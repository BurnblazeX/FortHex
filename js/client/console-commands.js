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
