// === Rules (PURE, moved from core.js - A1 step 5) ===
//
// Every function here reads and writes the live engine instance
// (engine.state / engine.settings). Nothing in this file touches the DOM, the
// client's gameState, or any client function - that was true only after the
// js/server/ purge; before it, spawnUnit called logAction() and
// recalculatePlayerSupplyNetwork called updateSupplyPointsDisplay() directly.
// Both now emit events instead (LOG, VISION_INVALIDATED, SUPPLY_CHANGED),
// drained by HandleActionEvents in js/client/actions.js.
//
// spawnUnit was renamed SpawnUnit in that same pass and gained a thin
// same-named client wrapper, so its three call sites (ai.js, main.js, ui.js)
// are unchanged and now get their log lines through the event drain.
//
// A few functions here (getTileKeysOfEdge, getSideTileKeys,
// hasCombinedArmsSupport, collectTargetsFromAttackRange, GetBaseCamp,
// isInternalBaseEdge, isEdgeAdjacentToSpearWall) aren't in the guide's explicit
// §4 list, but are pure rules-helpers depended on by functions that are, so
// they moved alongside them rather than being left behind.
//
// GetBaseCamp was originally two near-duplicate functions (getBaseTileKeys +
// getBaseCampTiles) doing the same array-or-edge-string normalization under
// different names/signatures - merged into one per user request.
//
// Naming note: this file is the last js/server/ module still on camelCase.
// The newer server files use PascalCase; renaming these is a separate pass.

 // === Fine Grid System ===

// The two hexCenters a hexPath sits between, as tile keys, with null where the
// tile is not on the board. Derived from the coordinate alone: of a fine cell's
// six neighbours, exactly two have both coordinates even, and those two are its
// centres. Nothing is stored for this.
function GetHexPathCenters(fq, fr) {
    const centers = [];
    for (const dir of AXIAL_DIRECTIONS) {
        const nq = fq + dir.q, nr = fr + dir.r;
        if (!IsHexCenterCoord(nq, nr)) continue;
        const tileKey = getTileKey(nq / 2, nr / 2);
        centers.push(engine.state.tiles.has(tileKey) ? tileKey : null);
    }
    return centers;
}

function buildFineGridIndex() {
    engine.state.fineGrid = new Map();

    // --- hexCenters: one per tile, at (2q, 2r) ------------------------------
    engine.state.tiles.forEach(tile => {
        const fq = 2 * tile.q;
        const fr = 2 * tile.r;
        const tileKey = getTileKey(tile.q, tile.r);
        engine.state.fineGrid.set(`${fq},${fr}`, { type: 'tile', key: tileKey });
    });

    // --- hexPaths: the real ones, at (q1+q2, r1+r2) -------------------------
    engine.state.edges.forEach((edge, edgeKey) => {
        const fq = edge.q1 + edge.q2;
        const fr = edge.r1 + edge.r2;
        engine.state.fineGrid.set(`${fq},${fr}`, { type: 'edge', key: edgeKey });
    });

    // --- the rim: generate outward, then cull -------------------------------
    //
    // The lattice is grown from the hexCenters rather than swept over a bounding
    // region, which is what makes it self-limiting: a cell is only considered if
    // it neighbours a centre that exists, so generation stops one ring out on its
    // own and there is no radius to keep in sync with anything.
    //
    // A candidate is CULLED when both of its hexCenters are off the board, and
    // kept as 'rim' when exactly one is. Rim cells are real positions on the grid
    // that no unit may occupy: GetPathCost returns null for them, which is a
    // different answer from Infinity (a real hexPath you cannot cross, water to
    // water).
    //
    // They are typed 'rim', NOT 'edge', and that matters. resolveFineCoord feeds
    // fineRangeQuery, which is what attack range and vision are built on; a rim
    // cell claiming to be an edge would put non-existent positions inside attack
    // range, on a board that would still look completely normal.
    const rim = [];
    engine.state.fineGrid.forEach((cell, key) => {
        if (cell.type !== 'tile') return;
        const parts = key.split(',');
        const cq = Number(parts[0]), cr = Number(parts[1]);
        for (const dir of AXIAL_DIRECTIONS) {
            const fq = cq + dir.q, fr = cr + dir.r;
            const candidateKey = `${fq},${fr}`;
            if (engine.state.fineGrid.has(candidateKey)) continue;
            const centers = GetHexPathCenters(fq, fr);
            const real = centers.filter(c => c !== null);
            // The cull. Note it CANNOT currently fire: candidates are only
            // generated as neighbours of a real hexCenter, so every one of them
            // already has at least one. Growth is what limits the lattice, not
            // this test. It is kept because the moment anyone generates by
            // sweeping a bounding region instead - the more literal reading of
            // drawing the grid over the board - this becomes the rule that stops
            // it, and rediscovering that is worse than carrying four dead lines.
            if (real.length === 0) continue;
            if (real.length === 2) continue;   // a real hexPath already claimed it
            rim.push([candidateKey, { type: 'rim', key: null, centers: centers }]);
        }
    });
    for (const [key, cell] of rim) engine.state.fineGrid.set(key, cell);

    // Vertices ride along with the fine grid rather than having their own six
    // call sites. buildFineGridIndex is already called from six places
    // (save.js x2, remote-state.js, match-setup.js x2, map-generation.js) and a
    // second index needing the same six would be a trap, not a design.
    BuildVertexIndex();
}

// A tile's movement weight, with a defined answer for a tile whose type predates
// the field (Testament reconstructs era-7 tiles as bare Plains). Falls back to
// Plains rather than to zero: a zero-weight tile would be free to cross.
// Whether a tile blocks movement outright. A tile with no type at all is NOT
// impassable, which matters: the map-maker and worker paths can hand getEdgeCost
// a tile whose type has not been attached yet, and the cascade this replaced
// treated such a tile as plains because every one of its === comparisons against
// a known type simply came out false. Reading .crossable off an absent type
// threw instead, which broke map-setup-smoke and victory-smoke.
function IsImpassableTile(tile) {
    return !!(tile && tile.type && tile.type.crossable === false);
}

function MoveWeightOfTile(tile) {
    const weight = tile && tile.type && tile.type.moveWeight;
    return Number.isFinite(weight) ? weight : TILE_TYPES.PLAINS.moveWeight;
}

// === The fine grid as the movement space (Track C, Burn's model) ===
//
// The fine grid is drawn OVER the board and treated as a volume. Every cell in
// it is one of exactly two things:
//
//   hexCENTER - sits precisely on top of a tile's centre. Carries that tile's
//               terrain, and is NOT pathable. A unit on one is fortified.
//   hexPATH   - everything else. Always sits between exactly two hexCenters,
//               which is what gives it a cost. This is what the code still calls
//               an "edge"; hexPath is the name from here on.
//
// "Sits on top of a tile centre" needs no geometry: tiles map to (2q, 2r) so
// both coordinates are even, while a hexPath is the sum of two tiles that differ
// by a unit direction, so at least one coordinate is odd. Measured on every
// board: no centre has an odd coordinate, no path has both even, and there is no
// third category - a radius-3 board is 127 cells, exactly 37 centres and 90
// paths.
// A cost is usable only if it is a real, finite number. Guards the two ways
// getEdgeCost declines: null (not a real hexPath) and Infinity (real but
// impassable). Written as one predicate because `cost === Infinity` alone let
// null through, and null + a number is that number - a non-existent rim path
// would have costed ZERO and been the cheapest route on the board.
function IsTraversableCost(cost) {
    return typeof cost === 'number' && Number.isFinite(cost);
}

function IsHexCenterCoord(fq, fr) {
    return (fq % 2 === 0) && (fr % 2 === 0);
}

// A hexPath's neighbours: walk the fine grid's own six directions and drop
// anything that lands on a hexCenter. Interior paths keep four, rim paths two.
//
// This replaces GetVertexAdjacentEdges in the movement path. The two agree
// exactly - a fine cell's non-centre neighbours ARE the paths meeting at its two
// vertices - and tools/vertex-parity.js checks all three models against each
// other on every run rather than taking that on faith.
function GetHexPathNeighbours(pathKey) {
    const coord = getFineCoordForEdge(pathKey);
    if (!coord || isNaN(coord.fq)) return [];
    const out = [];
    for (const dir of AXIAL_DIRECTIONS) {
        const fq = coord.fq + dir.q, fr = coord.fr + dir.r;
        if (IsHexCenterCoord(fq, fr)) continue;
        const cell = engine.state.fineGrid.get(`${fq},${fr}`);
        // Absent means the cell is not a real hexPath: one of the two
        // hexCenters it would sit between is off the board. Those are rejected
        // here rather than costed, which is what stops a unit pathing off the
        // rim onto a half-real cell.
        if (!cell || cell.type !== 'edge') continue;
        out.push(cell.key);
    }
    return out;
}

// === Vertex identity (Track C) ===
//
// A vertex is the point where three tiles meet. Until now they existed only as
// leftover geometry - drawFogOfWar computed trapezoid corners and threw them
// away - and nothing could name one. Track C needs them named for two reasons:
// movement is being re-expressed as edge -> vertex -> edge, and Candidates G2
// paints vertices as triangles and must reuse this identity rather than invent
// a second one.
//
// THE KEY IS THE SUM OF THE THREE TILE COORDINATES, and it is unique: the sum is
// three times the centroid, distinct vertices have distinct centroids, so
// distinct vertices have distinct sums.
//
// It carries a 'v:' prefix, and that prefix is load-bearing rather than
// decorative. The existing fine grid puts tiles at (2q, 2r) and edges at
// (q1+q2, r1+r2); a raw vertex sum collides with those numerically. The vertex
// of tiles (0,0), (1,0), (0,1) sums to (1,1), and the edge between (0,1) and
// (1,0) - which are adjacent - also has fine coordinate (1,1). Sharing one key
// space without a prefix would silently alias a vertex onto an edge.
//
// NOT DONE, deliberately: unifying vertices into engine.state.fineGrid itself.
// That needs a common denominator (tiles x6, edges x3, vertices x2), which
// changes every existing fine coordinate and so touches attack range, vision
// and the debug overlay - none of which have headless coverage. Left as a
// separate index; see the report.
function GetVertexKey(a, b, c) {
    return `v:${a.q + b.q + c.q},${a.r + b.r + c.r}`;
}

// The two tiles adjacent to BOTH ends of this edge. They are the edge's two
// endpoints, and they need not exist on the board: an edge on the rim still has
// two vertices, one of which simply has no third tile and fewer edges meeting
// at it.
function GetEdgeCornerTiles(h1, h2) {
    const corners = [];
    for (const dir of AXIAL_DIRECTIONS) {
        const c = { q: h1.q + dir.q, r: h1.r + dir.r };
        if (c.q === h2.q && c.r === h2.r) continue;
        const dq = c.q - h2.q, dr = c.r - h2.r;
        if (findDirectionIndex({ q: dq, r: dr }) !== -1) corners.push(c);
    }
    return corners;
}

// The two vertex keys at the ends of an edge.
function GetEdgeVertices(edgeKey) {
    const [h1, h2] = parseEdgeKey(edgeKey);
    if (isNaN(h1.q) || isNaN(h2.q)) return [];
    return GetEdgeCornerTiles(h1, h2).map(c => GetVertexKey(h1, h2, c));
}

