// === Map Generation (PURE, moved from map.js — A1 step 9) ===
//
// The generation/placement half of the old js/map.js. Everything here is
// engine-owned: it reads and writes engine.state and never touches the DOM,
// the canvas, or gameState. The editor UI that used to live alongside it is
// now js/client/map-maker.js.
//
// Three of these were MIXED rather than PURE and got the usual split
// (pure half here, thin same-named wrapper in js/client/map-maker.js):
//
//   PerformFloodFill          - dropped showInstruction/autoSaveMap/needsRedraw,
//                               and takes the brush's replacement type as an
//                               argument instead of reading gameState.mapMakerBrush.
//   UpdateBaseCampLocations   - dropped gameState.needsRedraw.
//   SetGridMode /             - the state-setup half of resizeMapGrid, split in
//   InitializeGridDimensions    two because the original interleaved a DOM
//                               control rebuild between setting the radius and
//                               building the grid (see those functions' notes).

function GenerateImprovedMap(radius) {
    const tempTiles = new Map();
    const allHexCoords = [];
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            if (Math.abs(q + r) <= radius) {
                allHexCoords.push({ q, r });
            }
        }
    }

    // Helper for radius checking within this scope
    const checkRadius = (key) => {
        const [q, r] = key.split(',').map(Number);
        return Math.abs(q) <= radius && Math.abs(r) <= radius && Math.abs(q + r) <= radius;
    };

    // --- 1. Define Base Area Keys ---
    const p1BaseQ = -radius;
    const p1BaseR = 1; 
    const p2BaseQ = radius;
    const p2BaseR = -1;

    const p1StartNode = getTileKey(p1BaseQ, p1BaseR);
    const p2EndNode = getTileKey(p2BaseQ, p2BaseR);

    const p1BaseAreaKeys = new Set([p1StartNode]);
    const p2BaseAreaKeys = new Set([p2EndNode]);

    const addNeighborsToSet = (centerQ, centerR, set) => {
        getNeighbors(centerQ, centerR).forEach(n => {
            const key = getTileKey(n.q, n.r);
            if (checkRadius(key)) set.add(key);
        });
    };

    addNeighborsToSet(p1BaseQ, p1BaseR, p1BaseAreaKeys);
    addNeighborsToSet(p2BaseQ, p2BaseR, p2BaseAreaKeys);

    // --- 2. Generate Water Archetype ---
    const archetypes = ['coastline', 'river'];
    const chosenArchetype = archetypes[Math.floor(Math.random() * archetypes.length)];
    console.log(`Generating map (R=${radius}) with archetype: ${chosenArchetype}`);

    if (chosenArchetype === 'coastline') {
        const side = Math.floor(Math.random() * 6);
        const direction = AXIAL_DIRECTIONS[side];
        allHexCoords.forEach(coord => {
            const projection = coord.q * direction.q + coord.r * direction.r;
            if (projection >= radius - 1) {
                tempTiles.set(getTileKey(coord.q, coord.r), TILE_TYPES.WATER);
            }
        });
    } else if (chosenArchetype === 'river') {
        // River logic adapted for dynamic radius
        const edgeCoords = allHexCoords.filter(c => axialDistance(c.q, c.r, 0, 0) === radius);
        let current = edgeCoords[Math.floor(Math.random() * edgeCoords.length)];
        let riverPath = new Set();
        
        for(let i = 0; i < radius * 2.5; i++) {
             const key = getTileKey(current.q, current.r);
             if(riverPath.has(key)) break;
             riverPath.add(key);
             tempTiles.set(key, TILE_TYPES.WATER);

             const neighbors = getNeighbors(current.q, current.r).filter(n => checkRadius(getTileKey(n.q, n.r)));
             if(neighbors.length > 0 && Math.random() > 0.4) {
                 const randomNeighbor = neighbors[Math.floor(Math.random() * neighbors.length)];
                 const neighborKey = getTileKey(randomNeighbor.q, randomNeighbor.r);
                 if(!riverPath.has(neighborKey)) {
                     riverPath.add(neighborKey);
                     tempTiles.set(neighborKey, TILE_TYPES.WATER);
                 }
             }
             
             let bestNeighbor = null;
             let maxDist = -Infinity;
             for(const n of neighbors) {
                 const dist = -1 * (n.q * current.q + n.r * current.r);
                 if (dist > maxDist) { maxDist = dist; bestNeighbor = n; }
             }
             if (bestNeighbor) current = bestNeighbor; else break;
        }
    }

    // --- 3. Generate Mountains ---
    allHexCoords.forEach(coord => {
        const key = getTileKey(coord.q, coord.r);
        if (!tempTiles.has(key) && Math.random() < 0.18) {
            tempTiles.set(key, TILE_TYPES.MOUNTAIN);
        }
    });

    // --- 4. Guarantee Two Paths ---
    // Pass 'radius' to FindAndCarvePath so it knows bounds
    FindAndCarvePath(p1StartNode, p2EndNode, tempTiles, [], radius);
    // Try for a second path
    const firstPath = FindAndCarvePath(p1StartNode, p2EndNode, tempTiles, [], radius); 
    if (firstPath) {
        FindAndCarvePath(p1StartNode, p2EndNode, tempTiles, firstPath, radius);
    }

    // --- 5. Fill Remaining ---
    allHexCoords.forEach(coord => {
        const key = getTileKey(coord.q, coord.r);
        if (!tempTiles.has(key)) {
            tempTiles.set(key, Math.random() < 0.45 ? TILE_TYPES.FOREST : TILE_TYPES.PLAINS);
        }
    });

    // --- 6. Force Base Areas ---
    p1BaseAreaKeys.forEach(key => tempTiles.set(key, TILE_TYPES.PLAINS));
    p2BaseAreaKeys.forEach(key => tempTiles.set(key, TILE_TYPES.PLAINS));

    return tempTiles;
}

