// === Console command surface (`FH`) ===
//
// Drive the game from the browser console for testing. Everything here goes
// through SendAction -> ActionManager.SubmitAction -> validation, exactly like a
// click does, so a command can only do what a player could do. There is no
// bypass and no god mode: an out-of-turn move fails from here the same way it
// fails from the board.
//
// That is the point. These commands are for reproducing and probing a captured
// match log, not for setting up impossible states - if a command is refused,
// that IS the result, and the error code says why.
//
//   FH.help()                       list everything
//   FH.units()                      who is on the board
//   FH.moves('u_p1_MELEE_t1_1')     where that unit may legally go
//   FH.move('u_p1_MELEE_t1_1', '0,-1_1,-1')
//   FH.endTurn()
//   FH.log('after-my-change')       capture a match log

const FH = {

    // --- inspection (reads, no validation involved) ---------------------

    state() {
        const s = {
            turn: engine.state.globalTurnNumber,
            currentPlayer: engine.state.currentPlayer,
            mode: engine.state.gameMode,
            gameOver: engine.state.gameOver,
            supply: { ...engine.state.supplyPoints },
            fogOfWar: engine.settings.fogOfWarEnabled,
            units: engine.state.units.length,
        };
        console.table([s]);
        return s;
    },

    units(player) {
        const rows = engine.state.units
            .filter(u => player === undefined || u.player === player)
            .map(u => ({
                id: u.id, p: u.player, type: u.type.name, hp: u.hp,
                mp: Number(u.currentMove.toFixed(2)), pos: u.position,
                fortified: !!u.isFortified, acted: !!u.hasPerformedMajorAction,
            }));
        console.table(rows);
        return rows;
    },

    unit(unitId) {
        const u = engine.state.units.find(x => x.id === unitId);
        if (!u) { console.warn('no such unit:', unitId); return null; }
        return u;
    },

    // Where the SERVER says this unit may go. Same call validation makes, so if
    // a move is in this list it will be accepted, and if it isn't it won't.
    moves(unitId) {
        const u = this.unit(unitId);
        if (!u) return [];
        const rows = [...getPossibleMoves(u).entries()]
            .map(([edgeKey, m]) => ({ to: edgeKey, cost: m.cost, steps: m.path.length }))
            .sort((a, b) => a.cost - b.cost);
        console.table(rows);
        return rows;
    },

    targets(unitId) {
        const u = this.unit(unitId);
        if (!u) return [];
        const rows = getValidMeleeAttackTargets(u).concat(getValidArcherAttackTargets(u))
            .map(t => ({
                targetId: t.unit ? t.unit.id : null,
                type: t.unit ? t.unit.type.name : 'BRIDGE',
                hp: t.unit ? t.unit.hp : null,
                edge: t.edgeKey, bridge: !!t.isBridgeTarget,
            }));
        console.table(rows);
        return rows;
    },

    fortifySpots(unitId) {
        const u = this.unit(unitId);
        if (!u) return [];
        const spots = GetValidFortifyTargets(u);
        console.log(spots.length ? spots.join('  ') : '(none)');
        return spots;
    },

    // --- actions (validated, exactly as a click would be) ---------------

    move(unitId, targetEdgeKey)      { return FH_Run('move',         { unitId, targetEdgeKey }); },
    attack(unitId, targetUnitId)     { return FH_Run('attack',       { unitId, targetUnitId, attackType: FH_AttackType(unitId) }); },
    attackBridge(unitId, edgeKey)    { return FH_Run('attack',       { unitId, targetEdgeKey: edgeKey, isBridgeTarget: true, attackType: FH_AttackType(unitId) }); },
    fortify(unitId, targetTileKey)   { return FH_Run('fortify',      { unitId, targetTileKey }); },
    unfortify(unitId, targetEdgeKey) { return FH_Run('unfortify',    { unitId, targetEdgeKey }); },
    bridge(unitId, targetEdgeKey)    { return FH_Run('build-bridge', { unitId, targetEdgeKey }); },
    upgrade(unitId, statType)        { return FH_Run('upgrade-unit', { unitId, statType }); },
    swap(unitId, newTypeName)        { return FH_Run('swap-class',   { unitId, newTypeName }); },
    spawn(player, unitTypeName)      { return FH_Run('spawn-unit',   { player, unitTypeName }); },
    endTurn()                        { return FH_Run('end-turn',     {}); },

    // --- session: disconnect / reconnect (A3) -----------------------------
    // There is no real transport yet, so there is no real disconnect to detect.
    // These drive LocalTransport's connect/disconnect handling directly, which
    // is the same entry point Track B's adapters will call when a socket
    // actually drops — so the server-side flow is exercised for real, only the
    // trigger is by hand.

    // profileId defaults to this device's real profile when it has one, so the
    // reconnect round-trip below is tested against a genuine durable id rather
    // than against null. Pass an explicit null to stamp nothing and get A3's
    // "an absent slot with no recorded id matches anyone" behaviour, which is
    // still what local pass-device play relies on.
    disconnect(player, reason, profileId) {
        const id = profileId === undefined ? GetProfileId() : profileId;
        const ack = transport.Send(MakeDisconnectMessage(reason || 'console', { player, profileId: id }));
        if (!ack.ok) { console.warn('✗ disconnect: ' + ack.error); return ack; }
        const left = Math.round((ack.deadline - Date.now()) / 1000);
        console.log(`✓ player ${player} absent — ${left}s to return`);
        return ack;
    },

    reconnect(player, profileId) {
        // Matched by IsReturningPlayer, not by anything this call asserts: `player`
        // is here for readability and to warn when the claim did not land.
        //
        // Since A5 the default is the real local profile id, so the happy path
        // exercises real identity. Pass a made-up id to test the negative case -
        // a slot that recorded a real id must refuse a different one.
        const ack = transport.Send(MakeConnectMessage(profileId || GetProfileId() || 'local-player'));
        if (ack.refused) { console.warn('✗ reconnect refused: ' + ack.refused); return ack; }
        if (ack.reconnected === null) { console.warn('✗ nobody was absent'); return ack; }
        if (player !== undefined && ack.reconnected !== player) {
            console.warn(`note: claimed slot ${ack.reconnected}, not ${player} (matched by IsReturningPlayer)`);
        }
        console.log(`✓ player ${ack.reconnected} back — resync: ${ack.resync.units.length} units, ` +
                    `filtered=${ack.resync.filtered}, turn ${ack.resync.globalTurnNumber} p${ack.resync.currentPlayer}`);
        return ack;
    },

    // Prompt the server to check its own clock. Nothing is asserted about time.
    heartbeat() { return FH_Run('heartbeat', {}); },

    resolve(player, choice) { return FH_Run('resolve-disconnect', { player, choice }); },

    sessions() {
        const rows = [1, 2].map(p => {
            const s = engine.playerSessions['player' + p];
            return {
                player: p, connected: s.connected, profileId: s.profileId,
                secondsLeft: s.deadline ? Math.round((s.deadline - Date.now()) / 1000) : null,
                resolution: s.resolutionState + (s.resolution ? ':' + s.resolution : ''),
            };
        });
        console.table(rows);
        return rows;
    },

    // --- profile: local identity (A5) -------------------------------------
    //
    // The real trigger is Menu > Multiplayer > Online, which shows the consent
    // screen and then calls GetOrCreateProfile. These commands call the EXACT
    // same functions, so scripted testing does not have to drive a menu click
    // through the DOM - and there is no second code path that happens to agree.
    //
    // Note what these do NOT do: bypass consent capture. FH.createProfile takes
    // consent as an argument and it defaults to FALSE, so a profile made from here
    // is unconsented unless you say otherwise. The screen is the thing that
    // captures a real yes, and it is the only thing that does.

    profile() {
        const p = GetProfile();
        if (!p) { console.log('(no profile on this device — that is the normal state)'); return null; }
        console.table([{ id: p.id, name: p.name, consent: p.consent, created: new Date(p.createdAt).toLocaleString() }]);
        return p;
    },

    // Creates if absent, returns the existing one otherwise - GetOrCreateProfile
    // semantics, matching what the Online button does. Calling it twice does not
    // produce two profiles.
    createProfile(name, consent) {
        const before = GetProfile();
        const p = GetOrCreateProfile(name, consent === true);
        console.log((before ? 'existing' : 'created') + ' profile: ' + p.name + '  ' + p.id +
                    '  consent=' + p.consent);
        return p;
    },

    consent(value) {
        if (value === undefined) return HasArchiveConsent();
        const p = SetConsent(value);
        if (p) console.log('consent = ' + p.consent);
        return p;
    },

    // Back to the no-profile state, to test the majority case without clearing
    // site data by hand. Not reachable from any UI: the roadmap rules account
    // management out of scope, and this is a test seam, not a feature.
    clearProfile() {
        ClearProfile();
        console.log('profile cleared — this device is back to never having gone online');
        return null;
    },

    // --- archive: the consent-gated match record (A6) ---------------------
    //
    // The archive writes itself: a snapshot at the start of a match and at every
    // turn end, finalized when the match is won. These are for looking at what it
    // recorded, not for driving it - except archiveNow(), which forces the same
    // snapshot a turn end would take, so the store can be exercised without
    // playing eight turns by hand.
    //
    // Everything here is async and returns a promise. Use await, or .then, or just
    // read what gets printed.

    archive() {
        return ListArchivedMatches().then(rows => {
            if (!rows.length) { console.log('(the archive is empty)'); return rows; }
            console.table(rows.map(r => ({
                matchId: r.matchId.slice(0, 8) + '...',
                who: r.profileName, mode: r.gameMode, turn: r.turn,
                done: r.complete, entries: r.entries,
                kb: Math.round(r.bytes / 1024) + 'K',
                updated: new Date(r.updatedAt).toLocaleString(),
            })));
            return rows;
        });
    },

    // Full record, both saves included. Pass a prefix - the console prints
    // shortened ids and typing a whole UUID from memory is nobody's idea of a
    // testing loop.
    archiveEntry(matchIdOrPrefix) {
        return ListArchivedMatches().then(rows => {
            const hit = rows.find(r => r.matchId === matchIdOrPrefix) ||
                        rows.find(r => r.matchId.startsWith(String(matchIdOrPrefix || '')));
            if (!hit) { console.warn('no archived match matching: ' + matchIdOrPrefix); return null; }
            return GetArchivedMatch(hit.matchId).then(record => {
                console.log('match ' + record.matchId + '  ' + (record.complete ? 'complete' : 'in progress') +
                            '  turn ' + record.turn + '  v' + record.schemaVersion);
                console.log('  opening: ' + record.opening.units.length + ' units, ' +
                            (record.opening.matchHistory || []).length + ' ledger entries');
                console.log('  latest : ' + record.latest.units.length + ' units, ' +
                            (record.latest.matchHistory || []).length + ' ledger entries');
                if (record.verdict) console.log('  verdict: ' + record.verdict.text);
                return record;
            });
        });
    },

    // Whether this device is recording at all, and why not if it isn't. The most
    // useful thing here when the archive looks empty and shouldn't be.
    archiveState() {
        const row = {
            consent: typeof engine !== 'undefined' ? !!engine.archiveConsent : false,
            matchId: engine.state.matchId ? engine.state.matchId.slice(0, 8) + '...' : null,
            mode: engine.state.gameMode,
            training: !!engine.state.isTrainingMode,
            mapMaker: !!engine.state.mapMakerMode,
            testingMap: !!(typeof gameState !== 'undefined' && gameState.isTestingMap),
            recording: ArchiveIsEnabled(),
        };
        console.table([row]);
        return row;
    },

    archiveNow(complete) {
        if (!ArchiveIsEnabled()) {
            console.warn('not recording - run FH.archiveState() to see why');
            return Promise.resolve(null);
        }
        return ArchiveMatchSnapshot(complete === true).then(r => {
            console.log('snapshot written for ' + r.matchId.slice(0, 8) + '... at turn ' + r.turn +
                        (r.complete ? ' (complete)' : ''));
            return r;
        });
    },

    clearArchive() {
        return ClearArchive().then(() => { console.log('archive cleared'); return null; });
    },

    archiveSync() { return SyncArchiveToServer(); },

    // The one command here that isn't something a player could do — and it still
    // isn't a rule bypass. Waiting out a real 100-second window by hand is not a
    // workable test loop, so this winds the stored deadline back into the past.
    // The server still decides the timeout itself, off its own clock, on the next
    // heartbeat; this only moves what that clock is being compared against.
    expire(player) {
        const s = engine.playerSessions['player' + player];
        if (!s || s.connected) { console.warn('player ' + player + ' is not absent'); return null; }
        s.absentSince -= DISCONNECT_TIMEOUT_MS;
        s.deadline -= DISCONNECT_TIMEOUT_MS;
        console.log(`deadline for player ${player} wound back — run FH.heartbeat()`);
        return this.heartbeat();
    },

    // --- editor (lighter validation path) --------------------------------

    paint(tileKey, tileTypeName)             { return FH_Run('paint-tile',  { tileKey, tileTypeName }); },
    eraseTile(tileKey)                       { return FH_Run('erase-tile',  { tileKey }); },
    place(player, unitTypeName, edgeKey)     { return FH_Run('place-unit',  { player, unitTypeName, edgeKey }); },
    removeUnit(unitId)                       { return FH_Run('remove-unit', { unitId }); },
    fill(startQ, startR, tileTypeName)       { return FH_Run('flood-fill',  { startQ, startR, tileTypeName }); },

    // --- capture ---------------------------------------------------------

    log(label) { return ExportMatchHistory(label || 'console'); },

    history(last = 10) {
        const rows = engine.state.matchHistory.slice(-last).map(e => ({
            type: e.type, turn: e.turn, p: e.player, actor: e.actorId || '',
        }));
        console.table(rows);
        return rows;
    },

    help() {
        console.log(`FH — console commands (all actions pass server validation)

  inspect     FH.state()  FH.units(player?)  FH.unit(id)  FH.history(n?)
              FH.moves(id)  FH.targets(id)  FH.fortifySpots(id)

  act         FH.move(id, edgeKey)         FH.attack(id, targetId)
              FH.attackBridge(id, edgeKey) FH.fortify(id, tileKey)
              FH.unfortify(id, edgeKey)    FH.bridge(id, edgeKey)
              FH.upgrade(id, 'damage')     FH.swap(id, 'ARCHER')
              FH.spawn(player, 'MELEE')    FH.endTurn()

  editor      FH.paint(tileKey, 'FOREST')  FH.eraseTile(tileKey)
              FH.place(player, 'MELEE', edgeKey)  FH.removeUnit(id)
              FH.fill(q, r, 'WATER')

  session     FH.sessions()                FH.disconnect(player, reason?, profileId?)
              FH.reconnect(player?)        FH.heartbeat()
              FH.expire(player)            FH.resolve(player, 'save')

  profile     FH.profile()                 FH.createProfile('Name', consent?)
              FH.consent(true|false)       FH.clearProfile()

  archive     FH.archiveState()            FH.archive()
              FH.archiveEntry('1ce1c77f')  FH.archiveNow(complete?)
              FH.clearArchive()            FH.archiveSync()

  capture     FH.log('label')

  Stats: health, speed, damage, defense.  Types: MELEE, ARCHER, PIKEMAN, HORSEMAN.
  A refusal prints the error code - that's a real result, not a bug.`);
    },
};

