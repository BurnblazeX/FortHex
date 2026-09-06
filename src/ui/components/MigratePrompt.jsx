import { useSyncExternalStore } from 'react';
import { MenuButton } from './MenuButton.jsx';
import { Subscribe, GetSnapshot, AnswerModernise } from '../migrate-store.js';

// Shown only when modernising would actually change something - see migrate-store.js.
//
// Deliberately just the question. The per-unit change list this used to render was
// developer detail - accurate, and meaningless to a player looking at
// "unit_1_archer_1788353131393_e2ead70b8413e: damage 3 to 2". It still goes to the
// console on every load, which is where that belongs.
//
// Like the disconnect resolution, this has no dismiss: the load is waiting on an answer,
// and closing it without one would leave the file half-loaded. Unlike that one, BOTH
// answers here are ordinary - declining is the faithful load that has always happened,
// not a fallback.
export function MigratePrompt() {
    const state = useSyncExternalStore(Subscribe, GetSnapshot);

    if (!state.open) return null;

    return (
        <div className="fh-resolve">
            <div className="fh-resolve__panel fh-migrate">
                <h2 className="fh-resolve__title">Migrate to Modern Ruleset &amp; Fix Bugs?</h2>

                <p className="fh-resolve__body">
                    This save was written under an older ruleset.
                </p>

                <div className="fh-menu__row" style={{ marginTop: '4px' }}>
                    <MenuButton onClick={() => AnswerModernise(true)}>Yes, migrate</MenuButton>
                    <MenuButton variant="cancel" onClick={() => AnswerModernise(false)}>
                        No, load as saved
                    </MenuButton>
                </div>
            </div>
        </div>
    );
}
