// === Player session tracking - disconnect / reconnect (A3) ===
//
// Nothing in engine.state models "a player is gone", and deliberately still
// doesn't. Absence is session truth, not match truth: it describes a connection,
// not the board. So it lives on the engine INSTANCE, next to pendingVictory and
// visionCache, and never reaches a save file.
//
//   NOTE FOR A4 (Testament): keep engine.playerSessions out of whatever becomes
//   ENGINE_SAVE_FIELDS. A save written mid-disconnect should not remember that
//   player 2 had 43 seconds left - reloading it later starts a fresh session with
//   no live opponent connection either way. Same known-gap shape as
//   pendingVictory, and intentional rather than an oversight to fix.
//
// Tracking is PER-PLAYER (Burn's call). A single "match is degraded" flag can't
// represent both sides being briefly absent at once - rare, but real for a P2P
// match where neither end keeps the other's clock.
//
// What this file does NOT do, by track boundary:
//   - the visible countdown            -> B3 (it gets the deadline in the event)
//   - real socket-level drop detection -> Track B's transports
//   - the save/continue-locally work   -> A4 (see ResolveDisconnectOutcome)
//   - durable player identity          -> A5 (see IsReturningPlayer)

// The roadmap's 100 seconds. Server-side only: the client is told the deadline,
// never asked what time it thinks it is.
const DISCONNECT_TIMEOUT_MS = 100000;

// The two things a still-present player may choose when the window lapses.
const DISCONNECT_RESOLUTIONS = ['save', 'continue-locally'];

// A slot starts connected because local play has a client attached from the
// first frame; a real transport (Track B) will start these false and connect
// them as each player actually arrives.
function MakePlayerSession() {
    return {
        connected: true,
        profileId: null,
        reason: null,
        absentSince: null,
        deadline: null,

        // 'none' -> nobody has timed out; 'needed' -> the window lapsed and the
        // present player owes us a choice; 'resolved' -> they made it. This is
        // what makes DISCONNECT_RESOLUTION_NEEDED fire exactly once rather than
        // on every heartbeat after the deadline.
        resolutionState: 'none',
        resolution: null,
    };
}

function GetPlayerSession(player) {
    if (player !== 1 && player !== 2) return null;
    return engine.playerSessions['player' + player];
}

// --- disconnect ------------------------------------------------------------

function DisconnectPlayer(player, reason = 'client_closed', profileId = null) {
    const session = GetPlayerSession(player);
    if (!session) return { ok: false, error: 'unknown_player' };
    if (!session.connected) return { ok: false, error: 'already_absent' };

    const now = Date.now();
    session.connected = false;
    session.reason = reason;
    session.absentSince = now;
    // The window is a property of the MATCH, so a host may set it - and a test may
    // shorten it. Without that, exercising the lapse path meant waiting 100 real
    // seconds, which is why nothing covered it.
    const windowMs = Number.isFinite(engine.settings.disconnectTimeoutMs)
        ? engine.settings.disconnectTimeoutMs
        : DISCONNECT_TIMEOUT_MS;

    session.deadline = now + windowMs;
    session.resolutionState = 'none';
    session.resolution = null;
    if (profileId !== null && profileId !== undefined) session.profileId = profileId;

    // The deadline rides along so B3 can draw a countdown without computing it,
    // and so its clock can't drift from the one the server actually enforces.
    engine.Emit({
        type: 'PLAYER_DISCONNECTED',
        player,
        reason,
        absentSince: now,
        deadline: session.deadline,
    });

    engine.actionManager.RecordHistory({
        type: 'PLAYER_DISCONNECTED',
        turn: engine.state.globalTurnNumber,
        player,
        payload: { reason, deadline: session.deadline },
    });

    return { ok: true, player, deadline: session.deadline };
}

// --- reconnect -------------------------------------------------------------

