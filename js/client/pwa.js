// === PWA install + service worker (moved from main.js — A1 step 12) ===
//
// Install-prompt capture and service worker registration. Nothing to do with
// the game; it just needed somewhere to live that isn't the composition root.

function WirePwaInstall() {
    // PWA INSTALLATION LOGIC (Replaces old HTML download)
    let deferredPrompt;

    // 1. Catch the install prompt from the browser
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); // Prevent Chrome's default mini-infobar
        deferredPrompt = e; // Stash the event so we can trigger it later
        ui.downloadButton.style.display = 'flex'; // Show the button!
    });

    // 2. Bind the new install functionality to your Download Button
    ui.downloadButton.addEventListener('click', async () => {
        if (!deferredPrompt) {
            showInstruction("App cannot be installed right now.", 2000);
            return;
        }
        // Show the native browser install prompt
        deferredPrompt.prompt();

        // Wait for the user to respond
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            console.log('User installed FortHex');
            showInstruction('FortHex installed successfully!', 3000);
        }

        // We've used the prompt, throw it away and hide the button
        deferredPrompt = null;
        ui.downloadButton.style.display = 'none';
    });

    // 3. Hide button immediately if they install it successfully
    window.addEventListener('appinstalled', () => {
        ui.downloadButton.style.display = 'none';
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
