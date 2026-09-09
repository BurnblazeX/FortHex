// FortHex - is the fine grid really the whole address space?  (Track C)
//
//   node tools/board-space-smoke.js
//   node tools/board-space-smoke.js --verbose
//
// unit.position holds a fine-grid coordinate and nothing else (schema v11). This
// file used to argue FOR that change, checking the proposed addressing against the
// tile-key-or-edge-key scheme it was going to replace. That argument is spent - the
// old representation is gone and there is nothing left to compare against - so what
// this file checks now is the invariant the shipped model rests on, which is the
// same claim from the other side: THE FINE GRID IS THE WHOLE ADDRESS SPACE.
//
// Four things, and the fourth is the one that would be expensive to discover late:
//
//   1. EVERY UNIT IS SOMEWHERE REAL. Its position resolves to an actual fine-grid
//      cell - never to nothing, and never to a rim cell, which is a lattice
//      position no unit may occupy.
//
//   2. THE LEGACY KEYS ROUND-TRIP. unit.edgeKey and unit.tileKey convert back to
//      exactly the position they came from. Roughly a hundred call sites still ask
//      for a tile or edge key by name; if that conversion loses information, all of
//      them are quietly reading the wrong cell.
//
//   3. EXACTLY ONE OF THEM IS NON-NULL. A unit is on a hexCenter or a hexPath and
//      never both or neither, so tileKey and edgeKey are never both answers - which
//      is what makes tiles.get(unit.tileKey) safe to call unconditionally.
//
//   4. FORTIFICATION AGREES WITH THE CELL. isFortified is derived from position
//      now, so this is no longer "do two stored facts match" but "does the derived
//      flag match what the board says is there" - the tile's own fortifiedByPlayer
//      and the cell's type. A disagreement means fortify and position have come
//      apart, which is the exact bug deriving the flag was meant to make impossible.
//
// Units are FORTIFIED for real here, through the action path, because a board at
// turn one has no fortified units at all and every one of these checks would
// pass while testing only half of what it claims to.
//
// Exit code 0 = pass.

const vm = require('vm');
const { ReadBundle } = require('../host/server-bundle.js');

const verbose = process.argv.includes('--verbose');
const failures = [];

const BOARDS = [
    { kind: 'preset', name: 'Standard' },
    { kind: 'preset', name: 'Alpha Grounds' },
    { kind: 'preset', name: 'River Fork' },
    { kind: 'preset', name: 'Volcano Island' },
    { kind: 'generated', radius: 2, seed: 1001 },
    { kind: 'generated', radius: 3, seed: 1002 },
    { kind: 'generated', radius: 4, seed: 1003 },
];

const PROBE = `
function AuditUnits(tag) {
    const problems = [];
    let checked = 0, fortifiedSeen = 0, unfortifiedSeen = 0;

    for (const unit of engine.state.units) {
        checked++;
        if (unit.isFortified) fortifiedSeen++; else unfortifiedSeen++;

        const key = unit.position;
        if (!key) { problems.push({ tag, id: unit.id, why: 'no position at all' }); continue; }

        // 1. it names a real, occupiable cell
        const cell = ResolveBoardSpaceKey(key);
        if (!cell) { problems.push({ tag, id: unit.id, why: 'position resolves to nothing', key }); continue; }
        if (cell.type === 'rim') {
            problems.push({ tag, id: unit.id, why: 'unit is standing on a rim cell', key });
            continue;
        }

        // 2 + 3. exactly one legacy key, and it converts back to where we started
        const onCenter = cell.type === 'tile';
        const legacy = onCenter ? unit.tileKey : unit.edgeKey;
        const other = onCenter ? unit.edgeKey : unit.tileKey;

        if (!legacy) {
            problems.push({ tag, id: unit.id, why: 'no legacy key for a ' + cell.type + ' cell', key });
            continue;
        }
        if (other !== null) {
            problems.push({ tag, id: unit.id, why: 'both legacy keys answered', key,
                tileKey: unit.tileKey, edgeKey: unit.edgeKey });
        }
        if (legacy !== cell.key) {
            problems.push({ tag, id: unit.id, why: 'legacy key disagrees with the cell',
                key, cellKey: cell.key, legacy });
        }
        const back = onCenter ? FineKeyOfTile(legacy) : FineKeyOfEdge(legacy);
        if (back !== key) {
            problems.push({ tag, id: unit.id, why: 'round trip lost the position',
                key, via: legacy, cameBackAs: back });
        }

        // 4. the derived flag against what the board says is there
        if (unit.isFortified !== onCenter) {
            problems.push({ tag, id: unit.id, why: 'isFortified disagrees with the cell type',
                isFortified: unit.isFortified, cellType: cell.type });
        }
        if (onCenter) {
            const tile = engine.state.tiles.get(legacy);
            if (!tile || tile.fortifiedByPlayer !== unit.player) {
                problems.push({ tag, id: unit.id, why: 'on a tile centre the board does not call fortified',
                    tileKey: legacy, fortifiedByPlayer: tile ? tile.fortifiedByPlayer : 'no tile' });
            }
        }
    }
    return { problems, checked, fortifiedSeen, unfortifiedSeen };
}

// Vision must only ever name things that are on the board.
//
// computePlayerVision used to force all six geometric edges around every base
// tile and every fortified unit visible, to paper over boundary fog from before
// the fine grid had cells for borders. It SPELLED those edge keys rather than
// looking them up, so at the rim it named edges that do not exist. Harmless in
// practice - nothing matches a key for a thing that is not there - but it meant
// the vision set was not a set of board entities, and anything downstream that
// iterated it rather than testing membership would have been reading fiction.
function AuditVisionKeys() {
    const problems = [];
    for (const player of [1, 2]) {
        const vis = computePlayerVision(player);
        vis.edges.forEach(edgeKey => {
            if (!engine.state.edges.has(edgeKey)) {
                problems.push({ player, why: 'vision names an edge that does not exist', key: edgeKey });
            }
        });
        vis.tiles.forEach(tileKey => {
            if (!engine.state.tiles.has(tileKey)) {
                problems.push({ player, why: 'vision names a tile that does not exist', key: tileKey });
            }
        });
        // Rim cells are named by fine coordinate and must resolve to an actual
        // rim cell. A real edge or a tile centre turning up in this set would
        // mean the boundary ring had leaked into ordinary vision.
        (vis.rim || new Set()).forEach(fineKey => {
            const cell = engine.state.fineGrid.get(fineKey);
            if (!cell || cell.type !== 'rim') {
                problems.push({ player, why: 'vision names a rim cell that is not one',
                    key: fineKey, actualType: cell ? cell.type : 'absent' });
            }
        });
    }
    return problems;
}

async function FortifySome() {
    const fortified = [];
    for (const player of [1, 2]) {
        for (const unit of engine.state.units.filter(u => u.player === player)) {
            const targets = [].concat(GetValidFortifyTargets(unit) || []);
            if (!targets.length) continue;
            await engine.actionManager.SubmitAction({
                type: 'action', action: 'fortify',
                payload: { unitId: unit.id, targetTileKey: targets[0] },
            });
            if (unit.isFortified) fortified.push(unit.id);
            if (fortified.length >= 2) break;
        }
    }
    return fortified;
}
`;

