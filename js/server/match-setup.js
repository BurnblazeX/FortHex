// === Match Setup (MIXED function split, pure half — A1 step 8/12) ===
//
// Same split pattern as the rest of js/server/. initializeGrid was deeply
// interleaved (canvas sizing and DOM calls sitting between individual
// gameState resets, not cleanly grouped) — the client-owned fields
// (selectedUnit, hoveredUnitId, visionCache, fogAnimState, visionDirty,
// isPassDeviceTransition, isDragging, draggingUnit, currentReachableMoves,
// arcadeTurnTimer, swapState, unitToSwap, arcadeTotalTurns,
// arcadeGameStartedInteraction) and every DOM/UI-refresh call all moved to
// the client wrapper (js/client/match-setup.js), reordered to run before/
// after this function rather than interleaved — safe because nothing in
// between reads intermediate state mid-function (this all runs synchronously
// to completion; nothing repaints until the next render tick regardless of
// exact statement order).
//
// Still calls into map.js's placeUnitsOnNewGeneratedMap, which hasn't been
// split yet (that's step 9, deferred until after main.js is finished per
// user request) — whatever map.js currently is, this just calls it exactly
// as the original did.

function InitializeGrid(tileLayoutMap = null, customUnits = null, baseCampData = null) {
    // 1. Setup Base Camp Defaults if needed
    if (baseCampData) {
        gameState.baseCampPositions = JSON.parse(JSON.stringify(baseCampData));
    } else if (!tileLayoutMap && !customUnits) {
        gameState.baseCampPositions = JSON.parse(JSON.stringify(DEFAULT_FLAG_HOME_POSITIONS));
    } else if (tileLayoutMap === DEFAULT_MAP_LAYOUT_RADIUS_3) {
        gameState.baseCampPositions = JSON.parse(JSON.stringify(DEFAULT_FLAG_HOME_POSITIONS));
    }

    // Reset Game State (engine-owned)
    gameState.tiles.clear();
    gameState.edges.clear();
    gameState.units = [];
    gameState.gameOver = false;
    gameState.currentPlayer = 1;
    gameState.globalTurnNumber = 1;
    gameState.actionLog = [];
    gameState.matchHistory = [];
    gameState.respawnQueue = { player1: [], player2: [] };

    gameState.unitCounts = {
        player1: { Melee: 0, Archer: 0, Pikeman: 0, Horseman: 0 },
        player2: { Melee: 0, Archer: 0, Pikeman: 0, Horseman: 0 }
    };

    if (gameState.gameMode === 'arcade') {
        gameState.supplyPoints = { player1: 0, player2: 0 };
        gameState.flags = null;
    } else {
        gameState.supplyPoints = { player1: 10, player2: 10 };
    }

    // Load Tiles
    if (tileLayoutMap) {
        const standardizedMap = (tileLayoutMap instanceof Map) ? tileLayoutMap : new Map(tileLayoutMap);
        const firstValue = standardizedMap.values().next().value;
        const isComplexObject = firstValue && (firstValue.type !== undefined) && (firstValue.type.name !== undefined);

        standardizedMap.forEach((value, key) => {
            const keyStr = String(key);
            const [q, r] = keyStr.split(',').map(Number);

            let finalType = value;
            if (value && value.name === 'Plains' && value.isBaseCampTile !== undefined) {
                finalType = TILE_TYPES.PLAINS;
            }

            if (isComplexObject) {
                if (finalType.type && finalType.type.name) {
                    const typeName = finalType.type.name.toUpperCase();
                    const rehydratedType = TILE_TYPES[typeName] || TILE_TYPES.PLAINS;
                    gameState.tiles.set(keyStr, { q, r, type: rehydratedType, fortifiedByPlayer: null, isBaseCampTile: false });
                }
            } else {
                gameState.tiles.set(keyStr, { q, r, type: finalType, fortifiedByPlayer: null, isBaseCampTile: false });
            }
        });
    } else {
        DEFAULT_MAP_LAYOUT_RADIUS_3.forEach((type, key) => {
            const [q, r] = key.split(',').map(Number);
            gameState.tiles.set(key, { q, r, type, fortifiedByPlayer: null, isBaseCampTile: false });
        });
    }

    // BASE CAMP FLAGGING
    if (gameState.gridRadius !== 2) {
        const p1Tiles = GetBaseCamp(1);
        const p2Tiles = GetBaseCamp(2);

        [...p1Tiles, ...p2Tiles].forEach(key => {
            const tile = gameState.tiles.get(key);
            if (tile) {
                tile.type = TILE_TYPES.PLAINS;
                tile.isBaseCampTile = true;
            }
        });
    }

    // Generate Edges
    gameState.tiles.forEach(tile => {
        getNeighbors(tile.q, tile.r).forEach(n_coord => {
            if (gameState.tiles.has(getTileKey(n_coord.q, n_coord.r))) {
                const edgeKey = getEdgeKey(tile.q, tile.r, n_coord.q, n_coord.r);
                if (!gameState.edges.has(edgeKey)) {
                    const newEdge = { q1: tile.q, r1: tile.r, q2: n_coord.q, r2: n_coord.r, bridge: false, bridgeHp: null, isPathway: true };
                    Object.defineProperty(newEdge, 'units', {
                        get: function() {
                            return gameState.units.filter(u => u.positionType === 'edge' && u.position === edgeKey && (!gameState.draggingUnit || u.id !== gameState.draggingUnit.id));
                        },
                        configurable: true,
                        enumerable: false
                    });
                    gameState.edges.set(edgeKey, newEdge);
                }
            }
        });
    });

    // Place Units
    if (customUnits) {
        customUnits.forEach(unitInfo => {
            if (!unitInfo || !unitInfo.typeName) return;
            const typeName = unitInfo.typeName.toUpperCase();
            const type = UNIT_TYPES[typeName];

            if (type && gameState.edges.has(unitInfo.position)) {
                const newUnit = createUnit(unitInfo.player, type, unitInfo.position);
                gameState.units.push(newUnit);
            }
        });
    } else if (tileLayoutMap && tileLayoutMap !== DEFAULT_MAP_LAYOUT_RADIUS_3) {
        const limit = getMaxUnitsForCurrentMap();
        placeUnitsOnNewGeneratedMap(limit);
    } else {
        if (gameState.gameMode === 'arcade') {
            gameState.units.push(createUnit(1, 'MELEE', getEdgeKey(1, -2, 0, -2)));
            gameState.units.push(createUnit(1, 'ARCHER', getEdgeKey(-2, 0, -1, -1)));
            gameState.units.push(createUnit(2, 'MELEE', getEdgeKey(-1, 2, 0, 2)));
            gameState.units.push(createUnit(2, 'ARCHER', getEdgeKey(1, 1, 2, 0)));
        } else {
            gameState.units.push(createUnit(1, 'MELEE', getEdgeKey(1, -2, 0, -2)));
            gameState.units.push(createUnit(1, 'ARCHER', getEdgeKey(-2, 0, -1, -1)));
            gameState.units.push(createUnit(1, 'PIKEMAN', getEdgeKey(-1, -1, 0, -2)));
            gameState.units.push(createUnit(1, 'HORSEMAN', getEdgeKey(-2, 0, -2, 1)));

            gameState.units.push(createUnit(2, 'MELEE', getEdgeKey(-1, 2, 0, 2)));
            gameState.units.push(createUnit(2, 'ARCHER', getEdgeKey(1, 1, 2, 0)));
            gameState.units.push(createUnit(2, 'PIKEMAN', getEdgeKey(0, 2, 1, 1)));
            gameState.units.push(createUnit(2, 'HORSEMAN', getEdgeKey(2, 0, 2, -1)));
        }
    }

    // Initialize Unit State
    gameState.units.forEach(unit => {
        unit.currentMove = unit.stats.speed;
        unit.hasPerformedMajorAction = false;
    });

    // Initialize Flags
    if (gameState.gameMode !== 'arcade') {
        if (gameState.baseCampPositions.player1 && gameState.baseCampPositions.player2) {
            gameState.flags = {
                'p1_flag': { id: 'p1_flag', player: 1, homePosition: gameState.baseCampPositions.player1, status: 'at_base', carrierId: null },
                'p2_flag': { id: 'p2_flag', player: 2, homePosition: gameState.baseCampPositions.player2, status: 'at_base', carrierId: null }
            };
        }
    }

    buildFineGridIndex();

    return {};
}
