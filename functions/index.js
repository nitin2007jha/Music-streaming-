/**
 * Musico — Cloud Functions for push notifications
 * ─────────────────────────────────────────────────
 * Deploy:
 *   cd functions
 *   npm install
 *   firebase deploy --only functions
 *
 * Requires the Blaze (pay-as-you-go) plan — Firestore triggers don't run
 * on the free Spark plan. Cost is usually ₹0 for small apps (huge free
 * quota); set a billing alert if you're worried.
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

setGlobalOptions({ region: "asia-south1" }); // change to your Firestore region if different

// ─────────────────────────────────────────────────────────────────
// Helper: send to a list of tokens, and auto-clean any that are dead
// (uninstalled app, permission revoked, etc.) so the array doesn't
// grow forever with tokens that will never work again.
// ─────────────────────────────────────────────────────────────────
async function sendAndPruneTokens(userRef, tokens, message) {
    if (!tokens || !tokens.length) return;
    const res = await messaging.sendEachForMulticast({ tokens, ...message });

    const deadTokens = [];
    res.responses.forEach((r, i) => {
        if (!r.success) {
            const code = r.error && r.error.code;
            if (code === "messaging/registration-token-not-registered" ||
                code === "messaging/invalid-argument") {
                deadTokens.push(tokens[i]);
            }
        }
    });
    if (deadTokens.length) {
        await userRef.update({ fcmTokens: FieldValue.arrayRemove(...deadTokens) });
    }
}

// ─────────────────────────────────────────────────────────────────
// 1) NEW CHAT MESSAGE → push the recipient
//    chatId is built client-side as [uidA, uidB].sort().join('_')
//    (see getChatId() in index.html) — so we can recover both
//    participants directly from the path, no extra lookup needed.
// ─────────────────────────────────────────────────────────────────
exports.onNewChatMessage = onDocumentCreated(
    "chats/{chatId}/messages/{messageId}",
    async (event) => {
        const msg = event.data.data();
        const { chatId } = event.params;
        const [uidA, uidB] = chatId.split("_");
        const recipientUid = msg.senderId === uidA ? uidB : uidA;
        if (!recipientUid || recipientUid === msg.senderId) return;

        const recipientRef = db.collection("users").doc(recipientUid);
        const recipientSnap = await recipientRef.get();
        if (!recipientSnap.exists) return;
        const recipient = recipientSnap.data();
        const tokens = recipient.fcmTokens || [];
        if (!tokens.length) return;

        const preview =
            msg.type === "song" ? `🎵 Shared a song: ${msg.song?.title || ""}` :
            msg.type === "image" ? "📷 Sent a photo" :
            (msg.text || "New message");

        await sendAndPruneTokens(recipientRef, tokens, {
            notification: {
                title: msg.senderName || "New message",
                body: preview.slice(0, 120),
                icon: "/web-app-manifest-192x192.png"
            },
            data: {
                type: "chat",
                chatUid: msg.senderId,
                tag: "musico-chat-" + chatId
            },
            webpush: {
                fcmOptions: { link: "/#/chat" },
                notification: { icon: "/web-app-manifest-192x192.png" }
            }
        });
    }
);

// ─────────────────────────────────────────────────────────────────
// 2) NEW SONG ADDED → broadcast to everyone subscribed to the
//    'new_songs' topic. Tokens get subscribed automatically below
//    whenever a user's fcmTokens array changes.
// ─────────────────────────────────────────────────────────────────
exports.onNewSongAdded = onDocumentCreated("songs/{songId}", async (event) => {
    const song = event.data.data();
    await messaging.send({
        topic: "new_songs",
        notification: {
            title: "🎵 New Song Added!",
            body: `${song.title || "A new song"} — ${song.artist || "Musico"}`,
            icon: "/web-app-manifest-192x192.png"
        },
        data: { type: "song", songId: event.params.songId },
        webpush: {
            fcmOptions: { link: "/?play=" + event.params.songId },
            notification: { icon: "/web-app-manifest-192x192.png" }
        }
    });
});

// ─────────────────────────────────────────────────────────────────
// 3) Keep topic subscriptions in sync whenever a user's fcmTokens
//    array changes (new device registers, or push disabled).
// ─────────────────────────────────────────────────────────────────
exports.syncTopicSubscription = onDocumentWritten("users/{uid}", async (event) => {
    const before = event.data.before.exists ? event.data.before.data().fcmTokens || [] : [];
    const after = event.data.after.exists ? event.data.after.data().fcmTokens || [] : [];

    const added = after.filter((t) => !before.includes(t));
    const removed = before.filter((t) => !after.includes(t));

    if (added.length) await messaging.subscribeToTopic(added, "new_songs");
    if (removed.length) await messaging.unsubscribeFromTopic(removed, "new_songs");
});