function FindAndCarvePath(startKey, endKey, tiles, excludedKeys = [], radius) {
    let openSet = [startKey];
    const cameFrom = new Map();
    const gScore = new Map(); gScore.set(startKey, 0);
    const fScore = new Map();
    const [sq, sr] = startKey.split(',').map(Number);
    const [eq, er] = endKey.split(',').map(Number);
    fScore.set(startKey, axialDistance(sq, sr, eq, er));
    const excludedSet = new Set(excludedKeys);

    const checkRadius = (key) => {
        const [q, r] = key.split(',').map(Number);
        return Math.abs(q) <= radius && Math.abs(r) <= radius && Math.abs(q + r) <= radius;
    };

    while (openSet.length > 0) {
        let currentKey = openSet.sort((a, b) => (fScore.get(a) || Infinity) - (fScore.get(b) || Infinity))[0];
        if (currentKey === endKey) return ReconstructPath(cameFrom, currentKey);

        openSet = openSet.filter(key => key !== currentKey);
        const [cq, cr] = currentKey.split(',').map(Number);
        const neighbors = getNeighbors(cq, cr).map(n => getTileKey(n.q, n.r));

        for (const neighborKey of neighbors) {
            if (!checkRadius(neighborKey)) continue; // Check bounds
            const tile = tiles.get(neighborKey);
            // Treat undefined tiles as passable (will be filled later)
            const isPassable = tile !== TILE_TYPES.WATER && tile !== TILE_TYPES.MOUNTAIN;
            if (excludedSet.has(neighborKey)) continue;

            if (isPassable || !tile) {
                const tentative_gScore = (gScore.get(currentKey) || Infinity) + 1;
                if (tentative_gScore < (gScore.get(neighborKey) || Infinity)) {
                    cameFrom.set(neighborKey, currentKey);
                    gScore.set(neighborKey, tentative_gScore);
                    const [nq, nr] = neighborKey.split(',').map(Number);
                    fScore.set(neighborKey, tentative_gScore + axialDistance(nq, nr, eq, er));
                    if (!openSet.includes(neighborKey)) openSet.push(neighborKey);
                }
            }
        }
    }

    // Carve logic
    console.log("Carving path...");
    let carvePath = [startKey];
    let currentCarveKey = startKey;
    for (let i = 0; i < 100; i++) {
        if (currentCarveKey === endKey) break;
        const [ccq, ccr] = currentCarveKey.split(',').map(Number);
        const neighbors = getNeighbors(ccq, ccr)
                            .map(n => ({ key: getTileKey(n.q, n.r), q: n.q, r: n.r }))
                            .filter(n => checkRadius(n.key));
        
        let nextStep = neighbors.sort((a,b) => axialDistance(a.q, a.r, eq, er) - axialDistance(b.q, b.r, eq, er))[0];
        if (!nextStep) return null;
        
        if (tiles.get(nextStep.key) === TILE_TYPES.WATER || tiles.get(nextStep.key) === TILE_TYPES.MOUNTAIN) {
            tiles.set(nextStep.key, TILE_TYPES.PLAINS);
        }
        currentCarveKey = nextStep.key;
        carvePath.push(currentCarveKey);
    }
    return carvePath;
}

function ReconstructPath(cameFrom, currentKey) {
    const totalPath = [currentKey];
    while (cameFrom.has(currentKey)) {
        currentKey = cameFrom.get(currentKey);
        totalPath.unshift(currentKey);
    }
    return totalPath;
}

