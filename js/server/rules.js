// === Rules (PURE, moved from core.js verbatim — A1 step 5) ===
//
// These still reference the bare global `gameState`/`gameSettings` rather than
// `this.state`/`this.settings`. Per the "relocate only" decision (see chat), the
// this.state rewrite + instance wiring is deferred until the composition root
// actually exists (A1 step 11/12) — converting now would break every existing
// caller in render.js/ai.js/map.js/ui.js/core.js/main.js, since nothing routes
// through a live engine instance yet.
//
// spawnUnit and recalculatePlayerSupplyNetwork keep their logAction()/
// updateSupplyPointsDisplay() UI calls for the same reason — the guide's step 5
// asks for those to be stripped in favor of emitted events, but that's really
// the MIXED-function event-emission pattern (step 7), and applying it here
// alone would silently drop log messages/UI updates with nothing yet consuming
// the events. Deferred, not forgotten.
//
// A few functions here (getTileKeysOfEdge, getSideTileKeys,
// hasCombinedArmsSupport, collectTargetsFromAttackRange, GetBaseCamp,
// isInternalBaseEdge, isEdgeAdjacentToSpearWall) aren't in the guide's explicit
// §4 list, but are pure rules-helpers depended on by functions that are —
//
// GetBaseCamp was originally two near-duplicate functions (getBaseTileKeys +
// getBaseCampTiles) doing the same array-or-edge-string normalization under
// different names/signatures — merged into one per user request.
// moved alongside them rather than left behind.

 // === Fine Grid System ===

function buildFineGridIndex() {
    engine.state.fineGrid = new Map();
    
    // Tiles map to (2q, 2r)
    engine.state.tiles.forEach(tile => {
        const fq = 2 * tile.q;
        const fr = 2 * tile.r;
        const tileKey = getTileKey(tile.q, tile.r);
        engine.state.fineGrid.set(`${fq},${fr}`, { type: 'tile', key: tileKey });
    });

    // Edges map to (q1+q2, r1+r2)
    engine.state.edges.forEach((edge, edgeKey) => {
        const fq = edge.q1 + edge.q2;
        const fr = edge.r1 + edge.r2;
        engine.state.fineGrid.set(`${fq},${fr}`, { type: 'edge', key: edgeKey });
    });
}

function getFineCoordForTile(tileKey) {
    const [q, r] = tileKey.split(',').map(Number);
    return { fq: 2 * q, fr: 2 * r };
}

function getFineCoordForEdge(edgeKey) {
    const [h1, h2] = parseEdgeKey(edgeKey);
    return { fq: h1.q + h2.q, fr: h1.r + h2.r };
}

function getFineCoordForUnit(unit) {
    if (unit.positionType === 'center') {
        return getFineCoordForTile(unit.position);
    } else {
        return getFineCoordForEdge(unit.position);
    }
}

function fineDistance(a, b) {
    return axialDistance(a.fq, a.fr, b.fq, b.fr);
}

function getFineNeighbors(fq, fr) {
    return AXIAL_DIRECTIONS.map(dir => ({ fq: fq + dir.q, fr: fr + dir.r }));
}

function resolveFineCoord(fq, fr) {
    return engine.state.fineGrid.get(`${fq},${fr}`) || null;
}