function Boot(board) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise,
    };
    vm.createContext(ctx);
    vm.runInContext(ReadBundle(), ctx);
    vm.runInContext(PROBE, ctx);
    const setup = board.kind === 'preset'
        ? 'const m = FindSelectableMap(' + JSON.stringify(board.name) + ');'
          + ' SetGridMode(m.radius); InitializeGridDimensions(m.radius);'
          + ' const bc = m.baseCampPositions;'
          + ' InitializeGrid(m.tiles, m.units, (bc && (bc.player1 || bc.player2)) ? bc : null);'
        : 'SetGridMode(' + board.radius + '); InitializeGridDimensions(' + board.radius + ');'
          + ' InitializeGrid(GenerateImprovedMap(' + board.radius + ', ' + board.seed + '));';
    vm.runInContext('globalThis.engine = CreateEngineInstance();'
        + ' engine.settings.fogOfWarEnabled = false;'
        + ' engine.settings.animationsEnabled = false;' + setup, ctx);
    return ctx;
}

function Check(label, condition, detail) {
    if (condition) {
        if (verbose) console.log('  ok   ' + label);
    } else {
        failures.push(label);
        console.error('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
    }
}

(async () => {
    let totalUnits = 0, totalFortified = 0;

    for (const board of BOARDS) {
        const label = board.kind === 'preset' ? board.name : ('generated r' + board.radius + ' s' + board.seed);
        const ctx = Boot(board);

        const opening = vm.runInContext('JSON.stringify(AuditUnits("opening"))', ctx);
        const openingResult = JSON.parse(opening);
        Check(label + ' (opening): every unit sits on a real cell and round-trips',
            openingResult.problems.length === 0,
            openingResult.problems.length ? JSON.stringify(openingResult.problems[0]) : null);
        Check(label + ' (opening): the board actually has units', openingResult.checked > 0);

        // Now fortify for real, so hexCenter occupancy is exercised at all.
        vm.runInContext('globalThis.__fortified = FortifySome();', ctx);
        const fortifiedIds = await ctx.__fortified;

        const after = JSON.parse(vm.runInContext('JSON.stringify(AuditUnits("fortified"))', ctx));
        Check(label + ' (fortified): every unit still sits on a real cell and round-trips',
            after.problems.length === 0,
            after.problems.length ? JSON.stringify(after.problems[0]) : null);

        // Fog on, so the vision path actually runs, and with units fortified so
        // the branch that used to force-add edges is exercised.
        vm.runInContext('engine.settings.fogOfWarEnabled = true;', ctx);
        const visionProblems = JSON.parse(vm.runInContext('JSON.stringify(AuditVisionKeys())', ctx));
        vm.runInContext('engine.settings.fogOfWarEnabled = false;', ctx);
        Check(label + ': vision names only edges and tiles that exist on the board',
            visionProblems.length === 0,
            visionProblems.length ? JSON.stringify(visionProblems[0]) + ' (' + visionProblems.length + ' total)' : null);

        totalUnits += after.checked;
        totalFortified += after.fortifiedSeen;

        if (verbose) {
            console.log('       ' + label + ': ' + after.checked + ' units, '
                + after.fortifiedSeen + ' fortified, ' + after.unfortifiedSeen + ' not');
        }
    }

    // The point of fortifying was to put units on hexCenters. If none ever got
    // there, checks 2 and 3 only ever saw hexPaths and prove nothing about the
    // half of the model that matters.
    Check('units were actually placed on hexCenters, so the fortified half was tested',
        totalFortified > 0, 'no unit anywhere ended up fortified');

    if (failures.length) {
        console.error('\nboard-space-smoke: ' + failures.length + ' failure(s)');
        process.exit(1);
    }
    console.log('board-space-smoke: ok - ' + totalUnits + ' unit positions across '
        + BOARDS.length + ' boards, ' + totalFortified
        + ' on hexCenters, every one on a real cell with exactly one legacy key that round-trips');
})();
