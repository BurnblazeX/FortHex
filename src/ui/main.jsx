// === React entry point (B1) ===
//
// Bundled by tools/build-ui.js into dist/ui-bundle.js, loaded as the last script
// on the page. The only thing it exposes to the rest of the codebase is
// window.FortHexUI — every plain script that needs to open or close the menu goes
// through that, and nothing reaches into React internals.

import { createRoot } from 'react-dom/client';
import { MenuApp } from './MenuApp.jsx';
import { Notifications } from './components/Notifications.jsx';
import { ShowMenu, HideMenu, GetSnapshot } from './menu-store.js';
import { Notify } from './notify-store.js';
import './menu.css';

let root = null;

function Mount() {
    if (root) return;

    const container = document.getElementById('menuRoot');
    if (!container) {
        console.error('[UI] #menuRoot is missing from index.html — the menu cannot mount.');
        return;
    }

    // Both trees share one root. The notification stack is position:fixed and the
    // menu is a fixed full-screen surface, so neither affects the other's layout —
    // and the toasts must outlive the menu, which unmounts every time it is hidden.
    root = createRoot(container);
    root.render(<><MenuApp /><Notifications /></>);
}

window.FortHexUI = {
    Mount,
    Show: ShowMenu,
    Hide: HideMenu,

    // Read by the top-left Menu trigger (js/client/menu.js) so it can toggle.
    IsOpen: () => GetSnapshot().visible,

    // Called from js/ via ShowAlert / ShowWarning (js/client/ui.js). Anything that
    // is not 'error' or 'warn' shows nothing — see src/ui/notify-store.js.
    Notify,
};