// vertexKey -> { edges: [...], tiles: [...] }, built from the edges that actually
// exist. A rim vertex holds one or two edges rather than three, which is what
// makes this agree with getRotationallyAdjacentEdges at the board boundary.
//
// tiles is the union of the tiles of those edges, so it is the tiles that are
// really on the board rather than the conceptual three. Candidates G2 paints a
// vertex as a triangle over exactly these.
function BuildVertexIndex() {
    const index = new Map();
    engine.state.edges.forEach((edge, edgeKey) => {
        for (const vertexKey of GetEdgeVertices(edgeKey)) {
            let entry = index.get(vertexKey);
            if (!entry) { entry = { edges: [], tiles: [] }; index.set(vertexKey, entry); }
            entry.edges.push(edgeKey);
            for (const tileKey of getTileKeysOfEdge(edgeKey)) {
                if (entry.tiles.indexOf(tileKey) === -1) entry.tiles.push(tileKey);
            }
        }
    });
    engine.state.vertices = index;
    return index;
}

// The axial coordinate a vertex sits at, as a fraction. The key stores the SUM
// of its three tile coordinates, so a third of that sum is their mean - which is
// the vertex's true position on the axial plane. Nothing needs to be stored for
// this: the key already is the position, scaled by three.
//
// Returned unrounded on purpose. A vertex never lands on an integer axial
// coordinate (that is what makes it a vertex rather than a tile), and rounding
// here would collapse the six vertices around a tile onto the tile itself.
function GetVertexAxial(vertexKey) {
    const parts = String(vertexKey).replace(/^v:/, '').split(',');
    const sq = Number(parts[0]), sr = Number(parts[1]);
    if (!Number.isFinite(sq) || !Number.isFinite(sr)) return null;
    return { q: sq / 3, r: sr / 3 };
}

// The single vertex two adjacent edges meet at, or null if they do not touch.
// Two edges that are neighbours share exactly one vertex - that is what makes
// them neighbours - so a second match would mean the index is malformed rather
// than that the geometry is ambiguous.
function GetSharedVertex(edgeKeyA, edgeKeyB) {
    const a = GetEdgeVertices(edgeKeyA);
    const b = GetEdgeVertices(edgeKeyB);
    for (const vertexKey of a) {
        if (b.indexOf(vertexKey) !== -1) return vertexKey;
    }
    return null;
}

// The fine-grid replacement for getRotationallyAdjacentEdges: every edge that
// shares a vertex with this one. Two edges are rotationally adjacent exactly
// when they meet at a vertex, which is why these two functions agree - and
// tools/vertex-parity.js is what proves they do rather than assuming it.
//
// SAME SET, DIFFERENT ORDER. This groups by vertex; the rotation walk groups by
// pivot tile. Any caller that depends on WHICH equal-cost result it sees first
// is therefore not a safe swap. findSupplyPath is exactly such a caller and is
// deliberately left on the old function - see the note at its call site.
function GetVertexAdjacentEdges(currentEdgeKey) {
    if (!engine.state.vertices) BuildVertexIndex();
    const out = new Set();
    for (const vertexKey of GetEdgeVertices(currentEdgeKey)) {
        const entry = engine.state.vertices.get(vertexKey);
        if (!entry) continue;
        for (const edgeKey of entry.edges) {
            if (edgeKey !== currentEdgeKey) out.add(edgeKey);
        }
    }
    return Array.from(out);
}

function getFineCoordForTile(tileKey) {
    const [q, r] = tileKey.split(',').map(Number);
    return { fq: 2 * q, fr: 2 * r };
}

function getFineCoordForEdge(edgeKey) {
    const [h1, h2] = parseEdgeKey(edgeKey);
    return { fq: h1.q + h2.q, fr: h1.r + h2.r };
}

// The same three conversions as strings, which is what actually gets stored and
// compared. Kept as a thin layer over the coord versions rather than duplicating
// the arithmetic, so there is one place the doubling lives.
// The preset this match is actually running, resolving "auto" against the board.
//
// One function so the fallback lives in one place: a match with no explicit choice
// must answer the same thing at unit creation, at class swap and at save-load, or a
// unit built at turn one and a unit built at turn thirty get different pools.
function ActiveUnitSpeedPreset() {
    const chosen = engine && engine.settings && engine.settings.unitSpeedPreset;
    if (chosen && UNIT_SPEED_PRESETS[chosen]) return chosen;
    const radius = (engine && engine.state && engine.state.gridRadius) || 3;
    return RecommendedUnitSpeedPreset(radius);
}

function FineKeyOfTile(tileKey) {
    const c = getFineCoordForTile(tileKey);
    return c.fq + ',' + c.fr;
}

function FineKeyOfEdge(edgeKey) {
    const c = getFineCoordForEdge(edgeKey);
    return c.fq + ',' + c.fr;
}

function ParseFineKey(fineKey) {
    const parts = String(fineKey).split(',');
    return { fq: Number(parts[0]), fr: Number(parts[1]) };
}

// Both coordinates even means the cell sits exactly on a tile centre.
// A null or malformed key parses to NaN, which is neither even nor odd, so it
// falls through as "not a centre" rather than throwing - callers get a hexPath
// answer and then a null legacy key, which is the same shape as a unit that is
// simply not on the board.
function IsHexCenterKey(fineKey) {
    if (!fineKey) return false;
    const { fq, fr } = ParseFineKey(fineKey);
    return IsHexCenterCoord(fq, fr);
}

// LEGACY KEYS OUT OF BOARD SPACE. Both return null when the fine key does not
// name that kind of cell, so a call site that asks for the wrong one gets
// nothing rather than a plausible-looking wrong answer.
function TileKeyOfFine(fineKey) {
    if (!IsHexCenterKey(fineKey)) return null;
    const { fq, fr } = ParseFineKey(fineKey);
    return getTileKey(fq / 2, fr / 2);
}

function EdgeKeyOfFine(fineKey) {
    if (!fineKey || IsHexCenterKey(fineKey)) return null;
    const { fq, fr } = ParseFineKey(fineKey);
    if (isNaN(fq) || isNaN(fr)) return null;
    // A rim cell has only ONE hexCenter on the board, so it has no edge key -
    // which is correct: there is no edge there, only a lattice position.
    const centers = GetHexPathCenters(fq, fr).filter(Boolean);
    if (centers.length !== 2) return null;
    const [a, b] = centers.map(k => k.split(',').map(Number));
    return getEdgeKey(a[0], a[1], b[0], b[1]);
}

// unit.position IS the fine coordinate now, so this is a parse rather than a
// conversion. Kept as a function because a hundred call sites name it.
function getFineCoordForUnit(unit) {
    return ParseFineKey(unit.position);
}

// === Board space: one coordinate for every position a unit can occupy ===
//
// Every position a unit can be in is a fine-grid cell, so the fine grid is the
// whole address space and the two-part scheme it replaces (a tile key OR a
// two-tile edge key, disambiguated by positionType) is redundant. This is the
// layer that establishes the new addressing WITHOUT changing what is stored,
// so it can be proven against the old representation before anything switches.
//
// THE SWITCH IS DONE (2026-09-08). unit.position holds "fq,fr" and nothing else;
// positionType, isFortified and fortifiedTileKey are derived getters on the unit
// and are no longer stored, transmitted or saved. Schema v11.
//
// The helpers below are the whole translation layer. Code that needs a LEGACY key
// asks for it by name - unit.tileKey or unit.edgeKey - which forces every call
// site to say which space it is working in instead of leaving it to a positionType
// check somewhere else in the file.

// What lives at a board-space key: { type: 'tile' | 'edge', key } in the old
// spelling, or null when nothing does. The fine grid already holds this; this
// just names the lookup so call sites stop reaching into the Map directly.
function ResolveBoardSpaceKey(boardSpaceKey) {
    if (!engine.state.fineGrid) return null;
    return engine.state.fineGrid.get(boardSpaceKey) || null;
}

function fineDistance(a, b) {
    return axialDistance(a.fq, a.fr, b.fq, b.fr);
}

function getFineNeighbors(fq, fr) {
    return AXIAL_DIRECTIONS.map(dir => ({ fq: fq + dir.q, fr: fr + dir.r }));
}

function resolveFineCoord(fq, fr) {
    const cell = engine.state.fineGrid.get(`${fq},${fr}`);
    // Rim cells are deliberately invisible here. This is what fineRangeQuery
    // walks, so attack range and vision see exactly the cells they saw before
    // the lattice gained a boundary ring. ResolveBoardSpaceKey is the accessor
    // that can see the rim.
    if (!cell || cell.type === 'rim') return null;
    return cell;
}

// options.includeRim brings the boundary ring into the result. It is OFF by
// default and must stay off for attack range: a rim cell is not a position, so
// nothing can be attacked there. Vision is different - you can SEE the edge of
// the world - and that is the only caller that asks for it.
//
// Rim cells are recorded but never expanded FROM. There is nothing beyond the
// board, so sight that reaches the rim stops there rather than continuing
// around it, which would let a unit see along the outside of the map.
function fineRangeQuery(startFine, maxRange, options = {}) {
    const visited = new Map();
    const startKeyStr = `${startFine.fq},${startFine.fr}`;
    const LookUp = options.includeRim
        ? ((fq, fr) => engine.state.fineGrid.get(`${fq},${fr}`) || null)
        : ((fq, fr) => resolveFineCoord(fq, fr));
    const startEntity = LookUp(startFine.fq, startFine.fr);

    // If the starting coordinate is off-board, return empty immediately
    if (!startEntity) return visited;

    // Record the starting cell
    visited.set(startKeyStr, {
        distance: 0,
        type: startEntity.type,
        key: startEntity.key
    });

    const queue = [{ coord: startFine, distance: 0, entity: startEntity }];

    while (queue.length > 0) {
        const { coord, distance, entity } = queue.shift();

        // If this entity blocks vision/range beyond it, stop expanding from it.
        // (It is still included in `visited`, but its neighbors won't be queued).
        if (options.blocksBeyond && options.blocksBeyond(entity, distance)) {
            continue;
        }

        // The rim is the end of the world: visible, but nothing lies past it.
        if (entity.type === 'rim') {
            continue;
        }       

        // Stop expanding if we've reached max range
        if (distance >= maxRange) {
            continue;
        }

        const nextDistance = distance + 1;
        const neighbors = getFineNeighbors(coord.fq, coord.fr);

        for (const neighbor of neighbors) {
            const neighborKeyStr = `${neighbor.fq},${neighbor.fr}`;

            if (!visited.has(neighborKeyStr)) {
                const neighborEntity = LookUp(neighbor.fq, neighbor.fr);
                
                // Only add if it's on the board
                if (neighborEntity) {
                    visited.set(neighborKeyStr, {
                        distance: nextDistance,
                        type: neighborEntity.type,
                        key: neighborEntity.key
                    });
                    
                    queue.push({ coord: neighbor, distance: nextDistance, entity: neighborEntity });
                }
            }
        }
    }

    return visited;
}

