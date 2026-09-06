// === PWA install + service worker (moved from main.js - A1 step 12) ===
//
// Install-prompt capture and service worker registration. Nothing to do with
// the game; it just needed somewhere to live that isn't the composition root.

// The browser fires beforeinstallprompt ONCE and the event cannot be recreated, so it is
// stashed here at module scope rather than inside WirePwaInstall. It was function-scoped
// while a button inside that same function was the only thing reading it; the menu reads
// it now, from outside, and a let that is not in scope is a ReferenceError rather than an
// undefined - which took the whole menu down on mount.
let deferredPrompt = null;

function WirePwaInstall() {
    // PWA INSTALLATION LOGIC (replaces the old single-file HTML download)

    // 1. Catch the install prompt from the browser
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); // Prevent Chrome's default mini-infobar
        deferredPrompt = e; // Stash the event so we can trigger it later
        // Held rather than shown: the floating button this used to reveal is gone. The
        // menu asks CanInstallApp() and calls InstallApp() instead, and this event is
        // how it learns the answer changed - it fires once, and can land either side
        // of the menu mounting.
        window.dispatchEvent(new CustomEvent('forthex-installable'));
    });

    // 3. Nothing to hide any more, but the stashed prompt is spent once installed.
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
    });

    // 4. Register the Service Worker (Required for PWA to work)
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(err => {
                console.warn('Service Worker Registration Failed:', err);
            });
        });
    }
}

// Whether the browser has offered an install for this page. False in most cases:
// already installed, not eligible, or a browser that does not do this at all.
function CanInstallApp() {
    return !!deferredPrompt;
}

// Fires the browser's own install dialog. One shot: the event cannot be reused, so
// it is discarded either way.
async function InstallApp() {
    if (!deferredPrompt) return false;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;

    if (outcome === 'accepted') {
        ShowSuccess('FortHex installed successfully!');
        return true;
    }
    return false;
}
