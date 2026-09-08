// FortHex - vertex adjacency IS rotational adjacency  (Track C, step 2)
//
//   node tools/vertex-parity.js
//   node tools/vertex-parity.js --verbose
//
// Track C re-expresses movement as edge -> vertex -> edge instead of the
// edge-rotation walk in getRotationallyAdjacentEdges. That rewrite is only safe
// if the two produce the same neighbours, and "they should, geometrically" is
// exactly the kind of assumption this project has been bitten by before.
//
// The claim under test: two edges are rotationally adjacent if and only if they
// meet at a vertex. getRotationallyAdjacentEdges pivots around each of an edge's
// two tiles and takes the clockwise and counter-clockwise neighbour of each, so
// it returns up to four edges. An edge has two vertices and each vertex joins
// three edges, so vertex adjacency also returns up to four. Same count is
// suggestive, not proof - this checks the actual sets, edge by edge, on every
// board the game can produce.
//
// It also checks the BOUNDARY, which is where the two models could most easily
// disagree: a rim edge has a vertex with no third tile, so fewer edges meet
// there. If every edge in the sweep had four neighbours, this file would be
// asserting nothing about rims, so it fails when that happens.
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
    { kind: 'generated', radius: 3, seed: 2024 },
];

const PROBE = `
function ProbeBoard() {
    const mismatches = [];
    const degrees = {};
    let edgeCount = 0;

    engine.state.edges.forEach((edge, edgeKey) => {
        edgeCount++;
        const rotational = getRotationallyAdjacentEdges(edgeKey).slice().sort();
        const viaVertex = GetVertexAdjacentEdges(edgeKey).slice().sort();
        // The third model, and the one movement actually runs on now: walk the
        // fine grid's own six neighbours and drop the hexCenters. All three must
        // agree - the legacy walk is the oracle, the vertex index is what proved
        // the geometry, and the fine-grid walk is what ships.
        const viaFineGrid = GetHexPathNeighbours(edgeKey).slice().sort();
        if (JSON.stringify(rotational) !== JSON.stringify(viaVertex)) {
            mismatches.push({ edgeKey: edgeKey, model: 'vertex', rotational: rotational, got: viaVertex });
        }
        if (JSON.stringify(rotational) !== JSON.stringify(viaFineGrid)) {
            mismatches.push({ edgeKey: edgeKey, model: 'fineGrid', rotational: rotational, got: viaFineGrid });
        }
        degrees[rotational.length] = (degrees[rotational.length] || 0) + 1;
    });

    // Every vertex must hold between one and three edges. Three is an interior
    // vertex; one or two means a rim vertex whose third tile is off the board.
    const vertexSizes = {};
    let malformed = 0;
    engine.state.vertices.forEach(entry => {
        const n = entry.edges.length;
        vertexSizes[n] = (vertexSizes[n] || 0) + 1;
        if (n < 1 || n > 3) malformed++;
        if (new Set(entry.edges).size !== entry.edges.length) malformed++;
    });

    // An edge's two vertices must be distinct, and each must list that edge back.
    let backrefBroken = 0, degenerateEnds = 0;
    engine.state.edges.forEach((edge, edgeKey) => {
        const vs = GetEdgeVertices(edgeKey);
        if (vs.length !== 2 || vs[0] === vs[1]) { degenerateEnds++; return; }
        for (const v of vs) {
            const entry = engine.state.vertices.get(v);
            if (!entry || entry.edges.indexOf(edgeKey) === -1) backrefBroken++;
        }
    });

    // Every fine cell must be a hexCenter or a hexPath, with no third category
    // and no misclassification. This is the parity claim Burn'"'"'s model rests on:
    // both coordinates even means it sits on a tile centre.
    let centres = 0, paths = 0, rimCells = 0, misclassified = 0, rimBroken = 0;
    engine.state.fineGrid.forEach((cell, key) => {
        const parts = key.split(',');
        const fq = Number(parts[0]), fr = Number(parts[1]);
        const isCentreCoord = IsHexCenterCoord(fq, fr);
        if (cell.type === 'tile') { centres++; if (!isCentreCoord) misclassified++; }
        else if (cell.type === 'edge') { paths++; if (isCentreCoord) misclassified++; }
        else if (cell.type === 'rim') {
            rimCells++;
            // A rim cell is a hexPath position, so it must NOT be at centre
            // parity, must have exactly one hexCenter on the board (two would
            // make it a real path, zero would mean it should have been culled),
            // and must answer null when asked its cost.
            if (isCentreCoord) misclassified++;
            if (cell.centers.filter(c => c !== null).length !== 1) rimBroken++;
            if (getEdgeCost({ player: 1 }, key) !== null) rimBroken++;
            // It must also stay invisible to resolveFineCoord, which is what
            // attack range and vision walk.
            if (resolveFineCoord(fq, fr) !== null) rimBroken++;
        }
        else misclassified++;
    });

    // A vertex key is the SUM of its three tile coordinates. Where all three are
    // on the board, that has to hold exactly - it is the whole basis for
    // GetVertexAxial deriving a position from the key alone. Rim vertices are
    // skipped: their third tile is off the board, so the stored tiles sum to
    // less than the key by exactly that missing tile.
    let keySumBroken = 0, fullVertices = 0;
    engine.state.vertices.forEach((entry, key) => {
        if (entry.tiles.length !== 3) return;
        fullVertices++;
        let sq = 0, sr = 0;
        for (const tileKey of entry.tiles) {
            const parts = tileKey.split(',');
            sq += Number(parts[0]); sr += Number(parts[1]);
        }
        if (key !== 'v:' + sq + ',' + sr) keySumBroken++;
        const axial = GetVertexAxial(key);
        if (!axial || Math.abs(axial.q - sq / 3) > 1e-9 || Math.abs(axial.r - sr / 3) > 1e-9) keySumBroken++;
    });

    return JSON.stringify({
        centres: centres, paths: paths, rimCells: rimCells, rimBroken: rimBroken, misclassified: misclassified,
        keySumBroken: keySumBroken,
        fullVertices: fullVertices,
        edgeCount: edgeCount,
        mismatches: mismatches,
        degrees: degrees,
        vertexCount: engine.state.vertices.size,
        vertexSizes: vertexSizes,
        malformed: malformed,
        backrefBroken: backrefBroken,
        degenerateEnds: degenerateEnds,
    });
}
`;