// Returns an object containing Sets of visible EdgeKeys and TileKeys, computed on the
// fine grid (every tile centre and every edge is its own subHex).
function getVisibleKeysFromUnit(unit) {
    if (!unit) return { edges: new Set(), tiles: new Set(), rim: new Set() };

    // An archer fortified on a mountain peak sees 3 instead of 2, and is high enough
    // that forests no longer block it. Other mountains still do.
    const onMountainPeak = isUnitOnMountainPeak(unit);
    const VISIBILITY_RANGE = onMountainPeak ? 3 : 2;
    const startCoord = getFineCoordForUnit(unit);

    // A fortified unit occupies its tile, so that tile's own terrain never blocks it -
    // it still gets the full flower and can see out of the forest/mountain it sits in.
    // Any OTHER forest or mountain tile still blocks normally.
    const occupiedTileKey = unit.tileKey;

    const isForestTile = (tileKey) => {
        if (onMountainPeak) return false; // too high up for forests to matter
        if (tileKey === occupiedTileKey) return false;
        const tile = engine.state.tiles.get(tileKey);
        return !!(tile && tile.type.name === 'Forest');
    };

    const isMountainTile = (tileKey) => {
        if (tileKey === occupiedTileKey) return false;
        const tile = engine.state.tiles.get(tileKey);
        return !!(tile && tile.type.name === 'Mountain');
    };

    // BLOCKING RULE: a subHex "contains" a forest/mountain if it is that tile's own
    // subHex, OR it is an edge subHex with such a tile on either side. Such a subHex
    // is itself visible, but nothing beyond it is - sight stops there. The unit's own
    // subHex never blocks.
    const blocksSight = (entity) => {
        if (entity.type === 'tile') {
            return isForestTile(entity.key) || isMountainTile(entity.key);
        }
        // A rim cell has no edge behind it and so no key to resolve tiles from.
        // It never blocks, which costs nothing: sight already stops at the rim.
        if (entity.type === 'rim') return false;
        return getTileKeysOfEdge(entity.key).some(k => isForestTile(k) || isMountainTile(k));
    };

    const blocksBeyond = (entity, distance) => distance > 0 && blocksSight(entity);

    const rangeResult = fineRangeQuery(startCoord, VISIBILITY_RANGE, { blocksBeyond, includeRim: true });

    const visibleEdges = new Set();
    const visibleTiles = new Set();
    // Rim cells are keyed by their fine coordinate, not by an edge key, because
    // they have no edge behind them to name.
    const visibleRim = new Set();

    rangeResult.forEach((data, fineKey) => {
        if (data.type === 'edge') {
            visibleEdges.add(data.key);
        } else if (data.type === 'tile') {
            visibleTiles.add(data.key);
        } else if (data.type === 'rim') {
            visibleRim.add(fineKey);
        }
    });

    // MOUNTAIN RULE 1: a mountain's peak (its centre subHex) is always visible so long
    // as it is within visibility range - it stands above whatever else is in the way,
    // so blockers along the path don't hide it.
    engine.state.tiles.forEach((tile, tileKey) => {
        if (tile.type.name !== 'Mountain') return;
        if (fineDistance(startCoord, getFineCoordForTile(tileKey)) <= VISIBILITY_RANGE) {
            visibleTiles.add(tileKey);
        }
    });

    // MOUNTAIN RULE 2: standing on a mountain tile's edge, that same mountain's other
    // edges rotationally adjacent to the unit (fine-distance 1) cannot be seen -
    // the peak between them is in the way.
    if (unit.positionType === 'edge') {
        const ownMountainKeys = getTileKeysOfEdge(unit.edgeKey).filter(isMountainTile);

        if (ownMountainKeys.length > 0) {
            [...visibleEdges].forEach(edgeKey => {
                if (edgeKey === unit.edgeKey) return;
                if (fineDistance(startCoord, getFineCoordForEdge(edgeKey)) !== 1) return;
                if (getTileKeysOfEdge(edgeKey).some(k => ownMountainKeys.includes(k))) {
                    visibleEdges.delete(edgeKey);
                }
            });
        }
    }

    return { edges: visibleEdges, tiles: visibleTiles, rim: visibleRim };
}

// The tile keys an edge subHex sits between.
function getTileKeysOfEdge(edgeKey) {
    const [h1, h2] = parseEdgeKey(edgeKey);
    const keys = [];
    if (!isNaN(h1.q)) keys.push(getTileKey(h1.q, h1.r));
    if (!isNaN(h2.q)) keys.push(getTileKey(h2.q, h2.r));
    return keys;
}

// The two tile keys an edge-positioned unit sits between (its "side tiles").
function getSideTileKeys(unit) {
    if (!unit || unit.positionType !== 'edge') return [];
    return getTileKeysOfEdge(unit.edgeKey);
}

// Does this unit share its edge with a friendly melee unit? (combined arms spotter)
function hasCombinedArmsSupport(unit) {
    if (!unit || unit.positionType !== 'edge') return false;
    const myEdge = engine.state.edges.get(unit.edgeKey);
    if (!myEdge) return false;
    return myEdge.units.some(u => u.id !== unit.id && u.player === unit.player && u.type.attackType === 'melee');
}

// Which subHexes a unit can attack INTO, purely positional. Deliberately ignores the
// action-economy guards (currentMove / hasPerformedMajorAction) so the range geometry
// stays visible while testing. Returns a Map of "fq,fr" -> { distance, type, key }.
// Attack range is ALWAYS a subset of visibility.
//
// Both the targeting functions and the debug overlay read from this, so what's drawn
// can never drift from what's actually attackable.
function getAttackRangeCells(unit) {
    const cells = new Map();
    if (!unit) return cells;

    const isArcher = unit.type.name === 'Archer';
    if (!isArcher && unit.type.attackType !== 'melee') return cells;

    const vis = getVisibleKeysFromUnit(unit);
    const sideTileKeys = getSideTileKeys(unit);
    const startCoord = getFineCoordForUnit(unit);

    // MODIFIER 2 - low-visibility fortified restriction: an archer fortified somewhere
    // with visibility <= 1 (e.g. a Forest) drops to range 1 instead of 2.
    //
    // A mountain peak is checked FIRST and overrides it: mountains are visibility 0, so
    // they'd otherwise trip the low-visibility rule, when in fact they extend range to 3.
    const onMountainPeak = isArcher && isUnitOnMountainPeak(unit);
    let maxRange = isArcher ? 2 : 1;
    let isLowVisFortifiedArcher = false;

    if (onMountainPeak) {
        maxRange = 3;
    } else if (isArcher && unit.positionType === 'center' && unit.isFortified) {
        const sourceTile = engine.state.tiles.get(unit.tileKey);
        if (sourceTile && getTileVisibility(sourceTile) <= 1) {
            maxRange = 1;
            isLowVisFortifiedArcher = true;
        }
    }

    // MODIFIER 1 - mountains stop arrows the same way they stop sight. Swordsman has no
    // LOS blocking at range 1, so it runs unblocked. An archer's own peak never blocks
    // its own shots.
    const blocksBeyond = !isArcher ? null : (entity, distance) => {
        if (distance === 0 || entity.type !== 'tile') return false;
        // tileKey is null for a unit on a hexPath, so this never matches one -
        // exactly as the old comparison of a tile key against an edge key never did.
        if (entity.key === unit.tileKey) return false;
        const tile = engine.state.tiles.get(entity.key);
        return !!(tile && getTileVisibility(tile) === 0);
    };

    // MODIFIER 3 - combined arms: a friendly melee unit sharing the edge spots for the
    // archer, relaxing the fortified-tile visibility threshold from 2 to 1 on the
    // archer's own side tiles.
    const hasCombinedArms = isArcher && hasCombinedArmsSupport(unit);

    const rangeResult = fineRangeQuery(startCoord, maxRange, blocksBeyond ? { blocksBeyond } : {});

    rangeResult.forEach((data, fineKey) => {
        if (data.distance === 0) return;

        if (data.type === 'edge') {
            if (!vis.edges.has(data.key)) return;

            // MODIFIER 4 - edge-position range restriction: an archer standing on an
            // edge can only hit edges touching one of its own two side tiles.
            if (isArcher && unit.positionType === 'edge') {
                const edgeTileKeys = getTileKeysOfEdge(data.key);
                if (!edgeTileKeys.some(k => sideTileKeys.includes(k))) return;
            }
        } else {
            if (!vis.tiles.has(data.key)) return;

            const tile = engine.state.tiles.get(data.key);
            if (!tile) return;

            const isMountainPeak = tile.type.name === 'Mountain';

            if (isArcher) {
                // Two cases skip the visibility threshold entirely:
                //   - A fortified enemy on a mountain peak is ALWAYS targetable by
                //     archers, despite the peak's raw visibility of 0.
                //   - An archer shooting FROM a peak has the elevation to hit anything
                //     in range, including enemies fortified inside a forest.
                if (!isMountainPeak && !onMountainPeak) {
                    // Fortified centres can normally only be targeted when the tile's own
                    // visibility is > 1; combined arms relaxes that to > 0 on side tiles.
                    let visibilityThreshold = 2;
                    if (hasCombinedArms && sideTileKeys.includes(data.key)) visibilityThreshold = 1;
                    if (getTileVisibility(tile) < visibilityThreshold) return;
                }
            } else {
                // Swordsman: fortified enemies can only be hit from an edge, not from
                // another fortified position - and a mountain peak can never be melee'd
                // at all, no matter where the attacker stands.
                if (unit.positionType !== 'edge') return;
                if (isMountainPeak) return;
            }
        }

        cells.set(fineKey, data);
    });

    // BALANCE RULE - an archer fortified in low visibility (a Forest) has its range cut
    // to 1 by MODIFIER 2, but can still target the centre of every adjacent PLAINS tile,
    // even though those sit at fine-distance 2.
    if (isLowVisFortifiedArcher) {
        const [q, r] = unit.tileKey.split(',').map(Number);

        getNeighbors(q, r).forEach(n => {
            const tileKey = getTileKey(n.q, n.r);
            const tile = engine.state.tiles.get(tileKey);
            if (!tile || tile.type.name !== 'Plains') return;
            if (!vis.tiles.has(tileKey)) return;

            const f = getFineCoordForTile(tileKey);
            const fineKey = `${f.fq},${f.fr}`;
            if (cells.has(fineKey)) return;

            cells.set(fineKey, {
                distance: fineDistance(startCoord, f),
                type: 'tile',
                key: tileKey
            });
        });
    }

    return cells;
}

