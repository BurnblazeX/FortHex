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
            // Fog off: every rim cell is visible too, so the boundary ring draws
            // clear rather than being the one thing still fogged on an unfogged
            // board.
            // Guarded: a view can be built before buildFineGridIndex has run, and
            // a throw here kills the match rather than degrading it. No rim
            // simply means no boundary cells are named, which the renderer
            // already handles.
            visibleRim: state.fineGrid
                ? new Set([...state.fineGrid.keys()].filter(k => state.fineGrid.get(k).type === 'rim'))
                : new Set(),
        };
    }

    const vision = computePlayerVision(recipientPlayer);

    const units = state.units.map(unit => {
        if (unit.player === recipientPlayer) return { ...unit, hidden: false };

        const seen = unit.isFortified
            ? vision.tiles.has(unit.tileKey)
            : vision.edges.has(unit.edgeKey);

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
        visibleRim: vision.rim,
    };
}

// The board itself, shaped for a wire. Units are handled above; this is the terrain
// and the edges, which a remote client needs before it can draw anything at all -
// A1's state-sync carried only events, so a `move` reached a remote client as a LOG
// string with no way to render the result.
//
// Two things here are NOT incidental:
//
//   1. Edges are rebuilt field by field rather than spread. An edge carries a live
//      `units` getter that closes over engine state. It is defined non-enumerable in
//      both construction paths, so a spread does not currently invoke it - but that
//      is a property of how those two files happen to be written, not something this
//      function should depend on. (They disagreed until B2: map-generation.js used a
//      plain literal getter, which IS enumerable, so edges from the resize path did
//      serialize their units.) Naming the fields explicitly means what goes on the
//      wire is decided here rather than inherited.
//
//   2. Tile `type` is a TILE_TYPES object reference. Only its name goes out; the
//      client already has the table and rebuilding from a name is what the save
//      format does too.
//
// Terrain is not secret - both players chose and saw the map - so tiles go out whole.
// A BRIDGE is not terrain: it is built during play, so its state is gated on vision
// the same way a unit is, and `bridgeKnown` tells the client the difference between
// "no bridge" and "you cannot see".
function BuildBoardView(state, visibleEdges, filtered) {
    const tiles = [];
    state.tiles.forEach((tile, key) => {
        tiles.push({
            key,
            q: tile.q,
            r: tile.r,
            type: tile.type ? tile.type.name : null,
            fortifiedByPlayer: tile.fortifiedByPlayer || null,
        });
    });

    const edges = [];
    state.edges.forEach((edge, key) => {
        const seen = !filtered || visibleEdges.has(key);
        edges.push({
            key,
            q1: edge.q1, r1: edge.r1, q2: edge.q2, r2: edge.r2,
            bridge: seen ? !!edge.bridge : false,
            bridgeHp: seen ? (edge.bridgeHp === undefined ? null : edge.bridgeHp) : null,
            bridgeKnown: seen,
        });
    });

    return { tiles, edges };
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
        return unit.isFortified ? vision.tiles.has(unit.tileKey) : vision.edges.has(unit.edgeKey);
    };

    return events.filter(event => {
        switch (event.type) {
            case 'UNIT_DAMAGED':
            case 'SHIELD_GAINED':
            case 'SHIELD_BROKEN':
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
