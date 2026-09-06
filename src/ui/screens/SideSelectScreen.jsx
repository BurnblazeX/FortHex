import { MenuButton } from '../components/MenuButton.jsx';

export function SideSelectScreen({ onPick, onBack }) {
    return (
        <div className="fh-menu__panel">
            <h2 className="fh-menu__title">Choose Your Side</h2>

            <div className="fh-menu__options">
                <MenuButton
                    style={{ backgroundColor: '#5dade2', boxShadow: '0 3px #3090D0' }}
                    onClick={() => onPick(1)}
                >
                    Play as Blue (P1)
                </MenuButton>
                <MenuButton
                    style={{ backgroundColor: '#E04030', boxShadow: '0 3px #C03020' }}
                    onClick={() => onPick(2)}
                >
                    Play as Red (P2)
                </MenuButton>
            </div>

            <p className="fh-menu__note">Red moves second - the AI takes the opening turn.</p>

            <MenuButton variant="cancel" className="fh-menu__back" onClick={onBack}>Back</MenuButton>
        </div>
    );
}