// Set of "fq,fr" keys for the debug overlay.
function getAttackRangeFineCells(unit) {
    return new Set(getAttackRangeCells(unit).keys());
}

        function getFlagTileKey(playerNum) {
            const baseData = engine.state.baseCampPositions[`player${playerNum}`];
            if (!Array.isArray(baseData) || baseData.length !== 3) return null; // Only applies to 3-tile bases

            const tiles = baseData.map(k => {
                const [q, r] = k.split(',').map(Number);
                return { q, r, key: k };
            });

            const [t1, t2, t3] = tiles;
            const d12 = axialDistance(t1.q, t1.r, t2.q, t2.r);
            const d23 = axialDistance(t2.q, t2.r, t3.q, t3.r);
            const d31 = axialDistance(t3.q, t3.r, t1.q, t1.r);

            if (d12 === 1 && d23 === 1 && d31 === 1) {
                // Triangle Cluster: Flag is at the vertex intersection, not on a single tile center.
                return null; 
            } else {
                // Line or 'L' Shape: Find the center tile
                let centerTileIndex = 0;
                if (d12 === 1 && d31 === 1) centerTileIndex = 0;      
                else if (d12 === 1 && d23 === 1) centerTileIndex = 1; 
                else centerTileIndex = 2;                             

                return tiles[centerTileIndex].key;
            }
        }

        function isLand(tileType) {
            return tileType === TILE_TYPES.PLAINS || tileType === TILE_TYPES.FOREST || tileType === TILE_TYPES.MOUNTAIN;
        }

        function isEdgeAdjacentToSpearWall(unit, edgeKey) {
            if (!unit || !edgeKey) return false;

            const enemyPlayer = unit.player === 1 ? 2 : 1;
            const [h1, h2] = parseEdgeKey(edgeKey);
            if (isNaN(h1.q) || isNaN(h2.q)) return false;

            // This set now ONLY contains the two tiles that form the edge.
            const tilesThatFormTheEdge = new Set();
            tilesThatFormTheEdge.add(getTileKey(h1.q, h1.r));
            tilesThatFormTheEdge.add(getTileKey(h2.q, h2.r));

            for (const tileKey of tilesThatFormTheEdge) {
                const tile = engine.state.tiles.get(tileKey);
                if (tile && tile.fortifiedByPlayer === enemyPlayer) {
                    const fortifiedUnit = engine.state.units.find(u => u.tileKey === tileKey);
                if (fortifiedUnit && fortifiedUnit.type.name === 'Pikeman') {
                        return true; 
                    }
                }
            }
            return false;
        }

        function isRoad(edgeKey) {
            const edge = engine.state.edges.get(edgeKey);
            if (!edge) return false;

            if (edge.bridge) {
                return true;
            }

            const tile1 = engine.state.tiles.get(getTileKey(edge.q1, edge.r1));
            const tile2 = engine.state.tiles.get(getTileKey(edge.q2, edge.r2));

            if (!tile1 || !tile2) return false;

            // Asked as "impassable", not as "water", so a future impassable terrain
            // inherits the rule. Third of the three places this same question was
            // spelled out separately; getEdgeCost was the first.
            return !(IsImpassableTile(tile1) && IsImpassableTile(tile2));
        }

        function isEdgePlaceable(edgeKey) {
            const edge = engine.state.edges.get(edgeKey);
            if (!edge) return false;

            // Cannot place on a player's home base/flag edge
            if (edgeKey === engine.state.baseCampPositions.player1 || edgeKey === engine.state.baseCampPositions.player2) {
                return false;
            }

            // cannot place on a water-water edge 
            const tile1 = engine.state.tiles.get(getTileKey(edge.q1, edge.r1));
            const tile2 = engine.state.tiles.get(getTileKey(edge.q2, edge.r2));
            if (!tile1 || !tile2) return false; // Should not happen on a valid map

            if (IsImpassableTile(tile1) && IsImpassableTile(tile2)) {
                return false;
            }

            // If no rules failed, the edge is placeable.
            return true;
        }

        function getTileVisibility(tile) {
            if (!tile) return 0;
            
            let vis = tile.type.visibility;

            // If a tile is fortified by ANYONE (friend or foe), it creates an obstruction
            // reducing visibility to 2 (unless it was already lower, like Forest/Mountain).
            // NOTE: Base Camps do not count as obstructions for this rule per instructions.
            if (tile.fortifiedByPlayer !== null && !tile.isBaseCampTile) {
                vis = Math.min(vis, 2);
            }

            return vis;
        }

        // Whether a specific unit may fortify on a specific tile. Fortification is
        // unit-dependent, not a flat terrain property: only Archers can take a mountain
        // peak, where they gain range/vision 3 but bleed attrition unless supplied.
        function canUnitFortifyOnTile(unit, tile) {
            if (!unit || !tile) return false;
            if (tile.type.name === 'Mountain') {
                // Arcade has no supply network at all, so a peak archer could never be
                // supplied and would just bleed escalating attrition with no counterplay.
                // Peaks are a non-arcade mechanic.
                if (engine.state.gameMode === 'arcade') return false;
                return unit.type.name === 'Archer';
            }
            return !!tile.type.canFortify;
        }

        // The full "where may this unit fortify" rule, as opposed to
        // canUnitFortifyOnTile which only answers "is this terrain fortifiable by
        // this unit". Returns tile keys. This used to be inline in three client
        // files and, once A2 needed it server-side too, drifted immediately - the
        // validation path checked only the terrain half and crashed on the rest.
        // One implementation now; client highlight code calls the same function.
        function GetValidFortifyTargets(unit) {
            if (!unit || unit.positionType !== 'edge' || unit.isFortified) return [];

            const edgeCoords = parseEdgeKey(unit.edgeKey);
            if (!edgeCoords || edgeCoords.some(c => isNaN(c.q))) return [];

            const enemyPlayer = unit.player === 1 ? 2 : 1;
            const myFlagTileKey = getFlagTileKey(unit.player);
            const enemyFlagTileKey = getFlagTileKey(enemyPlayer);
            const enemyBaseTileKeys = new Set(GetBaseCamp(enemyPlayer));

            const valid = [];
            edgeCoords.forEach(coord => {
                const tileKey = getTileKey(coord.q, coord.r);
                const tile = engine.state.tiles.get(tileKey);
                if (!tile) return;
                if (!canUnitFortifyOnTile(unit, tile)) return;
                if (tile.fortifiedByPlayer !== null) return;
                if (tileKey === myFlagTileKey && !unit.isCarryingFlag) return;
                if (enemyBaseTileKeys.has(tileKey) && tileKey !== enemyFlagTileKey) return;
                valid.push(tileKey);
            });
            return valid;
        }

        // baseCampPositions[playerN] is either an array of tile keys or a single edge-key
        // string depending on map radius. Normalise to an array of tile keys - hand-rolled
        // copies of this that forgot the string case have already caused one live bug.
        function GetBaseCamp(player) {
            const rawBaseData = engine.state.baseCampPositions ? engine.state.baseCampPositions[`player${player}`] : null;

            if (Array.isArray(rawBaseData)) return [...rawBaseData];

            if (typeof rawBaseData === 'string') {
                const [h1, h2] = parseEdgeKey(rawBaseData);
                const keys = [];
                if (!isNaN(h1.q)) keys.push(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) keys.push(getTileKey(h2.q, h2.r));
                return keys;
            }

            return [];
        }

        // Is this unit currently fortified on a mountain peak? Gated on Archer, not just
        // terrain - only archers are meant to hold the range-3/vision-3 peak package.
        // Without the type check, an arcade class-swap that morphs a fortified peak
        // archer into another class would keep granting it archer-tier vision.
        function isUnitOnMountainPeak(unit) {
            if (!unit || !unit.type || unit.type.name !== 'Archer' || unit.positionType !== 'center' || !unit.isFortified) return false;
            const tile = engine.state.tiles.get(unit.tileKey);
            return !!(tile && tile.type.name === 'Mountain');
        }

        // === RATIONS =============================================================
        //
        // The consumable half of supply. One number per player, STORED rather than
        // derived - a deliberate, named exception to Testament's "anything rebuildable
        // gets rebuilt", because nothing on the board can recompute it. The old pool
        // was derivable (reach ceiling minus network cost) and that is exactly what
        // stopped being true: this is a record of what was SPENT.

        // === REACH ===============================================================
        //
        // The other half, and the older one. Reach is a shared budget: every supply
        // line reserves part of it for as long as it exists, so what is left is how
        // much MORE line the player can lay. Unlike rations it is DERIVED - recomputed
        // from the board by recalculatePlayerSupplyNetwork on every call - and it is
        // stored in a save only so that a load has something to show before the first
        // recalculation runs.

        function ReachFor(playerNum) {
            const pool = engine.state.reach;
            if (!pool) return 0;
            const value = pool[`player${playerNum}`];
            return Number.isFinite(value) ? value : 0;
        }

        function SetReach(playerNum, value) {
            if (!engine.state.reach) return;
            const clamped = Math.max(0, Math.min(MAX_SUPPLY_REACH, Math.round(value)));
            const key = `player${playerNum}`;
            if (engine.state.reach[key] === clamped) return;
            engine.state.reach[key] = clamped;
            engine.Emit({ type: 'SUPPLY_CHANGED', player: playerNum, newValue: clamped });
        }

        function RationsFor(playerNum) {
            const pool = engine.state.rations;
            if (!pool) return 0;
            const value = pool[`player${playerNum}`];
            return Number.isFinite(value) ? value : 0;
        }

        function SetRations(playerNum, value) {
            if (!engine.state.rations) return;
            const clamped = Math.max(0, Math.min(STARTING_RATIONS, Math.round(value)));
            const key = `player${playerNum}`;
            if (engine.state.rations[key] === clamped) return;
            engine.state.rations[key] = clamped;
            engine.Emit({ type: 'SUPPLY_CHANGED', player: playerNum, newValue: clamped });
        }

        // Returns whether the ration was there to spend. Callers heal only on true -
        // an empty pool means the healing simply does not happen, not that it happens
        // on credit.
        function SpendRation(playerNum, amount) {
            const have = RationsFor(playerNum);
            if (have < amount) return false;
            SetRations(playerNum, have - amount);
            return true;
        }

        // Is this unit's line being stood on by an enemy? An intercepted line still
        // DRAINS - the ration is spent, stolen, and the unit at the far end does not
        // heal - which turns interception from a simple block into an attritional
        // attack on the enemy economy. isUnitSupplied answers false for these, so they
        // have to be found separately rather than falling out of the healing branch.
        function IsSupplyLineIntercepted(unit) {
            if (!unit || !unit.supplyLine || !unit.supplyLine.path) return false;
            return unit.supplyLine.path.some(edgeKey => {
                const edge = engine.state.edges.get(edgeKey);
                return edge && edge.units.some(u => u.player !== unit.player);
            });
        }

        // Is this fortified unit's supply line intact? Sitting on a base tile always
        // counts as supplied; otherwise the unit's supply path must not be intercepted
        // by an enemy unit standing on it.
        function isUnitSupplied(unit) {
            if (!unit) return false;

            if (GetBaseCamp(unit.player).includes(unit.fortifiedTileKey)) return true;

            if (unit.supplyLine && unit.supplyLine.path) {
                const isIntercepted = unit.supplyLine.path.some(edgeKey => {
                    const edge = engine.state.edges.get(edgeKey);
                    return edge && edge.units.some(u => u.player !== unit.player);
                });
                if (!isIntercepted) return true;
            }

            return false;
        }

        function getBaseVisibility(player) {
            const visibleEdges = new Set();
            const visibleTiles = new Set();
            const visibleRim = new Set();
            
            // 1. Identify Base Tiles
            const baseData = engine.state.baseCampPositions[`player${player}`];
            const baseTileKeys = new Set();
            
            if (Array.isArray(baseData)) {
                baseData.forEach(k => baseTileKeys.add(k));
            } else if (typeof baseData === 'string') {
                const [h1, h2] = parseEdgeKey(baseData);
                if (!isNaN(h1.q)) baseTileKeys.add(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) baseTileKeys.add(getTileKey(h2.q, h2.r));
            }

            // 2. A base camp SEES FOR ITSELF, as though a unit were fortified on each
            //    of its tiles - Burn's rule, and the one that matches what a base camp
            //    is. A camp with nobody standing in it is still a camp; it does not go
            //    blind because its garrison marched out.
            //
            //    This replaces a ring of "lookouts" placed on the base's outer EDGES.
            //    That version had two problems. The smaller one is that it was indirect:
            //    it computed what someone standing beside the base could see, which is
            //    not the same shape as what the base itself commands, and it left the
            //    base's own tiles seeing nothing when the ring happened to be empty.
            //
            //    The larger one is that it was BROKEN by the board-space cutover. The
            //    dummy carried `position: edgeKey` and a hand-written positionType, and
            //    position is a fine coordinate now - so getFineCoordForUnit parsed
            //    "1,2_3,4" straight to NaN and every base lost its own visibility. The
            //    dummy below is built in board space, with the derived keys spelled out,
            //    because a hand-rolled unit literal that skips them is exactly how that
            //    happened.
            baseTileKeys.forEach(tileKey => {
                if (!engine.state.tiles.has(tileKey)) return;

                const fineKey = FineKeyOfTile(tileKey);
                const garrison = {
                    position: fineKey,
                    positionType: 'center',
                    isFortified: true,
                    tileKey: tileKey,
                    edgeKey: null,
                    player: player,
                    // No `type`, deliberately. isUnitOnMountainPeak asks for
                    // type.name === 'Archer' before granting the range-3 peak package,
                    // so a typeless garrison gets ordinary fortified vision - a base
                    // camp is not an archer and should not see like one.
                };

                visibleTiles.add(tileKey);
                const vis = getVisibleKeysFromUnit(garrison);
                vis.edges.forEach(e => visibleEdges.add(e));
                vis.tiles.forEach(t => visibleTiles.add(t));
                vis.rim.forEach(k => visibleRim.add(k));
            });

            return { edges: visibleEdges, tiles: visibleTiles, rim: visibleRim };
        }

        function isInternalBaseEdge(edgeKey) {
            // Checks if an edge is between two tiles of the SAME base camp
            const [h1, h2] = parseEdgeKey(edgeKey);
            const t1 = getTileKey(h1.q, h1.r);
            const t2 = getTileKey(h2.q, h2.r);

            for (let i = 1; i <= 2; i++) {
                const base = engine.state.baseCampPositions[`player${i}`];
                if (Array.isArray(base)) {
                    if (base.includes(t1) && base.includes(t2)) return true;
                }
            }
            return false;
        }

        function getUnitCountsForPlayer(player) {
            const counts = { Swordsman: 0, Archer: 0, Pikeman: 0, Horseman: 0 };
            engine.state.units.forEach(unit => {
                if (unit.player === player) {
                    counts[unit.type.name]++;
                }
            });
            return counts;
        }

        // The third argument is a BOARD-SPACE key ("fq,fr"), not an edge key. Callers