function PlaceUnitsOnNewGeneratedMap(unitLimit = getMaxUnitsForCurrentMap()) {
    const landEdges = [];
    engine.state.edges.forEach((edgeData, edgeKey) => {
        // Use the new, more accurate isRoad() definition
        if (isRoad(edgeKey)) {
            landEdges.push(edgeKey);
        }
    });

    // Read each player's actual home side from their real base camp tiles rather
    // than assuming P1=left/P2=right, which breaks for maps whose base camps were
    // set up on the opposite/rotated hemisphere.
    const getPlayerHomeQ = (player) => {
        const tiles = GetBaseCamp(player);
        if (tiles.length === 0) return null;
        const sumQ = tiles.reduce((sum, key) => sum + Number(key.split(',')[0]), 0);
        return sumQ / tiles.length;
    };
    const p1HomeQ = getPlayerHomeQ(1);
    const p2HomeQ = getPlayerHomeQ(2);
    const useDynamicHemisphere = p1HomeQ !== null && p2HomeQ !== null && p1HomeQ !== p2HomeQ;
    const p1IsLeft = useDynamicHemisphere ? (p1HomeQ < p2HomeQ) : true;

    if (landEdges.length < unitLimit * 2) {
        console.error(`CRITICAL: Not enough land edges (${landEdges.length}). Placing randomly.`);
        landEdges.sort(() => 0.5 - Math.random());
        const usedEdgesFallback = new Set();
        const allUnitTypes = [UNIT_TYPES.MELEE, UNIT_TYPES.ARCHER, UNIT_TYPES.PIKEMAN, UNIT_TYPES.HORSEMAN];

        const placeFallbackTeam = (player) => {
            // Place up to unitLimit
            for (let i = 0; i < unitLimit; i++) {
                let placed = false;
                // Cycle through unit types if limit > 4, or just pick first few
                const typeToPlace = allUnitTypes[i % allUnitTypes.length];
                
                for (const edgeKey of landEdges) {
                    if (!usedEdgesFallback.has(edgeKey)) {
                        engine.state.units.push(createUnit(player, typeToPlace, edgeKey));
                        usedEdgesFallback.add(edgeKey);
                        placed = true;
                        break;
                    }
                }
                if (!placed) console.error(`Could not place P${player} ${typeToPlace.name}`);
            }
        };
        placeFallbackTeam(1);
        placeFallbackTeam(2);
    } else {
        const p1CandidateEdges = [];
        const p2CandidateEdges = [];
        const hemisphereThresholdQ = 0;
        landEdges.forEach(edgeKey => {
            const coords = parseEdgeKey(edgeKey);
            const avgQ = (coords[0].q + coords[1].q) / 2;
            const belongsToP1 = useDynamicHemisphere
                ? (p1IsLeft ? avgQ < hemisphereThresholdQ : avgQ >= hemisphereThresholdQ)
                : avgQ < hemisphereThresholdQ;
            if (belongsToP1) {
                p1CandidateEdges.push({ key: edgeKey, q: avgQ });
            } else {
                p2CandidateEdges.push({ key: edgeKey, q: avgQ });
            }
        });

        p1CandidateEdges.sort((a, b) => p1IsLeft ? a.q - b.q : b.q - a.q);
        p2CandidateEdges.sort((a, b) => p1IsLeft ? b.q - a.q : a.q - b.q);

        const usedEdges = new Set();
        const allUnitTypes = [UNIT_TYPES.MELEE, UNIT_TYPES.ARCHER, UNIT_TYPES.PIKEMAN, UNIT_TYPES.HORSEMAN];

        const placeTeam = (playerNum, candidates) => {
            let placedCount = 0;
            for (const cand of candidates) {
                if (placedCount >= unitLimit) break;
                if (!usedEdges.has(cand.key)) {
                    // Cycle types based on placement index
                    const typeToPlace = allUnitTypes[placedCount % allUnitTypes.length];
                    engine.state.units.push(createUnit(playerNum, typeToPlace, cand.key));
                    usedEdges.add(cand.key);
                    placedCount++;
                }
            }
            while (placedCount < unitLimit) {
                const fallbackEdge = landEdges.find(e => !usedEdges.has(e));
                if(fallbackEdge) {
                     const typeToPlace = allUnitTypes[placedCount % allUnitTypes.length];
                     engine.state.units.push(createUnit(playerNum, typeToPlace, fallbackEdge));
                     usedEdges.add(fallbackEdge);
                     placedCount++;
                } else {
                    console.error(`Ran out of all possible land edges placing for P${playerNum}`);
                    break;
                }
            }
        };

        placeTeam(1, p1CandidateEdges);
        placeTeam(2, p2CandidateEdges);
    }
}

