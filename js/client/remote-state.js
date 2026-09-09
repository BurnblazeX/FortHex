// === Rendering someone else's board (B2) ===
//
// In a local match the client and the engine are the same process: the renderer reads
// engine.state and that IS the truth. In a hosted match the truth is a worker on the
// server, and what arrives here is a filtered VIEW of it (js/server/state-filter.js,
// attached to every state-sync by transport.Flush).
//
// So this file does one thing: write a received view into the local engine.state, so
// every existing renderer keeps working unchanged. render.js does not learn that the
// match is remote, and it should not - a client drawing a board is the same job either
// way, and the alternative was a second renderer that would immediately drift.
//
// What this deliberately does NOT do is run rules. The local engine is a DRAWING
// SURFACE during an online match, not an authority: nothing here validates, and the
// only thing that mutates real state is SubmitAction inside the host's worker.

// True while a hosted match is being drawn. Guards the places that would otherwise
// try to reason locally about a board they do not own.
let renderingRemoteMatch = false;
let remoteSeat = null;

// The host's verdict for the match being drawn, as it last arrived. Null until the
// match ends. A player who rejoins a finished match gets it on their very first view,
// which is the case the VICTORY event cannot cover - that event fired while they
// were away.
let remoteVerdict = null;

// Host or guest, held explicitly rather than inferred. They are genuinely different
// roles - the host owns the match (starting it, the map, the save) and a guest is a
// participant in someone else's - and every rule that differs between them should read
// from one place instead of each site working it out again.
let remoteIsHost = false;

function IsRemoteMatch() { return renderingRemoteMatch; }
function RemoteSeat() { return remoteSeat; }
function IsRemoteHost() { return renderingRemoteMatch && remoteIsHost; }
function IsRemoteGuest() { return renderingRemoteMatch && !remoteIsHost; }

function BeginRemoteMatch(seat, isHost = false) {
    renderingRemoteMatch = true;
    remoteSeat = seat;
    remoteIsHost = !!isHost;

    // The player is one side of a two-player game they do not host, which is exactly
    // the shape singleplayer already describes to the rest of the client.
    engine.state.gameMode = 'online';
    engine.state.playerSide = seat;
    engine.state.gameOver = false;
    remoteVerdict = null;

    // A second match in the same session must not open under the first one's victory
    // overlay. Burn played two consecutive matches; this is the line that keeps the
    // second one clean.
    if (typeof ResetVictoryScreen === 'function') ResetVictoryScreen();
}

function EndRemoteMatch() {
    renderingRemoteMatch = false;
    remoteSeat = null;
    remoteIsHost = false;
    remoteVerdict = null;
    HideDisconnectCountdown();
    if (typeof ResetVictoryScreen === 'function') ResetVictoryScreen();

    // Hand the match-level controls back. They are disabled every frame while a guest
    // is in a hosted match; without this they would stay dead in the local game the
    // player returns to, because nothing else re-enables them.
    ['newMapButton', 'saveGameButton', 'loadGameButton'].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.disabled = false;
    });
}

