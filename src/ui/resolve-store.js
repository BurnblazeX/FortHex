// === Disconnect resolution (B3) ===
//
// The opponent's 100 seconds ran out. A3 emits DISCONNECT_RESOLUTION_NEEDED and stops
// there - deliberately, because the choice is a UI question and A3 had no UI. This is
// the state behind that question.
//
// Two answers, both from the server's own list (js/server/session.js):
//
//   'save'             write the match out as a save file and stop, to be resumed later
//   'continue-locally' carry on against the AI, or pass-device, on this machine
//
// It matters that this is asked rather than assumed. The roadmap's A3 is explicit that
// a timed-out match should not simply end with no resolution, and both answers keep the
// match alive in different ways - one on disk, one on this device.

let state = {
    open: false,
    player: null,        // the player who did NOT come back
    reason: null,
    choices: [],
    submitting: false,
};

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

// Called from js/client/actions.js when the event arrives.
export function OpenResolution({ player, reason, choices }) {
    SetState({
        open: true,
        player,
        reason: reason || null,
        choices: Array.isArray(choices) && choices.length ? choices : ['save', 'continue-locally'],
        submitting: false,
    });
}

export function CloseResolution() {
    SetState({ open: false, submitting: false });
}

export function MarkSubmitting() {
    SetState({ submitting: true });
}