// holding a legacy key wrap it in FineKeyOfEdge/FineKeyOfTile at the call site,
// deliberately: a tile key and a fine key are both "a,b" and cannot be told
// apart by shape, so accepting either here would be a silent mis-placement
// waiting to happen.
// The derived half of a unit's position, in ONE place.
//
// A unit reaches the board three ways - built by createUnit, resumed from a save
// (RelinkResumedUnits), or loaded by the client (rehydrateGameState) - and before
// the cutover positionType/isFortified/fortifiedTileKey were stored fields, so all
// three paths got them for free by copying the saved object. They are derived now,
// which means every one of those paths has to attach them, and three hand-written
// copies of the same five accessors is three chances to write four.
//
// ENUMERABLE ON PURPOSE, exactly like type/hp/maxHp: the codebase spreads units
// constantly - state-filter builds the wire view as `{ ...u, hidden: false }`, ai.js
// scores hypothetical moves on `{ ...unit, position }` - and a non-enumerable
// accessor vanishes from every one of those copies. That precise bug has already
// happened once with `type` (see the note in js/client/save.js).
function AttachDerivedUnitAccessors(unit) {
    const derived = {
        positionType: function () { return IsHexCenterKey(this.position) ? 'center' : 'edge'; },
        isFortified: function () { return IsHexCenterKey(this.position); },
        fortifiedTileKey: function () { return TileKeyOfFine(this.position); },
        tileKey: function () { return TileKeyOfFine(this.position); },
        edgeKey: function () { return EdgeKeyOfFine(this.position); },
    };

    for (const name of Object.keys(derived)) {
        Object.defineProperty(unit, name, {
            get: derived[name],
            // Loud, not silent. These were plain fields until the cutover and are
            // assigned in a handful of places; a bare getter would make every missed
            // write site a silent no-op in sloppy mode. Throwing turns one into a
            // test failure with its own name on it.
            set: function () {
                throw new Error('unit.' + name + ' is derived from position; set position instead');
            },
            configurable: true,
            enumerable: true,
        });
    }
    return unit;
}

