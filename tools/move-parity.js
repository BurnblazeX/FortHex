// FortHex - what does the movement model actually ANSWER?  (Track C, step 1)
//
//   node tools/move-parity.js --record    write the baseline from current code
//   node tools/move-parity.js             compare current code to the baseline
//   node tools/move-parity.js --verbose   list every differing case
//   node tools/move-parity.js --case=ID   dump one case in full, both sides
//
// Track C replaces getPossibleMoves, getEdgeCost and findSupplyPath with
// fine-grid implementations. The roadmap's acceptance test for that cutover is
// "compare old-model output to new-model output, don't assume parity". This is
// the thing that makes that sentence executable.
//
// WHY IT IS WRITTEN BEFORE THE NEW MODEL EXISTS. A harness authored alongside
// the code it checks gets shaped by that code - you assert what you just watched
// it do. Written first, against the model being replaced, it is only a recording,
// and the new implementation inherits a fixed target it had no hand in choosing.
// A4 built its migration chain against real archived saves rather than an assumed
// table for the same reason, and found three era buckets wrong.
//
// TWO LESSONS FROM tools/state-parity.js ARE BUILT IN HERE:
//
//   1. Comparing defaults proves nothing. Its first run compared two fresh
//      engines, found 3 gaps and looked healthy; perturbing every field off its
//      default first revealed 6 more. So this does not ask each unit one
//      question from its starting state - it asks ten, across fog, action
//      economy, movement allowance and flag carriage.
//
//   2. A field can be present and the board still unusable. So this records what
//      the model ANSWERS (reachable sets, costs, paths, supply routes), never
//      what it stores.
//
// And one from tools/map-setup-smoke.js: assert the answers are not all
// identical. A baseline in which every unit reaches the same four edges would
// pass forever while checking nothing, so RunSweep refuses to record one.
//
// Exit code 0 = pass.

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { ReadBundle } = require('../host/server-bundle.js');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'tools', 'reference', 'move-parity.baseline.json');

const args = process.argv.slice(2);
const recording = args.includes('--record');
const verbose = args.includes('--verbose');
const strict = args.includes('--strict');
const caseArg = (args.find(a => a.startsWith('--case=')) || '').split('=')[1];

// --- the boards ------------------------------------------------------------
// Four selectable maps (the ones a player can actually pick) plus seeded
// generated boards at every radius the game supports. The generated ones are
// only meaningful because Track C step 0 seeded the generator; before that
// "an arbitrary generated map" could not be visited twice.
const BOARDS = [
    { id: 'preset:Standard', kind: 'preset', name: 'Standard' },
    { id: 'preset:AlphaGrounds', kind: 'preset', name: 'Alpha Grounds' },
    { id: 'preset:RiverFork', kind: 'preset', name: 'River Fork' },
    { id: 'preset:VolcanoIsland', kind: 'preset', name: 'Volcano Island' },
    { id: 'gen:r2:s1001', kind: 'generated', radius: 2, seed: 1001 },
    { id: 'gen:r3:s1002', kind: 'generated', radius: 3, seed: 1002 },
    { id: 'gen:r4:s1003', kind: 'generated', radius: 4, seed: 1003 },
    { id: 'gen:r3:s2024', kind: 'generated', radius: 3, seed: 2024 },
];

// --- the perturbations -----------------------------------------------------
// Every one of these gates a different branch of getPossibleMoves. Left at
// defaults, a unit exercises exactly one of them.
const VARIANTS = [
    { id: 'default', apply: {} },
    { id: 'mp1', apply: { currentMove: 1 } },
    { id: 'mp3', apply: { currentMove: 3 } },
    { id: 'mp-high', apply: { currentMove: 99 } },
    { id: 'fortified', apply: { isFortified: true } },
    { id: 'spearwalled', apply: { spearWalled: true } },
    { id: 'ambushed', apply: { ambushed: true } },
    { id: 'major-action', apply: { hasPerformedMajorAction: true } },
    { id: 'carrying-flag', apply: { isCarryingFlag: true } },
    { id: 'flag-and-move', apply: { isCarryingFlag: true, currentMove: 6 } },
];

