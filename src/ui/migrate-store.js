// === "Modernise this save?" (B30) ===
//
// Testament's rule is that migration reshapes data and never re-judges it, so an old
// save keeps its old numbers forever. That is correct - rewriting them by default would
// invent a match nobody played - but it leaves no way to bring a file forward.
//
// This is that way, and it is the player's choice rather than ours. Two things keep it
// honest:
//
//   1. It is only ASKED when the answer would change something. Testament runs
//      faithfully first, the modernisation is previewed as a dry run, and a file with
//      nothing to change loads silently.
//   2. Declining is not a lesser path. It is the existing, faithful load - the same one
//      that has always run.
//
// The preview list is shown in full rather than summarised, because "damage 3 to 2" is
// the kind of change a player may well refuse, and they cannot refuse what they cannot
// see.

let state = {
    open: false,
    changes: [],
    fileName: null,
    resolve: null,   // settled with true (modernise) or false (load faithfully)
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

// Returns a promise the load path awaits. Resolving it is what lets the loader carry on,
// so every exit from the modal must settle it - including the decline.
export function AskAboutModernising({ changes, fileName }) {
    return new Promise((resolve) => {
        SetState({ open: true, changes: changes || [], fileName: fileName || null, resolve });
    });
}

export function AnswerModernise(shouldModernise) {
    const settle = state.resolve;
    SetState({ open: false, resolve: null });
    if (settle) settle(!!shouldModernise);
}
