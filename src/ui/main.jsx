// === React entry point (B1) ===
//
// Bundled by tools/build-ui.js into dist/ui-bundle.js, loaded as the last script
// on the page. The only thing it exposes to the rest of the codebase is
// window.FortHexUI - every plain script that needs to open or close the menu goes
// through that, and nothing reaches into React internals.

import { createRoot } from 'react-dom/client';
import { MenuApp } from './MenuApp.jsx';
import { Notifications } from './components/Notifications.jsx';
import { ResolveDisconnect } from './components/ResolveDisconnect.jsx';
import { MigratePrompt } from './components/MigratePrompt.jsx';
import { ShowMenu, HideMenu, GetSnapshot } from './menu-store.js';
import { Notify } from './notify-store.js';
import { OpenResolution } from './resolve-store.js';
import { AskAboutModernising } from './migrate-store.js';
import { EndDirectMatch } from './direct-store.js';
import { Reset as EndManualMatch } from './manual-store.js';
import './menu.css';

let root = null;

function Mount() {
    if (root) return;

    const container = document.getElementById('menuRoot');
    if (!container) {
        console.error('[UI] #menuRoot is missing from index.html - the menu cannot mount.');
        return;
    }

    // Both trees share one root. The notification stack is position:fixed and the
    // menu is a fixed full-screen surface, so neither affects the other's layout -
    // and the toasts must outlive the menu, which unmounts every time it is hidden.
    root = createRoot(container);
    root.render(<><MenuApp /><Notifications /><ResolveDisconnect /><MigratePrompt /></>);
}

window.FortHexUI = {
    Mount,
    Show: ShowMenu,
    Hide: HideMenu,

    // Read by the top-left Menu trigger (js/client/menu.js) so it can toggle.
    IsOpen: () => GetSnapshot().visible,

    // Called from js/ via ShowAlert / ShowWarning (js/client/ui.js). Anything that
    // is not 'error' or 'warn' shows nothing - see src/ui/notify-store.js.
    Notify,

    // B3. Raised by the DISCONNECT_RESOLUTION_NEEDED event (js/client/actions.js).
    OpenResolution,

    // Testament's load path awaits this when an older save would change on
    // modernisation. Resolves true (modernise) or false (load faithfully).
    AskAboutModernising,

    // B2. Tears down a direct match's peer connection and its match worker.
    //
    // Called from EndOnlineMatch (js/main.js), which is the ONE place every remote
    // match ends - leaving a room, the match finishing, or simply starting a local
    // game instead. The stores cannot hook that themselves: it is a plain script
    // global, and only the game side knows when it fires. Without this, quitting a
    // direct match to play locally left a Web Worker running an engine and an open
    // data channel, with nothing left holding a reference to either.
    EndDirectSession: () => { EndDirectMatch(); EndManualMatch(); },
};
