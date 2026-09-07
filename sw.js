// A minimal Service Worker to satisfy PWA install requirements
self.addEventListener('install', (e) => {
    self.skipWaiting(); // Forces the service worker to activate immediately
});

// Takes control of pages that were loaded by an EARLIER version of this worker,
// rather than waiting for the next navigation. Without it the broken pass-through
// below stayed in charge of every already-open tab.
self.addEventListener('activate', (e) => {
    e.waitUntil(self.clients.claim());
});

// Deliberately empty, and the emptiness is the fix.
//
// This used to be `e.respondWith(fetch(e.request).catch(() => new Response('Offline')))`,
// described as "just a pass-through". It was not one, and it broke two things:
//
//   Re-issuing e.request for a CROSS-ORIGIN subresource yields an OPAQUE response -
//   no readable body, no usable content type. The Google Fonts stylesheet therefore
//   arrived as a sheet with zero rules and no font faces, which Firefox reports as
//   'MIME type "text/plain" is not "text/css"'. Exo 2 and Lexend Deca silently fell
//   back to sans-serif on every browser, not just ones with tracking protection.
//   Same reason Cloudflare's beacon failed its integrity check: you cannot verify a
//   hash against a body you are not allowed to read.
//
//   And the catch turned a FAILED request into a fake 200 serving the literal string
//   "Offline". A stylesheet, a script or an image that quietly becomes eight bytes of
//   text is far harder to diagnose than one that simply fails.
//
// A fetch handler has to EXIST for the app to be installable; it does not have to
// answer anything. Letting the request fall through to the network is exactly the
// "pass-through" that was intended, and the browser already does it perfectly.
//
// When real offline caching arrives, it belongs here - and it must be same-origin,
// GET-only, and must never fabricate a response for a request it did not cache.
self.addEventListener('fetch', () => {
    // No respondWith: the browser handles the request itself.
});
