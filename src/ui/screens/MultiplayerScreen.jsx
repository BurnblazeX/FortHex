import { MenuButton } from '../components/MenuButton.jsx';
import { GetLocalProfile, StartMatch, GetMaps, Instruct } from '../bridge.js';
import { LeaveRoomIfAny } from '../net-store.js';

export function MultiplayerScreen({ onGoTo, onBack, onClose }) {
    const StartLocal = () => {
        LeaveRoomIfAny();
        onClose();
        // "Launches directly into the current local-multiplayer default, no additional
        // setup" - roadmap B1. The default map is the first entry, same as before.
        StartMatch({ mode: 'local', map: GetMaps()[0] });
    };

    const GoOnline = () => {
        // A5's contract, preserved: the profile screen is FIRST-ENTRY ONLY. A device
        // that already has a profile has already answered both questions and must not
        // be asked to re-consent or renamed. Everyone else goes straight to the rooms.
        if (GetLocalProfile()) { onGoTo('lobby'); return; }
        onGoTo('profile');
    };

    return (
        <div className="fh-menu__panel">
            <h2 className="fh-menu__title">Multiplayer</h2>

            <div className="fh-menu__options">
                <MenuButton onClick={StartLocal}>Local</MenuButton>
                <MenuButton onClick={GoOnline}>Online</MenuButton>
            </div>

            <p className="fh-menu__note">
                Local play shares one device, passing it between turns. Online connects
                to a FortHex server and needs one to be running.
            </p>

            <MenuButton variant="cancel" className="fh-menu__back" onClick={onBack}>Back</MenuButton>
        </div>
    );
}
