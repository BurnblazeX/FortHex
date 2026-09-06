// FortHex — proves a hosted match sends each player a board they can DRAW  (B2)
//
//   node tools/replication-smoke.js
//
// host-smoke.js proves the engine runs in bare Node and that its payloads survive
// JSON. This proves what was missing underneath every transport: that an accepted
// action produces, per recipient, enough state to RENDER — and no more.
//
// Before this, ApplyMoveAction emitted LOG lines and nothing positional, so a remote
// client was told "a unit moved" in prose with no way to know where. And A2's
// per-recipient filters existed but were wired to nothing, so fog of war over a
// network would have been decoration: the hidden positions were in the packet.
//
// Exit code 0 = pass.

const { Worker } = require('worker_threads');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { BuildWorkerSource, ReadBundle } = require('../host/server-bundle.js');

const failures = [];
function check(what, condition) {
    if (!condition) failures.push(what);
    return condition;
}

// Two real recipients and fog ON — the configuration where getting this wrong is
// invisible locally and a cheat over a wire.
const worker = new Worker(BuildWorkerSource(), {
    eval: true,
    workerData: {
        matchId: 'replication-smoke',
        players: [1, 2],
        settings: { fogOfWarEnabled: true },
    },
});

const wire = [];
const errors = [];
let ready = false;
let started = null;
const acks = new Map();

worker.on('message', (m) => {
    switch (m.type) {
        case 'ready':      ready = true; break;
        case 'started':    started = m; break;
        case 'ack':        acks.set(m.requestId, m.outcome); break;
        case 'host-error': errors.push(m); break;
        case 'wire':
            try {
                wire.push({ player: m.player, message: JSON.parse(m.encoded) });
            } catch (error) {
                failures.push('a payload did not survive JSON: ' + error.message);
            }
            break;
    }
});

const Settle = (predicate = () => true, ms = 8000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
        if (predicate()) return resolve();
        if (Date.now() > deadline) return reject(new Error('timed out waiting for the worker'));
        setTimeout(tick, 10);
    };
    tick();
});

function AllEdges(views) {
    return views.flatMap(view => (view && Array.isArray(view.edges)) ? view.edges : []);
}

