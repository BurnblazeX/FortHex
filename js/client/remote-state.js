// === Rendering someone else's board (B2) ===
//
// In a local match the client and the engine are the same process: the renderer reads
// engine.state and that IS the truth. In a hosted match the truth is a worker on the
// server, and what arrives here is a filtered VIEW of it (js/server/state-filter.js,
// attached to every state-sync by transport.Flush).
//
// So this file does one thing: write a received view into the local engine.state, so
// every existing renderer keeps working unchanged. render.js does not learn that the
// match is remote, and it should not — a client drawing a board is the same job either
// way, and the alternative was a second renderer that would immediately drift.
//
// What this deliberately does NOT do is run rules. The local engine is a DRAWING
// SURFACE during an online match, not an authority: nothing here validates, and the
// only thing that mutates real state is SubmitAction inside the host's worker.

// True while a hosted match is being drawn. Guards the places that would otherwise
// try to reason locally about a board they do not own.
let renderingRemoteMatch = false;
let remoteSeat = null;

function IsRemoteMatch() { return renderingRemoteMatch; }
function RemoteSeat() { return remoteSeat; }

function BeginRemoteMatch(seat) {
    renderingRemoteMatch = true;
    remoteSeat = seat;

    // The player is one side of a two-player game they do not host, which is exactly
    // the shape singleplayer already describes to the rest of the client.
    engine.state.gameMode = 'online';
    engine.state.playerSide = seat;
    engine.state.gameOver = false;
}

function EndRemoteMatch() {
    renderingRemoteMatch = false;
    remoteSeat = null;
}

// Terrain arrives as a NAME, not the TILE_TYPES object — see BuildBoardView for why.
// Rebuilding from the name is what the save format does too.
function TileTypeFromName(name) {
    if (!name) return TILE_TYPES.PLAINS;
    const wanted = String(name).toUpperCase();
    return TILE_TYPES[wanted] || Object.values(TILE_TYPES).find(t => t.name && t.name.toUpperCase() === wanted) || TILE_TYPES.PLAINS;
}