// The sweep runs INSIDE the vm context, where every game function is a global.
// One string round-trip per board rather than one per query: the same work split
// across ~1100 vm calls takes minutes instead of seconds.
const SWEEP = `
// A path summary rather than the path. Track C routes paths through vertices as
// real waypoints (edge -> vertex -> edge), so the SPELLING of a path is expected
// to change at the cutover while the route it describes must not. Recording the
// full string would manufacture 1280 guaranteed failures that mean nothing.
// Endpoints and length survive a representation change; the interior does not.
function PathSummary(p) {
    if (!Array.isArray(p) || p.length === 0) return null;
    return p[0] + '..' + p[p.length - 1] + '#' + p.length;
}

function BuildBoard(board) {
    globalThis.engine = CreateEngineInstance();
    engine.settings.fogOfWarEnabled = false;
    if (board.kind === 'preset') {
        const map = FindSelectableMap(board.name);
        if (!map) throw new Error('no such preset: ' + board.name);
        // Order matters. SetGridMode then InitializeGridDimensions then
        // InitializeGrid - without the first two a radius-4 map is poured into a
        // radius-3 grid, loses every tile outside the smaller ring, and still
        // starts a playable match on a board nobody picked (roadmap B2).
        SetGridMode(map.radius);
        InitializeGridDimensions(map.radius);
        const bc = map.baseCampPositions;
        // { player1: null, player2: null } is TRUTHY and wipes the computed
        // camps. It has to be normalised to null (roadmap B1 trap).
        const camps = (bc && (bc.player1 || bc.player2)) ? bc : null;
        InitializeGrid(map.tiles, map.units, camps);
        return map.radius;
    }
    SetGridMode(board.radius);
    InitializeGridDimensions(board.radius);
    InitializeGrid(GenerateImprovedMap(board.radius, board.seed));
    return board.radius;
}

// Every board in this sweep is at turn one: nothing is fortified, no two enemies
// are adjacent, and no archer shares an edge with a swordsman. So Zone of
// Control, Spear Wall, combined arms and attack targeting ALL answer false or
// zero on every unit of every board, and recording them from the opening
// position would produce a baseline that compares equal forever while checking
// nothing. AssertNotDegenerate says exactly that, out loud, when it happens.
//
// This builds the positions those rules actually need. It is deliberately
// hand-placed rather than played forward: a scripted opening would still only
// visit whatever the AI happened to do, and the point is to visit the branches.
function RuleAnswers(unit) {
    const Safe = (fn) => { try { return fn(); } catch (e) { return 'ERR:' + String(e && e.message || e); } };
    return {
        spearWalled: Safe(() => !!isEdgeAdjacentToSpearWall(unit, unit.position)),
        combinedArms: Safe(() => !!hasCombinedArmsSupport(unit)),
        zocSuppressed: Safe(() => !!isZoCSuppressed(unit)),
        fortifyTargets: Safe(() => [...GetValidFortifyTargets(unit)].sort().join(',')),
        unfortifyTargets: Safe(() => [...getPotentialUnfortifyTargets(unit)].sort().join(',')),
        bridgeTargets: Safe(() => [...getPotentialBridgeTargets(unit)].sort().join(',')),
        attackRange: Safe(() => {
            const cells = getAttackRangeCells(unit);
            return cells && cells.size !== undefined ? cells.size : (cells ? cells.length : 0);
        }),
        meleeTargets: Safe(() => (getValidMeleeAttackTargets(unit) || []).length),
        archerTargets: Safe(() => (getValidArcherAttackTargets(unit) || []).length),
    };
}

function BuildRulesScenario() {
    const crossable = [];
    engine.state.edges.forEach((edge, edgeKey) => {
        const tiles = getTileKeysOfEdge(edgeKey).map(k => engine.state.tiles.get(k));
        if (tiles.length !== 2 || !tiles[0] || !tiles[1]) return;
        if (tiles.some(t => !t.type || t.type.crossable === false)) return;
        crossable.push(edgeKey);
    });
    crossable.sort();

    // A pair of adjacent edges, so the two sides can actually reach each other.
    let home = null, front = null;
    for (const edgeKey of crossable) {
        const neighbours = GetVertexAdjacentEdges(edgeKey).filter(k => crossable.indexOf(k) !== -1).sort();
        if (neighbours.length) { home = edgeKey; front = neighbours[0]; break; }
    }
    if (!home) return null;

    engine.state.units.length = 0;
    engine.state.tiles.forEach(tile => { tile.fortifiedByPlayer = null; });

    const placed = [];
    const Place = (player, typeKey, edgeKey) => {
        const unit = createUnit(player, UNIT_TYPES[typeKey], edgeKey);
        engine.state.units.push(unit);
        placed.push(unit.id);
        return unit;
    };

    // Archer plus a melee partner on one edge is the combined-arms pairing.
    Place(1, 'ARCHER', home);
    Place(1, 'MELEE', home);
    // An enemy on the adjacent edge gives both sides real attack targets.
    Place(2, 'MELEE', front);

    // A fortified enemy on a tile of that edge is what Spear Wall and Zone of
    // Control key off. Fortification is a tile flag plus a unit that has moved
    // to the tile centre, so both halves have to be set.
    const frontTiles = getTileKeysOfEdge(front);
    const fortifyTileKey = frontTiles.find(k => {
        const tile = engine.state.tiles.get(k);
        return tile && tile.type && tile.type.canFortify;
    });
    if (fortifyTileKey) {
        const defender = Place(2, 'PIKEMAN', front);
        defender.isFortified = true;
        defender.positionType = 'center';
        defender.position = fortifyTileKey;
        defender.fortifiedTileKey = fortifyTileKey;
        engine.state.tiles.get(fortifyTileKey).fortifiedByPlayer = 2;

        // Zone of Control needs TWO enemies across TWO different edges - two on
        // one edge is not suppression (rules.js: totalEnemyCount >= 2 AND
        // occupiedEdgesCount >= 2). The pair placed above share an edge because
        // combined arms requires that, so without a third unit on a separate
        // edge touching the fortified tile, zocSuppressed answers false on every
        // board and that half of the baseline records nothing.
        let flankEdge = null;
        engine.state.edges.forEach((edge, edgeKey) => {
            if (flankEdge || edgeKey === home || edgeKey === front) return;
            if (crossable.indexOf(edgeKey) === -1) return;
            if (getTileKeysOfEdge(edgeKey).indexOf(fortifyTileKey) !== -1) flankEdge = edgeKey;
        });
        if (flankEdge) Place(1, 'PIKEMAN', flankEdge);
    }

    buildFineGridIndex();
    engine.visionCache = null;
    return { home: home, front: front, fortifyTileKey: fortifyTileKey || null, unitIds: placed };
}

function RunSweep(board, variants) {
    const radius = BuildBoard(board);
    const out = { id: board.id, radius: radius, moves: {}, edgeCosts: {}, supply: {} };

    // --- edge costs, both players, every edge --------------------------------
    for (const player of [1, 2]) {
        const costs = {};
        for (const edgeKey of [...engine.state.edges.keys()].sort()) {
            const c = getEdgeCost({ player: player }, edgeKey);
            costs[edgeKey] = (c === Infinity) ? 'Inf' : c;
        }
        out.edgeCosts['p' + player] = costs;
    }

    // --- supply routes from every tile, both players -------------------------
    // Arcade boards (every radius-2 map, forced by SetGridMode) have no flags and
    // no supply. findSupplyPath reads engine.state.flags unguarded and THROWS
    // there; its only caller, recalculatePlayerSupplyNetwork, returns early on
    // arcade before reaching it, so this is latent fragility rather than a live
    // bug - but it is recorded here rather than smoothed over, because the
    // fine-grid rewrite of findSupplyPath will decide whether to keep it.
    out.supplySkipped = (engine.state.gameMode === 'arcade') ? 'arcade: no flags, no supply' : null;
    for (const player of [1, 2]) {
        const routes = {};
        if (!out.supplySkipped) {
            for (const tileKey of [...engine.state.tiles.keys()].sort()) {
                let r = null, err = null;
                try { r = findSupplyPath(tileKey, player); }
                catch (e) { err = String(e && e.message || e); }
                routes[tileKey] = err ? { error: err } : (r ? { cost: r.cost, path: PathSummary(r.path) } : null);
            }
        }
        out.supply['p' + player] = routes;
    }

    // --- reachable sets, per unit, per variant, fog off and fog on -----------
    const unitIds = engine.state.units.map(u => u.id).sort();
    for (const fog of [false, true]) {
        engine.settings.fogOfWarEnabled = fog;
        for (const unitId of unitIds) {
            for (const variant of variants) {
                const unit = engine.state.units.find(u => u.id === unitId);
                if (!unit) continue;
                const saved = {};
                for (const key of Object.keys(variant.apply)) saved[key] = unit[key];
                Object.assign(unit, variant.apply);
                // Vision is normally filled client-side, so a headless engine
                // leaves it null and the fog branch of getPossibleMoves never
                // runs. Filling it here is what makes fog:true mean anything.
                engine.visionCache = fog ? computePlayerVision(unit.player) : null;

                let reachable, error = null;
                try {
                    reachable = getPossibleMoves(unit);
                } catch (e) {
                    reachable = new Map();
                    error = String(e && e.message || e);
                }
                const edges = {};
                const paths = {};
                for (const key of [...reachable.keys()].sort()) {
                    const v = reachable.get(key);
                    edges[key] = v.cost;
                    paths[key] = PathSummary(v.path);
                }
                // The rest of the systems the roadmap lists for this track: Zone
                // of Control, Spear Wall, combined arms, fortification legality
                // and attack targeting. None of them moved in this cutover, but
                // C1 and C2 change all of them, and recording what they answer
                // NOW is the only chance to record it before the model that
                // answers changes. Kept compact - counts and booleans, plus a
                // sorted key list for targets - because the point is to detect a
                // difference, and the live code can always be asked for detail.
                const rules = RuleAnswers(unit);

                const caseId = board.id + '|' + (fog ? 'fog' : 'clear') + '|' + unitId + '|' + variant.id;
                out.moves[caseId] = { n: Object.keys(edges).length, edges: edges, paths: paths, error: error, rules: rules };

                for (const key of Object.keys(saved)) unit[key] = saved[key];
                engine.visionCache = null;
            }
        }
    }
    engine.settings.fogOfWarEnabled = false;

    // --- the engineered positions -------------------------------------------
    const scenario = BuildRulesScenario();
    out.scenario = scenario ? { setup: scenario, cases: {} } : null;
    if (scenario) {
        for (const fog of [false, true]) {
            engine.settings.fogOfWarEnabled = fog;
            for (const unitId of scenario.unitIds) {
                const unit = engine.state.units.find(u => u.id === unitId);
                if (!unit) continue;
                engine.visionCache = fog ? computePlayerVision(unit.player) : null;
                const key = (fog ? 'fog' : 'clear') + '|' + unitId;
                out.scenario.cases[key] = RuleAnswers(unit);
                engine.visionCache = null;
            }
        }
        engine.settings.fogOfWarEnabled = false;
    }
    return out;
}
`;