// THE A5 SEAM. Everything about "is this the same player coming back" happens
// here and nowhere else, so A5 changes this function's body and touches nothing
// else in the disconnect/reconnect path.
//
// Today's stopgap: compare the profileId the client connected with against the
// one recorded when the slot went absent. That value has no durability guarantee
// behind it yet - A5 is the track that gives it one - and local pass-device play
// has a single client with no per-slot identity at all, which is why an absent
// slot that never recorded a profileId matches any returning client.
function IsReturningPlayer(profileId, playerSlot) {
    const session = GetPlayerSession(playerSlot);
    if (!session || session.connected) return false;
    if (session.profileId === null || session.profileId === undefined) return true;
    return session.profileId === profileId;
}

// Which absent slot, if any, this connect message may claim. Returns a reason
// instead of a slot when a match is found but can't be honoured, so the
// transport can say no out loud rather than silently doing nothing.
function FindReturningPlayerSlot(profileId) {
    for (const player of [1, 2]) {
        if (!IsReturningPlayer(profileId, player)) continue;

        // The window already lapsed and the match is being resolved. A late
        // arrival does not get to un-resolve it.
        const session = GetPlayerSession(player);
        if (session.resolutionState !== 'none') {
            return { player: null, refused: 'resolution_' + session.resolutionState };
        }
        return { player, refused: null };
    }
    return { player: null, refused: null };
}

function ReconnectPlayer(player, profileId = null) {
    const session = GetPlayerSession(player);
    if (!session) return { ok: false, error: 'unknown_player' };
    if (session.connected) return { ok: false, error: 'not_absent' };
    if (session.resolutionState !== 'none') return { ok: false, error: 'resolution_pending' };

    session.connected = true;
    session.reason = null;
    session.absentSince = null;
    session.deadline = null;
    if (profileId !== null && profileId !== undefined) session.profileId = profileId;

    engine.Emit({ type: 'PLAYER_RECONNECTED', player });

    engine.actionManager.RecordHistory({
        type: 'PLAYER_RECONNECTED',
        turn: engine.state.globalTurnNumber,
        player,
        payload: {},
    });

    return { ok: true, player, resync: BuildResyncSnapshot(player) };
}

// --- takeover (hot join) ---------------------------------------------------
//
// Somebody ELSE sitting down in an absent player's chair, mid-match. Deliberately a
// separate function from ReconnectPlayer rather than a flag on it, because the two
// disagree about the one thing that file is careful about: a reconnect PROVES it is
// the same person (IsReturningPlayer checks the profile), and this proves the
// opposite. Sharing a code path would mean the identity check had a way to be
// skipped, which is exactly the check worth not having a way to skip.
//
// Whether a takeover is ALLOWED is not decided here and must not be - it is a
// property of the room, not of the board (public only, and only after the seat's own
// player has had a head start). host/rooms.js HotJoin owns that, and the host passes
// the answer in as `takeover` on the connect message. This function does the part
// only the engine can: stop the clock, re-identify the slot, and say so out loud.
function TakeOverPlayer(player, profileId = null, name = null) {
    const session = GetPlayerSession(player);
    if (!session) return { ok: false, error: 'unknown_player' };
    if (session.connected) return { ok: false, error: 'not_absent' };

    // A window that was already answered stays answered. Everything else - including
    // 'needed', where the remaining player is being asked what to do about an opponent
    // who never came back - is better answered by somebody actually arriving to play.
    if (session.resolutionState === 'resolved') return { ok: false, error: 'already_resolved' };

    session.connected = true;
    session.reason = null;
    session.absentSince = null;
    session.deadline = null;

    // The slot's identity becomes the NEW player's. From here they are simply player
    // N, and the original occupant coming back is a stranger to this match - which is
    // the honest consequence of having given their seat away.
    session.profileId = profileId === undefined ? null : profileId;
    session.resolutionState = 'none';
    session.resolution = null;

    engine.Emit({ type: 'PLAYER_TAKEN_OVER', player, name: name || null });

    engine.actionManager.RecordHistory({
        type: 'PLAYER_TAKEN_OVER',
        turn: engine.state.globalTurnNumber,
        player,
        payload: { name: name || null },
    });

    return { ok: true, player, resync: BuildResyncSnapshot(player) };
}

