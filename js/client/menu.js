// === Main menu wiring (moved from main.js - A1 step 12) ===
//
// Menu/modal navigation listeners, lifted out of the old window.onload so
// js/main.js can be the composition root the guide's §4 describes rather than
// a 1200-line bootstrap. Each function here registers one screen's listeners
// and is called once, in order, from js/main.js.

// The logo IS the connection indicator now - white online, red offline. The
// separate wifi glyph that used to sit top-right is gone, and that corner belongs
// to the notification stack (src/ui/components/Notifications.jsx).
//
// navigator.onLine only reports whether the browser has a network interface, not
// whether it can reach anything. That was true of the old indicator too; a real
// reachability signal has to come from Track B2's transport, and this is the
// element it should drive when it exists.
function WireConnectionStatus() {
    const icon = document.getElementById('gameIcon');
    if (!icon) return;

    function UpdateConnectionStatus() {
        icon.classList.toggle('is-offline', !navigator.onLine);
        icon.classList.toggle('is-online', navigator.onLine);
    }

    window.addEventListener('online', UpdateConnectionStatus);
    window.addEventListener('offline', UpdateConnectionStatus);
    UpdateConnectionStatus();
}

function WireMainMenu() {
    // The hex logo: a hard restart, unchanged from before.
    document.getElementById('gameIconLink').addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById('customConfirmMessage').textContent =
            'Are you sure you want to restart? Any unsaved progress will be lost.';
        currentConfirmAction = () => { location.reload(); };
        if (ui.customConfirmModal) {
            ui.customConfirmModal.style.display = 'flex';
            setTimeout(() => ui.customConfirmModal.classList.add('modal-visible'), 10);
        }
    });

    // The in-game menu trigger. Clearing selection first is carried over verbatim:
    // opening the menu with a unit selected and a debug path drawn used to leave both
    // behind on the board underneath.
    //
    // The TITLE is the trigger now - the separate "Menu" link beside the logo was a
    // second control doing the same job in the same corner, and the title was already
    // the most obvious thing on screen.
    //
    // Toggles rather than only opening. When a match is running the menu is something
    // you are looking THROUGH at the board, so clicking the trigger again is the same
    // gesture as the root screen's "Back to Match" and should do the same thing.
    // With no match behind it there is nothing to close onto, so it only opens.
    document.getElementById('gameTitleTrigger').addEventListener('click', () => {
        if (IsMainMenuOpen() && IsMatchInProgress()) {
            HideMainMenu();
            return;
        }
        clearSelectionAndDebugState();
        ShowMainMenu();
    });
}

// The one call every plain script makes to open the menu. Wrapped rather than left
// as a bare window.FortHexUI.Show() at each call site so there is a single place to
// look if the bundle ever fails to load - which, unlike a missing DOM element, is
// silent otherwise.
function ShowMainMenu(screen) {
    if (!window.FortHexUI) {
        console.error('[Menu] dist/ui-bundle.js did not load - run `npm run build`.');
        return;
    }
    window.FortHexUI.Show(screen);
}

function HideMainMenu() {
    if (window.FortHexUI) window.FortHexUI.Hide();
}

function IsMainMenuOpen() {
    return !!(window.FortHexUI && window.FortHexUI.IsOpen());
}

// Whether there is a board behind the menu. Mirrors IsMatchInProgress in
// src/ui/bridge.js, which the root screen uses to decide whether to offer
// "Back to Match" at all - the two answers must agree or the trigger would close
// the menu onto nothing.
function IsMatchInProgress() {
    return !!(engine && engine.state && engine.state.tiles && engine.state.tiles.size > 0);
}
