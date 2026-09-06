import { useSyncExternalStore } from 'react';
import { MenuButton } from './MenuButton.jsx';
import { Subscribe, GetSnapshot, CloseResolution, MarkSubmitting } from '../resolve-store.js';
import { ResolveDisconnectChoice, RemoteSeatNumber } from '../bridge.js';

// The one modal in the game with no way out.
//
// Every other overlay closes on a backdrop click or Escape, because every other overlay
// is asking about something optional. This one is asking what happens to a match whose
// other player is gone: dismissing it would leave the player on a board that cannot
// advance, with nothing on screen explaining why. So there is no backdrop dismiss, no
// close button, and no Escape handler - only the two answers.
const DESCRIPTIONS = {
    save: {
        label: 'Save and stop',
        detail: 'Writes the match to a save file. Load it later to pick up where you left off - '
              + 'against the same opponent if they come back, or locally.',
    },
    'continue-locally': {
        label: 'Continue on this device',
        detail: 'Keeps playing right now, with both sides on this machine. The match stops '
              + 'being online; nothing is lost.',
    },
};

export function ResolveDisconnect() {
    const state = useSyncExternalStore(Subscribe, GetSnapshot);

    if (!state.open) return null;

    const Choose = (choice) => {
        if (state.submitting) return;
        MarkSubmitting();

        // The server refuses this from the absent player by definition, so the seat sent
        // is this client's own - the one that stayed.
        ResolveDisconnectChoice(RemoteSeatNumber(), choice);
        CloseResolution();
    };

    return (
        <div className="fh-resolve">
            <div className="fh-resolve__panel">
                <h2 className="fh-resolve__title">Opponent did not return</h2>

                <p className="fh-resolve__body">
                    Player {state.player} disconnected and their time ran out. The match is
                    still here - choose what happens to it.
                </p>

                <div className="fh-resolve__choices">
                    {state.choices.map(choice => {
                        const described = DESCRIPTIONS[choice] || { label: choice, detail: '' };
                        return (
                            <button
                                key={choice}
                                type="button"
                                className="fh-resolve__choice"
                                disabled={state.submitting}
                                onClick={() => Choose(choice)}
                            >
                                <span className="fh-resolve__choice-label">{described.label}</span>
                                <span className="fh-resolve__choice-detail">{described.detail}</span>
                            </button>
                        );
                    })}
                </div>

                {state.submitting && <p className="fh-resolve__working">Resolving…</p>}
            </div>
        </div>
    );
}