function fineRangeQuery(startFine, maxRange, options = {}) {
    const visited = new Map();
    const startKeyStr = `${startFine.fq},${startFine.fr}`;
    const startEntity = resolveFineCoord(startFine.fq, startFine.fr);

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

        // Stop expanding if we've reached max range
        if (distance >= maxRange) {
            continue;
        }

        const nextDistance = distance + 1;
        const neighbors = getFineNeighbors(coord.fq, coord.fr);

        for (const neighbor of neighbors) {
            const neighborKeyStr = `${neighbor.fq},${neighbor.fr}`;

            if (!visited.has(neighborKeyStr)) {
                const neighborEntity = resolveFineCoord(neighbor.fq, neighbor.fr);
                
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
    if (!unit) return { edges: new Set(), tiles: new Set() };

    // An archer fortified on a mountain peak sees 3 instead of 2, and is high enough
    // that forests no longer block it. Other mountains still do.
    const onMountainPeak = isUnitOnMountainPeak(unit);
    const VISIBILITY_RANGE = onMountainPeak ? 3 : 2;
    const startCoord = getFineCoordForUnit(unit);

    // A fortified unit occupies its tile, so that tile's own terrain never blocks it —
    // it still gets the full flower and can see out of the forest/mountain it sits in.
    // Any OTHER forest or mountain tile still blocks normally.
    const occupiedTileKey = (unit.positionType === 'center') ? unit.position : null;

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
    // is itself visible, but nothing beyond it is — sight stops there. The unit's own
    // subHex never blocks.
    const blocksSight = (entity) => {
        if (entity.type === 'tile') {
            return isForestTile(entity.key) || isMountainTile(entity.key);
        }
        return getTileKeysOfEdge(entity.key).some(k => isForestTile(k) || isMountainTile(k));
    };

    const blocksBeyond = (entity, distance) => distance > 0 && blocksSight(entity);

    const rangeResult = fineRangeQuery(startCoord, VISIBILITY_RANGE, { blocksBeyond });

    const visibleEdges = new Set();
    const visibleTiles = new Set();

    rangeResult.forEach((data) => {
        if (data.type === 'edge') {
            visibleEdges.add(data.key);
        } else if (data.type === 'tile') {
            visibleTiles.add(data.key);
        }
    });

    // MOUNTAIN RULE 1: a mountain's peak (its centre subHex) is always visible so long
    // as it is within visibility range — it stands above whatever else is in the way,
    // so blockers along the path don't hide it.
    engine.state.tiles.forEach((tile, tileKey) => {
        if (tile.type.name !== 'Mountain') return;
        if (fineDistance(startCoord, getFineCoordForTile(tileKey)) <= VISIBILITY_RANGE) {
            visibleTiles.add(tileKey);
        }
    });

    // MOUNTAIN RULE 2: standing on a mountain tile's edge, that same mountain's other
    // edges rotationally adjacent to the unit (fine-distance 1) cannot be seen —
    // the peak between them is in the way.
    if (unit.positionType === 'edge') {
        const ownMountainKeys = getTileKeysOfEdge(unit.position).filter(isMountainTile);

        if (ownMountainKeys.length > 0) {
            [...visibleEdges].forEach(edgeKey => {
                if (edgeKey === unit.position) return;
                if (fineDistance(startCoord, getFineCoordForEdge(edgeKey)) !== 1) return;
                if (getTileKeysOfEdge(edgeKey).some(k => ownMountainKeys.includes(k))) {
                    visibleEdges.delete(edgeKey);
                }
            });
        }
    }

    return { edges: visibleEdges, tiles: visibleTiles };
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
    return getTileKeysOfEdge(unit.position);
}

// Does this unit share its edge with a friendly melee unit? (combined arms spotter)
function hasCombinedArmsSupport(unit) {
    if (!unit || unit.positionType !== 'edge') return false;
    const myEdge = engine.state.edges.get(unit.position);
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

    // MODIFIER 2 — low-visibility fortified restriction: an archer fortified somewhere
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
        const sourceTile = engine.state.tiles.get(unit.position);
        if (sourceTile && getTileVisibility(sourceTile) <= 1) {
            maxRange = 1;
            isLowVisFortifiedArcher = true;
        }
    }

    // MODIFIER 1 — mountains stop arrows the same way they stop sight. Melee has no
    // LOS blocking at range 1, so it runs unblocked. An archer's own peak never blocks
    // its own shots.
    const blocksBeyond = !isArcher ? null : (entity, distance) => {
        if (distance === 0 || entity.type !== 'tile') return false;
        if (entity.key === unit.position) return false;
        const tile = engine.state.tiles.get(entity.key);
        return !!(tile && getTileVisibility(tile) === 0);
    };

    // MODIFIER 3 — combined arms: a friendly melee unit sharing the edge spots for the
    // archer, relaxing the fortified-tile visibility threshold from 2 to 1 on the
    // archer's own side tiles.
    const hasCombinedArms = isArcher && hasCombinedArmsSupport(unit);

    const rangeResult = fineRangeQuery(startCoord, maxRange, blocksBeyond ? { blocksBeyond } : {});

    rangeResult.forEach((data, fineKey) => {
        if (data.distance === 0) return;

        if (data.type === 'edge') {
            if (!vis.edges.has(data.key)) return;

            // MODIFIER 4 — edge-position range restriction: an archer standing on an
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
                // Melee: fortified enemies can only be hit from an edge, not from
                // another fortified position — and a mountain peak can never be melee'd
                // at all, no matter where the attacker stands.
                if (unit.positionType !== 'edge') return;
                if (isMountainPeak) return;
            }
        }

        cells.set(fineKey, data);
    });

    // BALANCE RULE — an archer fortified in low visibility (a Forest) has its range cut
    // to 1 by MODIFIER 2, but can still target the centre of every adjacent PLAINS tile,
    // even though those sit at fine-distance 2.
    if (isLowVisFortifiedArcher) {
        const [q, r] = unit.position.split(',').map(Number);

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
                    const fortifiedUnit = engine.state.units.find(u => u.position === tileKey && u.isFortified);
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

            return !(tile1.type === TILE_TYPES.WATER && tile2.type === TILE_TYPES.WATER);
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

            if (tile1.type === TILE_TYPES.WATER && tile2.type === TILE_TYPES.WATER) {
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

        // baseCampPositions[playerN] is either an array of tile keys or a single edge-key
        // string depending on map radius. Normalise to an array of tile keys — hand-rolled
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
        // terrain — only archers are meant to hold the range-3/vision-3 peak package.
        // Without the type check, an arcade class-swap that morphs a fortified peak
        // archer into another class would keep granting it archer-tier vision.
        function isUnitOnMountainPeak(unit) {
            if (!unit || !unit.type || unit.type.name !== 'Archer' || unit.positionType !== 'center' || !unit.isFortified) return false;
            const tile = engine.state.tiles.get(unit.position);
            return !!(tile && tile.type.name === 'Mountain');
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

            // 2. Find Outer Edges (Edges connecting a base tile to a non-base tile)
            const outerEdges = new Set();
            baseTileKeys.forEach(tileKey => {
                const [q, r] = tileKey.split(',').map(Number);
                getNeighbors(q, r).forEach(n => {
                    const nKey = getTileKey(n.q, n.r);
                    if (!baseTileKeys.has(nKey)) {
                        // This neighbor is NOT part of the base, so the edge between them is an "Outer Edge"
                        const edgeKey = getEdgeKey(q, r, n.q, n.r);
                        if (engine.state.edges.has(edgeKey)) {
                            outerEdges.add(edgeKey);
                        }
                    }
                });
            });

            // 3. Aggregate Visibility from all Outer Edges
            outerEdges.forEach(edgeKey => {
                // Create a dummy unit representing a lookout on this edge
                const dummyUnit = { 
                    position: edgeKey, 
                    positionType: 'edge', 
                    isFortified: false,
                    player: player // Needed if we add team-specific logic later
                };
                
                const vis = getVisibleKeysFromUnit(dummyUnit);
                vis.edges.forEach(e => visibleEdges.add(e));
                vis.tiles.forEach(t => visibleTiles.add(t));
            });

            return { edges: visibleEdges, tiles: visibleTiles };
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
            const counts = { Melee: 0, Archer: 0, Pikeman: 0, Horseman: 0 };
            engine.state.units.forEach(unit => {
                if (unit.player === player) {
                    counts[unit.type.name]++;
                }
            });
            return counts;
        }

        function createUnit(player, typeInput, edgeKey, existingId = null) {
            // Robust Type Lookup: Handle String Key or Object
            let typeKey = 'MELEE';
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

            // Fallback values for stats to prevent NaN
            const speedVal = template.speed !== undefined ? template.speed : (template.baseMove || 0);
            const defVal = template.defense !== undefined ? template.defense : (template.fortificationBonus || 0);

            // --- NEW: Deterministic ID Generation ---
            let unitId;
            if (existingId) {
                unitId = existingId;
            } else {
                engine.state.unitIdCounter++;
                // Format: u_p{PLAYER}_{TYPE}_{TURN}_{COUNTER}
                // Example: u_p1_MELEE_t1_1
                unitId = `u_p${player}_${typeKey}_t${engine.state.globalTurnNumber}_${engine.state.unitIdCounter}`;
            }
            // ----------------------------------------
            
            return {
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
                
                positionType: 'edge', 
                position: edgeKey,
                
                isFortified: false, 
                fortifiedTileKey: null, 
                hasPerformedMajorAction: false,
                isCarryingFlag: false,
                
                turnsFortifiedAtBase: 0,
                turnsFortified: 0,
                fortifyCooldown: 0,
                canHeal: true,
                supplyLine: null,
                lastAttackedByHostileOnTurn: 0,
                spearWalled: false,
                ambushed: false,
                
                // VETERANCY
                level: 0,
                upgrades: { health: 0, speed: 0, damage: 0, defense: 0 }
            };
        }

        function spawnUnit(player, unitType) {
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
                potentialSpawnEdges = getRotationallyAdjacentEdges(baseData);
            }

            // Find first valid edge in the potential list
            const spawnEdgeKey = potentialSpawnEdges.find(edgeKey => isEdgeValidForSpawn(edgeKey));

            if (spawnEdgeKey) {
                const newUnit = createUnit(player, unitType, spawnEdgeKey);
                engine.state.units.push(newUnit);
                
                logAction(`P${player} ${unitType.name} has returned to the fight!`, player);
                gameState.visionDirty = true;
                gameState.needsRedraw = true; 
                return true;
            }
            
            logAction(`P${player} Base is blocked! Cannot respawn ${unitType.name}.`, player);
            return false;
        }

        function getMaxUnitsForCurrentMap() {
            return MAP_SIZE_UNIT_LIMITS[engine.state.gridRadius] || 4;
        }

        function getEdgeCost(unit, edgeKey) {
            const edge = engine.state.edges.get(edgeKey);
            if (!edge) return Infinity;

            const tileCoords = parseEdgeKey(edgeKey);
            const tile1 = engine.state.tiles.get(getTileKey(tileCoords[0].q, tileCoords[0].r));
            const tile2 = engine.state.tiles.get(getTileKey(tileCoords[1].q, tileCoords[1].r));
            if (!tile1 || !tile2) return Infinity;

            let baseCost;

            if (edge.bridge) {
        baseCost = 1;
            } else {
                const isT1Water = tile1.type === TILE_TYPES.WATER;
                const isT2Water = tile2.type === TILE_TYPES.WATER;

                if (isT1Water && isT2Water) {
                    return Infinity; 
                } else if (isT1Water || isT2Water) {
                    baseCost = 3; 
                } else {
                    if (tile1.type === TILE_TYPES.MOUNTAIN || tile2.type === TILE_TYPES.MOUNTAIN) {
                        baseCost = TILE_TYPES.MOUNTAIN.baseMoveCost;
                    } else if (tile1.type === TILE_TYPES.FOREST || tile2.type === TILE_TYPES.FOREST) {
                        baseCost = TILE_TYPES.FOREST.baseMoveCost;
                    } else {
                        baseCost = TILE_TYPES.PLAINS.baseMoveCost;
                    }
                }
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
                fortificationPenalty = 1;
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

        function getPossibleMoves(unit) {
            if (gameState.mapMakerMode) {
                return new Map(); 
            }
            if (!unit || unit.currentMove < 1 || unit.isFortified) return new Map();
            if (unit.spearWalled) return new Map(); //Spear Wall Prevents Movement
            if (unit.ambushed) return new Map(); //Ambush Prevents Movement
    
            if (unit.hasPerformedMajorAction) {
                if (!unit.type.canMoveAfterAttack) {
                    return new Map();
                }
                if (isEdgeAdjacentToSpearWall(unit, unit.position)) {
                    return new Map(); 
                }
            }

    const playerBaseData = engine.state.baseCampPositions[`player${unit.player}`];
    
    let reachable = new Map();
    let frontier = [{ edgeKey: unit.position, pathCost: 0, pathTaken: [unit.position] }];
    let minCostsFound = new Map(); minCostsFound.set(unit.position, 0);
    
    while (frontier.length > 0) {
        frontier.sort((a, b) => a.pathCost - b.pathCost); 
        const current = frontier.shift();

        if (current.pathCost > (minCostsFound.get(current.edgeKey) || Infinity)) continue;
        
        const rotationallyAdjacentEdges = getRotationallyAdjacentEdges(current.edgeKey);

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

            if (nextAdjacentEdgeKey === unit.position && current.pathTaken.length === 1) continue;
            const nextAdjacentEdgeObject = engine.state.edges.get(nextAdjacentEdgeKey); 
            if (!nextAdjacentEdgeObject) continue;
            
            let enemyBlocks = false;
            if (nextAdjacentEdgeObject.units.some(u => u.player !== unit.player)) {
                if (engine.settings.fogOfWarEnabled && engine.state.gameMode !== 'arcade' && !gameState.mapMakerMode && gameState.visionCache) {
                    if (gameState.visionCache.edges.has(nextAdjacentEdgeKey)) {
                        enemyBlocks = true;
                    }
                } else {
                    enemyBlocks = true; 
                }
            }
            if (enemyBlocks) continue;
            const friendlyUnitsOnNext = nextAdjacentEdgeObject.units.filter(u => u.player === unit.player);
            if (friendlyUnitsOnNext.length >= 2 && !friendlyUnitsOnNext.find(u => u.id === unit.id)) continue;
            const costToTraverseNextEdge = getEdgeCost(unit, nextAdjacentEdgeKey); if (costToTraverseNextEdge === Infinity) continue;
            const newTotalPathCost = current.pathCost + costToTraverseNextEdge;
            if (newTotalPathCost <= unit.currentMove) {
                const knownMinCost = minCostsFound.get(nextAdjacentEdgeKey) || Infinity;
                if (newTotalPathCost < knownMinCost) {
                    minCostsFound.set(nextAdjacentEdgeKey, newTotalPathCost);
                    const newPathTaken = current.pathTaken.concat(nextAdjacentEdgeKey);
                    frontier.push({ edgeKey: nextAdjacentEdgeKey, pathCost: newTotalPathCost, pathTaken: newPathTaken });
                    if (nextAdjacentEdgeKey !== unit.position) reachable.set(nextAdjacentEdgeKey, { cost: newTotalPathCost, path: newPathTaken });
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

                const adjacentEdges = getRotationallyAdjacentEdges(current.edgeKey);
                for (const neighborEdgeKey of adjacentEdges) {
                    if (!isRoad(neighborEdgeKey)) continue;

                    const costToNeighbor = getEdgeCost({ player }, neighborEdgeKey);
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

            const playerSupplyKey = `player${playerNum}`;
            const maxSupply = 10;

            // Guard clause to prevent supply calculation if flag is stolen
            const playerFlag = engine.state.flags[`p${playerNum}_flag`];
            if (playerFlag && playerFlag.status === 'carried') {
                engine.state.units.forEach(unit => {
                    if (unit.player === playerNum) {
                        unit.supplyLine = null;
                    }
                });
                return; 
            }

            // --- FIX: Get Normalized Base Tiles ---
            const rawBaseData = engine.state.baseCampPositions[playerSupplyKey];
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

            potentialSupplies.sort((a, b) => a.cost - b.cost);

            let allUsedRoads = new Set();
            let networkSupplyCost = 0;
            
            potentialSupplies.forEach(supply => {
                const pathEdges = new Set(supply.pathData.path);
                let incrementalCost = 0;
                pathEdges.forEach(road => {
                    if (!allUsedRoads.has(road)) {
                        incrementalCost += getEdgeCost({ player: playerNum }, road);
                    }
                });

                if (networkSupplyCost + incrementalCost <= maxSupply) {
                    networkSupplyCost += incrementalCost;
                    supply.unit.supplyLine = supply.pathData;
                    pathEdges.forEach(road => allUsedRoads.add(road));
                } else {
                    supply.unit.supplyLine = null;
                }
            });

            engine.state.supplyPoints[playerSupplyKey] = maxSupply - Math.round(networkSupplyCost);
            updateSupplyPointsDisplay();
        }

        function getPotentialUnfortifyTargets(unit) {
            if (!unit || !unit.isFortified || unit.positionType !== 'center') return [];
            const fortifiedTile = engine.state.tiles.get(unit.position); if (!fortifiedTile) return [];
    
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
                    const t1 = unit.position; 
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
            const currentEdge = engine.state.edges.get(unit.position);
            if (currentEdge && !currentEdge.bridge) {
                const [h1, h2] = parseEdgeKey(unit.position);
                const tile1 = engine.state.tiles.get(getTileKey(h1.q, h1.r));
                const tile2 = engine.state.tiles.get(getTileKey(h2.q, h2.r));
                if (tile1 && tile2) {
                    const isBeachEdge = (tile1.type === TILE_TYPES.WATER && tile2.type !== TILE_TYPES.WATER) || 
                                      (tile2.type === TILE_TYPES.WATER && tile1.type !== TILE_TYPES.WATER);
                    if (isBeachEdge) {
                        validTargets.add(unit.position);
                    }
                }
            }

            // 2. Check all ADJACENT edges (original logic)
            const rotationallyAdjacentEdges = getRotationallyAdjacentEdges(unit.position);
            rotationallyAdjacentEdges.forEach(adjEdgeKey => {
                if (adjEdgeKey === unit.position) return;
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
        // it. Shared by the melee and archer target-getters — the only difference between
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

                    const fortifiedUnit = engine.state.units.find(u => u.isFortified && u.position === data.key && u.player === tile.fortifiedByPlayer);
                    if (fortifiedUnit) addUnitTarget(fortifiedUnit, null, data.key);
                }
            });

            return targets;
        }

        function getValidMeleeAttackTargets(attackingUnit) {
            if (!attackingUnit || attackingUnit.currentMove < ATTACK_COST || attackingUnit.hasPerformedMajorAction) return [];
            // Melee only. Without this, an Archer would get its full ranged result back
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

        function isZoCSuppressed(fortifiedUnit) {
            if (!fortifiedUnit || !fortifiedUnit.isFortified) return false;
    
            const tileKey = fortifiedUnit.position;
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
                    const enemiesOnEdge = edge.units.filter(u => u.player !== fortPlayer).length;
            
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

    baseTiles.forEach(tileKey => {
        visibleTiles.add(tileKey);
        const [q, r] = tileKey.split(',').map(Number);
        // Force all 6 geometric edges to be visible to clear boundary fog
        AXIAL_DIRECTIONS.forEach(dir => {
            visibleEdges.add(getEdgeKey(q, r, q + dir.q, r + dir.r));
        });
    });

    const baseVis = getBaseVisibility(player);
    baseVis.tiles.forEach(t => visibleTiles.add(t));
    baseVis.edges.forEach(e => visibleEdges.add(e));

    // 2. Add Unit Visibility
    engine.state.units.forEach(unit => {
        if (unit.player === player) {
            if (unit.positionType === 'center') {
                visibleTiles.add(unit.position);
                const [q, r] = unit.position.split(',').map(Number);
                // Force all 6 geometric edges to be visible to clear boundary fog
                AXIAL_DIRECTIONS.forEach(dir => {
                    visibleEdges.add(getEdgeKey(q, r, q + dir.q, r + dir.r));
                });
            } else if (unit.positionType === 'edge') {
                visibleEdges.add(unit.position);
                const [h1, h2] = parseEdgeKey(unit.position);
                if (!isNaN(h1.q)) visibleTiles.add(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) visibleTiles.add(getTileKey(h2.q, h2.r));
            }

            const vis = getVisibleKeysFromUnit(unit);
            vis.tiles.forEach(t => visibleTiles.add(t));
            vis.edges.forEach(e => visibleEdges.add(e));
        }
    });

    return { tiles: visibleTiles, edges: visibleEdges };
}
