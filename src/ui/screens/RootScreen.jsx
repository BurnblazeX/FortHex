import { MenuButton } from '../components/MenuButton.jsx';
import { InstallButton } from '../components/InstallButton.jsx';
import { Wordmark } from '../components/Wordmark.jsx';
import { LeaveRoomIfAny } from '../net-store.js';
import {
    OpenSettings, OpenChangelog, OpenTutorial, OpenLoadGame, IsMatchInProgress,
    StartMatch, GetMaps,
} from '../bridge.js';

export function RootScreen({ onGoTo, onClose }) {
    // Nothing to close onto at launch - the menu IS the first screen. The close
    // affordance only makes sense once a match exists behind it.
    const canClose = IsMatchInProgress();

    // Wordmark, panel and footer are SIBLINGS, not nested: .fh-menu places each in
    // its own grid row (src/ui/menu.css), so the title sits in the space above the
    // buttons and the credits sit at the bottom of the viewport, and neither shifts
    // when the button stack grows or shrinks.
    return (
        <>
            {/* The wordmark doubles as a quick-play shortcut straight into local
                multiplayer on the default map - the fastest way into a game without
                walking the Play > Multiplayer > Local path. */}
            <Wordmark
                className="fh-menu__wordmark"
                title="Quick play - local multiplayer"
                onClick={() => { LeaveRoomIfAny(); onClose(); StartMatch({ mode: 'local', map: GetMaps()[0] }); }}
            />

            <div className="fh-menu__panel">
                <div className="fh-menu__options">
                    <MenuButton variant="play" onClick={() => onGoTo('play')}>Play</MenuButton>

                    {/* Not in the roadmap's three-item root, but menu-first boot put
                        the toolbar's Load button behind this screen - without a door
                        here, a saved game could only be reached by starting a match
                        first. The menu stays up underneath: cancelling the file picker
                        returns here, and a successful load closes it. */}
                    <MenuButton onClick={OpenLoadGame}>Load Game</MenuButton>

                    {/* A real button again. It spent a while as a small link under the
                        credits, which is where things go to be missed. */}
                    <MenuButton variant="confirm" onClick={OpenChangelog}>Changelog</MenuButton>

                    {/* Moved off the board, where it was a floating purple circle that
                        never stopped being visible. Keeps its purple. Still the static
                        reference modal; a guided version is a Candidates job. */}
                    <MenuButton variant="accent" onClick={OpenTutorial}>Tutorial</MenuButton>

                    {/* Grey and iconned, as it was before B1. Settings is the one item
                        here that does not start a game, and looking different is how
                        the menu says so without a label explaining it. */}
                    <MenuButton variant="muted" className="fh-menu__settings" onClick={OpenSettings}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2.5"
                             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                        Settings
                    </MenuButton>

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

            {/* The corner install button. A sibling rather than a menu item, because it
                positions itself in the bottom-left and has nothing to do with the
                stack's layout. Being inside the React tree is what keeps it off the
                game screen: the menu unmounts and it goes with it. */}
            <InstallButton />

            {/* B1b. The attribution is a permanent fixture of the root screen rather
                than buried in an About page - the point of it is that the answer to
                "did AI make this" is already on record without being asked for. */}
            <div className="fh-menu__footer">
                Made by Mirza Musab (Burn). Made possible by Gemini &amp; Claude: {' '}
                <button type="button" className="fh-menu__linkbutton" onClick={() => onGoTo('credits')}>
                    AI Declaration
                </button>
                . All Rights Reserved.
            </div>
        </>
    );
}