async function Main() {
    await Settle(() => ready);
    worker.postMessage({ kind: 'start-match' });
    await Settle(() => started !== null);
    check('the hosted match starts', started !== null);

    // Compute a legal move the way a real client does: its own copy of the same
    // engine code, from the same deterministic board. Same technique as host-smoke.
    const mirror = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(mirror);
    vm.runInContext(ReadBundle(), mirror);
    vm.runInContext('globalThis.engine = CreateEngineInstance(); InitializeGrid();', mirror);

    const planSource = [
        'const unit = engine.state.units.find(u => u.player === engine.state.currentPlayer);',
        'const moves = getPossibleMoves(unit);',
        'JSON.stringify({ unitId: unit.id, targetEdgeKey: [...moves.keys()][0] });',
    ].join('\n');

    const plan = JSON.parse(vm.runInContext(planSource, mirror));
    check('a legal move could be computed client-side', !!plan.targetEdgeKey);

    const before = wire.length;
    worker.postMessage({
        kind: 'client-message',
        requestId: 'm1',
        message: { type: 'action', action: 'move', payload: plan },
    });
    await Settle(() => acks.has('m1'));
    await Settle(() => wire.length > before, 2000).catch(() => {});

    const moveAck = acks.get('m1');
    check('the server accepted the move' + (moveAck && moveAck.error ? ' (' + moveAck.error + ')' : ''),
        moveAck && moveAck.ok !== false);

    const syncs = wire.slice(before).filter(entry => entry.message.type === 'state-sync');

    // --- 1. every player gets their own copy -------------------------------
    const forP1 = syncs.find(entry => entry.player === 1);
    const forP2 = syncs.find(entry => entry.player === 2);
    check('player 1 received a sync', !!forP1);
    check('player 2 received a sync', !!forP2);
    check('the two copies are addressed separately, not broadcast once',
        !!forP1 && !!forP2 && forP1 !== forP2);

    // --- 2. the sync carries a board, not just prose -----------------------
    const views = [forP1, forP2].filter(Boolean).map(entry => entry.message.view);
    const haveBoth = views.length === 2 && views.every(v => !!v);
    check('each sync carries a board view', haveBoth);

    if (haveBoth) {
        check('the view carries tiles', views.every(v => Array.isArray(v.tiles) && v.tiles.length > 0));
        check('the view carries edges', views.every(v => Array.isArray(v.edges) && v.edges.length > 0));
        check('tiles carry a terrain name, not an object reference',
            views[0].tiles.every(t => t.type === null || typeof t.type === 'string'));

        // The renderable claim, stated precisely: the unit that moved is reported at
        // the edge it moved to. This is what a LOG line could never say.
        const movedUnit = views[0].units.find(u => u.id === plan.unitId);
        check('the moving unit appears in its own view', !!movedUnit);
        check('and it is reported at the edge it moved to',
            !!movedUnit && movedUnit.position === plan.targetEdgeKey);
    }

    // --- 3. the edge getter did not smuggle units through ------------------
    // An edge carries a live `units` getter closing over engine state. If it is
    // enumerable, spreading or JSON-ing an edge embeds full unit objects — which
    // would put every unit on the wire past the redaction checked below.
    const leaked = AllEdges(views).filter(edge => 'units' in edge);
    check('no edge smuggled a live units getter onto the wire (' + leaked.length + ' did)',
        leaked.length === 0);

    // The two construction paths DISAGREED until B2: match-setup.js defined the getter
    // non-enumerable, map-generation.js used a plain object-literal getter, which is
    // enumerable — so edges built by the resize path serialized their units and edges
    // built by the normal path did not. The check above cannot catch that on its own,
    // because the board it inspects only ever comes from one of the two paths. This
    // asserts the property at the source, for both.
    for (const [label, setup] of [
        ['InitializeGrid', 'InitializeGrid();'],
        ['InitializeGridDimensions', 'InitializeGridDimensions(3, "3");'],
    ]) {
        const probeCtx = { console: { log() {}, warn() {}, error() {} } };
        vm.createContext(probeCtx);
        vm.runInContext(ReadBundle(), probeCtx);
        vm.runInContext('globalThis.engine = CreateEngineInstance();', probeCtx);
        vm.runInContext(setup, probeCtx);

        const enumerable = vm.runInContext(
            '(() => { const e = [...engine.state.edges.values()][0];' +
            ' return Object.getOwnPropertyDescriptor(e, "units").enumerable; })()',
            probeCtx
        );
        check('the units getter is non-enumerable in ' + label, enumerable === false);
    }

    // --- 4. fog is enforced on the payload, not just in the renderer -------
    if (haveBoth) {
        const p2View = views[1];
        check('player 2 view is marked as filtered', p2View.filtered === true);

        const enemies = p2View.units.filter(u => u.player === 1);
        const redacted = enemies.filter(u => u.hidden === true);

        check('player 2 receives at least one redacted enemy (' + redacted.length +
            ' of ' + enemies.length + ')', redacted.length > 0);

        // The claim that matters: a redacted unit carries NO position. If this ever
        // fails, fog of war is cosmetic and a modified client can read the board.
        check('a redacted enemy carries no position on the wire',
            redacted.every(u => u.position === undefined && u.positionType === undefined));
        check('a redacted enemy carries no hp or type on the wire',
            redacted.every(u => u.currentHp === undefined && u.type === undefined));
    }

    // --- 5. a received view rebuilds a drawable board ----------------------
    //
    // The other half of replication: the server produced a view, and a client has to
    // turn it back into something render.js can draw. ApplyRemoteView
    // (js/client/remote-state.js) is that step, and until it existed a hosted match
    // sent perfectly good state to a client that had nowhere to put it.
    //
    // Applied into a FRESH engine with no board of its own, which is the real case —
    // a joining client has never seen this match.
    if (haveBoth) {
        const client = { console: { log() {}, warn() {}, error() {} } };
        vm.createContext(client);
        vm.runInContext(ReadBundle(), client);
        vm.runInContext('globalThis.engine = CreateEngineInstance();', client);
        vm.runInContext('globalThis.gameState = { needsRedraw: false };', client);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/client/remote-state.js'), 'utf8'), client);

        vm.runInContext('globalThis.incoming = ' + JSON.stringify(views[0]) + ';', client);
        vm.runInContext('BeginRemoteMatch(1); ApplyRemoteView(incoming);', client);

        const rebuilt = JSON.parse(vm.runInContext(`(() => {
            const anyEdge = [...engine.state.edges.values()][0];
            return JSON.stringify({
                tiles: engine.state.tiles.size,
                edges: engine.state.edges.size,
                units: engine.state.units.length,
                currentPlayer: engine.state.currentPlayer,
                terrainIsObject: typeof [...engine.state.tiles.values()][0].type === 'object',
                edgeUnitsEnumerable: Object.getOwnPropertyDescriptor(anyEdge, 'units').enumerable,
                redrawRequested: gameState.needsRedraw,
                visionFromHost: !!(engine.visionCache && engine.visionCache.tiles),
                visionRecomputeSkipped: engine.visionDirty === false,
                visibleTileCount: engine.visionCache ? engine.visionCache.tiles.size : -1,
            });
        })()`, client));

        check('the view rebuilds every tile', rebuilt.tiles === views[0].tiles.length);
        check('the view rebuilds every edge', rebuilt.edges === views[0].edges.length);
        check('terrain is rehydrated back into a TILE_TYPES object, not left a name',
            rebuilt.terrainIsObject === true);

        // The live accessor cannot travel, so it has to be re-attached — and must be
        // non-enumerable here too, or the next thing that serializes this board puts
        // every unit back on the wire.
        check('the edge units accessor is re-attached as non-enumerable',
            rebuilt.edgeUnitsEnumerable === false);

        // Redacted enemies arrive with no position; keeping them as stubs would mean
        // every draw call needing a special case.
        const visible = views[0].units.filter(u => !u.hidden).length;
        check('hidden units are dropped rather than drawn as stubs', rebuilt.units === visible);

        check('applying a view asks for a repaint', rebuilt.redrawRequested === true);

        // Vision is TAKEN from the host, not recomputed. The client only holds part of
        // the board, so deriving fog from it could agree only by luck — the server had
        // to work the set out anyway in order to know what to send.
        check('vision is taken from the host', rebuilt.visionFromHost === true);
        check('and is not marked for local recomputation', rebuilt.visionRecomputeSkipped === true);
        check('the host-supplied vision set is non-empty', rebuilt.visibleTileCount > 0);
    }

    // --- 6. a client only controls its own side ----------------------------
    //
    // Every ownership gate in the client used to read `gameMode === 'singleplayer' &&
    // unit.player !== playerSide`. Correct while singleplayer was the only mode that
    // bound a client to one side — but an online client is bound the same way with a
    // different mode string, so every one of those tests evaluated false and both
    // players could drag both armies. The server refused the illegal moves, so nothing
    // desynced; it just made having two sides pointless.
    //
    // The predicates are extracted here rather than loading client-state.js, which
    // pulls in the whole client. They are short enough that duplicating them would
    // rot, so this reads the real source and evaluates just those functions.
    {
        const clientState = fs.readFileSync(path.join(__dirname, '../js/client/client-state.js'), 'utf8');
        const gates = clientState.slice(clientState.indexOf('function IsBoundToOneSide'));

        const ctx = { engine: { state: {} } };
        vm.createContext(ctx);
        vm.runInContext(gates, ctx);

        const Ask = (playerSide, currentPlayer, unitPlayer) => {
            ctx.engine.state.playerSide = playerSide;
            ctx.engine.state.currentPlayer = currentPlayer;
            return {
                foreign: vm.runInContext('IsForeignUnit(' + JSON.stringify({ player: unitPlayer }) + ')', ctx),
                theirTurn: vm.runInContext('IsOpponentsTurn()', ctx),
            };
        };

        // Hotseat: controlling both sides is the entire point, so nothing is foreign.
        check('local play treats no unit as foreign', Ask(null, 1, 2).foreign === false);
        check('local play never reports an opponent turn', Ask(null, 2, 1).theirTurn === false);

        // Bound to a side, whether by choosing one or by taking a seat.
        check('a bound client may move its own units', Ask(1, 1, 1).foreign === false);
        check('a bound client may NOT move the other side', Ask(1, 1, 2).foreign === true);
        check('a bound client knows when the turn is not theirs', Ask(1, 2, 1).theirTurn === true);
        check('and when it is', Ask(2, 2, 2).theirTurn === false);
    }

    // --- 7. the rebuilt board must be SPATIALLY usable, not just present -----
    //
    // Having the right tiles, edges and units is not enough. engine.state.fineGrid is a
    // DERIVED index, rebuilt by every other path that replaces a board — after
    // InitializeGrid, after a load, after a resize. This path replaced the board and did
    // not, so the index stayed empty and every spatial query returned nothing.
    //
    // It presented as "units cannot attack": the Attack button greys itself out when
    // there are no valid targets, and with no fine grid there were never any targets,
    // even with an enemy on the adjacent edge. The board looked perfect and had no
    // geometry. Compared against the server rather than asserted as a number, because
    // the only thing that matters is that the two agree.
    {
        const server = { console: { log() {}, warn() {}, error() {} } };
        vm.createContext(server);
        vm.runInContext(ReadBundle(), server);
        vm.runInContext('globalThis.engine = CreateEngineInstance();'
            + ' engine.settings.fogOfWarEnabled = false; InitializeGrid();', server);

        // Put an enemy on an edge next to one of ours so an attack is genuinely legal.
        const staged = JSON.parse(vm.runInContext([
            "(() => {",
            "  const a = engine.state.units.find(u => u.player === 1 && u.type.attackType === 'melee');",
            "  const spot = getRotationallyAdjacentEdges(a.position)[0];",
            "  const b = engine.state.units.find(u => u.player === 2 && u.type.attackType === 'melee');",
            "  b.position = spot; b.positionType = 'edge';",
            "  return JSON.stringify({ attacker: a.id });",
            "})()",
        ].join('\n'), server));

        const ask = "(() => { const a = engine.state.units.find(u => u.id === '" + staged.attacker + "');"
            + " return JSON.stringify({ targets: getValidMeleeAttackTargets(a).length,"
            + " moves: getPossibleMoves(a).size, fineGrid: engine.state.fineGrid.size }); })()";

        const onServer = JSON.parse(vm.runInContext(ask, server));
        const snapshot = JSON.parse(vm.runInContext('JSON.stringify(BuildResyncSnapshot(1))', server));

        const client = { console: { log() {}, warn() {}, error() {} } };
        vm.createContext(client);
        vm.runInContext(ReadBundle(), client);
        vm.runInContext('globalThis.engine = CreateEngineInstance();'
            + ' globalThis.gameState = { needsRedraw: false };', client);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/client/remote-state.js'), 'utf8'), client);
        vm.runInContext('globalThis.incoming = ' + JSON.stringify(snapshot) + ';', client);
        vm.runInContext('BeginRemoteMatch(1); ApplyRemoteView(incoming);', client);

        const onClient = JSON.parse(vm.runInContext(ask, client));

        check('the rebuilt board has a fine grid at all (' + onClient.fineGrid + ')',
            onClient.fineGrid > 0);
        check('the fine grid matches the server (' + onClient.fineGrid + ' vs ' + onServer.fineGrid + ')',
            onClient.fineGrid === onServer.fineGrid);
        check('an adjacent enemy IS attackable after a rebuild ('
            + onClient.targets + ' vs ' + onServer.targets + ')',
            onServer.targets > 0 && onClient.targets === onServer.targets);
        check('legal moves match the server (' + onClient.moves + ' vs ' + onServer.moves + ')',
            onServer.moves > 0 && onClient.moves === onServer.moves);
    }

    check('nothing errored inside the worker' +
        (errors.length ? ' (' + errors.map(e => e.where + ': ' + e.error).join('; ') + ')' : ''),
        errors.length === 0);

    await worker.terminate();

    if (failures.length) {
        console.error('FAIL — ' + failures.length + ' check(s)');
        failures.forEach(f => console.error('  !! ' + f));
        process.exit(1);
    }

    const sizes = views.map(v => JSON.stringify(v).length);
    console.log('PASS — per-recipient state replication');
    console.log('  addressed : each player got their own sync, not one broadcast');
    console.log('  renderable: the moved unit is reported at its new edge, with ' +
        views[0].tiles.length + ' tiles and ' + views[0].edges.length + ' edges');
    console.log('  no leak   : edges carry no live units getter');
    console.log('  fog       : enemy units outside vision arrive redacted, without position');
    console.log('  rebuild   : a received view reconstructs a drawable board on a fresh client');
    console.log('  ownership : a seated client controls its own side only; hotseat controls both');
    console.log('  geometry  : the rebuilt board answers attack range and movement like the server');
    console.log('  size      : ' + sizes.map(n => (n / 1024).toFixed(1) + 'KB').join(' / ') + ' per view');
}

Main().catch((error) => {
    console.error('FAIL —', error.message);
    process.exit(1);
});
