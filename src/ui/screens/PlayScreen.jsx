import { MenuButton } from '../components/MenuButton.jsx';
import { StartTraining, IsDebugMode } from '../bridge.js';

export function PlayScreen({ onGoTo, onBack, onClose }) {
    return (
        <div className="fh-menu__panel">
            <h2 className="fh-menu__title">Play</h2>

            <div className="fh-menu__options">
                <MenuButton onClick={() => onGoTo('sp-side')}>Singleplayer</MenuButton>
                <MenuButton onClick={() => onGoTo('multiplayer')}>Multiplayer</MenuButton>

                {/* Training was a hidden button inside the old Singleplayer submenu,
                    revealed only by Debug Mode (js/client/settings-panel.js). It keeps
                    exactly that gate - it is a dev entry point, not a game mode. */}
                {IsDebugMode() && (
                    <MenuButton
                        style={{ backgroundColor: '#F0A010', boxShadow: '0 3px #D05000' }}
                        onClick={() => { onClose(); StartTraining(); }}
                    >
                        Training (Auto-Play)
                    </MenuButton>
                )}
            </div>

            <MenuButton variant="cancel" className="fh-menu__back" onClick={onBack}>Back</MenuButton>
        </div>
    );
}
