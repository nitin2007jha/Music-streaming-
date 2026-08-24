// firebase-messaging-sw.js
// Place this file at the SAME LEVEL as index.html (site root), alongside
// your existing sw.js. It must be reachable at /firebase-messaging-sw.js.
//
// This is what wakes up and shows an OS-level notification when the app
// is closed or in the background. When the app is open and focused,
// the onMessage() handler inside index.html handles it instead.

importScripts("https://www.gstatic.com/firebasejs/9.15.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.15.0/firebase-messaging-compat.js");

// Must match the firebaseConfig in index.html
firebase.initializeApp({
    apiKey: "AIzaSyCFJGZ1bJyqcH6qRXLqszLb1I8hU_0ofME",
    authDomain: "shanti-beats.firebaseapp.com",
    projectId: "shanti-beats",
    storageBucket: "shanti-beats.appspot.com",
    messagingSenderId: "1057045092960",
    appId: "1:1057045092960:web:ba0de9d6e20382285ec105"
});

const messaging = firebase.messaging();

// Background push → show system notification
messaging.onBackgroundMessage(payload => {
    const title = (payload.notification && payload.notification.title) || 'Musico';
    const body = (payload.notification && payload.notification.body) || '';
    const icon = (payload.notification && payload.notification.icon) || '/web-app-manifest-192x192.png';
    const data = payload.data || {};

    self.registration.showNotification(title, {
        body,
        icon,
        badge: '/favicon-96x96.png',
        tag: data.tag || 'musico-push',
        vibrate: [200, 100, 200],
        data,
        actions: data.chatUid
            ? [{ action: 'open_chat', title: '💬 Reply' }]
            : (data.songId ? [{ action: 'play', title: '▶ Play' }] : [])
    });
});

// Tapping the notification → open/focus the app at the right place.
// Deep-link scheme matches PAGE_TO_HASH / HASH_ROUTES in index.html —
// '/#/chat' opens the Chat tab, '?play=<id>' auto-plays a song.
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const data = event.notification.data || {};
    let url = '/';
    if (data.chatUid) url = '/#/chat';
    else if (data.songId) url = '/?play=' + data.songId;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) { client.navigate(url); return client.focus(); }
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
