// A minimal Service Worker to satisfy PWA install requirements
self.addEventListener('install', (e) => {
    self.skipWaiting(); // Forces the service worker to activate immediately
});

self.addEventListener('fetch', (e) => {
    // Just a pass-through. We aren't doing aggressive offline caching yet 
    // so we don't break your development cycle!
    e.respondWith(fetch(e.request).catch(() => new Response('Offline')));
});