function Boot() {
    const ctx = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(ctx);
    vm.runInContext(ReadBundle(), ctx);
    vm.runInContext(SWEEP, ctx);
    return ctx;
}

function Sweep() {
    const boards = {};
    for (const board of BOARDS) {
        const ctx = Boot();
        const json = vm.runInContext(
            'JSON.stringify(RunSweep(' + JSON.stringify(board) + ', ' + JSON.stringify(VARIANTS) + '))', ctx);
        boards[board.id] = JSON.parse(json);
    }
    return boards;
}

// A sweep in which nothing varies would satisfy every equality check forever.
// map-setup-smoke.js exists because "every map silently became the default"
// passed a suite that only compared values to themselves.
function AssertNotDegenerate(boards) {
    const problems = [];
    const degenerateRules = [];
    const shapes = new Set();
    let totalCases = 0, nonEmpty = 0;

    for (const id of Object.keys(boards)) {
        const b = boards[id];
        const counts = new Set();
        for (const caseId of Object.keys(b.moves)) {
            const c = b.moves[caseId];
            totalCases++;
            if (c.n > 0) nonEmpty++;
            counts.add(c.n);
            shapes.add(JSON.stringify(c.edges));
        }
        if (counts.size < 2) {
            problems.push(id + ': every unit reaches the same number of edges (' + [...counts] + ')');
        }
        // A rules block where every field answers the same thing for every unit
        // on every board would compare equal forever while proving nothing - the
        // same trap the reachable-set check above exists for.
        const ruleAnswers = {};
        for (const caseId of Object.keys(b.moves)) {
            const r = b.moves[caseId].rules || {};
            for (const key of Object.keys(r)) {
                (ruleAnswers[key] = ruleAnswers[key] || new Set()).add(JSON.stringify(r[key]));
            }
        }
        for (const key of Object.keys(ruleAnswers)) {
            if (ruleAnswers[key].size < 2 && Object.keys(b.moves).length > 20) {
                degenerateRules.push(id + '.' + key + '=' + [...ruleAnswers[key]][0]);
            }
        }
        const costs = new Set(Object.values(b.edgeCosts.p1));
        if (costs.size < 2) problems.push(id + ': every edge costs the same (' + [...costs] + ')');
    }
    // The whole reason the scenario exists is to make these answer something
    // other than false. If it does not, it has stopped working and the rules
    // half of this baseline is decorative.
    const fired = new Set();
    for (const id of Object.keys(boards)) {
        const sc = boards[id].scenario;
        if (!sc) continue;
        for (const key of Object.keys(sc.cases)) {
            const r = sc.cases[key];
            for (const field of Object.keys(r)) {
                const v = r[field];
                if (v === true || (typeof v === 'number' && v > 0) || (typeof v === 'string' && v !== '' && !v.startsWith('ERR:'))) {
                    fired.add(field);
                }
            }
        }
    }
    for (const needed of ['spearWalled', 'combinedArms', 'meleeTargets', 'attackRange', 'zocSuppressed']) {
        if (!fired.has(needed)) problems.push('the engineered scenario never made ' + needed + ' fire');
    }

    if (nonEmpty === 0) problems.push('no case anywhere produced a reachable edge');
    if (nonEmpty === totalCases) problems.push('every case produced a reachable edge - the blocking variants did nothing');
    if (shapes.size < 10) problems.push('only ' + shapes.size + ' distinct reachable sets across the whole sweep');
    return { problems, totalCases, nonEmpty, distinct: shapes.size, degenerateRules };
}