// The whole of it. Called for every state-sync that carries a view, and for the
// resync a reconnecting client receives.
function ApplyRemoteView(view) {
    if (!view) {
        console.warn('[Online] ApplyRemoteView called with nothing to apply.');
        return;
    }

    // --- tiles ---
    if (Array.isArray(view.tiles)) {
        engine.state.tiles.clear();
        view.tiles.forEach(tile => {
            engine.state.tiles.set(tile.key, {
                q: tile.q,
                r: tile.r,
                type: TileTypeFromName(tile.type),
                fortifiedByPlayer: tile.fortifiedByPlayer || null,
            });
        });
    }

    // --- edges ---
    // The `units` accessor is rebuilt here rather than carried: it is a live view over
    // engine.state.units, so it cannot travel and must be re-attached on arrival.
    // Non-enumerable for the same reason it is everywhere else — it must not end up
    // serialized into a save or a subsequent payload.
    if (Array.isArray(view.edges)) {
        engine.state.edges.clear();
        view.edges.forEach(edge => {
            const rebuilt = {
                q1: edge.q1, r1: edge.r1, q2: edge.q2, r2: edge.r2,
                bridge: !!edge.bridge,
                bridgeHp: edge.bridgeHp === undefined ? null : edge.bridgeHp,
                isPathway: true,
            };
            Object.defineProperty(rebuilt, 'units', {
                get: function () {
                    return engine.state.units.filter(u => u.positionType === 'edge' && u.position === edge.key);
                },
                configurable: true,
                enumerable: false,
            });
            engine.state.edges.set(edge.key, rebuilt);
        });
    }

    // --- units ---
    // Redacted enemies (fog) arrive as { id, player, hidden: true } with no position.
    // They are dropped rather than kept as stubs: every renderer here expects a unit to
    // have somewhere to be drawn, and a stub with no position would either crash a draw
    // call or need a special case in each one. The id is retained by the server so a
    // future "last known position" feature can use it; nothing draws it today.
    if (Array.isArray(view.units)) {
        engine.state.units = view.units.filter(unit => !unit.hidden);

        // Every unit object was just REPLACED. Anything still pointing at one of the old
        // ones is holding a stale copy with a stale position — which is how a swordsman
        // that had moved several edges away could still be offered Build Bridge against
        // the water it started next to. Re-link by id, or drop the selection if that
        // unit is no longer visible at all.
        if (gameState.selectedUnit) {
            gameState.selectedUnit = engine.state.units.find(u => u.id === gameState.selectedUnit.id) || null;
        }
        if (gameState.draggingUnit) {
            gameState.draggingUnit = engine.state.units.find(u => u.id === gameState.draggingUnit.id) || null;
        }

        // The reachable set was computed against the previous board. It is not adjusted,
        // it is discarded: re-deriving it here would be the client reasoning about rules
        // during a match it does not own, and the highlights come back on next select.
        if (gameState.currentReachableMoves) gameState.currentReachableMoves.clear();
        if (typeof resetActionSelectionStates === 'function') resetActionSelectionStates();
    }

    // --- derived indexes ---
    //
    // The fine grid is not stored, it is DERIVED from tiles and edges — which is why
    // every other path that replaces a board rebuilds it (match-setup.js after
    // InitializeGrid, save.js after a load, map-generation.js after a resize). This path
    // replaced the board and did not, so engine.state.fineGrid stayed empty.
    //
    // Everything spatial reads it. getAttackRangeCells returned zero cells, so the
    // Attack button was permanently greyed out with an enemy standing right next to
    // you: not an attack bug at all, a board that had no geometry.
    //
    // Anything else derived belongs here too, for the same reason.
    buildFineGridIndex();

    // --- everything else the renderer reads ---
    if (view.currentPlayer !== undefined) engine.state.currentPlayer = view.currentPlayer;
    if (view.globalTurnNumber !== undefined) engine.state.globalTurnNumber = view.globalTurnNumber;
    if (view.supplyPoints) engine.state.supplyPoints = { ...view.supplyPoints };
    if (view.flags !== undefined) engine.state.flags = view.flags;
    if (view.gameOver !== undefined) engine.state.gameOver = view.gameOver;

    // Vision comes from the HOST, it is not recomputed here.
    //
    // The client was deriving fog from its own copy of the board — a board it has only
    // been shown part of. That is the same mistake as adjudicating victory locally: the
    // server already decided what this player can see (it had to, in order to know what
    // to send), so recomputing could only ever agree by luck and disagree in the gaps.
    //
    // Writing it straight into visionCache with visionDirty cleared means render.js's
    // existing "recompute if dirty or the perspective changed" test simply finds the
    // answer already there, and nothing in the renderer had to change.
    if (Array.isArray(view.visibleTiles) && Array.isArray(view.visibleEdges)) {
        engine.visionCache = {
            player: engine.state.playerSide,
            tiles: new Set(view.visibleTiles),
            edges: new Set(view.visibleEdges),
        };
        engine.visionDirty = false;
    } else {
        engine.visionCache = null;
        engine.visionDirty = true;
    }

    gameState.needsRedraw = true;

    // One line per board, so a match that stops updating is visible in the console as
    // a stream that stopped rather than as a canvas that looks frozen for no reason.
    console.log('[Online] board applied — ' + engine.state.tiles.size + ' tiles, '
        + engine.state.edges.size + ' edges, ' + engine.state.units.length + ' units, '
        + 'P' + engine.state.currentPlayer + ' to move');
}

// Refreshes the panels that read state rather than being drawn on the canvas. Kept
// separate from ApplyRemoteView so a burst of syncs can apply cheaply and repaint once.
function RefreshRemoteUi() {
    // Whose turn it is came from the host a moment ago, so the button follows it.
    //
    // Nothing was doing this online: the local turn lifecycle sets the button state in
    // finalizeVisuals, and that whole path is skipped in a hosted match. So End Turn sat
    // enabled for both players, and clicking it on your opponent's turn sent a request
    // the server used to accept — it does not any more, but a button that is only
    // stopped by the server is still a button that should have been greyed out.
    if (ui && ui.endTurnButton) {
        ui.endTurnButton.disabled = IsOpponentsTurn() || !!engine.state.gameOver;
    }

    updateTurnDisplay();
    updateGlobalTurnDisplay();
    updateSelectedUnitInfoPanel();
    updateSupplyPointsDisplay();
    updateActionLogDisplay();

    // checkVictoryCondition is DELIBERATELY not called here.
    //
    // It runs the real rule against the local engine — and in a hosted match the local
    // engine is a drawing surface holding a FILTERED board. Under fog it contains no
    // enemy units at all, so the very first refresh saw an empty enemy army and handed
    // somebody an immediate win by annihilation.
    //
    // The host decides the match is over and says so: `gameOver` rides in the view, and
    // the VICTORY event it emits is already handled by HandleActionEvent. Nothing here
    // needs to work it out, and nothing here is in a position to.
}