function ComputeRotatedBaseCampPositions(radius, sliderValue) {
    const sliderToRotations = [3, 2, 1, 0, -1, -2];
    const rotations = sliderToRotations[parseInt(sliderValue, 10)];
    const defaults = BASE_CAMP_DEFAULTS[radius];
    if (!defaults) return null;

    const rotateTiles = (tileKeys) => tileKeys.map(key => {
        const [q, r] = key.split(',').map(Number);
        const rotated = rotateAxial(q, r, rotations);
        return getTileKey(rotated.q, rotated.r);
    });

    const p1Tiles = rotateTiles(defaults.player1.tiles);
    const p2Tiles = rotateTiles(defaults.player2.tiles);

    if (radius === 3) {
        const p1c = p1Tiles.map(k => { const [q, r] = k.split(',').map(Number); return { q, r }; });
        const p2c = p2Tiles.map(k => { const [q, r] = k.split(',').map(Number); return { q, r }; });
        return {
            player1: p1c.length >= 2 ? getEdgeKey(p1c[0].q, p1c[0].r, p1c[1].q, p1c[1].r) : null,
            player2: p2c.length >= 2 ? getEdgeKey(p2c[0].q, p2c[0].r, p2c[1].q, p2c[1].r) : null
        };
    }
    return { player1: p1Tiles, player2: p2Tiles };
}

function UpdateBaseCampLocations(sliderValue) {
    const sliderToRotations = [3, 2, 1, 0, -1, -2];
    const rotations = sliderToRotations[parseInt(sliderValue, 10)];
    const currentRadius = engine.state.gridRadius;

    // Safety check
    if (!BASE_CAMP_DEFAULTS[currentRadius]) return false;

    const defaults = BASE_CAMP_DEFAULTS[currentRadius];
    
    // 1. Clear old base camp tiles (Reset to Plains and remove flag)
    const oldP1Tiles = GetBaseCamp(1);
    const oldP2Tiles = GetBaseCamp(2);
    [...oldP1Tiles, ...oldP2Tiles].forEach(key => {
        const tile = engine.state.tiles.get(key);
        if (tile) {
            tile.type = TILE_TYPES.PLAINS;
            tile.isBaseCampTile = false; // Clear the property
        }
    });

    // 2. Calculate new Rotated Tile Keys
    const p1_rotated_tiles = defaults.player1.tiles.map(key => {
        const [q, r] = key.split(',').map(Number);
        const rotated = rotateAxial(q, r, rotations);
        return getTileKey(rotated.q, rotated.r);
    });
    
    const p2_rotated_tiles = defaults.player2.tiles.map(key => {
        const [q, r] = key.split(',').map(Number);
        const rotated = rotateAxial(q, r, rotations);
        return getTileKey(rotated.q, rotated.r);
    });

    // 3. Determine the Flag Edge (Only for Standard Size R=3)
    let newP1EdgeKey = null;
    let newP2EdgeKey = null;
    
    if (currentRadius === 3) {
        const p1_coords = p1_rotated_tiles.map(k => {
            const [q, r] = k.split(',').map(Number);
            return { q, r };
        });
        const p2_coords = p2_rotated_tiles.map(k => {
            const [q, r] = k.split(',').map(Number);
            return { q, r };
        });

        if (p1_coords.length >= 2) {
            newP1EdgeKey = getEdgeKey(p1_coords[0].q, p1_coords[0].r, p1_coords[1].q, p1_coords[1].r);
        }
        if (p2_coords.length >= 2) {
            newP2EdgeKey = getEdgeKey(p2_coords[0].q, p2_coords[0].r, p2_coords[1].q, p2_coords[1].r);
        }
    }

    // 4. Update Game State
    engine.state.baseCampPositions.player1 = newP1EdgeKey;
    engine.state.baseCampPositions.player2 = newP2EdgeKey;
    
    if (engine.state.flags) {
        if (engine.state.flags.p1_flag) engine.state.flags.p1_flag.homePosition = newP1EdgeKey;
        if (engine.state.flags.p2_flag) engine.state.flags.p2_flag.homePosition = newP2EdgeKey;
    }

    // 5. Set new base camp tiles to Plains and apply the Lock Flag
    [...p1_rotated_tiles, ...p2_rotated_tiles].forEach(key => {
        const tile = engine.state.tiles.get(key);
        if (tile) {
            tile.type = TILE_TYPES.PLAINS;
            tile.isBaseCampTile = true; // Set the property
        }
    });

    return true;
}