function createUnit(player, typeInput, boardSpaceKey, existingId = null) {
            // Robust Type Lookup: Handle String Key or Object
            let typeKey = 'SWORDSMAN';
            if (typeof typeInput === 'string') {
                typeKey = typeInput.toUpperCase();
            } else if (typeInput && typeInput.typeName) {
                typeKey = typeInput.typeName.toUpperCase();
            } else if (typeInput && typeInput.name) {
                // Fallback for old map data using 'name'
                typeKey = typeInput.name.toUpperCase();
            }

            const template = UNIT_TYPES[typeKey];
            if (!template) {
                console.error(`[createUnit] Invalid unit type: ${typeKey} (Input: ${JSON.stringify(typeInput)})`);
                return null;
            }

            // Fallback values for stats to prevent NaN. SpeedForPreset carries that
            // same fallback and then answers for the match's chosen pools - a horseman
            // is built with 6 under Normal and 9 under Faster.
            const speedVal = SpeedForPreset(typeKey, ActiveUnitSpeedPreset());
            const defVal = template.defense !== undefined ? template.defense : (template.fortificationBonus || 0);

            // --- NEW: Deterministic ID Generation ---
            let unitId;
            if (existingId) {
                unitId = existingId;
            } else {
                engine.state.unitIdCounter++;
                // Format: u_p{PLAYER}_{TYPE}_{TURN}_{COUNTER}
                // Example: u_p1_SWORDSMAN_t1_1
                unitId = `u_p${player}_${typeKey}_t${engine.state.globalTurnNumber}_${engine.state.unitIdCounter}`;
            }
            // ----------------------------------------
            
            // Built, then given its derived accessors - the same call the resume
            // and load paths make, so a unit is the same shape however it arrived.
            return AttachDerivedUnitAccessors({
                id: unitId, 
                player: player, 
                typeId: typeKey, 
                
                // COMPATIBILITY GETTER
                get type() { return UNIT_TYPES[this.typeId]; }, 

                // MUTABLE STATS CONTAINER
                stats: {
                    hp: template.hp,
                    maxHp: template.hp,
                    speed: speedVal,
                    damage: template.damage,
                    defense: defVal,
                    range: template.attackType === 'ranged' ? 2 : 1
                },
                
                // LEGACY GETTERS/SETTERS (Bridge for old code accessing unit.hp directly)
                get hp() { return this.stats.hp; },
                set hp(val) { this.stats.hp = val; },
                get maxHp() { return this.stats.maxHp; },
                set maxHp(val) { this.stats.maxHp = val; },

                currentMove: speedVal, // Initialize with full speed

                // BOARD SPACE. The one stored position field, holding "fq,fr" on
                // the fine grid. Every position a unit can occupy is a fine cell,
                // so this addresses all of them; the old scheme needed a tile key
                // OR an edge key plus a positionType to say which.
                position: boardSpaceKey,

                hasPerformedMajorAction: false,
                isCarryingFlag: false,
                
                turnsFortifiedAtBase: 0,
                turnsFortified: 0,
                fortifyCooldown: 0,
                canHeal: true,
                hasShield: false,
                supplyLine: null,
                lastAttackedByHostileOnTurn: 0,
                spearWalled: false,
                ambushed: false,
                
                // VETERANCY
                level: 0,
                upgrades: { health: 0, speed: 0, damage: 0, defense: 0 }
            });
        }

        function SpawnUnit(player, unitType) {
            const baseData = engine.state.baseCampPositions[`player${player}`];
            let potentialSpawnEdges = [];

            // Helper to check validity
            const isEdgeValidForSpawn = (edgeKey) => {
                const edge = engine.state.edges.get(edgeKey);
                // A valid edge must exist, have less than 2 units, and have NO enemy units.
                if (!edge || edge.units.length >= 2 || edge.units.some(u => u.player !== player)) return false;
                
                // Special check: Don't spawn ON the flag edge if in Standard mode
                if (typeof baseData === 'string' && edgeKey === baseData) return false;
                
                return true;
            };

            if (Array.isArray(baseData)) {
                // --- EXPANSIVE MAP LOGIC (Radius 4) ---
                // baseData is an array of tile keys. 
                // We want to spawn on the "Outer Edges" of the base camp.
                
                const baseTileSet = new Set(baseData);
                const processedEdges = new Set();
                
                baseData.forEach(tileKey => {
                    const [q, r] = tileKey.split(',').map(Number);
                    getNeighbors(q, r).forEach(n => {
                        const neighborKey = getTileKey(n.q, n.r);
                        
                        // --- FIX: Logic for Outer Edges ---
                        // An edge is valid for spawning ONLY if it connects a Base Tile to a Non-Base Tile.
                        if (!baseTileSet.has(neighborKey)) {
                            const edgeKey = getEdgeKey(q, r, n.q, n.r);
                            if (!processedEdges.has(edgeKey)) {
                                processedEdges.add(edgeKey);
                                potentialSpawnEdges.push(edgeKey);
                            }
                        }
                    });
                });
            } else {
                // --- STANDARD MAP LOGIC (Radius 3) ---
                // baseData is an edge key string
                potentialSpawnEdges = GetHexPathNeighbours(baseData);
            }

            // Find first valid edge in the potential list
            const spawnEdgeKey = potentialSpawnEdges.find(edgeKey => isEdgeValidForSpawn(edgeKey));

            if (spawnEdgeKey) {
                const newUnit = createUnit(player, unitType, FineKeyOfEdge(spawnEdgeKey));
                engine.state.units.push(newUnit);
                
                engine.Emit({ type: 'LOG', text: `P${player} ${unitType.name} has returned to the fight!`, player });
                engine.Emit({ type: 'VISION_INVALIDATED' });

                engine.actionManager.RecordHistory({
                    type: "UNIT_SPAWN", turn: engine.state.globalTurnNumber, player,
                    actorId: newUnit.id,
                    payload: { typeName: unitType.name, at: spawnEdgeKey }
                });

                // The charge is spent HERE, on success, not by the caller. It used to be
                // debited client-side after the fact (consumeRespawnCharge), which meant
                // a blocked base spent nothing while some paths spent twice - and online
                // it was never spent on the authoritative board at all.
                SpendReinforcementCharge(player);
                return true;
            }

            engine.Emit({ type: 'LOG', text: `P${player} Base is blocked! Cannot respawn ${unitType.name}.`, player });
            return false;
        }

        function getMaxUnitsForCurrentMap() {
            return MAP_SIZE_UNIT_LIMITS[engine.state.gridRadius] || 4;
        }

        function getEdgeCost(unit, edgeKey) {
            const edge = engine.state.edges.get(edgeKey);
            // Not a real hexPath. Null, not Infinity: see the hexCenter check
            // below for why the two answers are kept apart.
            if (!edge) return null;

            const tileCoords = parseEdgeKey(edgeKey);
            const tile1 = engine.state.tiles.get(getTileKey(tileCoords[0].q, tileCoords[0].r));
            const tile2 = engine.state.tiles.get(getTileKey(tileCoords[1].q, tileCoords[1].r));
            // NULL, not Infinity, and the difference is meaningful. Infinity says
            // "a real hexPath you cannot cross" - water to water. Null says "not a
            // hexPath at all", because one of its two hexCenters is off the board.
            // Rim cells are the whole reason this distinction exists. Callers must
            // treat null as impassable; IsTraversableCost is how.
            if (!tile1 || !tile2) return null;

            let baseCost;

            if (edge.bridge) {
                baseCost = BRIDGE_MOVE_COST;
            } else if (IsImpassableTile(tile1) && IsImpassableTile(tile2)) {
                // Both sides impassable and no bridge. Stated as a property of the
                // terrain rather than as "is it water", so a future impassable
                // terrain gets this for free.
                return Infinity;
            } else {
                // One number per terrain, combined by EDGE_COST_MODEL. This replaced
                // a hardcoded mountain-then-forest-then-plains cascade with a water
                // special case in front of it. That cascade was Math.max over the
                // weights all along, which is why swapping in the data-driven form
                // moved nothing - tools/move-parity.js is the proof.
                baseCost = EDGE_COST_MODEL.combine(
                    MoveWeightOfTile(tile1), MoveWeightOfTile(tile2));
            }
    
            // Apply fortification penalty
            let fortificationPenalty = 0;
            const enemyPlayer = unit.player === 1 ? 2 : 1;
    
            // --- FIX: Handle Polymorphic Base Camp Data (String or Array) ---
            const enemyBaseData = engine.state.baseCampPositions[`player${enemyPlayer}`];
            let enemyBaseTiles = [];
    
            if (Array.isArray(enemyBaseData)) {
                // Expansive Map: Array of Tile Keys
                enemyBaseTiles = enemyBaseData;
            } else if (typeof enemyBaseData === 'string') {
                // Standard Map: Edge Key String "q,r_q,r"
                enemyBaseTiles = enemyBaseData.split('_');
            }

            if ((tile1.fortifiedByPlayer && tile1.fortifiedByPlayer === enemyPlayer) ||
                (tile2.fortifiedByPlayer && tile2.fortifiedByPlayer === enemyPlayer) ||
                enemyBaseTiles.includes(getTileKey(tile1.q, tile1.r)) ||
                enemyBaseTiles.includes(getTileKey(tile2.q, tile2.r)))
            {
                fortificationPenalty = FORTIFICATION_MOVE_PENALTY;
            }

            const finalCost = baseCost + fortificationPenalty;
            return Math.min(finalCost, MAX_MOVEMENT_COST);
        }

        function getRotationallyAdjacentEdges(currentEdgeKey) {
            const adjacentEdges = new Set(); const [h1, h2] = parseEdgeKey(currentEdgeKey);
            if (isNaN(h1.q) || isNaN(h2.q)) return [];
            const findEdgesAroundPivot = (pivotHex, fromHex) => {
                const dirToFromHex = { q: fromHex.q - pivotHex.q, r: fromHex.r - pivotHex.r };
                const initialDirIndex = findDirectionIndex(dirToFromHex); if (initialDirIndex === -1) return;
                const ccwDirIndex = (initialDirIndex + 1) % 6; const cwDirIndex = (initialDirIndex + 5) % 6;
                const ccwNeighborCoords = { q: pivotHex.q + AXIAL_DIRECTIONS[ccwDirIndex].q, r: pivotHex.r + AXIAL_DIRECTIONS[ccwDirIndex].r };
                const cwNeighborCoords = { q: pivotHex.q + AXIAL_DIRECTIONS[cwDirIndex].q, r: pivotHex.r + AXIAL_DIRECTIONS[cwDirIndex].r };
                if (engine.state.tiles.has(getTileKey(ccwNeighborCoords.q, ccwNeighborCoords.r))) adjacentEdges.add(getEdgeKey(pivotHex.q, pivotHex.r, ccwNeighborCoords.q, ccwNeighborCoords.r));
                if (engine.state.tiles.has(getTileKey(cwNeighborCoords.q, cwNeighborCoords.r))) adjacentEdges.add(getEdgeKey(pivotHex.q, pivotHex.r, cwNeighborCoords.q, cwNeighborCoords.r));
            };
            findEdgesAroundPivot(h1, h2); findEdgesAroundPivot(h2, h1);
            return Array.from(adjacentEdges);
        }

        // THE ONE PLACE A UNIT LOSES HP.
        //
        // Shield is a one-hit sponge: it absorbs a single instance of damage IN FULL,
        // whatever the amount, and is then gone. That only works if every source of
        // damage asks the same function, so all nine of them do - attacks, split damage,
        // retaliation, the three ZoC sites, bridge collapse and mountain attrition.
        // Before this, shield was `hp === maxHp + 1` and any `hp -= n` consumed it by
        // arithmetic; a sponge cannot be expressed that way, because a 4-damage hit
        // would eat the point AND three real HP.
        //
        // Returns the damage ACTUALLY dealt, which is 0 on an absorb. Callers use that
        // for their logs and ledger entries, so a shielded hit is recorded as the
        // nothing it was rather than as damage the unit never took.
        function ApplyDamageToUnit(unit, amount, sourceLabel) {
            if (!unit || amount <= 0) return 0;

            if (unit.hasShield) {
                unit.hasShield = false;
                const label = sourceLabel ? ` (${sourceLabel})` : '';
                engine.Emit({
                    type: 'LOG',
                    text: `P${unit.player} ${unit.type.name}'s shield absorbs the hit${label}!`,
                    player: engine.state.currentPlayer,
                    duration: 2500
                });
                engine.Emit({ type: 'SHIELD_BROKEN', unit });
                return 0;
            }

            unit.hp -= amount;
            return amount;
        }

        // Shield is granted at the start of a turn to a fortified unit that has not been
        // hit for a turn and is either at full health on supply, or cut off entirely.
        // The mountain-peak exception is Burn's: ranged reach, elevation and a free
        // absorbed hit on top is the one stack with no answer to it. Peak fortification
        // is already archer-only (canUnitFortifyOnTile), so asking about the peak is
        // enough - but the archer is named here anyway, because the day another type can
        // hold a peak is the day this rule should be re-read rather than silently widened.
        function CanUnitGainShield(unit) {
            if (!unit || unit.hasShield) return false;
            if (!unit.isFortified) return false;
            if (isUnitOnMountainPeak(unit)) return false;
            if (CanUnitDrawOnSupply(unit)) return unit.hp >= unit.maxHp;
            return true;
        }

        // "Supplied" for the purposes of the shield means SUPPLIED AND ABLE TO USE IT.
        // A stolen flag zeroes the pool (SetRationsForFlagStatus), so a unit on a
        // perfectly intact line still cannot heal while the flag is gone - and a unit
        // that cannot heal is exactly the one the shield's second branch is for. Asking
        // isUnitSupplied alone would leave a hurt unit on a live line with neither the
        // healing nor the buffer, which is the one gap the rework was meant to close.
        function CanUnitDrawOnSupply(unit) {
            if (!isUnitSupplied(unit)) return false;
            const flag = engine.state.flags && engine.state.flags[`p${unit.player}_flag`];
            return !(flag && flag.status === 'carried');
        }

        // The MP a unit is given at the start of its turn. ONE definition, because
        // the overrun rule below has to ask "is this unit still on a full tank?" and a
        // second copy of the flag-carrier penalty would drift from the first.
        function TurnStartMovePool(unit) {
            let pool = unit.stats.speed;
            if (unit.isCarryingFlag) pool -= 1;
            return Math.max(0, pool);
        }

        // OVERRUN: a unit on a full tank can always make at least one move.
        //
        // Terrain costs run to MAX_MOVEMENT_COST (5) while the smaller boards give an
        // archer a pool of 4, so without this a mountain-to-mountain hexPath is not
        // expensive for an archer - it is a wall, permanently, no matter how many turns
        // it waits. Civ solves that the same way: if you have not spent anything yet,
        // you may enter regardless of cost and it costs you everything.
        //
        // Three conditions, and each one is load-bearing:
        //
        //   pathCostSoFar === 0   FIRST STEP ONLY. Otherwise a unit could spend its
        //                         pool crossing plains and then overrun a mountain on
        //                         the end of it, which is a free move, not a floor.
        //
        //   stepCost > currentMove  Only when the step is genuinely unaffordable. If it
        //                         fits, it is charged normally.
        //
        //   currentMove >= pool   NOTHING SPENT THIS TURN. Attacking, fortifying and
        //                         bridge-building all draw on the same pool, so this
        //                         reads as "has not acted", not merely "has not moved" -
        //                         attacking and then overrunning would be two full
        //                         actions on one turn.
        //
        // The caller clamps the resulting path cost to currentMove, which both charges
        // the whole pool and stops the search dead at that cell.
        function CanOverrunHexPath(unit, pathCostSoFar, stepCost) {
            if (pathCostSoFar !== 0) return false;
            if (!IsTraversableCost(stepCost)) return false;
            if (stepCost <= unit.currentMove) return false;
            return unit.currentMove >= TurnStartMovePool(unit);
        }

        function getPossibleMoves(unit) {
            if (engine.state.mapMakerMode) {
                return new Map(); 
            }
            if (!unit || unit.currentMove < 1 || unit.isFortified) return new Map();
            if (unit.spearWalled) return new Map(); //Spear Wall Prevents Movement
            if (unit.ambushed) return new Map(); //Ambush Prevents Movement
    
            if (unit.hasPerformedMajorAction) {
                if (!unit.type.canMoveAfterAttack) {
                    return new Map();
                }
                if (isEdgeAdjacentToSpearWall(unit, unit.edgeKey)) {
                    return new Map(); 
                }
            }

    const playerBaseData = engine.state.baseCampPositions[`player${unit.player}`];
    
    let reachable = new Map();
    // Hoisted rather than asked for four times: unit.edgeKey is a derived getter
    // that reparses the fine key and re-resolves both hexCenters, and this is the
    // hot loop of the whole game.
    const startEdgeKey = unit.edgeKey;
    let frontier = [{ edgeKey: startEdgeKey, pathCost: 0, pathTaken: [startEdgeKey] }];
    let minCostsFound = new Map(); minCostsFound.set(startEdgeKey, 0);
    
    while (frontier.length > 0) {
        frontier.sort((a, b) => a.pathCost - b.pathCost); 
        const current = frontier.shift();

        if (current.pathCost > (minCostsFound.get(current.edgeKey) || Infinity)) continue;
        
        const rotationallyAdjacentEdges = GetHexPathNeighbours(current.edgeKey);

        for (const nextAdjacentEdgeKey of rotationallyAdjacentEdges) {
            
            // --- FIX: Check restricted base edges for both types ---
            let isRestrictedBaseEdge = false;
            
            if (Array.isArray(playerBaseData)) {
                // Expansive Logic: Check if edge is internal to base array
                const [h1, h2] = parseEdgeKey(nextAdjacentEdgeKey);
                const t1 = getTileKey(h1.q, h1.r);
                const t2 = getTileKey(h2.q, h2.r);
                if (playerBaseData.includes(t1) && playerBaseData.includes(t2)) {
                    isRestrictedBaseEdge = true;
                }
            } else if (typeof playerBaseData === 'string') {
                // Standard Logic: Check exact edge key match
                if (nextAdjacentEdgeKey === playerBaseData) {
                    isRestrictedBaseEdge = true;
                }
            }

            // A unit cannot move onto its own team's restricted base edge, UNLESS carrying flag.
            if (isRestrictedBaseEdge && !unit.isCarryingFlag) {
                continue;
            }
            // -------------------------------------------------------

            if (nextAdjacentEdgeKey === startEdgeKey && current.pathTaken.length === 1) continue;
            const nextAdjacentEdgeObject = engine.state.edges.get(nextAdjacentEdgeKey); 
            if (!nextAdjacentEdgeObject) continue;
            
            let enemyBlocks = false;
            if (nextAdjacentEdgeObject.units.some(u => u.player !== unit.player)) {
                if (engine.settings.fogOfWarEnabled && engine.state.gameMode !== 'arcade' && !engine.state.mapMakerMode && engine.visionCache) {
                    if (engine.visionCache.edges.has(nextAdjacentEdgeKey)) {
                        enemyBlocks = true;
                    }
                } else {
                    enemyBlocks = true; 
                }
            }
            if (enemyBlocks) continue;
            const friendlyUnitsOnNext = nextAdjacentEdgeObject.units.filter(u => u.player === unit.player);
            if (friendlyUnitsOnNext.length >= 2 && !friendlyUnitsOnNext.find(u => u.id === unit.id)) continue;
            const costToTraverseNextEdge = getEdgeCost(unit, nextAdjacentEdgeKey);
            if (!IsTraversableCost(costToTraverseNextEdge)) continue;
            let newTotalPathCost = current.pathCost + costToTraverseNextEdge;
            // A full-tank unit may step onto a hexPath it cannot afford, for the price
            // of everything it has. Charging currentMove rather than the real cost is
            // what makes that terminal: the frontier entry then has nothing left to
            // spend, so the search cannot continue past it.
            if (CanOverrunHexPath(unit, current.pathCost, costToTraverseNextEdge)) {
                newTotalPathCost = unit.currentMove;
            }
            if (newTotalPathCost <= unit.currentMove) {
                const knownMinCost = minCostsFound.get(nextAdjacentEdgeKey) || Infinity;
                if (newTotalPathCost < knownMinCost) {
                    minCostsFound.set(nextAdjacentEdgeKey, newTotalPathCost);
                    const newPathTaken = current.pathTaken.concat(nextAdjacentEdgeKey);
                    frontier.push({ edgeKey: nextAdjacentEdgeKey, pathCost: newTotalPathCost, pathTaken: newPathTaken });
                    if (nextAdjacentEdgeKey !== startEdgeKey) reachable.set(nextAdjacentEdgeKey, { cost: newTotalPathCost, path: newPathTaken });
                        }
                    }
                }
            }
            return reachable;
        }

        function findSupplyPath(startFortTileKey, player) {
            // If the player's flag is stolen, they cannot have a supply line.
            const playerFlag = engine.state.flags[`p${player}_flag`]; 
            if (playerFlag && playerFlag.status === 'carried') {
                return null;
            }

            // --- FIX: Normalized Base Camp Tiles retrieval ---
            const rawBaseData = engine.state.baseCampPositions[`player${player}`];
            let baseTiles = [];
            if (Array.isArray(rawBaseData)) {
                baseTiles = rawBaseData;
            } else if (typeof rawBaseData === 'string') {
                const [h1, h2] = parseEdgeKey(rawBaseData);
                if (!isNaN(h1.q)) baseTiles.push(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) baseTiles.push(getTileKey(h2.q, h2.r));
            }

            // The "start" for our pathfinding are all edges adjacent to the fort
            const startTile = engine.state.tiles.get(startFortTileKey);
            if (!startTile) return null;
            const startEdges = getEdgesOfTile(startTile.q, startTile.r);
            
            // The "goals" are all edges adjacent to ANY base tile
            const endEdges = new Set();
            baseTiles.forEach(tileKey => {
                const [q, r] = tileKey.split(',').map(Number);
                getEdgesOfTile(q, r).forEach(e => endEdges.add(e));
            });

            let frontier = [];
            for (const edge of startEdges) {
                if (isRoad(edge)) {
                     frontier.push({ edgeKey: edge, cost: getEdgeCost({player}, edge), path: [edge] });
                }
            }

            let visited = new Map();
            startEdges.forEach(edge => visited.set(edge, { cost: 0, path: [] }));

            while (frontier.length > 0) {
                frontier.sort((a, b) => a.cost - b.cost);
                const current = frontier.shift();

                if (endEdges.has(current.edgeKey)) {
                    // Path found! Now calculate the adjusted cost.
                    let adjustedCost = current.cost;
                    const fullPath = current.path;

                    // Subtract the cost of the first and last edge segments.
                    if (fullPath.length > 0) {
                        adjustedCost -= getEdgeCost({ player }, fullPath[0]);
                    }
                    if (fullPath.length > 1) {
                        adjustedCost -= getEdgeCost({ player }, fullPath[fullPath.length - 1]);
                    }

                    const visualPath = fullPath.length > 2 ? fullPath.slice(1, -1) : [];
                    return { path: visualPath, cost: Math.max(0, adjustedCost) }; // Ensure cost isn't negative
                }

                // DELIBERATELY still the rotation walk, not GetVertexAdjacentEdges.
                // The two return the SAME SET in a DIFFERENT ORDER, and this search
                // keeps the first path it finds at a given cost (strictly-less
                // below), so order decides which of several equal-cost routes is
                // stored. recalculatePlayerSupplyNetwork then charges each network
                // only for roads it has not already paid for, so two units on
                // routes that share edges cost less than two on disjoint ones.
                // Swapping the order therefore moves rations - caught by
                // tools/reference/default-opening.a2.json, which replayed to
                // player1 supply 3 where the log recorded 4.
                //
                // That coupling is undocumented and fragile, but it is not this
                // step's business to change it: the cutover is meant to preserve
                // behaviour exactly. C1/C2 replace this accounting outright (the
                // pool stops being derived from network cost), which is the
                // deliberate place to make route choice order-independent.
                const adjacentEdges = getRotationallyAdjacentEdges(current.edgeKey);
                for (const neighborEdgeKey of adjacentEdges) {
                    if (!isRoad(neighborEdgeKey)) continue;

                    const costToNeighbor = getEdgeCost({ player }, neighborEdgeKey);
                    if (!IsTraversableCost(costToNeighbor)) continue;
                    const newCost = current.cost + costToNeighbor;

                    if (!visited.has(neighborEdgeKey) || newCost < visited.get(neighborEdgeKey).cost) {
                        const newPath = [...current.path, neighborEdgeKey];
                        visited.set(neighborEdgeKey, { cost: newCost, path: newPath });
                        frontier.push({ edgeKey: neighborEdgeKey, cost: newCost, path: newPath });
                    }
                }
            }

            return null; // No path found
        }

        function recalculatePlayerSupplyNetwork(playerNum) {
            if (engine.state.gameMode === 'arcade') return;

            const playerRationsKey = `player${playerNum}`;

            // A6. Supply transitions were never a ledger type, so Testament's rebuilt
            // log could not reproduce them (A4 §5.1) and the archive had no record of
            // a network forming or collapsing.
            //
            // Recorded as a DIFF rather than as per-unit events, because this function
            // recomputes the whole network from scratch on every call: what matters is
            // which units changed state, not that a recalculation ran. A call that
            // changes nothing writes nothing, which keeps an ordinary move from filling
            // the ledger with noise.
            const supplyBefore = new Map();
            engine.state.units.forEach(u => {
                if (u.player === playerNum) supplyBefore.set(u.id, !!u.supplyLine);
            });

            // Two ways to have no network at all: the flag is gone, or the rations
            // are. Starvation is the new one - "at zero, healing stops and every
            // supply line is cut" - and it is checked here rather than only where the
            // last ration is spent, because this function is what re-grants lines and
            // it must not hand one back to a player who cannot feed it.
            const playerFlag = engine.state.flags[`p${playerNum}_flag`];
            const starved = RationsFor(playerNum) <= 0;
            if ((playerFlag && playerFlag.status === 'carried') || starved) {
                engine.state.units.forEach(unit => {
                    if (unit.player === playerNum) {
                        unit.supplyLine = null;
                    }
                });
                // Every line for this player just went away. That is a severing, and
                // it is the one exit from this function that skips the diff below.
                RecordSupplyTransitions(playerNum, supplyBefore);
                return;
            }

            // --- FIX: Get Normalized Base Tiles ---
            const rawBaseData = engine.state.baseCampPositions[playerRationsKey];
            let baseTiles = [];
            if (Array.isArray(rawBaseData)) {
                baseTiles = rawBaseData;
            } else if (typeof rawBaseData === 'string') {
                const [h1, h2] = parseEdgeKey(rawBaseData);
                if (!isNaN(h1.q)) baseTiles.push(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) baseTiles.push(getTileKey(h2.q, h2.r));
            }

            // Reset all non-base supply lines for the player to start fresh
            engine.state.units.forEach(unit => {
                if (unit.player === playerNum && unit.isFortified) {
                    if (!baseTiles.includes(unit.fortifiedTileKey)) {
                         unit.supplyLine = null;
                    }
                }
            });

            // Find all fortified units and their potential individual paths
            const potentialSupplies = [];
            const fortifiedUnits = engine.state.units.filter(u => u.player === playerNum && u.isFortified);

            fortifiedUnits.forEach(unit => {
                // Check if not in base tiles using the normalized array
                if (!baseTiles.includes(unit.fortifiedTileKey)) {
                    const pathData = findSupplyPath(unit.fortifiedTileKey, playerNum);
                    if (pathData) {
                        potentialSupplies.push({
                            unit: unit,
                            cost: Math.round(pathData.cost), 
                            pathData: pathData
                        });
                    }
                }
            });

            // REACH IS A SHARED BUDGET, and this is the accounting for it.
            //
            // Lines are taken cheapest-first and each is charged only for the roads no
            // earlier line has already paid for, so two units on routes that overlap
            // cost less than two on disjoint ones. When the running total would pass
            // MAX_SUPPLY_REACH the line is refused. What is LEFT of the budget is the
            // Reach number on the panel: it falls as you lay line and rises as forts
            // are released, which is the whole reason a player watches it.
            //
            // This is unchanged from the original mechanic, deliberately (Burn,
            // 2026-09-09). C2 briefly replaced it with a per-line ceiling on the
            // reasoning that a shared budget makes forts compete for a resource at a
            // distance. It does, and that IS the mechanic - extending your network is
            // supposed to cost you something everywhere else, or there is no decision
            // in where you fortify. Only the CONSUMABLE half of C2 was wanted.
            //
            // The known wart, kept with it: because later lines pay only for NEW roads,
            // which of several equal-cost routes findSupplyPath happens to store changes
            // what everything after it costs. See the note there - it is why the
            // rotation walk was not swapped for GetVertexAdjacentEdges.
            //
            // Rations are NOT touched here. They are spent on healing, at the start of a
            // turn (ApplyStartOfTurnHealing), and this function runs on every move.
            potentialSupplies.sort((a, b) => a.cost - b.cost);

            let allUsedRoads = new Set();
            let networkSupplyCost = 0;

            potentialSupplies.forEach(supply => {
                const pathEdges = new Set(supply.pathData.path);
                let incrementalCost = 0;
                pathEdges.forEach(road => {
                    if (!allUsedRoads.has(road)) {
                        const roadCost = getEdgeCost({ player: playerNum }, road);
                        if (!IsTraversableCost(roadCost)) return;
                        incrementalCost += roadCost;
                    }
                });

                if (networkSupplyCost + incrementalCost <= MAX_SUPPLY_REACH) {
                    networkSupplyCost += incrementalCost;
                    supply.unit.supplyLine = supply.pathData;
                    pathEdges.forEach(road => allUsedRoads.add(road));
                } else {
                    supply.unit.supplyLine = null;
                }
            });

            SetReach(playerNum, MAX_SUPPLY_REACH - Math.round(networkSupplyCost));

            RecordSupplyTransitions(playerNum, supplyBefore);
        }

        // Compares the supply state captured before a recalculation against what came
        // out of it, and records the difference - nothing at all when there is no
        // difference, which is the common case.
        function RecordSupplyTransitions(playerNum, before) {
            if (!engine.state.matchHistory) return;

            const established = [];
            const severed = [];
            engine.state.units.forEach(u => {
                if (u.player !== playerNum) return;
                const had = before.get(u.id);
                if (had === undefined) return;
                const has = !!u.supplyLine;
                if (has && !had) established.push(u.id);
                else if (!has && had) severed.push(u.id);
            });

            if (established.length === 0 && severed.length === 0) return;

            engine.actionManager.RecordHistory({
                type: "SUPPLY_LINES_CHANGED", turn: engine.state.globalTurnNumber,
                player: playerNum,
                payload: {
                    established, severed,
                    rations: engine.state.rations[`player${playerNum}`],
                }
            });
        }

        function getPotentialUnfortifyTargets(unit) {
            if (!unit || !unit.isFortified || unit.positionType !== 'center') return [];
            const fortifiedTile = engine.state.tiles.get(unit.tileKey); if (!fortifiedTile) return [];
    
            // Use the generic name as it can be a String or Array
            const playerBaseData = engine.state.baseCampPositions[`player${unit.player}`];
            const validTargets = [];

            getNeighbors(fortifiedTile.q, fortifiedTile.r).forEach(neighborCoords => {
                const edgeKey = getEdgeKey(fortifiedTile.q, fortifiedTile.r, neighborCoords.q, neighborCoords.r);
        
                // --- FIX: Check restricted base edges for both map types ---
                let isRestricted = false;
        
                if (Array.isArray(playerBaseData)) {
                    // Expansive Mode: Check if edge connects two of our own base tiles
                    // We know one tile is the fortified tile (unit.position)
                    const t1 = unit.tileKey; 
                    const t2 = getTileKey(neighborCoords.q, neighborCoords.r);
            
                    // If both tiles are in the base camp array, this is an internal edge -> Restricted
                    if (playerBaseData.includes(t1) && playerBaseData.includes(t2)) {
                        isRestricted = true;
                    }
                } else {
                    // Standard Mode: Check specific edge key string
                    if (edgeKey === playerBaseData) {
                        isRestricted = true;
                    }
                }

                if (isRestricted) {
                    return; // Skip this edge, it's not a valid target.
                }

                const edge = engine.state.edges.get(edgeKey);
                if (edge && getEdgeCost(unit, edgeKey) !== Infinity) {
                    const enemyOnEdge = edge.units.some(u => u.player !== unit.player);
                    const friendliesOnEdge = edge.units.filter(u => u.player === unit.player).length;
                    if (!enemyOnEdge && friendliesOnEdge < 2) {
                        validTargets.push(edgeKey);
                    }
                }
            });
            return validTargets;
        }

        function getPotentialBridgeTargets(unit) {
            if (!unit || unit.positionType !== 'edge' || !unit.type.canBuildBridge || unit.isFortified) return [];

            const validTargets = new Set();
            
            // 1. Check if the unit's CURRENT edge is a valid target
            const currentEdge = engine.state.edges.get(unit.edgeKey);
            if (currentEdge && !currentEdge.bridge) {
                const [h1, h2] = parseEdgeKey(unit.edgeKey);
                const tile1 = engine.state.tiles.get(getTileKey(h1.q, h1.r));
                const tile2 = engine.state.tiles.get(getTileKey(h2.q, h2.r));
                if (tile1 && tile2) {
                    const isBeachEdge = (tile1.type === TILE_TYPES.WATER && tile2.type !== TILE_TYPES.WATER) || 
                                      (tile2.type === TILE_TYPES.WATER && tile1.type !== TILE_TYPES.WATER);
                    if (isBeachEdge) {
                        validTargets.add(unit.edgeKey);
                    }
                }
            }

            // 2. Check all ADJACENT edges (original logic)
            const rotationallyAdjacentEdges = GetHexPathNeighbours(unit.edgeKey);
            rotationallyAdjacentEdges.forEach(adjEdgeKey => {
                if (adjEdgeKey === unit.edgeKey) return;
                const edgeData = engine.state.edges.get(adjEdgeKey);
                if (edgeData && !edgeData.bridge) {
                    const adjEdgeTileCoords = parseEdgeKey(adjEdgeKey);
                    if (adjEdgeTileCoords.some(coord => isNaN(coord.q))) return;

                    const t1 = engine.state.tiles.get(getTileKey(adjEdgeTileCoords[0].q, adjEdgeTileCoords[0].r));
                    const t2 = engine.state.tiles.get(getTileKey(adjEdgeTileCoords[1].q, adjEdgeTileCoords[1].r));

                    // An adjacent edge is a target if it's next to water (either beach or full water edge)
                    if ((t1 && t1.type === TILE_TYPES.WATER) || (t2 && t2.type === TILE_TYPES.WATER)) {
                        validTargets.add(adjEdgeKey);
                    }
                }
            });

            return Array.from(validTargets);
        }

        // Walks a getAttackRangeCells() result and collects the actual targets sitting in
        // it. Shared by the melee and archer target-getters - the only difference between
        // them is the range calculation, which getAttackRangeCells() already handles.
        function collectTargetsFromAttackRange(attackingUnit, rangeCells) {
            const targets = [];

            const addUnitTarget = (targetUnit, edgeKey = null, tileKeyForTarget = null) => {
                if (!targets.some(t => t.unit && t.unit.id === targetUnit.id)) targets.push({ unit: targetUnit, edgeKey, tileKeyForTarget, isBridgeTarget: false });
            };
            const addBridgeTarget = (edgeKey) => {
                if (!targets.some(t => t.isBridgeTarget && t.edgeKey === edgeKey)) targets.push({ unit: null, edgeKey, tileKeyForTarget: null, isBridgeTarget: true });
            };

            rangeCells.forEach((data) => {
                if (data.type === 'edge') {
                    const edge = engine.state.edges.get(data.key);
                    if (!edge) return;

                    edge.units.forEach(unitOnEdge => {
                        if (unitOnEdge.player !== attackingUnit.player && unitOnEdge.positionType === 'edge') {
                            addUnitTarget(unitOnEdge, data.key);
                        }
                    });

                    if (edge.bridge && edge.bridgeHp > 0) addBridgeTarget(data.key);
                } else if (data.type === 'tile') {
                    const tile = engine.state.tiles.get(data.key);
                    if (!tile || !tile.fortifiedByPlayer || tile.fortifiedByPlayer === attackingUnit.player) return;

                    const fortifiedUnit = engine.state.units.find(u => u.tileKey === data.key && u.player === tile.fortifiedByPlayer);
                    if (fortifiedUnit) addUnitTarget(fortifiedUnit, null, data.key);
                }
            });

            return targets;
        }

        function getValidMeleeAttackTargets(attackingUnit) {
            if (!attackingUnit || attackingUnit.currentMove < ATTACK_COST || attackingUnit.hasPerformedMajorAction) return [];
            // Swordsman only. Without this, an Archer would get its full ranged result back
            // from here as well as from getValidArcherAttackTargets, double-counting every
            // archer target for any caller that unions the two.
            if (attackingUnit.type.attackType !== 'melee') return [];

            return collectTargetsFromAttackRange(attackingUnit, getAttackRangeCells(attackingUnit));
        }

        function getValidArcherAttackTargets(attackingUnit) {
            if (!attackingUnit || attackingUnit.currentMove < ATTACK_COST || attackingUnit.hasPerformedMajorAction || attackingUnit.type.name !== 'Archer') {
                return [];
            }

            return collectTargetsFromAttackRange(attackingUnit, getAttackRangeCells(attackingUnit));
        }

        // excludeUnitId: a unit that should not count toward suppression. Used for
        // the unit currently ARRIVING on an adjacent edge - it takes the zone's
        // damage on arrival and only starts suppressing once it has been there
        // for the turn. Without this exclusion an arriving unit suppresses the
        // very zone that should be hitting it, and whether that happened
        // depended on whether the player dragged or clicked (the drag filter
        // hid the mover from edge.units, which silently produced the correct
        // answer for the wrong reason).
        function isZoCSuppressed(fortifiedUnit, excludeUnitId = null) {
            if (!fortifiedUnit || !fortifiedUnit.isFortified) return false;
    
            const tileKey = fortifiedUnit.tileKey;
            const tile = engine.state.tiles.get(tileKey);
            if (!tile) return false;

            const fortPlayer = fortifiedUnit.player;
            let totalEnemyCount = 0;
            let occupiedEdgesCount = 0;

            const neighbors = getNeighbors(tile.q, tile.r);
            for (const n of neighbors) {
                const edgeKey = getEdgeKey(tile.q, tile.r, n.q, n.r);
                const edge = engine.state.edges.get(edgeKey);
        
                if (edge && edge.units.length > 0) {
                    // Count enemies on this specific edge
                    const enemiesOnEdge = edge.units.filter(u => u.player !== fortPlayer && u.id !== excludeUnitId).length;
            
                    if (enemiesOnEdge > 0) {
                        totalEnemyCount += enemiesOnEdge;
                        occupiedEdgesCount++; // Mark this edge as "Active Front"
                    }
                }
            }

            // Rule: Suppression requires at least 2 enemies coming from at least 2 different directions.
            // (e.g. 2 units on 1 edge = No Suppression)
            // (e.g. 1 unit on Edge A, 1 unit on Edge B = Suppression)
            return totalEnemyCount >= 2 && occupiedEdgesCount >= 2;
        }

