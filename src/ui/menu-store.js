// === Menu navigation state (B1) ===
//
// Which screen is showing, and whether the menu is up at all. Deliberately a
// module-level store rather than React state on a parent component, because the
// menu is opened and closed from OUTSIDE the React tree: the hex-icon trigger,
// the Settings and Changelog modals' Back buttons, and the "return to menu" paths
// in ai-training.js all live in plain scripts. Those call window.FortHexUI, which
// calls in here, and every mounted component re-renders.
//
// useSyncExternalStore is the supported way to read this from a component; the
// contract it needs is that GetSnapshot returns the SAME object reference until
// something actually changes, which is why SetState replaces the object rather
// than mutating it.

let state = { visible: false, screen: 'root' };
const listeners = new Set();

function SetState(patch) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
}

export function Subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function GetSnapshot() {
    return state;
}

// Opens the menu, optionally jumping straight to a screen. Callers outside React
// only ever want the root, but the profile flow re-enters at 'multiplayer' after
// the setup screen so a player who declines lands back where they clicked.
export function ShowMenu(screen) {
    SetState({ visible: true, screen: screen || 'root' });
}

export function HideMenu() {
    SetState({ visible: false });
}

export function GoTo(screen) {
    SetState({ screen });
}