// --- comparison ------------------------------------------------------------
// HARD: which edges are reachable, at what cost, and what supply costs. These
//       are the promises the cutover makes. Any difference is a failure.
// SOFT: how a path is spelled. Track C deliberately re-routes paths through
//       vertices, so these are reported and not failed on unless --strict.
function DiffBoards(before, after) {
    const hard = [], soft = [];
    const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const id of ids) {
        const a = before[id], b = after[id];
        if (!a) { hard.push({ id, what: 'board only in current run' }); continue; }
        if (!b) { hard.push({ id, what: 'board missing from current run' }); continue; }

        for (const player of ['p1', 'p2']) {
            if (JSON.stringify(a.edgeCosts[player]) !== JSON.stringify(b.edgeCosts[player])) {
                const changed = Object.keys(a.edgeCosts[player])
                    .filter(k => a.edgeCosts[player][k] !== b.edgeCosts[player][k]);
                hard.push({ id, what: 'edgeCosts.' + player + ': ' + changed.length + ' edge(s) changed cost'
                    + (changed.length ? ' e.g. ' + changed[0] + ' ' + a.edgeCosts[player][changed[0]]
                        + ' -> ' + b.edgeCosts[player][changed[0]] : '') });
            }
            const as = a.supply[player] || {}, bs = b.supply[player] || {};
            for (const tile of new Set([...Object.keys(as), ...Object.keys(bs)])) {
                const x = as[tile], y = bs[tile];
                const xc = x && x.cost, yc = y && y.cost;
                if (!!x !== !!y || xc !== yc) {
                    hard.push({ id, what: 'supply.' + player + ' at ' + tile + ': cost ' + xc + ' -> ' + yc });
                } else if (x && y && x.path !== y.path) {
                    soft.push({ id, what: 'supply.' + player + ' at ' + tile + ': route respelled ' + x.path + ' -> ' + y.path });
                }
            }
        }

        const sa = (a.scenario && a.scenario.cases) || {}, sb = (b.scenario && b.scenario.cases) || {};
        for (const key of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
            if (JSON.stringify(sa[key]) !== JSON.stringify(sb[key])) {
                const before = sa[key] || {}, after = sb[key] || {};
                const changed = Object.keys(Object.assign({}, before, after))
                    .filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
                hard.push({ id, case: 'scenario|' + key, what: 'rules differ: ' + changed.map(k =>
                    k + ' ' + JSON.stringify(before[k]) + ' -> ' + JSON.stringify(after[k])).join(', ') });
            }
        }

        const caseIds = new Set([...Object.keys(a.moves), ...Object.keys(b.moves)]);
        for (const caseId of caseIds) {
            const ca = a.moves[caseId], cb = b.moves[caseId];
            if (!ca || !cb) { hard.push({ id, case: caseId, what: 'case present on only one side' }); continue; }
            if (JSON.stringify(ca.edges) !== JSON.stringify(cb.edges)) {
                const keysA = Object.keys(ca.edges), keysB = Object.keys(cb.edges);
                const gained = keysB.filter(k => !(k in ca.edges));
                const lost = keysA.filter(k => !(k in cb.edges));
                const recosted = keysA.filter(k => k in cb.edges && ca.edges[k] !== cb.edges[k]);
                hard.push({ id, case: caseId, what: 'reachable set differs: '
                    + ca.n + ' -> ' + cb.n + ' edges'
                    + (gained.length ? ', +' + gained.length : '')
                    + (lost.length ? ', -' + lost.length : '')
                    + (recosted.length ? ', ' + recosted.length + ' recosted (e.g. ' + recosted[0]
                        + ' ' + ca.edges[recosted[0]] + ' -> ' + cb.edges[recosted[0]] + ')' : '') });
            }
            if (JSON.stringify(ca.rules || null) !== JSON.stringify(cb.rules || null)) {
                const before = ca.rules || {}, after = cb.rules || {};
                const changed = Object.keys(Object.assign({}, before, after))
                    .filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
                hard.push({ id, case: caseId, what: 'rules differ: ' + changed.map(k =>
                    k + ' ' + JSON.stringify(before[k]) + ' -> ' + JSON.stringify(after[k])).join(', ') });
            }
            if (JSON.stringify(ca.edges) === JSON.stringify(cb.edges)
                && JSON.stringify(ca.paths) !== JSON.stringify(cb.paths)) {
                const n = Object.keys(ca.paths).filter(k => ca.paths[k] !== cb.paths[k]).length;
                soft.push({ id, case: caseId, what: n + ' path(s) respelled, same edges at the same costs' });
            }
            if (ca.error !== cb.error) {
                hard.push({ id, case: caseId, what: 'error changed: ' + ca.error + ' -> ' + cb.error });
            }
        }
    }
    return { hard, soft };
}

