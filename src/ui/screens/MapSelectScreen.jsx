import { MenuButton } from '../components/MenuButton.jsx';
import { MapCard } from '../components/MapCard.jsx';
import { GetMaps } from '../bridge.js';

// New in B1: singleplayer hardcoded DEFAULT_MAP_LAYOUT_RADIUS_3 and never asked.
export function MapSelectScreen({ playerSide, onPick, onBack }) {
    const maps = GetMaps();

    return (
        <div className="fh-menu__panel">
            <h2 className="fh-menu__title">Select Map</h2>
            <p className="fh-menu__subtitle">
                Playing as {playerSide === 1 ? 'Blue (P1)' : 'Red (P2)'}
            </p>

            <div className="fh-menu__maps">
                {maps.map(map => (
                    <MapCard key={map.name} map={map} onSelect={onPick} />
                ))}
            </div>

            <MenuButton variant="cancel" className="fh-menu__back" onClick={onBack}>Back</MenuButton>
        </div>
    );
}
