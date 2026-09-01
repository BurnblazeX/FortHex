// === Grid Math (coordinate/topology, shared) ===
// Both client and server need these verbatim: the client resolves clicks to
// axial coordinates and needs getTileKey/getEdgeKey on the result; rendering
// needs getNeighbors for boundary-edge detection. The server needs all of it
// for rules. See FortHex_A1_Server_Core_Guide.md §4.0.
//
// getEdgesOfTile is the one function here that isn't actually zero-dependency
// (it reads engine.state.tiles) despite the guide listing it alongside the pure
// ones — flagging rather than silently "fixing" it, see chat.

function roundAxial({ q, r }) {
    const s = -q - r;
    let rq = Math.round(q); let rr = Math.round(r); let rs = Math.round(s);
    const q_diff = Math.abs(rq - q); const r_diff = Math.abs(rr - r); const s_diff = Math.abs(rs - s);
    if (q_diff > r_diff && q_diff > s_diff) rq = -rr - rs;
    else if (r_diff > s_diff) rr = -rq - rs;
    return { q: rq, r: rr };
}

function getTileKey(q, r) { return `${q},${r}`; }

function getEdgeKey(q1, r1, q2, r2) {
    if (q1 > q2 || (q1 === q2 && r1 > r2)) {
        [q1, q2] = [q2, q1]; [r1, r2] = [r2, r1];
    }
    return `${q1},${r1}_${q2},${r2}`;
}

function getNeighbors(q, r) { return AXIAL_DIRECTIONS.map(dir => ({ q: q + dir.q, r: r + dir.r })); }

function axialDistance(q1, r1, q2, r2) {
    const dq = q1 - q2; const dr = r1 - r2; const ds = (-q1 - r1) - (-q2 - r2);
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function rotateAxial(q, r, rotations) {
    let currentQ = q;
    let currentR = r;
    const count = Math.abs(rotations);

    for (let i = 0; i < count; i++) {
        if (rotations > 0) { // Clockwise
            const nextQ = -currentR;
            const nextR = currentQ + currentR;
            currentQ = nextQ;
            currentR = nextR;
        } else { // Counter-clockwise
            const nextQ = currentQ + currentR;
            const nextR = -currentQ;
            currentQ = nextQ;
            currentR = nextR;
        }
    }
    return { q: currentQ, r: currentR };
}

function getEdgesOfTile(q, r) {
    const edges = new Set();
    getNeighbors(q, r).forEach(neighborCoords => {
        if (engine.state.tiles.has(getTileKey(neighborCoords.q, neighborCoords.r))) {
            edges.add(getEdgeKey(q, r, neighborCoords.q, neighborCoords.r));
        }
    });
    return Array.from(edges);
}

function isSetContiguous(tileKeyArray) {
    if (tileKeyArray.length <= 1) return true;

    // Convert strings "q,r" to objects {q, r, key}
    const tiles = tileKeyArray.map(k => {
        const [q, r] = k.split(',').map(Number);
        return { q, r, key: k };
    });

    // Perform a simple BFS/flood fill to count connected tiles
    const visited = new Set();
    const queue = [tiles[0]]; // Start from the first tile
    visited.add(tiles[0].key);
    let count = 0;

    while (queue.length > 0) {
        const current = queue.shift();
        count++;

        // Check against all other tiles in the set
        for (const other of tiles) {
            if (!visited.has(other.key)) {
                if (axialDistance(current.q, current.r, other.q, other.r) === 1) {
                    visited.add(other.key);
                    queue.push(other);
                }
            }
        }
    }

    // If the number of visited tiles equals the total set size, it's contiguous
    return count === tileKeyArray.length;
}

function findDirectionIndex(dir) {
    for (let i = 0; i < AXIAL_DIRECTIONS.length; i++) {
        if (AXIAL_DIRECTIONS[i].q === dir.q && AXIAL_DIRECTIONS[i].r === dir.r) return i;
    }
    return -1;
}

function parseEdgeKey(edgeKey) {
    if (!edgeKey || typeof edgeKey !== 'string' || !edgeKey.includes('_')) {
        return [{q:NaN, r:NaN}, {q:NaN, r:NaN}];
    }
    const parts = edgeKey.split('_');
    const [q1, r1] = parts[0].split(',').map(Number);
    const [q2, r2] = parts[1].split(',').map(Number);
    return [{q: q1, r: r1}, {q: q2, r: r2}];
}