function computePlayerVision(player) {
    const visibleTiles = new Set();
    const visibleEdges = new Set();
    const visibleRim = new Set();

    // 1. Add Base Camp Visibility (Force fully visible)
    const baseData = engine.state.baseCampPositions[`player${player}`];
    let baseTiles = [];
    if (Array.isArray(baseData)) {
        baseTiles = baseData;
    } else if (typeof baseData === 'string') {
        const [h1, h2] = parseEdgeKey(baseData);
        if (!isNaN(h1.q)) baseTiles.push(getTileKey(h1.q, h1.r));
        if (!isNaN(h2.q)) baseTiles.push(getTileKey(h2.q, h2.r));
    }

    // The tile is visible. Its surrounding hexPaths are NOT force-added here any
    // more - getBaseVisibility below computes them properly from the base's outer
    // edges, and it checks engine.state.edges.has() before adding anything.
    //
    // What was here forced all six geometric edges of every base tile visible "to
    // clear boundary fog". It predates the fine grid having cells for borders at
    // all, and it did so by SPELLING edge keys rather than looking them up, so at
    // the board rim it invented keys for edges that do not exist. Measured before
    // removal, across five boards and both players: it contributed 4 to 7 such
    // phantom keys per player and NOT ONE real edge. Nothing loses visibility.
    baseTiles.forEach(tileKey => {
        visibleTiles.add(tileKey);
    });

    const baseVis = getBaseVisibility(player);
    baseVis.tiles.forEach(t => visibleTiles.add(t));
    baseVis.edges.forEach(e => visibleEdges.add(e));
    baseVis.rim.forEach(k => visibleRim.add(k));

    // 2. Add Unit Visibility
    engine.state.units.forEach(unit => {
        if (unit.player === player) {
            if (unit.positionType === 'center') {
                // A fortified unit sees its own tile. The hexPaths around it come
                // from getVisibleKeysFromUnit below, which walks the fine grid
                // from this unit's cell and respects what blocks sight - so a
                // path behind a forest correctly stays dark instead of being
                // cleared because the unit happened to be standing next to it.
                // Same phantom-key removal as the base camp block above; measured
                // with units actually fortified, no real edge or tile is lost.
                visibleTiles.add(unit.tileKey);
            } else if (unit.positionType === 'edge') {
                visibleEdges.add(unit.edgeKey);
                const [h1, h2] = parseEdgeKey(unit.edgeKey);
                if (!isNaN(h1.q)) visibleTiles.add(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) visibleTiles.add(getTileKey(h2.q, h2.r));
            }

            const vis = getVisibleKeysFromUnit(unit);
            vis.tiles.forEach(t => visibleTiles.add(t));
            vis.edges.forEach(e => visibleEdges.add(e));
            vis.rim.forEach(k => visibleRim.add(k));
        }
    });

    return { tiles: visibleTiles, edges: visibleEdges, rim: visibleRim };
}
