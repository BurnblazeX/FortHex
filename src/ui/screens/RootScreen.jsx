import { MenuButton } from '../components/MenuButton.jsx';
import { Wordmark } from '../components/Wordmark.jsx';
import { LeaveRoomIfAny } from '../net-store.js';
import { OpenSettings, OpenChangelog, OpenLoadGame, IsMatchInProgress, StartMatch, GetMaps } from '../bridge.js';

export function RootScreen({ onGoTo, onClose }) {
    // Nothing to close onto at launch — the menu IS the first screen. The close
    // affordance only makes sense once a match exists behind it.
    const canClose = IsMatchInProgress();

    // Wordmark, panel and footer are SIBLINGS, not nested: .fh-menu places each in
    // its own grid row (src/ui/menu.css), so the title sits in the space above the
    // buttons and the credits sit at the bottom of the viewport, and neither shifts
    // when the button stack grows or shrinks.
    return (
        <>
            {/* The wordmark doubles as a quick-play shortcut straight into local
                multiplayer on the default map — the fastest way into a game without
                walking the Play > Multiplayer > Local path. */}
            <Wordmark
                className="fh-menu__wordmark"
                title="Quick play — local multiplayer"
                onClick={() => { LeaveRoomIfAny(); onClose(); StartMatch({ mode: 'local', map: GetMaps()[0] }); }}
            />

            <div className="fh-menu__panel">
                <div className="fh-menu__options">
                    <MenuButton onClick={() => onGoTo('play')}>Play</MenuButton>

                    {/* Not in the roadmap's three-item root, but menu-first boot put
                        the toolbar's Load button behind this screen — without a door
                        here, a saved game could only be reached by starting a match
                        first. The menu stays up underneath: cancelling the file picker
                        returns here, and a successful load closes it. */}
                    <MenuButton onClick={OpenLoadGame}>Load Game</MenuButton>

                    <MenuButton onClick={OpenSettings}>Settings</MenuButton>

                    {/* Disabled on purpose. A browser tab cannot close itself, and
                        there is no Electron shell in this repo yet. The slot is held
                        rather than the button omitted, so the menu does not visibly
                        change shape when Electron lands. */}
                    <MenuButton disabled title="Available in the desktop build">Exit</MenuButton>
                </div>

                {canClose && (
                    <MenuButton variant="cancel" className="fh-menu__back" onClick={onClose}>
                        Back to Match
                    </MenuButton>
                )}
            </div>

            {/* B1b. The attribution is a permanent fixture of the root screen rather
                than buried in an About page — the point of it is that the answer to
                "did AI make this" is already on record without being asked for. */}
            <div className="fh-menu__footer">
                Made by Mirza Musab (Burn). Made possible by Gemini &amp; Claude: {' '}
                <button type="button" className="fh-menu__linkbutton" onClick={() => onGoTo('credits')}>
                    AI Declaration
                </button>
                . All Rights Reserved.
                <div style={{ marginTop: '6px' }}>
                    <button type="button" className="fh-menu__linkbutton" onClick={OpenChangelog}>
                        Changelog
                    </button>
                </div>
            </div>
        </>
    );
}