// --- main ------------------------------------------------------------------
if (caseArg) {
    const boards = Sweep();
    for (const id of Object.keys(boards)) {
        const hit = boards[id].moves[caseArg];
        if (hit) { console.log(JSON.stringify(hit, null, 2)); process.exit(0); }
    }
    console.error('no such case: ' + caseArg);
    process.exit(1);
}

const boards = Sweep();
const health = AssertNotDegenerate(boards);

if (health.problems.length) {
    console.error('move-parity: the sweep is degenerate and would prove nothing:');
    health.problems.forEach(p => console.error('  - ' + p));
    process.exit(1);
}

if (verbose && health.degenerateRules.length) {
    console.log('note: these rule fields answered identically across a whole board.');
    console.log('      Expected for some (no forest means no combined arms); worth a look if a');
    console.log('      field is constant on EVERY board, which would mean it is untested here.');
    for (const d of health.degenerateRules) console.log('      ' + d);
}

if (recording) {
    const payload = {
        note: 'Track C baseline. Re-recorded after C1 (terrain weights 1/3/5/5 with a mean combine, cap 5, pools 9/7/5/5). The pre-C1 baseline it replaced is in git history at commit 0d16792. Do not regenerate to make a failing comparison pass - a red run means behaviour moved, and only a deliberate balance change justifies a new recording.',
        recordedAt: new Date().toISOString().slice(0, 10),
        boards,
    };
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    // Compact, one line per board rather than one per field. Pretty-printing
    // tripled the size of a file nobody reads by eye - the tool reports the
    // diffs. Same reasoning as Testament's lean schema: the file holds the
    // skeleton and the tool regenerates the rest. One line per board still
    // gives git a per-board diff, which is the only granularity that helps.
    const lines = Object.keys(payload.boards).sort()
        .map(id => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(payload.boards[id]));
    fs.writeFileSync(BASELINE, [
        '{',
        ' "note": ' + JSON.stringify(payload.note) + ',',
        ' "recordedAt": ' + JSON.stringify(payload.recordedAt) + ',',
        ' "boards": {',
        lines.join(',' + '\n'),
        ' }',
        '}',
    ].join('\n') + '\n');
    const kb = Math.round(fs.statSync(BASELINE).size / 1024);
    console.log('move-parity: recorded ' + health.totalCases + ' move cases across '
        + Object.keys(boards).length + ' boards (' + health.distinct + ' distinct reachable sets, ' + kb + ' KB)');
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error('move-parity: no baseline at ' + path.relative(ROOT, BASELINE) + ' - run with --record first');
    process.exit(1);
}

const { hard, soft } = DiffBoards(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).boards, boards);

function Report(label, list) {
    console.error('\n' + label + ' (' + list.length + '):');
    const shown = verbose ? list : list.slice(0, 15);
    for (const d of shown) {
        console.error('  ' + d.id + (d.case ? '  ' + d.case : '') + '\n      ' + d.what);
    }
    if (!verbose && list.length > shown.length) {
        console.error('  ... ' + (list.length - shown.length) + ' more (--verbose for all)');
    }
}

if (soft.length) Report('PATHS RESPELLED - same edges, same costs, different route spelling', soft);

if (hard.length === 0) {
    if (soft.length && strict) {
        console.error('\nmove-parity: FAIL under --strict (path spelling changed)');
        process.exit(1);
    }
    console.log('move-parity: ok - ' + health.totalCases + ' move cases match the baseline'
        + (soft.length ? ' (' + soft.length + ' path respellings, not a parity failure)' : ''));
    process.exit(0);
}

Report('PARITY BROKEN - reachable sets, costs or supply differ', hard);
console.error('\nInspect one with:  node tools/move-parity.js --case=<id>');
console.error('Do NOT re-record to make this pass. The baseline is the old model.');
process.exit(1);