// A returning client missed whatever happened while it was away, and the event
// queue can't tell it - that queue is "since the last flush", not a history log.
// So rebuild its whole view from current state instead of replaying anything.
//
// This is a SCOPED use of FilterStateForPlayer: one player, one occasion. It is
// not a reversal of A2's decision to leave the filter unwired from the general
// Flush() path (pass-device is one client; the overlay covers the handover).
// Wiring it more broadly is still Track B's call to make.
//
// Sets become arrays because a real transport has to JSON this; the local
// adapter could pass them live, but then Track B would find out the hard way.
function BuildResyncSnapshot(player) {
    const view = FilterStateForPlayer(engine.state, player, engine.settings.fogOfWarEnabled);

    // B2: tiles and edges added. They were absent while this only ever served a
    // reconnect, because a reconnecting browser still had the board it started with.
    // Once this same shape started riding along with every state-sync (transport.js
    // Flush), their absence became the reason a bridge built or destroyed mid-match
    // never reached the other client.
    const board = BuildBoardView(engine.state, view.visibleEdges, view.filtered);

    return {
        player,
        filtered: view.filtered,
        units: view.units,
        tiles: board.tiles,
        edges: board.edges,
        visibleTiles: [...view.visibleTiles],
        visibleEdges: [...view.visibleEdges],
        // Rim cells are named by fine coordinate, not by an edge key - they have
        // no edge behind them to name.
        visibleRim: [...(view.visibleRim || [])],
        currentPlayer: engine.state.currentPlayer,
        globalTurnNumber: engine.state.globalTurnNumber,
        supplyPoints: { ...engine.state.supplyPoints },
        flags: engine.state.flags ? JSON.parse(JSON.stringify(engine.state.flags)) : null,
        gameOver: engine.state.gameOver,

        // Who won, and in what words. gameOver on its own tells a remote client the
        // match stopped but not why, and "why" is the entire content of a victory
        // screen. Rides with every view rather than only with the VICTORY event,
        // because a player who rejoins after the fact never sees that event.
        victory: engine.matchVerdict || null,

        // Everything below was missing, and each absence had already caused or was
        // waiting to cause a bug. Found by comparing a rebuilt client against the
        // server field by field (tools/state-parity.js) rather than one at a time as
        // the symptoms turned up.
        //
        //   gridRadius            board extent and render scale
        //   baseCampPositions     base camps, flag homes, and the fortify rules that
        //                         refuse enemy base tiles - a rule, not decoration
        //   respawnQueue          the respawn panel and its countdown
        //   unitCounts            what the recruit UI is allowed to offer
        //   playerActionTaken     gates whether a turn may be ended
        //   playerColorSelections whose colours the board is drawn in
        //   arcadeTotalTurns      the arcade turn cap
        //   matchId               A6's archive identity, so a client archiving its own
        //                         view files it under the same match as the host
        gridRadius: engine.state.gridRadius,
        baseCampPositions: JSON.parse(JSON.stringify(engine.state.baseCampPositions || null)),
        respawnQueue: JSON.parse(JSON.stringify(engine.state.respawnQueue || { player1: [], player2: [] })),
        unitCounts: engine.state.unitCounts ? JSON.parse(JSON.stringify(engine.state.unitCounts)) : null,
        playerActionTaken: { ...engine.state.playerActionTaken },
        playerColorSelections: { ...engine.state.playerColorSelections },
        arcadeTotalTurns: engine.state.arcadeTotalTurns,
        matchId: engine.state.matchId || null,
    };
}

// --- the deadline ----------------------------------------------------------

