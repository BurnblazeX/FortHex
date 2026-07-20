        // === Math and Grid ===
        
        function axialToPixel(q, r) {
            const rawX = HEX_SIZE * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
            const rawY = HEX_SIZE * (3 / 2 * r);
            const x = (rawX * gameState.renderScale) + gameState.renderOffset.x + canvas.width / 2;
            const y = (rawY * gameState.renderScale) + gameState.renderOffset.y + canvas.height / 2;
            return { x, y };
        }

        function pixelToAxial(x, y) {
            const adjX = (x - canvas.width / 2 - gameState.renderOffset.x) / gameState.renderScale;
            const adjY = (y - canvas.height / 2 - gameState.renderOffset.y) / gameState.renderScale;
            const q_calc = (Math.sqrt(3) / 3 * adjX - 1 / 3 * adjY) / HEX_SIZE;
            const r_calc = (2 / 3 * adjY) / HEX_SIZE;
            return roundAxial({ q: q_calc, r: r_calc });
        }

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

        function getEdgeMidpoint(q1, r1, q2, r2) {
            const p1 = axialToPixel(q1, r1); const p2 = axialToPixel(q2, r2);
            return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        }

        function getNeighbors(q, r) { return AXIAL_DIRECTIONS.map(dir => ({ q: q + dir.q, r: r + dir.r })); }

        function axialDistance(q1, r1, q2, r2) {
            const dq = q1 - q2; const dr = r1 - r2; const ds = (-q1 - r1) - (-q2 - r2);
            return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
        }

        function calculateBaseCentroid(baseTileKeys) {
            if (!Array.isArray(baseTileKeys) || baseTileKeys.length !== 3) return null;

            let sumX = 0, sumY = 0;
            const tiles = baseTileKeys.map(k => {
                const [q, r] = k.split(',').map(Number);
                const pos = axialToPixel(q, r);
                sumX += pos.x;
                sumY += pos.y;
                return { q, r };
            });

            // Check topology: Do they form a tight triangle?
            // A touches B, B touches C, C touches A
            const [t1, t2, t3] = tiles;
            const d12 = axialDistance(t1.q, t1.r, t2.q, t2.r);
            const d23 = axialDistance(t2.q, t2.r, t3.q, t3.r);
            const d31 = axialDistance(t3.q, t3.r, t1.q, t1.r);

            if (d12 === 1 && d23 === 1 && d31 === 1) {
                // Triangle: Use true geometric centroid
                return { x: sumX / 3, y: sumY / 3 };
            } else {
                // Line or 'L': Find the center tile (the one connected to the other two)
                let centerTileIndex = 0;
                if (d12 === 1 && d31 === 1) centerTileIndex = 0;      // 1 connects to 2 and 3
                else if (d12 === 1 && d23 === 1) centerTileIndex = 1; // 2 connects to 1 and 3
                else centerTileIndex = 2;                             // 3 connects to 1 and 2
        
                const [q, r] = baseTileKeys[centerTileIndex].split(',').map(Number);
                return axialToPixel(q, r);
            }
        }

        function getFlagTileKey(playerNum) {
            const baseData = gameState.baseCampPositions[`player${playerNum}`];
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

        function distSq(p1, p2) { return (p1.x - p2.x)**2 + (p1.y - p2.y)**2; }

        function pointDistance(p1, p2) { return Math.sqrt(distSq(p1,p2)); }
        
        function distToSegmentSquared(p, v, w) {
            const l2 = distSq(v, w); if (l2 === 0) return distSq(p, v);
            let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
            return distSq(p, projection);
        }

        function lerp(start, end, amount) {
            return start + (end - start) * amount;
        }

        // === Queries and LoS ===

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
                const tile = gameState.tiles.get(tileKey);
                if (tile && tile.fortifiedByPlayer === enemyPlayer) {
                    const fortifiedUnit = gameState.units.find(u => u.position === tileKey && u.isFortified);
                if (fortifiedUnit && fortifiedUnit.type.name === 'Pikeman') {
                        return true; 
                    }
                }
            }
            return false;
        }

        function isRoad(edgeKey) {
            const edge = gameState.edges.get(edgeKey);
            if (!edge) return false;

            if (edge.bridge) {
                return true;
            }

            const tile1 = gameState.tiles.get(getTileKey(edge.q1, edge.r1));
            const tile2 = gameState.tiles.get(getTileKey(edge.q2, edge.r2));

            if (!tile1 || !tile2) return false;

            return !(tile1.type === TILE_TYPES.WATER && tile2.type === TILE_TYPES.WATER);
        }

        function isEdgePlaceable(edgeKey) {
            const edge = gameState.edges.get(edgeKey);
            if (!edge) return false;

            // Cannot place on a player's home base/flag edge
            if (edgeKey === gameState.baseCampPositions.player1 || edgeKey === gameState.baseCampPositions.player2) {
                return false;
            }

            // cannot place on a water-water edge 
            const tile1 = gameState.tiles.get(getTileKey(edge.q1, edge.r1));
            const tile2 = gameState.tiles.get(getTileKey(edge.q2, edge.r2));
            if (!tile1 || !tile2) return false; // Should not happen on a valid map

            if (tile1.type === TILE_TYPES.WATER && tile2.type === TILE_TYPES.WATER) {
                return false;
            }

            // If no rules failed, the edge is placeable.
            return true;
        }

        function getEdgesOfTile(q, r) {
            const edges = new Set(); 
            getNeighbors(q, r).forEach(neighborCoords => {
                if (gameState.tiles.has(getTileKey(neighborCoords.q, neighborCoords.r))) {
                    edges.add(getEdgeKey(q, r, neighborCoords.q, neighborCoords.r));
                }
            });
            return Array.from(edges);
        }

        function isEdgePartOfTile(tileQ, tileR, edgeKey) {
            if (!edgeKey) return false;
            const [h1, h2] = parseEdgeKey(edgeKey);
            return (h1.q === tileQ && h1.r === tileR) || (h2.q === tileQ && h2.r === tileR);
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

        function getBaseVisibility(player) {
            const visibleEdges = new Set();
            const visibleTiles = new Set();
            
            // 1. Identify Base Tiles
            const baseData = gameState.baseCampPositions[`player${player}`];
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
                        if (gameState.edges.has(edgeKey)) {
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

        function getBaseCampTiles(baseData) {
            let tiles = [];
            if (!baseData) return tiles;

            if (Array.isArray(baseData)) {
                // Expansive Maps (R=4) use an array of tile keys
                tiles = [...baseData];
            } else if (typeof baseData === 'string') {
                // Standard Maps (R=3) use a string representing the Flag's edge
                const [h1, h2] = parseEdgeKey(baseData);
                if (!isNaN(h1.q)) tiles.push(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) tiles.push(getTileKey(h2.q, h2.r));
            }
    
            return tiles;
        }
        
        function isInternalBaseEdge(edgeKey) {
            // Checks if an edge is between two tiles of the SAME base camp
            const [h1, h2] = parseEdgeKey(edgeKey);
            const t1 = getTileKey(h1.q, h1.r);
            const t2 = getTileKey(h2.q, h2.r);

            for (let i = 1; i <= 2; i++) {
                const base = gameState.baseCampPositions[`player${i}`];
                if (Array.isArray(base)) {
                    if (base.includes(t1) && base.includes(t2)) return true;
                }
            }
            return false;
        }

        function findClosestEdgeToPoint(x, y) {
            let closestEdgeKey = null;
            let minDistanceSq = Infinity;

            for (const [edgeKey, edge] of gameState.edges.entries()) {
                const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                const dSq = distSq({x, y}, mid);
                if (dSq < minDistanceSq) {
                    minDistanceSq = dSq;
                    closestEdgeKey = edgeKey;
                }
            }
            return { key: closestEdgeKey, distance: Math.sqrt(minDistanceSq) };
        }

        function getUnitCountsForPlayer(player) {
            const counts = { Melee: 0, Archer: 0, Pikeman: 0, Horseman: 0 };
            gameState.units.forEach(unit => {
                if (unit.player === player) {
                    counts[unit.type.name]++;
                }
            });
            return counts;
        }

        function getUnitScreenPosition(unit) {
            if (!unit) return null;
            let unitX, unitY;

            if (unit.isFortified) {
                const tile = gameState.tiles.get(unit.position);
                if (tile) {
                    const center = axialToPixel(tile.q, tile.r);
                    unitX = center.x;
                    unitY = center.y;
                }
            } else {
                const edge = gameState.edges.get(unit.position);
                if (edge) {
                    const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                    unitX = mid.x;
                    unitY = mid.y;
                    const unitsOnEdge = edge.units.filter(u => u.positionType === 'edge');
                    const unitIndex = unitsOnEdge.findIndex(u => u.id === unit.id);
                    if (unitsOnEdge.length > 1 && unitIndex !== -1) {
                        const offsetSign = (unitIndex % 2 === 0) ? -1 : 1;
                        const p1 = axialToPixel(edge.q1, edge.r1);
                        const p2 = axialToPixel(edge.q2, edge.r2);
                        let dx = p2.x - p1.x, dy = p2.y - p1.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        let perpX = -dy / len, perpY = dx / len;
                        unitX += perpX * UNIT_ON_EDGE_OFFSET * offsetSign * 0.5;
                        unitY += perpY * UNIT_ON_EDGE_OFFSET * offsetSign * 0.5;
                    }
                }
            }
            if (unitX !== undefined) {
                return { x: unitX, y: unitY };
            }
            return null;
        }

        // === Unit and State ===

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
                gameState.unitIdCounter++;
                // Format: u_p{PLAYER}_{TYPE}_{TURN}_{COUNTER}
                // Example: u_p1_MELEE_t1_1
                unitId = `u_p${player}_${typeKey}_t${gameState.globalTurnNumber}_${gameState.unitIdCounter}`;
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
                
                // VETERANCY
                level: 0,
                upgrades: { health: 0, speed: 0, damage: 0, defense: 0 }
            };
        }

        function spawnUnit(player, unitType) {
            const baseData = gameState.baseCampPositions[`player${player}`];
            let potentialSpawnEdges = [];

            // Helper to check validity
            const isEdgeValidForSpawn = (edgeKey) => {
                const edge = gameState.edges.get(edgeKey);
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
                gameState.units.push(newUnit);
                const edge = gameState.edges.get(spawnEdgeKey);
                logAction(`P${player} ${unitType.name} has returned to the fight!`, player);
                return true;
            }
            
            if (gameState.unitCounts) {
                    gameState.unitCounts[`player${player}`][unitType.name]++;
                }

            logAction(`P${player} Base is blocked! Cannot respawn ${unitType.name}.`, player);
            return false;
        }

        function handleUnitDeath(unitToDie, reason = "destroyed") {
            const unitExists = gameState.units.some(u => u.id === unitToDie.id);
            if (!unitExists) {
                return;
            }

            destroyUnit(unitToDie, reason);
        }

        function destroyUnit(unitToDestroy, reason = "destroyed") {
            const activePlayer = gameState.currentPlayer;
            const destroyedPlayer = unitToDestroy.player;
            const wasFortified = unitToDestroy.isFortified;

            gameState.unitCounts[`player${destroyedPlayer}`][unitToDestroy.type.name]--;

            if (unitToDestroy.isCarryingFlag) {
                const flag = Object.values(gameState.flags).find(f => f.carrierId === unitToDestroy.id);
                if (flag) {
                    flag.status = 'at_base';
                    flag.carrierId = null;
                    unitToDestroy.isCarryingFlag = false;
                    logAction(`The P${flag.player} flag has been returned to base!`, activePlayer);

                    updateSupplyPointsBasedOnFlagStatus(flag.player); 
                    recalculatePlayerSupplyNetwork(flag.player);      
                }
            }
            
            if (gameState.gameMode !== 'arcade') {
                const queueKey = `player${destroyedPlayer}`;
                gameState.respawnQueue[queueKey].push({
                    unitType: unitToDestroy.type,
                    turnsRemaining: RESPAWN_TURN_TIMER,
                    timerHalved: false
                });
                updateRespawnQueueDisplay();
            }

            // --- CENTRALIZED DEATH LOGGING ---
            if (reason === "bridge_collapse") {
                logAction(`P${destroyedPlayer} ${unitToDestroy.type.name} fell as the bridge collapsed!`, activePlayer, 3500);
            } else if (reason === "zoc_move" || reason === "zoc_turn_start" || reason === "fort_zoc" || reason === "zoc_fort") {
                logAction(`P${destroyedPlayer} ${unitToDestroy.type.name} destroyed by ZoC!`, activePlayer, 3500);
            } else if (reason === "cowardice") {
                logAction(`P${destroyedPlayer} ${unitToDestroy.type.name} was destroyed for cowardice!`, activePlayer, 3500);
            } else if (reason === "crushed") {
                logAction(`P${destroyedPlayer} ${unitToDestroy.type.name}'s defenses collapsed, and they were crushed with no escape!`, activePlayer, 3500);
            } else {
                logAction(`P${destroyedPlayer} ${unitToDestroy.type.name} has been destroyed!`, activePlayer, 3000);
            }

            // --- THE FIX: Nuclear Tile Clearing ---
            if (unitToDestroy.positionType === 'edge') {
                const edgeOfUnit = gameState.edges.get(unitToDestroy.position);
                if (edgeOfUnit) edgeOfUnit.units = edgeOfUnit.units.filter(u => u.id !== unitToDestroy.id);
            } else if (unitToDestroy.positionType === 'center' || wasFortified) {
                // Use a fallback to grab the tile key just in case positionType got desynced
                const tileKey = unitToDestroy.positionType === 'center' ? unitToDestroy.position : unitToDestroy.fortifiedTileKey;
                const fortifiedTile = gameState.tiles.get(tileKey);
                
                // Forcibly clear the tile, no questions asked
                if (fortifiedTile) {
                    fortifiedTile.fortifiedByPlayer = null;
                }
            }

            gameState.units = gameState.units.filter(u => u.id !== unitToDestroy.id);

            if (wasFortified) {
                const playerFlag = gameState.flags[`p${destroyedPlayer}_flag`];
                if (playerFlag && playerFlag.status !== 'carried') {
                    recalculatePlayerSupplyNetwork(destroyedPlayer);
                } else {
                    if (unitToDestroy.supplyLine && unitToDestroy.supplyLine.cost > 0) {
                        gameState.supplyPoints[`player${destroyedPlayer}`] += Math.round(unitToDestroy.supplyLine.cost);
                        updateSupplyPointsDisplay();
                    }
                }
            }
            
            if (gameState.selectedUnit && gameState.selectedUnit.id === unitToDestroy.id) {
                gameState.selectedUnit = null;
                gameState.currentReachableMoves.clear();
                resetActionSelectionStates();
                updateSelectedUnitInfoPanel();
            }
            if (gameState.hoveredUnitId === unitToDestroy.id) {
                gameState.hoveredUnitId = null;
                canvas.style.cursor = 'default';
            }
            if (gameState.draggingUnit && gameState.draggingUnit.id === unitToDestroy.id) {
                gameState.isDragging = false;
                gameState.draggingUnit = null;
                canvas.style.cursor = 'default';
            }

            checkVictoryCondition();
            
            // --- GUARANTEE REDRAW ---
            gameState.needsRedraw = true;
        }
        

        function getMaxUnitsForCurrentMap() {
            return MAP_SIZE_UNIT_LIMITS[gameState.gridRadius] || 4;
        }

        function getEdgeCost(unit, edgeKey) {
            const edge = gameState.edges.get(edgeKey);
            if (!edge) return Infinity;

            const tileCoords = parseEdgeKey(edgeKey);
            const tile1 = gameState.tiles.get(getTileKey(tileCoords[0].q, tileCoords[0].r));
            const tile2 = gameState.tiles.get(getTileKey(tileCoords[1].q, tileCoords[1].r));
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
            const enemyBaseData = gameState.baseCampPositions[`player${enemyPlayer}`];
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
                if (gameState.tiles.has(getTileKey(ccwNeighborCoords.q, ccwNeighborCoords.r))) adjacentEdges.add(getEdgeKey(pivotHex.q, pivotHex.r, ccwNeighborCoords.q, ccwNeighborCoords.r));
                if (gameState.tiles.has(getTileKey(cwNeighborCoords.q, cwNeighborCoords.r))) adjacentEdges.add(getEdgeKey(pivotHex.q, pivotHex.r, cwNeighborCoords.q, cwNeighborCoords.r));
            };
            findEdgesAroundPivot(h1, h2); findEdgesAroundPivot(h2, h1);
            return Array.from(adjacentEdges);
        }

        function getPossibleMoves(unit) {
            if (gameState.mapMakerMode) {
                return new Map(); 
            }
            if (!unit || unit.currentMove < 1 || unit.isFortified) return new Map();
    
            if (unit.hasPerformedMajorAction) {
                if (!unit.type.canMoveAfterAttack) {
                    return new Map();
                }
                if (isEdgeAdjacentToSpearWall(unit, unit.position)) {
                    return new Map(); 
                }
            }

    const playerBaseData = gameState.baseCampPositions[`player${unit.player}`];
    
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
            const nextAdjacentEdgeObject = gameState.edges.get(nextAdjacentEdgeKey); if (!nextAdjacentEdgeObject) continue;
            if (nextAdjacentEdgeObject.units.some(u => u.player !== unit.player)) continue;
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
            const playerFlag = gameState.flags[`p${player}_flag`]; 
            if (playerFlag && playerFlag.status === 'carried') {
                return null;
            }

            // --- FIX: Normalized Base Camp Tiles retrieval ---
            const rawBaseData = gameState.baseCampPositions[`player${player}`];
            let baseTiles = [];
            if (Array.isArray(rawBaseData)) {
                baseTiles = rawBaseData;
            } else if (typeof rawBaseData === 'string') {
                const [h1, h2] = parseEdgeKey(rawBaseData);
                if (!isNaN(h1.q)) baseTiles.push(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) baseTiles.push(getTileKey(h2.q, h2.r));
            }

            // The "start" for our pathfinding are all edges adjacent to the fort
            const startTile = gameState.tiles.get(startFortTileKey);
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
            if (gameState.gameMode === 'arcade') return;

            const playerSupplyKey = `player${playerNum}`;
            const maxSupply = 10;

            // Guard clause to prevent supply calculation if flag is stolen
            const playerFlag = gameState.flags[`p${playerNum}_flag`];
            if (playerFlag && playerFlag.status === 'carried') {
                gameState.units.forEach(unit => {
                    if (unit.player === playerNum) {
                        unit.supplyLine = null;
                    }
                });
                return; 
            }

            // --- FIX: Get Normalized Base Tiles ---
            const rawBaseData = gameState.baseCampPositions[playerSupplyKey];
            let baseTiles = [];
            if (Array.isArray(rawBaseData)) {
                baseTiles = rawBaseData;
            } else if (typeof rawBaseData === 'string') {
                const [h1, h2] = parseEdgeKey(rawBaseData);
                if (!isNaN(h1.q)) baseTiles.push(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) baseTiles.push(getTileKey(h2.q, h2.r));
            }

            // Reset all non-base supply lines for the player to start fresh
            gameState.units.forEach(unit => {
                if (unit.player === playerNum && unit.isFortified) {
                    if (!baseTiles.includes(unit.fortifiedTileKey)) {
                         unit.supplyLine = null;
                    }
                }
            });

            // Find all fortified units and their potential individual paths
            const potentialSupplies = [];
            const fortifiedUnits = gameState.units.filter(u => u.player === playerNum && u.isFortified);

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

            gameState.supplyPoints[playerSupplyKey] = maxSupply - Math.round(networkSupplyCost);
            updateSupplyPointsDisplay();
        }

        function fundNewFortification(unit) {
            const player = unit.player;
            const playerSupplyKey = `player${player}`;

            // Supply calculation now relies on the fixed findSupplyPath logic
            const pathData = findSupplyPath(unit.fortifiedTileKey, player);

            if (pathData && pathData.cost <= gameState.supplyPoints[playerSupplyKey]) {
                // Can afford it, fund the new line
                unit.supplyLine = pathData;
                gameState.supplyPoints[playerSupplyKey] -= Math.round(pathData.cost);
                logAction(`P${player} ${unit.type.name} established a supply line (Cost: ${Math.round(pathData.cost)}).`, player);
            } else {
                // Cannot afford it or no path exists, remains unsupplied
                unit.supplyLine = null;
                logAction(`P${player} ${unit.type.name} fortified, but is unsupplied.`, player);
            }
            updateSupplyPointsDisplay();
        }

        function severSupplyLinesForPlayer(playerNum) {
            logAction(`P${playerNum}'s flag was stolen! Supply lines have been cut.`, playerNum === 1 ? 2 : 1);
            gameState.units.forEach(unit => {
                if (unit.player === playerNum && unit.isFortified) {
                    unit.supplyLine = null;
                }
            });
        }

        function recalculateSupplyLinesForPlayer(playerNum) {
            logAction(`P${playerNum}'s flag has been returned! Supply lines are re-established.`, playerNum);
            
            // --- FIX: Normalized Base Tiles ---
            const rawBaseData = gameState.baseCampPositions[`player${playerNum}`];
            let baseTiles = [];
            if (Array.isArray(rawBaseData)) {
                baseTiles = rawBaseData;
            } else if (typeof rawBaseData === 'string') {
                const [h1, h2] = parseEdgeKey(rawBaseData);
                if (!isNaN(h1.q)) baseTiles.push(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) baseTiles.push(getTileKey(h2.q, h2.r));
            }

            gameState.units.forEach(unit => {
                if (unit.player === playerNum && unit.isFortified) {
                    if (!baseTiles.includes(unit.fortifiedTileKey)) {
                        unit.supplyLine = findSupplyPath(unit.fortifiedTileKey, unit.player);
                    }
                }
            });
            // Recalculate costs too
            recalculatePlayerSupplyNetwork(playerNum);
        }

        function attemptToResupplyForts(playerNum) {
            const playerSupplyKey = `player${playerNum}`;
            const unsuppliedForts = gameState.units.filter(u => 
                u.player === playerNum && 
                u.isFortified && 
                u.supplyLine === null
            );

            if (unsuppliedForts.length === 0) return;

            // --- FIX: Normalize Base Tiles ---
            const rawBaseData = gameState.baseCampPositions[playerSupplyKey];
            let baseTiles = [];
            if (Array.isArray(rawBaseData)) {
                baseTiles = rawBaseData;
            } else if (typeof rawBaseData === 'string') {
                const [h1, h2] = parseEdgeKey(rawBaseData);
                if (!isNaN(h1.q)) baseTiles.push(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) baseTiles.push(getTileKey(h2.q, h2.r));
            }

            // Find potential supply lines and their costs for all unsupplied forts
            const potentialResupplies = [];
            unsuppliedForts.forEach(unit => {
                if (!baseTiles.includes(unit.fortifiedTileKey)) {
                    const supplyPathData = findSupplyPath(unit.fortifiedTileKey, playerNum);
                    if (supplyPathData) {
                        potentialResupplies.push({
                            unit: unit,
                            cost: Math.round(supplyPathData.cost),
                            pathData: supplyPathData
                        });
                    }
                }
            });

            // Prioritize the cheapest supply lines first
            potentialResupplies.sort((a, b) => a.cost - b.cost);

            // Attempt to fund the new supply lines
            potentialResupplies.forEach(resupply => {
                if (gameState.supplyPoints[playerSupplyKey] >= resupply.cost) {
                    gameState.supplyPoints[playerSupplyKey] -= resupply.cost;
                    resupply.unit.supplyLine = resupply.pathData;
                    logAction(`P${playerNum} ${resupply.unit.type.name} is now in supply! (Cost: ${resupply.cost})`, playerNum);
                }
            });
            
            updateSupplyPointsDisplay();
        }

        function getPotentialUnfortifyTargets(unit) {
            if (!unit || !unit.isFortified || unit.positionType !== 'center') return [];
            const fortifiedTile = gameState.tiles.get(unit.position); if (!fortifiedTile) return [];
    
            // Use the generic name as it can be a String or Array
            const playerBaseData = gameState.baseCampPositions[`player${unit.player}`];
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

                const edge = gameState.edges.get(edgeKey);
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

        function completeFortify(unitToFortify, targetTileKeyToFortify) {
            if (!unitToFortify || unitToFortify.hasPerformedMajorAction || unitToFortify.isFortified) { showInstruction("Cannot fortify now.", 2000); return; }
            const targetTileObject = gameState.tiles.get(targetTileKeyToFortify);
            if (!targetTileObject || !targetTileObject.type.canFortify) { showInstruction("Invalid tile to fortify.", 2000); return; }
            if (targetTileObject.fortifiedByPlayer !== null) {
                showInstruction(`Tile ${targetTileKeyToFortify.substring(0,5)}... already fortified.`, 2500);
                resetActionSelectionStates(); 
                updateSelectedUnitInfoPanel(); return;
            }

            const myFlagTileKey = getFlagTileKey(unitToFortify.player);
            if (targetTileKeyToFortify === myFlagTileKey && !unitToFortify.isCarryingFlag) {
                showInstruction("Cannot fortify on the flag tile.", 2500);
                resetActionSelectionStates(); 
                updateSelectedUnitInfoPanel(); return;
            }

    //Immediately clear move highlights so they don't persist during animation
    gameState.currentReachableMoves.clear();

    const animation = {
        type: 'fortify',
        unit: unitToFortify,
        targetTileKey: targetTileKeyToFortify,
        startTime: Date.now(),
        duration: 450,

        onComplete: async () => {
            gameState.playerActionTaken[`player${gameState.currentPlayer}`] = true;
            const fortifyingPlayer = unitToFortify.player;
            
            const currentEdge = gameState.edges.get(unitToFortify.position);
            unitToFortify.isFortified = true; unitToFortify.fortifiedTileKey = targetTileKeyToFortify;
            if (unitToFortify.typeId === 'ARCHER') {
                unitToFortify.stats.damage += 2;
            }
            unitToFortify.positionType = 'center'; unitToFortify.position = targetTileKeyToFortify;
            unitToFortify.currentMove -= FORTIFY_UNFORTIFY_COST; unitToFortify.hasPerformedMajorAction = true;
            targetTileObject.fortifiedByPlayer = fortifyingPlayer;
            if (typeof ActionManager !== 'undefined') {
                ActionManager.submitAction({
                    type: "FORTIFY",
                    turn: gameState.globalTurnNumber,
                    player: fortifyingPlayer,
                    actorId: unitToFortify.id,
                    payload: {
                        tile: targetTileKeyToFortify,
                        relativeLocation: 'center', // Explicitly tracking the new position type
                        unitState: getUnitSnapshot(unitToFortify)
                    }
                });
            }
            logAction(`${unitToFortify.type.name} fortified on tile ${targetTileKeyToFortify.substring(0,5)}...`, fortifyingPlayer, 2500);

            if (gameState.gameMode !== 'arcade') {
                const enemyPlayer = unitToFortify.player === 1 ? 2 : 1;
                const enemyFlagTileKey = getFlagTileKey(enemyPlayer);
                
                if (targetTileKeyToFortify === enemyFlagTileKey) {
                    const enemyFlagObj = unitToFortify.player === 1 ? gameState.flags.p2_flag : gameState.flags.p1_flag;
                    
                    if (enemyFlagObj && enemyFlagObj.status === 'at_base') {
                        enemyFlagObj.status = 'carried';
                        enemyFlagObj.carrierId = unitToFortify.id;
                        unitToFortify.isCarryingFlag = true;
                        
                        logAction(`P${unitToFortify.player} ${unitToFortify.type.name} has captured the flag from the fort!`, gameState.currentPlayer);
                        
                        updateAllHealingStatus();
                        severSupplyLinesForPlayer(enemyPlayer);
                        
                        const victimPlayerQueue = gameState.respawnQueue[`player${enemyPlayer}`];
                        victimPlayerQueue.forEach(item => {
                            if (!item.timerHalved) {
                                item.turnsRemaining = Math.ceil(item.turnsRemaining / 2);
                                item.timerHalved = true;
                            }
                        });
                        updateRespawnQueueDisplay();
                        updateSupplyPointsBasedOnFlagStatus(enemyPlayer);

                        const unitPos = getUnitScreenPosition(unitToFortify);
                        if (unitPos) {
                            gameState.visualEffects.push({
                                type: 'flag_capture_burst',
                                x: unitPos.x,
                                y: unitPos.y,
                                player: enemyPlayer,
                                startTime: Date.now(),
                                duration: 500
                            });
                        }
                    }
                }
            }

            const playerFlag = gameState.flags[`p${fortifyingPlayer}_flag`];
            if (playerFlag && playerFlag.status !== 'carried') {
                // Instead of funding one fort, recalculate the entire player's network
                // to account for shared supply lines.
                recalculatePlayerSupplyNetwork(fortifyingPlayer);

            } else {
                logAction(`P${unitToFortify.player} ${unitToFortify.type.name} fortified, but is unsupplied due to stolen flag.`, fortifyingPlayer, 3000);
            }

            let unitsToDestroy = [];
            let zocHits = []; // --- NEW: Aggregate ZoC Hits ---

            getNeighbors(targetTileObject.q, targetTileObject.r).forEach(neighborCoords => {
                 const edgeKey = getEdgeKey(targetTileObject.q, targetTileObject.r, neighborCoords.q, neighborCoords.r);
                 const adjacentEdge = gameState.edges.get(edgeKey);
                 if (adjacentEdge) {
                     adjacentEdge.units.forEach(enemyUnit => {
                         if (enemyUnit.player !== fortifyingPlayer && enemyUnit.positionType === 'edge') {
                             enemyUnit.hp -= FORTIFICATION_DAMAGE;
                             
                             // --- NEW: Track Hit ---
                             zocHits.push({
                                 unitId: enemyUnit.id,
                                 damage: FORTIFICATION_DAMAGE,
                                 isFatal: enemyUnit.hp <= 0
                             });
                             // ----------------------

                             logAction(`P${enemyUnit.player} ${enemyUnit.type.name} takes ZoC. HP: ${enemyUnit.hp}`, fortifyingPlayer);
                             if (enemyUnit.hp <= 0 && !unitsToDestroy.find(u => u.id === enemyUnit.id)) unitsToDestroy.push(enemyUnit);
                         }
                     });
                 }
             });

            // --- NEW: Submit Separate Event for Clarity ---
            if (zocHits.length > 0 && typeof ActionManager !== 'undefined') {
                ActionManager.submitAction({
                    type: "FORTIFY_ZOC_BLAST",
                    turn: gameState.globalTurnNumber,
                    player: fortifyingPlayer,
                    actorId: unitToFortify.id,
                    payload: { hits: zocHits }
                });
            }
            // ----------------------------------------------

            unitsToDestroy.forEach(u => handleUnitDeath(u, "zoc_fort"));

            gameState.currentReachableMoves.clear();
            resetActionSelectionStates();
            updateSelectedUnitInfoPanel();
            if (!gameState.gameOver) checkVictoryCondition();
        }
    };
    
    if (gameSettings.animationsEnabled) {
        gameState.activeAnimations.push(animation);
    } else {
        animation.onComplete();
    }
    
            resetActionSelectionStates(); 
            updateSelectedUnitInfoPanel();
        }

        function completeUnfortify(unitToUnfortify, targetEdgeKey) {
            if (!unitToUnfortify || !unitToUnfortify.isFortified || unitToUnfortify.hasPerformedMajorAction) {
                showInstruction("Cannot unfortify now.", 2000); 
                return; 
            }
            const targetEdge = gameState.edges.get(targetEdgeKey); 
            if (!targetEdge) { 
                showInstruction("Invalid target edge.", 2000); 
                return; 
            }
            if (targetEdge.units.some(u => u.player !== unitToUnfortify.player) || targetEdge.units.filter(u => u.player === unitToUnfortify.player).length >= 2) {
                showInstruction("Target edge blocked.", 2000); 
                resetActionSelectionStates();
                updateSelectedUnitInfoPanel(); 
                return;
            }

    const startTileKey = unitToUnfortify.position;
    const oldFortifiedTile = gameState.tiles.get(startTileKey);
    
    if (oldFortifiedTile) {
        oldFortifiedTile.fortifiedByPlayer = null;
    }
    unitToUnfortify.supplyLine = null;

    const animation = {
        type: 'unfortify',
        unit: unitToUnfortify,
        startTileKey: startTileKey,
        targetEdgeKey: targetEdgeKey,
        startTime: Date.now(),
        duration: 600,

        onComplete: async () => {
            const unfortifyingPlayer = unitToUnfortify.player;
            
            gameState.playerActionTaken[`player${gameState.currentPlayer}`] = true;
            gameState.mustUnfortify = false;
            ui.endTurnButton.disabled = false;

            unitToUnfortify.fortifyCooldown = unitToUnfortify.turnsFortified * 5; 

            unitToUnfortify.isFortified = false;
            if (unitToUnfortify.typeId === 'ARCHER') {
                unitToUnfortify.stats.damage -= 2;
            }
            unitToUnfortify.turnsFortifiedAtBase = 0;
            unitToUnfortify.turnsFortified = 0;      
            unitToUnfortify.supplyLine = null;
            unitToUnfortify.fortifiedTileKey = null;
            unitToUnfortify.positionType = 'edge'; 
            unitToUnfortify.position = targetEdgeKey;
            unitToUnfortify.currentMove -= FORTIFY_UNFORTIFY_COST; 
            unitToUnfortify.hasPerformedMajorAction = true;
            if (typeof ActionManager !== 'undefined') {
                ActionManager.submitAction({
                    type: "UNFORTIFY",
                    turn: gameState.globalTurnNumber,
                    player: unfortifyingPlayer,
                    actorId: unitToUnfortify.id,
                    payload: {
                        fromTile: startTileKey, // Where they were
                        toEdge: targetEdgeKey,  // Where they went
                        relativeLocation: 'edge',          // Explicitly tracking the new position type
                        unitState: getUnitSnapshot(unitToUnfortify)
                    }
                });
            }
            logAction(`${unitToUnfortify.type.name} unfortified to ${targetEdgeKey.substring(0,7)}...`, unfortifyingPlayer, 2500);
            
            recalculatePlayerSupplyNetwork(unfortifyingPlayer);

            resetActionSelectionStates();
            updateSelectedUnitInfoPanel();
        }
    };

    if (gameSettings.animationsEnabled) {
        gameState.activeAnimations.push(animation);
    } else {
        animation.onComplete();
    }
    
            resetActionSelectionStates();
            updateSelectedUnitInfoPanel();
        }

        function getPotentialBridgeTargets(unit) {
            if (!unit || unit.positionType !== 'edge' || !unit.type.canBuildBridge || unit.isFortified) return [];

            const validTargets = new Set();
            
            // 1. Check if the unit's CURRENT edge is a valid target
            const currentEdge = gameState.edges.get(unit.position);
            if (currentEdge && !currentEdge.bridge) {
                const [h1, h2] = parseEdgeKey(unit.position);
                const tile1 = gameState.tiles.get(getTileKey(h1.q, h1.r));
                const tile2 = gameState.tiles.get(getTileKey(h2.q, h2.r));
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
                const edgeData = gameState.edges.get(adjEdgeKey);
                if (edgeData && !edgeData.bridge) {
                    const adjEdgeTileCoords = parseEdgeKey(adjEdgeKey);
                    if (adjEdgeTileCoords.some(coord => isNaN(coord.q))) return;

                    const t1 = gameState.tiles.get(getTileKey(adjEdgeTileCoords[0].q, adjEdgeTileCoords[0].r));
                    const t2 = gameState.tiles.get(getTileKey(adjEdgeTileCoords[1].q, adjEdgeTileCoords[1].r));

                    // An adjacent edge is a target if it's next to water (either beach or full water edge)
                    if ((t1 && t1.type === TILE_TYPES.WATER) || (t2 && t2.type === TILE_TYPES.WATER)) {
                        validTargets.add(adjEdgeKey);
                    }
                }
            });

            return Array.from(validTargets);
        }

        function completeBuildBridge(targetEdgeKey) {
            const { selectedUnit } = gameState;
            if (!selectedUnit || !selectedUnit.type.canBuildBridge || selectedUnit.hasPerformedMajorAction || selectedUnit.isFortified) {
                showInstruction("Cannot build bridge.", 2000); 
                resetActionSelectionStates();
                updateSelectedUnitInfoPanel(); 
                return;
            }
            const edgeToBridge = gameState.edges.get(targetEdgeKey);
            if (!edgeToBridge || edgeToBridge.bridge) {
                showInstruction("Cannot build bridge here.", 2000); 
                resetActionSelectionStates();
                updateSelectedUnitInfoPanel(); 
                return;
            }

    selectedUnit.currentMove -= BUILD_BRIDGE_COST; 
    selectedUnit.hasPerformedMajorAction = true;
    gameState.currentReachableMoves.clear(); // Immediately remove move highlights

    const animation = {
        type: 'build_bridge',
        unit: selectedUnit,
        targetEdgeKey: targetEdgeKey,
        startTime: Date.now(),
        duration: 500,

        onComplete: () => {
            gameState.playerActionTaken[`player${gameState.currentPlayer}`] = true;
            edgeToBridge.bridge = true; 
            edgeToBridge.bridgeHp = BRIDGE_MAX_HP;
            logAction(`${selectedUnit.type.name} built bridge on ${targetEdgeKey.substring(0,7)}... HP: ${edgeToBridge.bridgeHp}`, gameState.currentPlayer, 3000);
            resetActionSelectionStates();
            updateSelectedUnitInfoPanel();
        }
    };
    
    if (gameSettings.animationsEnabled) {
        gameState.activeAnimations.push(animation);
    } else {
        animation.onComplete();
    }
    
            resetActionSelectionStates();
            updateSelectedUnitInfoPanel();
        }

        function applyFortificationDamageOnMove(unitMoving, newEdgeKey) {
             if (!unitMoving || unitMoving.isFortified || unitMoving.positionType !== 'edge') return false;
            const tileCoords = parseEdgeKey(newEdgeKey); 
            if (tileCoords.some(coord => isNaN(coord.q))) return false;
            let unitDestroyed = false; const enemyPlayer = unitMoving.player === 1 ? 2 : 1;
            
            const checkAndApply = (tile, tileKey) => {
                // If tile is fortified by enemy
                if (tile && tile.fortifiedByPlayer === enemyPlayer && !unitDestroyed) {
                    
                    // --- NEW: Check Suppression ---
                    const fortUnit = gameState.units.find(u => u.isFortified && u.position === tileKey && u.player === enemyPlayer);
                    if (fortUnit && isZoCSuppressed(fortUnit)) {
                        // ZoC is suppressed by 2+ enemies on perimeter.
                        // Note: unitMoving is NOT counted yet as they haven't "arrived" fully in logic terms 
                        // relative to the static check, but even if they were, this allows the 3rd unit to pass freely.
                        return false; 
                    }
                    // ------------------------------

                    unitMoving.hp -= FORTIFICATION_DAMAGE;
                    
                    if (typeof ActionManager !== 'undefined') {
                        ActionManager.submitAction({
                            type: "MOVEMENT_ZOC_HIT",
                            turn: gameState.globalTurnNumber,
                            player: unitMoving.player,
                            actorId: unitMoving.id,
                            payload: {
                                location: newEdgeKey,
                                damage: FORTIFICATION_DAMAGE,
                                isFatal: unitMoving.hp <= 0
                            }
                        });
                    }

                    logAction(`P${unitMoving.player} ${unitMoving.type.name} takes ZoC. HP: ${unitMoving.hp}`, gameState.currentPlayer, 3500);
                    if (unitMoving.hp <= 0) { handleUnitDeath(unitMoving, "zoc_move"); unitDestroyed = true; }
                    return true;
                } return false;
            };
            
            const tile1Key = getTileKey(tileCoords[0].q, tileCoords[0].r);
            const tile2Key = getTileKey(tileCoords[1].q, tileCoords[1].r);
            const tile1 = gameState.tiles.get(tile1Key);
            const tile2 = gameState.tiles.get(tile2Key);
            
            if (!checkAndApply(tile1, tile1Key)) {
                checkAndApply(tile2, tile2Key);
            }
            return unitDestroyed;
        }

        function getPotentialMeleeAttackEdges(attackingUnit) {
            const potentialEdges = new Set();
            if (!attackingUnit) return Array.from(potentialEdges);

            if (attackingUnit.isFortified && attackingUnit.positionType === 'center') {
                const fortifiedTile = gameState.tiles.get(attackingUnit.position);
                if (!fortifiedTile) return Array.from(potentialEdges);
                getNeighbors(fortifiedTile.q, fortifiedTile.r).forEach(neighborCoords => {
                    if (gameState.tiles.has(getTileKey(neighborCoords.q, neighborCoords.r))) {
                        const edgeKey = getEdgeKey(fortifiedTile.q, fortifiedTile.r, neighborCoords.q, neighborCoords.r);
                        potentialEdges.add(edgeKey);
                    }
                });
            } else if (attackingUnit.positionType === 'edge') {
                return getRotationallyAdjacentEdges(attackingUnit.position);
            }
            return Array.from(potentialEdges);
        }

        function getValidMeleeAttackTargets(attackingUnit) {
            if (!attackingUnit || attackingUnit.currentMove < ATTACK_COST || attackingUnit.hasPerformedMajorAction) return [];
            const targets = [];
            const addUnitTarget = (targetUnit, edgeKey = null, tileKeyForTarget = null) => {
                if (!targets.some(t => t.unit && t.unit.id === targetUnit.id)) targets.push({ unit: targetUnit, edgeKey, tileKeyForTarget, isBridgeTarget: false });
            };
            const addBridgeTarget = (edgeKey) => {
                 if (!targets.some(t => t.isBridgeTarget && t.edgeKey === edgeKey)) targets.push({ unit: null, edgeKey, tileKeyForTarget: null, isBridgeTarget: true });
            }
            
            const potentialAttackEdges = getPotentialMeleeAttackEdges(attackingUnit);

            potentialAttackEdges.forEach(edgeKey => {
                const edge = gameState.edges.get(edgeKey);
                if (edge) {
                    edge.units.forEach(unitOnEdge => { 
                        if (unitOnEdge.player !== attackingUnit.player && unitOnEdge.positionType === 'edge') {
                            addUnitTarget(unitOnEdge, edgeKey); 
                        }
                    });
                     if (edge.bridge && edge.bridgeHp > 0) addBridgeTarget(edgeKey);
                }
            });
            
            if (attackingUnit.positionType === 'edge') { 
                const [H1_coords, H2_coords] = parseEdgeKey(attackingUnit.position);
                [H1_coords, H2_coords].forEach(hexCoords => { 
                     if (isNaN(hexCoords.q)) return;
                    const tileKey = getTileKey(hexCoords.q, hexCoords.r);
                    const tile = gameState.tiles.get(tileKey);
                    if (tile && tile.fortifiedByPlayer && tile.fortifiedByPlayer !== attackingUnit.player) {
                        const fortifiedUnit = gameState.units.find(u => u.isFortified && u.position === tileKey && u.player === tile.fortifiedByPlayer);
                        if (fortifiedUnit) {
                            addUnitTarget(fortifiedUnit, null, tileKey);
                        }
                    }
                });
            }
            return targets;
        }

        function getValidArcherAttackTargets(attackingUnit) {
            if (!attackingUnit || attackingUnit.currentMove < ATTACK_COST || attackingUnit.hasPerformedMajorAction || attackingUnit.type.name !== 'Archer') {
                return [];
            }

            // 1. Calculate all visible keys using the new system (Fog of War)
            const visibilityData = getVisibleKeysFromUnit(attackingUnit);
            const visibleEdges = visibilityData.edges;
            const visibleTiles = visibilityData.tiles;

            const potentialTargets = [];

            // Helper to add targets if they are in the visible set
            const addPotentialUnit = (unit, edgeKey = null, tileKey = null) => {
                if (!potentialTargets.some(t => t.unit && t.unit.id === unit.id)) {
                    potentialTargets.push({ unit: unit, edgeKey: edgeKey, tileKeyForTarget: tileKey, isBridgeTarget: false });
                }
            };
            
            const addPotentialBridge = (edgeKey) => {
                if (!potentialTargets.some(t => t.isBridgeTarget && t.edgeKey === edgeKey)) {
                    potentialTargets.push({ unit: null, edgeKey: edgeKey, tileKeyForTarget: null, isBridgeTarget: true });
                }
            };

            // --- COMBINED ARMS CHECK ---
            let hasCombinedArms = false;
            if (attackingUnit.positionType === 'edge') {
                const myEdge = gameState.edges.get(attackingUnit.position);
                if (myEdge) {
                    hasCombinedArms = myEdge.units.some(u => u.id !== attackingUnit.id && u.player === attackingUnit.player && u.type.attackType === 'melee');
                }
            }

            // Pre-calculate Edge Archer context (Side Tiles)
            let adjTile1Key = null;
            let adjTile2Key = null;
            let sideTileH1 = null; 
            let sideTileH2 = null;

            if (attackingUnit.positionType === 'edge') {
                const [h1, h2] = parseEdgeKey(attackingUnit.position);
                if (!isNaN(h1.q)) { adjTile1Key = getTileKey(h1.q, h1.r); sideTileH1 = h1; }
                if (!isNaN(h2.q)) { adjTile2Key = getTileKey(h2.q, h2.r); sideTileH2 = h2; }
            }

            // Pre-calculate Fortified Archer context (Source Tile Visibility)
            let sourceTile = null;
            let sourceVis = 3;
            if (attackingUnit.positionType === 'center' && attackingUnit.isFortified) {
                sourceTile = gameState.tiles.get(attackingUnit.position);
                if (sourceTile) sourceVis = getTileVisibility(sourceTile);
            }

            // 2. Scan Visible Edges for Targets
            visibleEdges.forEach(edgeKey => {
                // --- ATTACK RANGE FILTER: EDGE ARCHER ---
                // Can only attack edges belonging to Side Tiles (A/B)
                if (attackingUnit.positionType === 'edge') {
                    const inA = sideTileH1 && isEdgePartOfTile(sideTileH1.q, sideTileH1.r, edgeKey);
                    const inB = sideTileH2 && isEdgePartOfTile(sideTileH2.q, sideTileH2.r, edgeKey);
                    if (!inA && !inB) return; 
                }

                // --- ATTACK RANGE FILTER: FORTIFIED ARCHER ---
                // If fortified in Low Vis (<=1, e.g. Forest), can ONLY attack own tile edges.
                // If fortified in High Vis (>1, e.g. Plains), can attack "roads leading up" (Neighbors included).
                if (attackingUnit.positionType === 'center' && attackingUnit.isFortified && sourceTile) {
                    if (sourceVis <= 1) {
                        if (!isEdgePartOfTile(sourceTile.q, sourceTile.r, edgeKey)) {
                            return; // Skip edge if not directly on the fort perimeter
                        }
                    }
                }

                const edge = gameState.edges.get(edgeKey);
                if (edge) {
                    // Check for Enemy Units
                    edge.units.forEach(unit => {
                        if (unit.player !== attackingUnit.player) {
                            addPotentialUnit(unit, edgeKey, null);
                        }
                    });
                    // Check for Bridges
                    if (edge.bridge && edge.bridgeHp > 0) {
                        addPotentialBridge(edgeKey);
                    }
                }
            });

            // 3. Scan Visible Tiles for Fortified Targets
            visibleTiles.forEach(tileKey => {
                const tile = gameState.tiles.get(tileKey);
                if (!tile) return;

                const vis = getTileVisibility(tile);
                
                // --- TARGETING RESTRICTION & EXCEPTION ---
                // Default Rule: Can only target center if Visibility > 1.
                let visibilityThreshold = 2;

                // Combined Arms Exception: If we have a spotter, we can target adjacent centers with Visibility > 0.
                if (hasCombinedArms && (tileKey === adjTile1Key || tileKey === adjTile2Key)) {
                    visibilityThreshold = 1;
                }

                if (vis < visibilityThreshold) return;

                if (tile.fortifiedByPlayer && tile.fortifiedByPlayer !== attackingUnit.player) {
                    const fortifiedUnit = gameState.units.find(u => u.isFortified && u.position === tileKey);
                    if (fortifiedUnit) {
                        addPotentialUnit(fortifiedUnit, null, tileKey);
                    }
                }
            });
            
            return potentialTargets;
        }

        function completeAttack(attackingUnit, targetUnitInfo, attackType) {
            // 1. Validate Attacker
            if (!attackingUnit || attackingUnit.currentMove < ATTACK_COST || attackingUnit.hasPerformedMajorAction) {
                showInstruction("Cannot complete attack.", 2000);
                resetActionSelectionStates();
                updateSelectedUnitInfoPanel();
                return;
            }

    // 2. Refresh Attacker Reference (Safety)
    const liveAttacker = gameState.units.find(u => u.id === attackingUnit.id);
    if (!liveAttacker) { console.error("Attacker missing from master list"); return; }
    attackingUnit = liveAttacker;

    // 3. Calculate Base Damage (Robust Fallback)
    // Check if .stats exists (New System) or fallback to .type (Old System) to prevent NaN
    let baseDamage = 0;
    if (attackingUnit.stats && typeof attackingUnit.stats.damage === 'number') {
        baseDamage = attackingUnit.stats.damage;
    } else {
        baseDamage = attackingUnit.type.damage || 0;
    }

    let damageModifier = 0;
    let advantageMessage = "";
    
    if (targetUnitInfo.unit) {
        const attackerType = attackingUnit.type;
        const defenderType = targetUnitInfo.unit.type;
        if (attackerType.strengths && attackerType.strengths.includes(defenderType.name)) {
            damageModifier = 1;
            advantageMessage = "Advantage!";
        } else if (attackerType.weaknesses && attackerType.weaknesses.includes(defenderType.name)) {
            damageModifier = -1;
            advantageMessage = "Disadvantage!";
        }
    }
    baseDamage += damageModifier;

    let attackStatus = 'normal';
    if (advantageMessage === "Advantage!") {
        attackStatus = 'advantage';
    } else if (advantageMessage === "Disadvantage!") {
        attackStatus = 'disadvantage';
    }

    const animation = {
        attacker: attackingUnit,
        targetInfo: targetUnitInfo,
        startTime: Date.now(),

        onComplete: async () => {
            gameState.playerActionTaken[`player${gameState.currentPlayer}`] = true;
            attackingUnit.hasPerformedMajorAction = true;
            
            // --- MOVEMENT LOGIC (Hit & Run) ---
            let hitAndRunMessage = "";
            if (attackingUnit.type.canMoveAfterAttack) {
                attackingUnit.currentMove -= ATTACK_COST;
                const spearWallOnAttacker = isEdgeAdjacentToSpearWall(attackingUnit, attackingUnit.position);
                const spearWallOnTarget = targetUnitInfo.edgeKey ? isEdgeAdjacentToSpearWall(attackingUnit, targetUnitInfo.edgeKey) : false;
                if (spearWallOnAttacker || spearWallOnTarget) {
                    hitAndRunMessage = "Spear Wall prevents further movement!";
                    gameState.currentReachableMoves.clear();
                } else if (attackingUnit.currentMove > 0) {
                    hitAndRunMessage = "Horseman can move again!";
                    if (gameState.gameMode !== 'singleplayer' || attackingUnit.player === gameState.playerSide) {
                        gameState.currentReachableMoves = getPossibleMoves(attackingUnit);
                    }
                } else {
                    gameState.currentReachableMoves.clear();
                }
            } else {
                attackingUnit.currentMove = 0;
                gameState.currentReachableMoves.clear();
            }

            // --- PREPARE LOGS & LEDGER DATA ---
            let logParts = [];
            let ledgerModifiers = []; 

            if (advantageMessage === "Advantage!") { logParts.push(advantageMessage); ledgerModifiers.push("ADVANTAGE"); }
            else if (advantageMessage === "Disadvantage!") { logParts.push(advantageMessage); ledgerModifiers.push("DISADVANTAGE"); }

            let ledgerPayload = {
                targetType: 'UNKNOWN',
                damageDealt: 0,
                isKill: false
            };

            // --- COMBAT RESOLUTION ---
            if (targetUnitInfo.isBridgeTarget && targetUnitInfo.edgeKey) {
                // 1. BRIDGE ATTACK
                ledgerPayload.targetType = 'BRIDGE';
                ledgerPayload.targetEdge = targetUnitInfo.edgeKey;
                ledgerPayload.damageDealt = baseDamage;

                const bridgeEdge = gameState.edges.get(targetUnitInfo.edgeKey);
                if (bridgeEdge && bridgeEdge.bridge) {
                    bridgeEdge.bridgeHp -= baseDamage;
                    triggerDamageVisual({ position: targetUnitInfo.edgeKey, isFortified: false }, 'normal');
                    logParts.push(`P${attackingUnit.player} ${attackingUnit.type.name} targets bridge for ${baseDamage}.<br>Bridge HP: ${bridgeEdge.bridgeHp}/${BRIDGE_MAX_HP}.`);
                    
                    if (bridgeEdge.bridgeHp <= 0) {
                        ledgerPayload.isKill = true;
                        logParts.push(`Bridge destroyed!`);
                        bridgeEdge.bridge = false;
                        bridgeEdge.bridgeHp = null;
                        recalculatePlayerSupplyNetwork(1);
                        recalculatePlayerSupplyNetwork(2);
                        if (attackingUnit.type.name === 'Horseman') {
                            gameState.currentReachableMoves = getPossibleMoves(attackingUnit);
                        }
                        // Handle Fall Damage
                        const [h1, h2] = parseEdgeKey(targetUnitInfo.edgeKey);
                        const tile1 = gameState.tiles.get(getTileKey(h1.q, h1.r));
                        const tile2 = gameState.tiles.get(getTileKey(h2.q, h2.r));
                        const isBeach = (tile1 && tile1.type !== TILE_TYPES.WATER) || (tile2 && tile2.type !== TILE_TYPES.WATER);
                        [...bridgeEdge.units].forEach(unitOnCollapse => {
                            if (isBeach) {
                                const fallDamage = 3;
                                unitOnCollapse.hp -= fallDamage;
                                logParts.push(`P${unitOnCollapse.player} ${unitOnCollapse.type.name} fell as the bridge collapsed and takes ${fallDamage} damage! HP: ${unitOnCollapse.hp}`);
                                if (unitOnCollapse.hp <= 0) handleUnitDeath(unitOnCollapse, "bridge_collapse");
                            } else {
                                handleUnitDeath(unitOnCollapse, "bridge_collapse");
                            }
                        });
                    }
                } else logParts.push("Target bridge missing.");

            } else if (targetUnitInfo.unit) {
                // 2. UNIT ATTACK
                // --- CRITICAL FIX: Refresh Target Reference ---
                // We fetch the target from the master list using the ID to ensure we hit the live object.
                const targetUnit = gameState.units.find(u => u.id === targetUnitInfo.unit.id);
                
                if (targetUnit) {
                    ledgerPayload.targetId = targetUnit.id;
                    
                    if (attackingUnit.player !== targetUnit.player) {
                        targetUnit.lastAttackedByHostileOnTurn = gameState.globalTurnNumber;
                    }
                    
                    let actualDamage = baseDamage;
                    let defenseMessage = "";
                    
                    // Safe Access to Defense
                    let targetDefense = 0;
                    if (targetUnit.stats && typeof targetUnit.stats.defense === 'number') targetDefense = targetUnit.stats.defense;
                    else targetDefense = targetUnit.type.defense || 0; // Legacy fallback
                    
                    // Forest Penalty Logic (New)
                    const fortTile = gameState.tiles.get(targetUnit.position);
                    if (targetUnit.isFortified && fortTile && fortTile.type.name === 'Forest') {
                        targetDefense -= 1;
                    }

                    // Defense / Combined Arms Logic
                    if (targetUnit.isFortified) {
                        let hasCombinedArmsPartner = false;
                        const edge = gameState.edges.get(attackingUnit.position);
                        if (edge) {
                            if (attackingUnit.type.attackType === 'ranged') hasCombinedArmsPartner = edge.units.some(u => u.id !== attackingUnit.id && u.player === attackingUnit.player && u.type.attackType === 'melee');
                            else if (attackingUnit.type.attackType === 'melee') hasCombinedArmsPartner = edge.units.some(u => u.id !== attackingUnit.id && u.player === attackingUnit.player && u.type.attackType === 'ranged');
                        }
                        if (hasCombinedArmsPartner) {
                            defenseMessage = 'Combined arms negates fortification!';
                            ledgerModifiers.push("COMBINED_ARMS");
                            if (targetDefense < 0) actualDamage -= targetDefense; 
                        } else {
                            actualDamage -= targetDefense;
                            if (targetDefense > 0) defenseMessage = `Fortification reduced damage by ${targetDefense}.`;
                            else if (targetDefense < 0) {
                                defenseMessage = `Vulnerable! Taken ${Math.abs(targetDefense)} extra damage.`;
                                ledgerModifiers.push("VULNERABLE");
                            }
                        }
                    } else {
                        if (targetDefense < 0) {
                            actualDamage -= targetDefense; 
                            defenseMessage = `Vulnerable! Taken ${Math.abs(targetDefense)} extra damage.`;
                            ledgerModifiers.push("VULNERABLE");
                        }
                    }
                    
                    actualDamage = Math.max(1, actualDamage); // Ensure at least 1 dmg
                    if (defenseMessage) logParts.push(defenseMessage);
                    triggerDamageVisual(targetUnit, attackStatus);

                    // Archer Split Logic
                    if (attackType === 'Archer' && targetUnitInfo.edgeKey && !targetUnit.isFortified) {
                        const edgeOfTarget = gameState.edges.get(targetUnitInfo.edgeKey);
                        // Refresh edge units from master list
                        const allEnemyUnitsOnEdge = edgeOfTarget ? edgeOfTarget.units.filter(u => u.player === targetUnit.player) : [];
                        
                        if (allEnemyUnitsOnEdge.length === 2) {
                            ledgerPayload.targetType = 'UNIT_SPLIT';
                            let splitDamage = Math.max(1, Math.round(actualDamage / 2));
                            ledgerPayload.damageDealt = splitDamage;
                            ledgerPayload.splitTargets = allEnemyUnitsOnEdge.map(u => u.id);
                            ledgerModifiers.push("SPLIT_DAMAGE");

                            logParts.push(`Damage split between 2 units!`);
                            allEnemyUnitsOnEdge.forEach(unitToHit => {
                                // Fetch live ref just in case
                                const liveSplitTarget = gameState.units.find(u => u.id === unitToHit.id);
                                if (liveSplitTarget) {
                                    liveSplitTarget.hp -= splitDamage;
                                    triggerDamageVisual(liveSplitTarget, attackStatus);
                                    logParts.push(`P${liveSplitTarget.player} ${liveSplitTarget.type.name} takes ${splitDamage} damage. HP: ${liveSplitTarget.hp}`);
                                    if (attackingUnit.player !== liveSplitTarget.player) liveSplitTarget.lastAttackedByHostileOnTurn = gameState.globalTurnNumber;
                                    if (liveSplitTarget.hp <= 0) handleUnitDeath(liveSplitTarget);
                                }
                            });
                        } else {
                            // Standard Archer Hit
                            ledgerPayload.targetType = 'UNIT';
                            ledgerPayload.damageDealt = actualDamage;
                            targetUnit.hp -= actualDamage;
                            logParts.push(`P${attackingUnit.player} ${attackingUnit.type.name} hits P${targetUnit.player} ${targetUnit.type.name} for ${actualDamage}.<br>HP: ${targetUnit.hp}/${targetUnit.maxHp}`);
                            if (targetUnit.hp <= 0) {
                                handleUnitDeath(targetUnit);
                                ledgerPayload.isKill = true;
                            }
                        }
                    } else {
                        // Standard Melee/Other Hit
                        ledgerPayload.targetType = 'UNIT';
                        ledgerPayload.damageDealt = actualDamage;
                        targetUnit.hp -= actualDamage;
                        logParts.push(`P${attackingUnit.player} ${attackingUnit.type.name} hits P${targetUnit.player} ${targetUnit.type.name} for ${actualDamage}.<br>HP: ${targetUnit.hp}/${targetUnit.maxHp}`);
                        if (targetUnit.hp <= 0) {
                            handleUnitDeath(targetUnit);
                            ledgerPayload.isKill = true;
                        }
                    }

                    // Cavalry Screen
                    if (targetUnit.type.name === 'Horseman' && attackingUnit.type.attackType === 'melee' && targetUnitInfo.edgeKey) {
                        const edgeOfHorseman = gameState.edges.get(targetUnitInfo.edgeKey);
                        const retaliatingArcher = edgeOfHorseman ? edgeOfHorseman.units.find(u => u.player === targetUnit.player && u.type.name === 'Archer') : null;
                        if (retaliatingArcher) {
                            let retDmg = retaliatingArcher.stats ? retaliatingArcher.stats.damage : retaliatingArcher.type.damage;
                            const retaliationDamage = Math.ceil(retDmg / 2);
                            attackingUnit.hp -= retaliationDamage;
                            triggerDamageVisual(attackingUnit, 'normal');
                            logParts.push(`Cavalry Screen! P${retaliatingArcher.player} ${retaliatingArcher.type.name} retaliates for ${retaliationDamage} damage.<br>Attacker HP: ${attackingUnit.hp}/${attackingUnit.maxHp}`);
                            ledgerModifiers.push(`RETALIATION_DMG_${retaliationDamage}`);
                            if (attackingUnit.hp <= 0) handleUnitDeath(attackingUnit, "retaliation");
                        }
                    }
                } else {
                    console.error("Target unit not found in live gamestate!");
                }
            }
            if (hitAndRunMessage) logParts.push(hitAndRunMessage);

            // --- REPORT TO ACTION MANAGER ---
            if (typeof ActionManager !== 'undefined') {
                ActionManager.submitAction({
                    type: "ATTACK",
                    turn: gameState.globalTurnNumber,
                    player: attackingUnit.player,
                    actorId: attackingUnit.id,
                    payload: {
                        ...ledgerPayload,
                        modifiers: ledgerModifiers,
                        attackerState: getUnitSnapshot(attackingUnit),
                        targetState: targetUnitInfo.unit ? getUnitSnapshot(targetUnitInfo.unit) : null
                    }
                });
            }

            logAction(logParts.join('<br>'), gameState.currentPlayer, 4500);
            updateSupplyPointsDisplay();
            resetActionSelectionStates();
            updateSelectedUnitInfoPanel();
            if (!gameState.gameOver) checkVictoryCondition();
        }
    };

    if (gameSettings.animationsEnabled) {
        if (targetUnitInfo.isBridgeTarget) {
            // ... (keep existing bridge animation block) ...
            const bridgeEdge = gameState.edges.get(targetUnitInfo.edgeKey);
            if (bridgeEdge) {
                const targetPos = getEdgeMidpoint(bridgeEdge.q1, bridgeEdge.r1, bridgeEdge.q2, bridgeEdge.r2);
                const dummyTarget = { isFortified: false, position: targetUnitInfo.edgeKey, getScreenPosition: () => targetPos };
                const originalGetUnitScreenPosition = getUnitScreenPosition;
                getUnitScreenPosition = (unit) => {
                    if (unit === dummyTarget) return unit.getScreenPosition();
                    return originalGetUnitScreenPosition(unit);
                };

                if (attackingUnit.type.attackType === 'melee') {
                    animation.type = 'attack_lunge'; animation.duration = 250; animation.target = dummyTarget;
                    gameState.activeAnimations.push(animation);
                } else if (attackingUnit.type.attackType === 'ranged') {
                    animation.targets = [dummyTarget];
                    const startPos = originalGetUnitScreenPosition(attackingUnit);
                    const maxDistance = pointDistance(startPos, targetPos);
                    const travelDuration = maxDistance / PROJECTILE_SPEED_PIXELS_PER_MS;
                    animation.type = 'attack_projectile'; animation.duration = 150 + 250 + travelDuration;
                    animation.preShotDuration = { draw: 150, hold: 250 }; animation.travelDuration = travelDuration;
                    gameState.activeAnimations.push(animation);
                }
                setTimeout(() => { getUnitScreenPosition = originalGetUnitScreenPosition; }, animation.duration + 50);
            } else { animation.onComplete(); }
        } else if (attackingUnit.type.attackType === 'melee') {
            animation.type = 'attack_lunge'; animation.duration = 250; animation.target = targetUnitInfo.unit;
            gameState.activeAnimations.push(animation);
        } else if (attackingUnit.type.attackType === 'ranged') {
            let targets = []; let maxDistance = 0;
            const edgeOfTarget = targetUnitInfo.edgeKey ? gameState.edges.get(targetUnitInfo.edgeKey) : null;
            const enemyUnitsOnEdge = edgeOfTarget ? edgeOfTarget.units.filter(u => u.player !== attackingUnit.player) : [];
            if (edgeOfTarget && enemyUnitsOnEdge.length === 2 && !targetUnitInfo.unit.isFortified) { targets = enemyUnitsOnEdge; } else { targets.push(targetUnitInfo.unit); }
            animation.targets = targets;
            const startPos = getUnitScreenPosition(attackingUnit);
            if (startPos) {
                targets.forEach(t => {
                    const targetPos = getUnitScreenPosition(t);
                    if (targetPos) { const distance = pointDistance(startPos, targetPos); if (distance > maxDistance) maxDistance = distance; }
                });
            }
            if (maxDistance > 0) {
                const preShotDrawDuration = 150; const preShotHoldDuration = 250; const travelDuration = maxDistance / PROJECTILE_SPEED_PIXELS_PER_MS;
                animation.type = 'attack_projectile'; animation.duration = preShotDrawDuration + preShotHoldDuration + travelDuration;
                animation.preShotDuration = { draw: preShotDrawDuration, hold: preShotHoldDuration }; animation.travelDuration = travelDuration;
                gameState.activeAnimations.push(animation);
            } else { animation.onComplete(); }
        } else { animation.onComplete(); }
    } else { animation.onComplete(); }

            resetActionSelectionStates();
            updateSelectedUnitInfoPanel();
        }

        function performSwap(unit, newType) {
    // 1. Calculate HP ratio using the new stats object
    const oldRatio = unit.stats.hp / unit.stats.maxHp;
    
    // Ensure we get the correct uppercase key (e.g., "HORSEMAN")
    const newTypeKey = newType.typeName ? newType.typeName.toUpperCase() : newType.name.toUpperCase();
    const template = UNIT_TYPES[newTypeKey];

    let newHp = Math.floor(template.hp * oldRatio);
    if (newHp < 1) newHp = 1; 

    const oldType = unit.type.name;

    // 2. Update global counts
    gameState.unitCounts[`player${unit.player}`][oldType]--;
    gameState.unitCounts[`player${unit.player}`][template.name]++;

    // --- 3. B29 FIX: Update typeId and stats object ---
    unit.typeId = newTypeKey; 
    
    // Reset base stats to the new class
    unit.stats.maxHp = template.hp;
    unit.stats.hp = newHp;
    unit.stats.speed = template.speed;
    unit.stats.damage = template.damage;
    if (unit.isFortified && newTypeKey === 'ARCHER') {
        unit.stats.damage += 2;
    }
    unit.stats.defense = template.defense;
    unit.stats.range = template.attackType === 'ranged' ? 2 : 1;
    
    // Sync their Movement Points to the new speed
    unit.currentMove = unit.stats.speed;
    // ---------------------------------------------------

    triggerDamageVisual(unit, 'normal');
    logAction(`P${unit.player} morphed ${oldType} into ${template.name}.`, unit.player);

    gameState.swapState = 'complete';
    gameState.unitToSwap = null;

    updateSupplyPointsDisplay();
    showInstruction("Swap complete! Turn begins.", 2000);
}

        function handleForcedSwap() {
            if (gameState.gameMode !== 'arcade') return;
    
            const myUnits = gameState.units.filter(u => u.player === gameState.currentPlayer);
            if (myUnits.length === 0) { proceedToEndTurn(); return; }
    
            const victim = myUnits[Math.floor(Math.random() * myUnits.length)];
            const allTypes = Object.values(UNIT_TYPES);
            const validTypes = allTypes.filter(t => {
            if (t.name === victim.type.name) return false;
            if (victim.isFortified && t.defense <= 0) return false;
            return true;
        });
    
            const newType = validTypes[Math.floor(Math.random() * validTypes.length)];
    
            hideRespawnModal(); 
            performSwap(victim, newType);
            proceedToEndTurn();
        }

        function applyUnitUpgrade(unit, statType) {
            // 1. Validation
            if (!unit || unit.level >= UPGRADE_CONSTANTS.MAX_LEVEL) {
                console.warn("Upgrade failed: Max level reached or invalid unit.");
                return false;
            }
    
    const validStats = ['health', 'speed', 'damage', 'defense'];
    if (!validStats.includes(statType)) {
        console.error("Upgrade failed: Invalid stat type", statType);
        return false;
    }

    // 2. Apply Boost
    unit.level++;
    unit.upgrades[statType]++;
    
    const boostAmount = UPGRADE_CONSTANTS.BOOST_VALUES[statType];

    if (statType === 'health') {
        unit.stats.maxHp += boostAmount;
        unit.stats.hp += boostAmount; // Heal the amount gained immediately
    } else if (statType === 'speed') {
        unit.stats.speed += boostAmount;
        unit.currentMove += boostAmount; // Grant immediate MP for the turn
    } else {
        unit.stats[statType] += boostAmount;
    }

    // 3. Apply Penalty (The Trade-off Rule)
    // Rule: At 2 points, -1 to pair. At 3 points, another -1 to pair (Total -2).
    const count = unit.upgrades[statType];
    const pairedStat = UPGRADE_CONSTANTS.PAIRS[statType];
    let penaltyApplied = 0;

    if (count === 2 || count === 3) {
        
        let penaltyAmount = UPGRADE_CONSTANTS.BOOST_VALUES[pairedStat];
        
        if (pairedStat === 'health') {
            unit.stats.maxHp -= penaltyAmount;
            if (unit.stats.hp > unit.stats.maxHp) unit.stats.hp = unit.stats.maxHp;
        } else if (pairedStat === 'speed') {
            unit.stats.speed -= penaltyAmount;
            if (unit.currentMove > unit.stats.speed) unit.currentMove = unit.stats.speed;
        } else {
            unit.stats[pairedStat] -= penaltyAmount;
        }
        
        penaltyApplied = penaltyAmount;
    }

    // 4. Visuals & Logging
    triggerDamageVisual(unit, 'upgrade'); // We will add a 'gold' flash effect later
    
    let logMsg = `${unit.type.name} reached Level ${unit.level}! (+${boostAmount} ${statType})`;
    if (penaltyApplied > 0) {
        logMsg += ` (Penalty: -${penaltyApplied} ${pairedStat})`;
    }
    logAction(logMsg, unit.player);

    // 5. Ledger Recording
    if (typeof ActionManager !== 'undefined') {
        ActionManager.submitAction({
            type: "UNIT_UPGRADE",
            turn: gameState.globalTurnNumber,
            player: unit.player,
            actorId: unit.id,
            payload: {
                stat: statType,
                level: unit.level,
                penaltyStat: penaltyApplied > 0 ? pairedStat : null,
                unitState: getUnitSnapshot(unit)
            }
        });
    }

            // 6. Refresh UI
            updateSelectedUnitInfoPanel(); // Will update card when we build it
            return true;
        }

        function getUnitSnapshot(unit) {
            if (!unit) return null;
            return {
                id: unit.id,
                hp: unit.hp, // Getter accesses unit.stats.hp
                mp: Number(unit.currentMove.toFixed(2)), // Clean float precision
                pos: unit.position,
                isFortified: unit.isFortified
            };
        }

        function isZoCSuppressed(fortifiedUnit) {
            if (!fortifiedUnit || !fortifiedUnit.isFortified) return false;
    
            const tileKey = fortifiedUnit.position;
            const tile = gameState.tiles.get(tileKey);
            if (!tile) return false;

            const fortPlayer = fortifiedUnit.player;
            let totalEnemyCount = 0;
            let occupiedEdgesCount = 0;

            const neighbors = getNeighbors(tile.q, tile.r);
            for (const n of neighbors) {
                const edgeKey = getEdgeKey(tile.q, tile.r, n.q, n.r);
                const edge = gameState.edges.get(edgeKey);
        
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

        function handleMoveAction(unitToMove, targetEdgeKey, costToMove) {
    gameState.playerActionTaken[`player${gameState.currentPlayer}`] = true;

    // 1. MASTER REFERENCE CHECK
    const masterUnit = gameState.units.find(u => u.id === unitToMove.id);
    if (!masterUnit) {
        console.error("CRITICAL: Unit not found in master list during move.");
        return;
    }
    const unit = masterUnit;

    const originPos = unit.position; 

    // 2. UPDATE UNIT STATE
    unit.position = targetEdgeKey;
    unit.positionType = 'edge';
    unit.currentMove -= costToMove;

    // FLAG CAPTURE LOGIC
    if (gameState.gameMode !== 'arcade') {
        const enemyPlayer = unit.player === 1 ? 2 : 1;
        
        let enemyFlagHome = null;
        if (gameState.gridRadius === 4) {
             if (isInternalBaseEdge(targetEdgeKey)) {
                const [h1, h2] = parseEdgeKey(targetEdgeKey);
                const t1 = getTileKey(h1.q, h1.r);
                const enemyBase = gameState.baseCampPositions[`player${enemyPlayer}`];
                if (Array.isArray(enemyBase) && enemyBase.includes(t1)) enemyFlagHome = true;
            }
        } else {
            const flagObj = unit.player === 1 ? gameState.flags.p2_flag : gameState.flags.p1_flag;
            if (flagObj && flagObj.homePosition === targetEdgeKey) enemyFlagHome = true;
        }
        
        const enemyFlagObj = unit.player === 1 ? gameState.flags.p2_flag : gameState.flags.p1_flag;
        if (enemyFlagHome && enemyFlagObj.status === 'at_base') {
            enemyFlagObj.status = 'carried';
            enemyFlagObj.carrierId = unit.id;
            unit.isCarryingFlag = true;
            unit.currentMove = 0;
            logAction(`P${unit.player} ${unit.type.name} has picked up the flag!`, gameState.currentPlayer);
            updateAllHealingStatus();
            severSupplyLinesForPlayer(enemyPlayer);
            
            const victimPlayerQueue = gameState.respawnQueue[`player${enemyPlayer}`];
            victimPlayerQueue.forEach(item => {
                if (!item.timerHalved) {
                    item.turnsRemaining = Math.ceil(item.turnsRemaining / 2);
                    item.timerHalved = true;
                }
            });
            updateRespawnQueueDisplay();
            updateSupplyPointsBasedOnFlagStatus(enemyPlayer);

            const unitPos = getUnitScreenPosition(unit);
            
            // DIAGNOSTIC TRACE
            console.group("FLAG CAPTURE DIAGNOSTICS");
            console.trace("Capture Triggered");
            console.log("Calculated unitPos:", unitPos);
            
            if (unitPos) {
                gameState.visualEffects.push({
                    type: 'flag_capture_burst',
                    x: unitPos.x,
                    y: unitPos.y,
                    player: enemyPlayer,
                    startTime: Date.now(),
                    duration: 500
                });
                console.log("Pushed to visualEffects array. Current array:", gameState.visualEffects);
            } else {
                console.error("unitPos was null! Animation skipped.");
            }
            console.groupEnd();
        }
    }

    checkVictoryCondition();
    const unitDestroyedByZoC = applyFortificationDamageOnMove(unit, targetEdgeKey);

    if (typeof ActionManager !== 'undefined') {
        ActionManager.submitAction({
            type: "MOVE",
            turn: gameState.globalTurnNumber,
            player: gameState.currentPlayer,
            actorId: unit.id,
            payload: {
                from: originPos,
                to: targetEdgeKey,
                cost: costToMove,
                unitState: getUnitSnapshot(unit)
            }
        });
    }

    if (!unitDestroyedByZoC && unit.hp > 0) {
        logAction(`${unit.type.name} moved. MP: ${Math.floor(unit.currentMove)}`, gameState.currentPlayer);
        if (unit.currentMove >= 1 && (!unit.hasPerformedMajorAction || unit.type.canMoveAfterAttack)) {
            if (gameState.gameMode !== 'singleplayer' || unit.player === gameState.playerSide) {
                gameState.currentReachableMoves = getPossibleMoves(unit);
            }
        } else {
            gameState.currentReachableMoves.clear();
        }
    } else {
        gameState.currentReachableMoves.clear();
    }

    updateSelectedUnitInfoPanel();
    updateSupplyPointsDisplay();
}

// Returns an object containing Sets of visible EdgeKeys and TileKeys
function getVisibleKeysFromUnit(unit) {
    const visibleEdges = new Set();
    const visibleTiles = new Set(); 

    if (!unit) return { edges: visibleEdges, tiles: visibleTiles };

    const touchingTileKeys = new Set();

    if (unit.positionType === 'edge') {
        const [h1, h2] = parseEdgeKey(unit.position);
        if (!isNaN(h1.q)) touchingTileKeys.add(getTileKey(h1.q, h1.r));
        if (!isNaN(h2.q)) touchingTileKeys.add(getTileKey(h2.q, h2.r));

        if (!isNaN(h1.q) && !isNaN(h2.q)) {
            const n1 = getNeighbors(h1.q, h1.r);
            n1.forEach(n => {
                if (axialDistance(n.q, n.r, h2.q, h2.r) === 1) {
                    touchingTileKeys.add(getTileKey(n.q, n.r));
                }
            });
        }
    } else if (unit.positionType === 'center') {
        const t = gameState.tiles.get(unit.position);
        if (t) {
            touchingTileKeys.add(unit.position);
            getNeighbors(t.q, t.r).forEach(n => touchingTileKeys.add(getTileKey(n.q, n.r)));
        }
    }

    const isBlockedByMountain = (edgeKey) => {
        if (edgeKey === unit.position) return false; 
        if (unit.positionType === 'center' && unit.isFortified) {
            const [ea, eb] = parseEdgeKey(edgeKey);
            if (getTileKey(ea.q, ea.r) === unit.position || getTileKey(eb.q, eb.r) === unit.position) {
                return false; 
            }
        }

        const [ea, eb] = parseEdgeKey(edgeKey);
        const k1 = !isNaN(ea.q) ? getTileKey(ea.q, ea.r) : null;
        const k2 = !isNaN(eb.q) ? getTileKey(eb.q, eb.r) : null;

        const checkBlock = (k) => {
            if (!k) return false;
            const t = gameState.tiles.get(k);
            if (t && getTileVisibility(t) === 0 && touchingTileKeys.has(k)) {
                return true;
            }
            return false;
        };

        return checkBlock(k1) || checkBlock(k2);
    };

    const safeAddEdge = (key) => {
        if (!isBlockedByMountain(key)) {
            visibleEdges.add(key);
        }
    };

    const processTileVisibility = (tileKey, viewingEdgeKey) => {
        const tile = gameState.tiles.get(tileKey);
        if (!tile) return;

        let visLevel = getTileVisibility(tile);
        const tileEdges = getEdgesOfTile(tile.q, tile.r);

        if (unit.isFortified && unit.positionType === 'center') {
            if (visLevel > 0) visLevel = 1;
        }

        if (visLevel === 3) {
            tileEdges.forEach(e => safeAddEdge(e));
            visibleTiles.add(tileKey);
        } 
        else if (visLevel === 2) {
            let viewingEdgeIndex = -1;
            for(let i=0; i<6; i++) {
                const neighbor = AXIAL_DIRECTIONS[i];
                const checkKey = getEdgeKey(tile.q, tile.r, tile.q + neighbor.q, tile.r + neighbor.r);
                if (checkKey === viewingEdgeKey) {
                    viewingEdgeIndex = i;
                    break;
                }
            }

            if (viewingEdgeIndex !== -1) {
                const oppositeIndex = (viewingEdgeIndex + 3) % 6;
                for(let i=0; i<6; i++) {
                    if (i !== oppositeIndex) {
                        const neighbor = AXIAL_DIRECTIONS[i];
                        const eKey = getEdgeKey(tile.q, tile.r, tile.q + neighbor.q, tile.r + neighbor.r);
                        safeAddEdge(eKey);
                    }
                }
            }
            visibleTiles.add(tileKey);
        } 
        else if (visLevel === 1) {
            if (viewingEdgeKey) {
                const adjacentEdges = getRotationallyAdjacentEdges(viewingEdgeKey);
                adjacentEdges.forEach(adjKey => {
                    if (isEdgePartOfTile(tile.q, tile.r, adjKey)) {
                        safeAddEdge(adjKey);
                    }
                });
            }
            visibleTiles.add(tileKey);
        }
    };

    if (unit.positionType === 'edge') {
        const [h1, h2] = parseEdgeKey(unit.position);
        
        if (!isNaN(h1.q)) processTileVisibility(getTileKey(h1.q, h1.r), unit.position);
        if (!isNaN(h2.q)) processTileVisibility(getTileKey(h2.q, h2.r), unit.position);

        visibleEdges.add(unit.position);

        if (!isNaN(h1.q) && !isNaN(h2.q)) {
            const n1_neighbors = getNeighbors(h1.q, h1.r);
            const commonNeighbors = [];
            n1_neighbors.forEach(n => {
                if (axialDistance(n.q, n.r, h2.q, h2.r) === 1) commonNeighbors.push({ q: n.q, r: n.r });
            });

            commonNeighbors.forEach(n => {
                const endTileKey = getTileKey(n.q, n.r);
                const endTile = gameState.tiles.get(endTileKey);
                
                if (endTile) {
                    const vis = getTileVisibility(endTile);
                    if (vis > 0) {
                        visibleTiles.add(endTileKey);
                        
                        if (vis >= 3) {
                            const dirToA = { q: h1.q - n.q, r: h1.r - n.r };
                            const dirToB = { q: h2.q - n.q, r: h2.r - n.r };
                            const idxA = findDirectionIndex(dirToA);
                            const idxB = findDirectionIndex(dirToB);
                            const forbiddenIdx1 = (idxA + 3) % 6;
                            const forbiddenIdx2 = (idxB + 3) % 6;
                            
                            for(let i=0; i<6; i++) {
                                if (i !== forbiddenIdx1 && i !== forbiddenIdx2) {
                                    const neighborDir = AXIAL_DIRECTIONS[i];
                                    const eKey = getEdgeKey(n.q, n.r, n.q + neighborDir.q, n.r + neighborDir.r);
                                    safeAddEdge(eKey);
                                }
                            }
                        }
                    }
                }
            });
        }
    } 
    else if (unit.positionType === 'center' && unit.isFortified) {
        const myTile = gameState.tiles.get(unit.position);
        if (myTile) {
            getEdgesOfTile(myTile.q, myTile.r).forEach(e => safeAddEdge(e));
            
            getNeighbors(myTile.q, myTile.r).forEach(n => {
                const neighborKey = getTileKey(n.q, n.r);
                const sharedEdgeKey = getEdgeKey(myTile.q, myTile.r, n.q, n.r);
                processTileVisibility(neighborKey, sharedEdgeKey);
            });
        }
    }

    return { edges: visibleEdges, tiles: visibleTiles };
}