function Boot(board) {
    const ctx = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(ctx);
    vm.runInContext(ReadBundle(), ctx);
    vm.runInContext(PROBE, ctx);
    if (board.kind === 'preset') {
        vm.runInContext('globalThis.engine = CreateEngineInstance();'
            + ' const m = FindSelectableMap(' + JSON.stringify(board.name) + ');'
            + ' SetGridMode(m.radius); InitializeGridDimensions(m.radius);'
            + ' const bc = m.baseCampPositions;'
            + ' InitializeGrid(m.tiles, m.units, (bc && (bc.player1 || bc.player2)) ? bc : null);', ctx);
    } else {
        vm.runInContext('globalThis.engine = CreateEngineInstance();'
            + ' SetGridMode(' + board.radius + '); InitializeGridDimensions(' + board.radius + ');'
            + ' InitializeGrid(GenerateImprovedMap(' + board.radius + ', ' + board.seed + '));', ctx);
    }
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

let totalEdges = 0;
const degreesSeen = new Set();

for (const board of BOARDS) {
    const label = board.kind === 'preset' ? board.name : ('generated r' + board.radius + ' s' + board.seed);
    const r = JSON.parse(vm.runInContext('ProbeBoard()', Boot(board)));
    totalEdges += r.edgeCount;
    Object.keys(r.degrees).forEach(d => degreesSeen.add(Number(d)));

    Check(label + ': vertex AND fine-grid adjacency both match rotational adjacency on all ' + r.edgeCount + ' hexPaths',
        r.mismatches.length === 0,
        r.mismatches.length ? JSON.stringify(r.mismatches[0]) : null);
    Check(label + ': every vertex holds 1-3 distinct edges', r.malformed === 0);
    Check(label + ': every edge is listed back by both its vertices', r.backrefBroken === 0);
    Check(label + ': no edge has two identical or missing vertices', r.degenerateEnds === 0);
    Check(label + ': board has edges at all', r.edgeCount > 0);
    Check(label + ': every full vertex key is the sum of its three tiles, and GetVertexAxial agrees',
        r.keySumBroken === 0, r.keySumBroken + ' of ' + r.fullVertices + ' broken');
    Check(label + ': the board has interior (three-tile) vertices', r.fullVertices > 0);
    Check(label + ': every fine cell is a hexCenter or a hexPath, and the even/even parity rule classifies it correctly',
        r.misclassified === 0, r.misclassified + ' misclassified of ' + (r.centres + r.paths));
    Check(label + ': the fine grid holds both centres and paths', r.centres > 0 && r.paths > 0);
    Check(label + ': every rim cell has exactly one hexCenter, costs null, and is invisible to resolveFineCoord',
        r.rimBroken === 0, r.rimBroken + ' broken of ' + r.rimCells);
    Check(label + ': the lattice generated a rim at all', r.rimCells > 0);

    if (verbose) {
        console.log('       ' + label + ': ' + r.edgeCount + ' edges, ' + r.vertexCount
            + ' vertices, neighbour counts ' + JSON.stringify(r.degrees)
            + ', vertex sizes ' + JSON.stringify(r.vertexSizes) + ', rim ' + r.rimCells);
    }
}

// If every edge had four neighbours, nothing above would have tested the board
// boundary - where a vertex has no third tile and the two models are most
// likely to disagree. The sweep has to contain rim edges to be worth running.
Check('the sweep contains boundary edges, not only interior ones',
    degreesSeen.size > 1,
    'every edge had the same neighbour count: ' + [...degreesSeen]);
Check('interior edges are present too', degreesSeen.has(4));

if (failures.length) {
    console.error('\nvertex-parity: ' + failures.length + ' failure(s)');
    process.exit(1);
}
console.log('vertex-parity: ok - ' + totalEdges + ' edges across ' + BOARDS.length
    + ' boards, vertex adjacency is identical to rotational adjacency');