// PROVISIONAL MECHANISM (Burn's §7 call, flagged for Track B to revisit).
// The engine has no way to speak unprompted - Flush() only ever runs after an
// inbound message - so a genuine server-side timer would need a transport
// capability that doesn't exist yet. Instead a connected client sends the
// 'heartbeat' action, and that prompts this check.
//
// The heartbeat is ONLY a trigger to look. It carries no timing claim: what gets
// compared is the server's own stored deadline against the server's own clock.
// Same principle as A2's id resolution - never trust a client for something the
// server can determine itself.
//
// Once Track B has real transports (which will want server-initiated events for
// other reasons anyway), replace this with an actual timer firing a push.
function CheckDisconnectDeadlines(now = Date.now()) {
    const lapsed = [];

    for (const player of [1, 2]) {
        const session = GetPlayerSession(player);
        if (!session || session.connected) continue;
        if (session.resolutionState !== 'none') continue;
        if (session.deadline === null || now < session.deadline) continue;

        session.resolutionState = 'needed';

        engine.Emit({
            type: 'DISCONNECT_RESOLUTION_NEEDED',
            player,
            reason: session.reason,
            deadline: session.deadline,
            choices: [...DISCONNECT_RESOLUTIONS],
        });

        engine.actionManager.RecordHistory({
            type: 'DISCONNECT_TIMEOUT',
            turn: engine.state.globalTurnNumber,
            player,
            payload: { reason: session.reason, deadline: session.deadline },
        });

        lapsed.push(player);
    }

    return { now, lapsed };
}

// Which player, if any, the present player currently owes a decision about.
function FindPlayerAwaitingResolution() {
    for (const player of [1, 2]) {
        const session = GetPlayerSession(player);
        if (session && session.resolutionState === 'needed') return player;
    }
    return null;
}

// --- resolution ------------------------------------------------------------

// The Apply half of the 'resolve-disconnect' action. A3 owns recording the
// choice and closing out the pending state; what the choice DOES is A4's.
function ApplyDisconnectResolution(requester, absentPlayer, choice) {
    const session = GetPlayerSession(absentPlayer);
    session.resolutionState = 'resolved';
    session.resolution = choice;

    engine.actionManager.RecordHistory({
        type: 'DISCONNECT_RESOLVED',
        turn: engine.state.globalTurnNumber,
        player: requester,
        payload: { absentPlayer, choice },
    });

    const outcome = ResolveDisconnectOutcome(choice, absentPlayer);

    // Emitted, not only returned. The return value reaches whoever called SubmitAction,
    // which in a hosted match is an ack the client is not supposed to read state from -
    // and the OTHER player needs to hear about this too. Sending it through the event
    // stream is the same path every other consequence takes.
    engine.Emit({
        type: 'DISCONNECT_RESOLVED',
        player: requester,
        absentPlayer,
        choice,
        outcome,
    });

    return { absentPlayer, choice, outcome };
}

// FILLED IN BY A4 (Testament). Was an intentionally empty hook through A3.
//
// Both choices serialize the live match through exactly the same canonical path a
// manual save uses - BuildSaveObject in js/testament.js, called directly and
// in-process, no message round trip. That directness is why Testament's pure logic
// is a shared root module rather than client-side code.
//
//   'save'             -> hand back the save object; the client writes the bytes.
//   'continue-locally' -> the same object, flagged for immediate reload as a local
//                         pass-device match instead of a disk write (Burn's call).
//
// What this function deliberately does NOT do is touch a filesystem or a running
// client. It produces the object and says what should happen to it; js/client/save.js
// and the composition root own the rest, because a Worker has no disk and loading a
// file into a *new* match happens before an engine instance fully exists.
function ResolveDisconnectOutcome(choice, absentPlayer) {
    const { save, report } = BuildSaveObject(engine);

    return {
        choice,
        absentPlayer,
        save,
        schemaVersion: save.schemaVersion,
        warnings: report.warnings,
        // The client reads this to decide between a file dialog and a local reload.
        disposition: choice === 'continue-locally' ? 'reload-local' : 'write-file',
    };
}
