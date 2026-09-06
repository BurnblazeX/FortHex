import { useEffect, useRef } from 'react';
import { DrawMapPreview } from '../bridge.js';

// The canvas thumbnail is drawn by renderMapPreview (js/client/ui.js), the same
// function the map maker's Select Map view has always used - not a reimplementation.
// It reads TEAM_COLORS live, so the preview follows the player's colour settings.
export function MapCard({ map, onSelect }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (canvasRef.current) DrawMapPreview(canvasRef.current, map);
    }, [map]);

    // Radius 2 forces arcade (SetGridMode, js/server/map-generation.js) - no flags,
    // no base camps, turn timer on. Saying so on the card is the alternative to the
    // chosen mode being silently overridden after the player has already picked it.
    const isArcade = (map.radius === 2);

    return (
        <button type="button" className="fh-map-card" onClick={() => onSelect(map)}>
            <canvas ref={canvasRef} width={140} height={120} />
            <span className="fh-map-card__name">{map.name}</span>
            <span className="fh-map-card__meta">
                {isArcade ? 'Compact · Arcade rules' : `Radius ${map.radius}`}
            </span>
        </button>
    );
}