// Terrain arrives as a NAME, not the TILE_TYPES object - see BuildBoardView for why.
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
    // Non-enumerable for the same reason it is everywhere else - it must not end up
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
                    const fineKey = (edge.q1 + edge.q2) + ',' + (edge.r1 + edge.r2);
                    return engine.state.units.filter(u => u.position === fineKey);
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
        // `hidden` is a TRANSPORT annotation added by FilterStateForPlayer, not a
        // property of a unit. It is stripped rather than carried: left on, it would sit
        // on every unit in engine.state and eventually travel into a save as a field
        // the schema knows nothing about.
        engine.state.units = view.units
            .filter(unit => !unit.hidden)
            .map(({ hidden, ...unit }) => unit);

        // Every unit object was just REPLACED. Anything still pointing at one of the old
        // ones is holding a stale copy with a stale position - which is how a swordsman
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
    // The fine grid is not stored, it is DERIVED from tiles and edges - which is why
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
    // Applied by name rather than by spreading the view: the view also carries things
    // that are NOT engine state (player, filtered, visibleTiles), and a blind copy
    // would push those onto engine.state and eventually into a save.
    if (view.gridRadius !== undefined) {
        const changed = engine.state.gridRadius !== view.gridRadius;
        engine.state.gridRadius = view.gridRadius;

        // Camera framing is per DEVICE, not per match, so it does not travel with the
        // board - and nothing else in the online path sets it. Until rooms could pick a
        // map every hosted match was radius 3 and the default scale happened to be
        // right; a radius-4 map drew at 1.0 and ran off the canvas, and a radius-2 one
        // sat tiny in the middle. Lifted from resizeMapGrid, which owns this for local
        // play.
        if (changed) ApplyRemoteRenderScale(view.gridRadius);
    }
    if (view.baseCampPositions !== undefined) engine.state.baseCampPositions = view.baseCampPositions;
    if (view.respawnQueue !== undefined) engine.state.respawnQueue = view.respawnQueue;
    if (view.unitCounts !== undefined) engine.state.unitCounts = view.unitCounts;
    if (view.playerActionTaken !== undefined) engine.state.playerActionTaken = view.playerActionTaken;
    if (view.playerColorSelections !== undefined) engine.state.playerColorSelections = view.playerColorSelections;
    if (view.arcadeTotalTurns !== undefined) engine.state.arcadeTotalTurns = view.arcadeTotalTurns;
    if (view.matchId !== undefined) engine.state.matchId = view.matchId;

    if (view.currentPlayer !== undefined) engine.state.currentPlayer = view.currentPlayer;
    if (view.globalTurnNumber !== undefined) engine.state.globalTurnNumber = view.globalTurnNumber;
    if (view.reach) engine.state.reach = { ...view.reach };
    if (view.rations) engine.state.rations = { ...view.rations };
    if (view.flags !== undefined) engine.state.flags = view.flags;
    if (view.gameOver !== undefined) engine.state.gameOver = view.gameOver;

    // The host's verdict, kept so RefreshRemoteUi can draw it. Held rather than acted
    // on here: this function writes state, and putting a full-screen overlay up from
    // inside it would fire in the middle of a board being rebuilt.
    if (view.victory !== undefined) remoteVerdict = view.victory;

    // Vision comes from the HOST, it is not recomputed here.
    //
    // The client was deriving fog from its own copy of the board - a board it has only
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
            // Absent from an older host, so default to empty rather than
            // undefined: drawFogOfWar asks this every frame for every border
            // slot on the board.
            rim: new Set(view.visibleRim || []),
        };
        engine.visionDirty = false;
    } else {
        engine.visionCache = null;
        engine.visionDirty = true;
    }

    gameState.needsRedraw = true;

    // One line per board, so a match that stops updating is visible in the console as
    // a stream that stopped rather than as a canvas that looks frozen for no reason.
    console.log('[Online] board applied - ' + engine.state.tiles.size + ' tiles, '
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
    // the server used to accept - it does not any more, but a button that is only
    // stopped by the server is still a button that should have been greyed out.
    if (ui && ui.endTurnButton) {
        ui.endTurnButton.disabled = IsOpponentsTurn() || !!engine.state.gameOver;
    }

    updateTurnDisplay();
    updateGlobalTurnDisplay();
    updateSelectedUnitInfoPanel();
    updateSupplyPointsDisplay();
    updateActionLogDisplay();

    // The reinforcements panel reads engine.state.respawnQueue, which arrives with every
    // view - but nothing here was redrawing it, so it sat empty for the whole match.
    updateRespawnQueueDisplay();

    // The match is over and the host said so. checkVictoryCondition is DELIBERATELY
    // still not called (see below) - the verdict is not being WORKED OUT here, it is
    // being read off the view that carried it. That distinction is the whole of why
    // this is safe and adjudicating locally is not.
    //
    // This is the path that covers a player who rejoins after the fact: they never saw
    // the VICTORY event, and their first board view is the only thing that can tell
    // them. ShowRemoteVictory is idempotent, so the common case - event first, view a
    // moment later - still draws exactly one screen.
    if (engine.state.gameOver && typeof ShowRemoteVictory === 'function') {
        ShowRemoteVictory(remoteVerdict);
    }

    // checkVictoryCondition is DELIBERATELY not called here.
    //
    // It runs the real rule against the local engine - and in a hosted match the local
    // engine is a drawing surface holding a FILTERED board. Under fog it contains no
    // enemy units at all, so the very first refresh saw an empty enemy army and handed
    // somebody an immediate win by annihilation.
    //
    // The host decides the match is over and says so: `gameOver` rides in the view, and
    // the VICTORY event it emits is already handled by HandleActionEvent. Nothing here
    // needs to work it out, and nothing here is in a position to.
}