// Attack type is a property of the attacking unit, not a player choice; derive
// it rather than making every console call spell it out.
function FH_AttackType(unitId) {
    const u = engine.state.units.find(x => x.id === unitId);
    if (!u) return 'Melee';
    return u.type.attackType === 'melee' ? 'Melee' : 'Archer';
}

// One place that submits, reports, and refreshes the view - so a console action
// leaves the screen in the same state a click would.
function FH_Run(action, payload) {
    const before = engine.state.units.find(u => u.id === payload.unitId);
    const beforeHp = before ? before.hp : null;

    const outcome = transport.Send(MakeActionMessage(action, payload));

    const report = (settled) => {
        if (!settled.ok) {
            console.warn(`✗ ${action}: ${settled.error}${settled.detail ? ' — ' + settled.detail : ''}`);
        } else {
            const u = engine.state.units.find(x => x.id === payload.unitId);
            const bits = [`✓ ${action}`];
            if (u) bits.push(`${u.id} hp ${beforeHp}→${u.hp} mp ${Number(u.currentMove.toFixed(2))} @ ${u.position}`);
            console.log(bits.join('  '));
        }
        engine.visionDirty = true;
        gameState.needsRedraw = true;
        if (typeof updateSelectedUnitInfoPanel === 'function') updateSelectedUnitInfoPanel();
        return settled;
    };

    return (outcome && typeof outcome.then === 'function') ? outcome.then(report) : report(outcome);
}
