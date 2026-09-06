// === Notification stack (B1, opportunistic) ===
//
// Replaces #messageBox — the single red bar that showed every one of the game's
// 112 showInstruction calls in the same alarm colour, so "Game Saved!" and "Save
// File Corrupted." were visually identical.
//
// Three severities reach the screen and nothing else does:
//   'error' — red    : corrupted save, disconnect, load failure
//   'warn'  — yellow : invalid drop, illegal action, refused input
//   'ok'    — green  : an operation the player asked for succeeded
// Anything else is silent. Routine narration ("unit moved") is already in the
// action log and does not need announcing over the board as well.
//
// Same external-store shape as menu-store.js, and for the same reason: the callers
// are plain scripts in js/, not React components.

// Deliberately 2. A third arriving does not queue — a stack that grows under a burst
// of errors covers the board, and the action log is where the full history lives.
// The one it displaces is FADED rather than deleted: an item over capacity is marked
// `expiring`, which the Toast reads as "start your exit now", and it removes itself
// once that has run. Dropping it from this array outright would make it vanish
// mid-frame with no transition.
const MAX_VISIBLE = 2;

const SEVERITIES = ['error', 'warn', 'ok'];

let state = { items: [] };
const listeners = new Set();
let nextId = 1;

function SetState(items) {
    state = { items };
    listeners.forEach(listener => listener());
}

export function Subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function GetSnapshot() {
    return state;
}

// The one entry point. Returns the id so a caller could dismiss early; nothing
// does yet. An unrecognised severity is silent rather than an error — a call site
// that has not been triaged should show nothing, which is the default this whole
// change exists to establish.
export function Notify(message, severity) {
    if (!SEVERITIES.includes(severity)) return null;
    if (!message) return null;

    const id = nextId++;

    // Newest FIRST. The stack renders top-down, so a new message appears at the top
    // and pushes the previous one down.
    const items = [{ id, message: String(message), severity, expiring: false }, ...state.items];

    // Anything past capacity that is not already on its way out gets told to leave.
    // Only live items count toward the limit, so a toast still fading does not
    // reserve a slot against the ones that can actually be read.
    const live = items.filter(item => !item.expiring);
    if (live.length > MAX_VISIBLE) {
        const doomed = new Set(live.slice(MAX_VISIBLE).map(item => item.id));
        SetState(items.map(item => (doomed.has(item.id) ? { ...item, expiring: true } : item)));
        return id;
    }

    SetState(items);
    return id;
}

export function Dismiss(id) {
    SetState(state.items.filter(item => item.id !== id));
}