// === The disconnect countdown (B3) ===
//
// A3 built the deadline server-side and put it in the PLAYER_DISCONNECTED event, and
// noted that DRAWING it was B3's job and was not built. This is that.
//
// The deadline is an absolute timestamp from the host, not a duration, which matters:
// counting down from a duration would drift with every dropped frame and would restart
// from full if the page were reloaded mid-window. Counting toward a fixed instant is
// correct in both cases, and needs no further messages from the server to stay honest.
let disconnectDeadline = null;
let disconnectTicker = null;

function ShowDisconnectCountdown(player, deadline) {
    const banner = document.getElementById('disconnectBanner');
    const text = document.getElementById('disconnectBannerText');
    if (!banner || !text) return;

    disconnectDeadline = deadline;

    // "Your opponent" only if it is not us. A player watching their OWN slot count down
    // is the reconnect case, and telling them their opponent left would be a lie.
    const mine = (player === engine.state.playerSide);
    text.textContent = mine
        ? 'You are disconnected - reconnecting'
        : 'Opponent disconnected - waiting for them to return';

    banner.style.display = 'flex';

    if (disconnectTicker) clearInterval(disconnectTicker);
    TickDisconnectCountdown();
    disconnectTicker = setInterval(TickDisconnectCountdown, 250);
}

function TickDisconnectCountdown() {
    const banner = document.getElementById('disconnectBanner');
    const clock = document.getElementById('disconnectBannerClock');
    if (!banner || !clock || disconnectDeadline === null) return;

    const remaining = Math.max(0, disconnectDeadline - Date.now());
    clock.textContent = (remaining / 1000).toFixed(0) + 's';
    banner.classList.toggle('is-urgent', remaining <= 10000);

    // At zero the countdown stops but the banner STAYS. The host decides what happens
    // next (DISCONNECT_RESOLUTION_NEEDED), and clearing the banner here would tell the
    // player the situation had resolved itself when it has not.
    if (remaining === 0 && disconnectTicker) {
        clearInterval(disconnectTicker);
        disconnectTicker = null;
    }
}

function HideDisconnectCountdown() {
    const banner = document.getElementById('disconnectBanner');
    if (banner) banner.style.display = 'none';
    if (disconnectTicker) clearInterval(disconnectTicker);
    disconnectTicker = null;
    disconnectDeadline = null;
}

// === Acting on a disconnect resolution (B3) ===
//
// A4 converts the live match into a save; this is what happens to it. Both branches end
// the online match FIRST - the socket has to be released before anything is loaded, or
// the host's next state-sync overwrites it, which is exactly how leaving-for-a-local-
// game used to clobber the local board.
function ApplyDisconnectResolution_Client(event) {
    const save = event.outcome && event.outcome.save;

    if (typeof EndOnlineMatch === 'function') EndOnlineMatch();
    HideDisconnectCountdown();

    if (!save) {
        ShowAlert('The match could not be resolved - no save was produced.');
        return;
    }

    if (event.choice === 'continue-locally') {
        // Straight back onto this device, both sides local. ApplyLoadedState is the same
        // path a loaded save file takes, so nothing here is a special case.
        ApplyLoadedState(save);
        rehydrateGameState();
        EnsureGameLoopRunning();
        UpdateStatusCorner();
        ShowSuccess('Continuing locally. Both sides are on this device now.');
        return;
    }

    // 'save' - hand the file over and step back to the menu. Written through the same
    // serializer a manual save uses, so it loads like any other.
    try {
        const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'forthex-interrupted-' + (save.matchId || Date.now()) + '.fhsave';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        ShowSuccess('Match saved. Load it any time to pick it up.');
    } catch (error) {
        console.error('[B3] Could not write the save:', error);
        ShowAlert('Could not write the save file. See console.');
    }

    ShowMainMenu('root');
}

// The client half of a resize, for a board this device did not build.
//
// resizeMapGrid (js/client/map-maker.js) does this for local play alongside a pile of
// map-maker concerns that have no meaning here, so only the framing is lifted. Kept
// beside ApplyRemoteView because the two have to agree about what a radius means.
function ApplyRemoteRenderScale(radius) {
    if (radius === 2) {
        gameState.renderScale = 1.3;
    } else if (radius === 4) {
        const expansiveMapWidth = (2 * 4 + 1.5) * (HEX_SIZE * Math.sqrt(3));
        gameState.renderScale = CANVAS_WIDTH_NORMAL / expansiveMapWidth;
    } else {
        gameState.renderScale = 1.0;
    }

    gameState.renderOffset = { x: 0, y: 0 };
    gameState.needsRedraw = true;
}
