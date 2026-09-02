// === Per-recipient state filtering (A2 §5) ===
//
// The server must never hand a client information that client isn't allowed to
// see. `fogOfWarEnabled` has lived on engine.settings since A1, so the engine
// was *able* to gate this; nothing actually did the gating. This is that.
//
// Built on computePlayerVision (js/server/rules.js) rather than a new vision
// system: fog visibility already exists and is already the rule the renderer
// obeys. Filtering is "apply that same mask to the outgoing payload".
//
// SCOPE DECISION (Burn, 2026-09-02): build the function, do not wire it into
// local pass-device play. Local multiplayer is one client instance shared by two
// humans, and showPassDeviceOverlay already covers the hand-the-device moment.
// The filter is what Track B's real networked clients need, so it exists, is
// unit-tested headlessly, and sits in transport.Flush() as a pass-through no-op
// while there is exactly one local recipient. Wiring it into pass-device play is
// a follow-up decision, not an oversight.

// Returns a filtered VIEW of match state as `recipientPlayer` is allowed to see
// it. Enemy units outside vision are replaced by a redacted stub rather than
// dropped, so a client can still tell "something was here last I looked" apart
// from "this list is short" without learning position, hp or type.
function FilterStateForPlayer(state, recipientPlayer, fogOfWarEnabled) {
    // Arcade has no fog and no base camps; nothing to hide.
    if (!fogOfWarEnabled || state.gameMode === 'arcade') {
        return {
            filtered: false,
            units: state.units.map(u => ({ ...u, hidden: false })),
            visibleTiles: new Set(state.tiles.keys()),
            visibleEdges: new Set(state.edges.keys()),
        };
    }

    const vision = computePlayerVision(recipientPlayer);

    const units = state.units.map(unit => {
        if (unit.player === recipientPlayer) return { ...unit, hidden: false };

        const seen = unit.isFortified
            ? vision.tiles.has(unit.position)
            : vision.edges.has(unit.position);

        if (seen) return { ...unit, hidden: false };

        // Redacted: the recipient learns a unit id exists and whose it is (they
        // may have seen it before), and nothing else.
        return { id: unit.id, player: unit.player, hidden: true };
    });

    return {
        filtered: true,
        units,
        visibleTiles: vision.tiles,
        visibleEdges: vision.edges,
    };
}

// Events carry unit references and positions, so they leak the same way state
// does. A LOG line naming an unseen enemy's move is still a leak, even though
// no coordinates are attached.
function FilterEventsForPlayer(events, recipientPlayer, fogOfWarEnabled) {
    if (!fogOfWarEnabled) return events;

    const vision = computePlayerVision(recipientPlayer);

    const visible = (unit) => {
        if (!unit || !unit.position) return true;
        if (unit.player === recipientPlayer) return true;
        return unit.isFortified ? vision.tiles.has(unit.position) : vision.edges.has(unit.position);
    };

    return events.filter(event => {
        switch (event.type) {
            case 'UNIT_DAMAGED':
            case 'SHIELD_GAINED':
                return visible(event.unit);
            case 'FLAG_CAPTURED':
                return event.player === recipientPlayer || visible(event.carrierUnit);
            case 'ACTION_REJECTED':
                // A rejection is addressed to whoever made the request.
                return event.player === recipientPlayer;
            default:
                // LOG, SUPPLY_CHANGED, VISION_INVALIDATED and anything added
                // later default to visible. Revisit per-type as Track B makes
                // recipients real - a LOG naming an unseen unit is a known
                // remaining leak, listed in the A2 handoff.
                return true;
        }
    });
}
