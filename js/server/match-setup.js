// === Match Setup (MIXED function split, pure half — A1 step 8/12) ===
//
// Same split pattern as the rest of js/server/. initializeGrid was deeply
// interleaved (canvas sizing and DOM calls sitting between individual
// gameState resets, not cleanly grouped) — the client-owned fields
// (selectedUnit, hoveredUnitId, visionCache, fogAnimState, visionDirty,
// isPassDeviceTransition, isDragging, draggingUnit, currentReachableMoves,
// arcadeTurnTimer, swapState, unitToSwap,
// arcadeGameStartedInteraction) and every DOM/UI-refresh call all moved to
// the client wrapper (js/client/match-setup.js), reordered to run before/
// after this function rather than interleaved — safe because nothing in
// between reads intermediate state mid-function (this all runs synchronously
// to completion; nothing repaints until the next render tick regardless of
// exact statement order).
//
// Unit placement for generated maps goes through PlaceUnitsOnNewGeneratedMap
// in js/server/map-generation.js, split out of map.js in step 9.

function InitializeGrid(tileLayoutMap = null, customUnits = null, baseCampData = null) {
    // 1. Setup Base Camp Defaults if needed
    if (baseCampData) {
        engine.state.baseCampPositions = JSON.parse(JSON.stringify(baseCampData));
    } else if (!tileLayoutMap && !customUnits) {
        engine.state.baseCampPositions = JSON.parse(JSON.stringify(DEFAULT_FLAG_HOME_POSITIONS));
    } else if (tileLayoutMap === DEFAULT_MAP_LAYOUT_RADIUS_3) {
        engine.state.baseCampPositions = JSON.parse(JSON.stringify(DEFAULT_FLAG_HOME_POSITIONS));
    }

    // Reset Game State (engine-owned)
    engine.state.tiles.clear();
    engine.state.edges.clear();
    engine.state.units = [];
    engine.state.gameOver = false;
    engine.state.currentPlayer = 1;
    engine.state.globalTurnNumber = 1;
    engine.state.actionLog = [];
    engine.state.matchHistory = [];
    engine.state.respawnQueue = { player1: [], player2: [] };
    engine.state.arcadeTotalTurns = 0;

    engine.state.unitCounts = {
        player1: { Melee: 0, Archer: 0, Pikeman: 0, Horseman: 0 },
        player2: { Melee: 0, Archer: 0, Pikeman: 0, Horseman: 0 }
    };

    if (engine.state.gameMode === 'arcade') {
        engine.state.supplyPoints = { player1: 0, player2: 0 };
        engine.state.flags = null;
    } else {
        engine.state.supplyPoints = { player1: 10, player2: 10 };
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
                    engine.state.tiles.set(keyStr, { q, r, type: rehydratedType, fortifiedByPlayer: null, isBaseCampTile: false });
                }
            } else {
                engine.state.tiles.set(keyStr, { q, r, type: finalType, fortifiedByPlayer: null, isBaseCampTile: false });
            }
        });
    } else {
        DEFAULT_MAP_LAYOUT_RADIUS_3.forEach((type, key) => {
            const [q, r] = key.split(',').map(Number);
            engine.state.tiles.set(key, { q, r, type, fortifiedByPlayer: null, isBaseCampTile: false });
        });
    }

    // BASE CAMP FLAGGING
    if (engine.state.gridRadius !== 2) {
        const p1Tiles = GetBaseCamp(1);
        const p2Tiles = GetBaseCamp(2);

        [...p1Tiles, ...p2Tiles].forEach(key => {
            const tile = engine.state.tiles.get(key);
            if (tile) {
                tile.type = TILE_TYPES.PLAINS;
                tile.isBaseCampTile = true;
            }
        });
    }

    // Generate Edges
    engine.state.tiles.forEach(tile => {
        getNeighbors(tile.q, tile.r).forEach(n_coord => {
            if (engine.state.tiles.has(getTileKey(n_coord.q, n_coord.r))) {
                const edgeKey = getEdgeKey(tile.q, tile.r, n_coord.q, n_coord.r);
                if (!engine.state.edges.has(edgeKey)) {
                    const newEdge = { q1: tile.q, r1: tile.r, q2: n_coord.q, r2: n_coord.r, bridge: false, bridgeHp: null, isPathway: true };
                    Object.defineProperty(newEdge, 'units', {
                        get: function() {
                            return engine.state.units.filter(u => u.positionType === 'edge' && u.position === edgeKey && (!engine.unitVisibilityFilter || engine.unitVisibilityFilter(u)));
                        },
                        configurable: true,
                        enumerable: false
                    });
                    engine.state.edges.set(edgeKey, newEdge);
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

            if (type && engine.state.edges.has(unitInfo.position)) {
                const newUnit = createUnit(unitInfo.player, type, unitInfo.position);
                engine.state.units.push(newUnit);
            }
        });
    } else if (tileLayoutMap && tileLayoutMap !== DEFAULT_MAP_LAYOUT_RADIUS_3) {
        const limit = getMaxUnitsForCurrentMap();
        PlaceUnitsOnNewGeneratedMap(limit);
    } else {
        if (engine.state.gameMode === 'arcade') {
            engine.state.units.push(createUnit(1, 'MELEE', getEdgeKey(1, -2, 0, -2)));
            engine.state.units.push(createUnit(1, 'ARCHER', getEdgeKey(-2, 0, -1, -1)));
            engine.state.units.push(createUnit(2, 'MELEE', getEdgeKey(-1, 2, 0, 2)));
            engine.state.units.push(createUnit(2, 'ARCHER', getEdgeKey(1, 1, 2, 0)));
        } else {
            engine.state.units.push(createUnit(1, 'MELEE', getEdgeKey(1, -2, 0, -2)));
            engine.state.units.push(createUnit(1, 'ARCHER', getEdgeKey(-2, 0, -1, -1)));
            engine.state.units.push(createUnit(1, 'PIKEMAN', getEdgeKey(-1, -1, 0, -2)));
            engine.state.units.push(createUnit(1, 'HORSEMAN', getEdgeKey(-2, 0, -2, 1)));

            engine.state.units.push(createUnit(2, 'MELEE', getEdgeKey(-1, 2, 0, 2)));
            engine.state.units.push(createUnit(2, 'ARCHER', getEdgeKey(1, 1, 2, 0)));
            engine.state.units.push(createUnit(2, 'PIKEMAN', getEdgeKey(0, 2, 1, 1)));
            engine.state.units.push(createUnit(2, 'HORSEMAN', getEdgeKey(2, 0, 2, -1)));
        }
    }

    // Initialize Unit State
    engine.state.units.forEach(unit => {
        unit.currentMove = unit.stats.speed;
        unit.hasPerformedMajorAction = false;
    });

    // Initialize Flags
    if (engine.state.gameMode !== 'arcade') {
        if (engine.state.baseCampPositions.player1 && engine.state.baseCampPositions.player2) {
            engine.state.flags = {
                'p1_flag': { id: 'p1_flag', player: 1, homePosition: engine.state.baseCampPositions.player1, status: 'at_base', carrierId: null },
                'p2_flag': { id: 'p2_flag', player: 2, homePosition: engine.state.baseCampPositions.player2, status: 'at_base', carrierId: null }
            };
        }
    }

    buildFineGridIndex();

    return {};
}