// Pure half of the map maker's flood fill. The brush type comes in as an
// argument rather than being read off gameState.mapMakerBrush, and the
// "why nothing happened" cases come back as a reason code for the client
// wrapper to turn into an on-screen message.
function PerformFloodFill(startQ, startR, replacementType) {
    const startKey = getTileKey(startQ, startR);
    const startTile = engine.state.tiles.get(startKey);
    if (!startTile) return { filled: false, reason: 'no_tile' };

    // Prevent starting a fill ON a base camp tile
    if (startTile.isBaseCampTile) return { filled: false, reason: 'base_camp' };

    const targetType = startTile.type;
    if (targetType === replacementType) return { filled: false, reason: 'same_type' };

    const queue = [startKey];
    const visited = new Set([startKey]);

    while (queue.length > 0) {
        const currentKey = queue.shift();
        const currentTile = engine.state.tiles.get(currentKey);

        // Prevent the fill from SPREADING to a base camp tile
        if (currentTile.isBaseCampTile) {
            continue; // Skip this tile and move to the next in the queue
        }

        currentTile.type = replacementType;

        const { q, r } = currentTile;
        const neighbors = getNeighbors(q, r);

        for (const neighborCoord of neighbors) {
            const neighborKey = getTileKey(neighborCoord.q, neighborCoord.r);
            const neighborTile = engine.state.tiles.get(neighborKey);

            if (neighborTile && !visited.has(neighborKey) && neighborTile.type === targetType) {
                visited.add(neighborKey);
                queue.push(neighborKey);
            }
        }
    }

    return { filled: true, reason: 'ok' };
}

// First half of the old resizeMapGrid's state setup: which radius we're on and
// what that implies about game mode and flags. Kept separate from
// InitializeGridDimensions because the original rebuilt the map maker's
// controls in between the two - and that rebuild both reads the new radius and
// resets the base camp slider whose value the grid build then consumes.
function SetGridMode(newRadius) {
    engine.state.gridRadius = newRadius;

    if (newRadius === 2) {
        engine.state.gameMode = 'arcade';
        engine.state.baseCampPositions = { player1: null, player2: null };
        engine.state.flags = null; // Explicitly clear flags for Arcade
    } else {
        engine.state.gameMode = 'local';

        // Re-initialize the flags object if it's missing (e.g. coming from Arcade)
        if (!engine.state.flags) {
            engine.state.flags = {
                'p1_flag': { id: 'p1_flag', player: 1, homePosition: null, status: 'at_base', carrierId: null },
                'p2_flag': { id: 'p2_flag', player: 2, homePosition: null, status: 'at_base', carrierId: null }
            };
        }
    }
}

// Second half of the old resizeMapGrid's state setup: wipe the board and build
// a fresh all-plains grid of the given radius, then place base camps.
// baseCampRotation is the map maker's slider position, read by the caller.
function InitializeGridDimensions(newRadius, baseCampRotation = '3') {
    engine.state.units = [];
    engine.state.tiles.clear();
    engine.state.edges.clear();

    for (let q = -newRadius; q <= newRadius; q++) {
        for (let r = -newRadius; r <= newRadius; r++) {
            if (Math.abs(q + r) <= newRadius) {
                const key = getTileKey(q, r);
                engine.state.tiles.set(key, { q, r, type: TILE_TYPES.PLAINS, fortifiedByPlayer: null });
            }
        }
    }

    engine.state.tiles.forEach(tile => {
        getNeighbors(tile.q, tile.r).forEach(n_coord => {
            if (engine.state.tiles.has(getTileKey(n_coord.q, n_coord.r))) {
                const edgeKey = getEdgeKey(tile.q, tile.r, n_coord.q, n_coord.r);
                if (!engine.state.edges.has(edgeKey)) {
                    engine.state.edges.set(edgeKey, {
                        q1: tile.q, r1: tile.r, q2: n_coord.q, r2: n_coord.r,
                        get units() {
                            return engine.state.units.filter(u => u.positionType === 'edge' && u.position === edgeKey && (!engine.unitVisibilityFilter || engine.unitVisibilityFilter(u)));
                        },
                        bridge: false, bridgeHp: null, isPathway: true
                    });
                }
            }
        });
    });

    if (newRadius === 3) {
        UpdateBaseCampLocations(baseCampRotation);
    } else {
        engine.state.baseCampPositions = { player1: null, player2: null };
        if (engine.state.flags) {
            engine.state.flags.p1_flag.homePosition = null;
            engine.state.flags.p2_flag.homePosition = null;
        }
    }

    buildFineGridIndex();
}
