// === Match Setup (MIXED function split, pure half - A1 step 8/12) ===
//
// Same split pattern as the rest of js/server/. initializeGrid was deeply
// interleaved (canvas sizing and DOM calls sitting between individual
// gameState resets, not cleanly grouped) - the client-owned fields
// (selectedUnit, hoveredUnitId, visionCache, fogAnimState, visionDirty,
// isPassDeviceTransition, isDragging, draggingUnit, currentReachableMoves,
// arcadeTurnTimer, swapState, unitToSwap,
// arcadeGameStartedInteraction) and every DOM/UI-refresh call all moved to
// the client wrapper (js/client/match-setup.js), reordered to run before/
// after this function rather than interleaved - safe because nothing in
// between reads intermediate state mid-function (this all runs synchronously
// to completion; nothing repaints until the next render tick regardless of
// exact statement order).
//
// Unit placement for generated maps goes through PlaceUnitsOnNewGeneratedMap
// in js/server/map-generation.js, split out of map.js in step 9.

function NewMatchId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

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
    // A new board is a new match, so last match's verdict is not this match's.
    // Missed here, the second match of a session would open already announcing
    // that somebody had won the first.
    engine.matchVerdict = null;
    engine.pendingVictory = null;
    engine.state.globalTurnNumber = 1;
    engine.state.actionLog = [];
    engine.state.matchHistory = [];

    // A6. A fresh board is a new match, and the archive keys its record on this.
    // Minted here rather than at the archive's write point so that a match already
    // in progress when the first snapshot is taken still has a stable identity.
    //
    // Not a UUID by necessity the way the profile id is - this identifies a match,
    // not a person, and nothing depends on it being unguessable. randomUUID is used
    // when it exists (Node has it unconditionally; a browser only in a secure
    // context) purely because a central archive will one day hold match ids from
    // many devices at once.
    engine.state.matchId = NewMatchId();
    engine.state.respawnQueue = { player1: [], player2: [] };
    engine.state.arcadeTotalTurns = 0;

    engine.state.unitCounts = {
        player1: { Swordsman: 0, Archer: 0, Pikeman: 0, Horseman: 0 },
        player2: { Swordsman: 0, Archer: 0, Pikeman: 0, Horseman: 0 }
    };

    if (engine.state.gameMode === 'arcade') {
        engine.state.reach = { player1: 0, player2: 0 };
        engine.state.rations = { player1: 0, player2: 0 };
        engine.state.flags = null;
    } else {
        engine.state.reach = { player1: MAX_SUPPLY_REACH, player2: MAX_SUPPLY_REACH };
        engine.state.rations = { player1: STARTING_RATIONS, player2: STARTING_RATIONS };
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
                            // Board space: a hexPath's fine key is the SUM of its two
                            // tile coordinates, and a unit standing there stores exactly
                            // that string. No positionType test is needed any more - a
                            // hexCenter key has both coordinates even and can never equal
                            // a hexPath key, so the comparison alone is unambiguous.
                            const fineKey = (tile.q + n_coord.q) + ',' + (tile.r + n_coord.r);
                            return engine.state.units.filter(u => u.position === fineKey);
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

            // Custom/preset unit lists still name an EDGE, because that is what a
            // human writing a map thinks in. Converted here rather than accepted by
            // createUnit - see the note on its signature.
            if (type && engine.state.edges.has(unitInfo.position)) {
                const newUnit = createUnit(unitInfo.player, type, FineKeyOfEdge(unitInfo.position));
                engine.state.units.push(newUnit);
            }
        });
    } else if (tileLayoutMap && tileLayoutMap !== DEFAULT_MAP_LAYOUT_RADIUS_3) {
        const limit = getMaxUnitsForCurrentMap();
        PlaceUnitsOnNewGeneratedMap(limit);
    } else {
        if (engine.state.gameMode === 'arcade') {
            engine.state.units.push(createUnit(1, 'SWORDSMAN', '1,-4'));
            engine.state.units.push(createUnit(1, 'ARCHER', '-3,-1'));
            engine.state.units.push(createUnit(2, 'SWORDSMAN', '-1,4'));
            engine.state.units.push(createUnit(2, 'ARCHER', '3,1'));
        } else {
            // The default opening on the Standard board, in board space - the same
            // coordinates the debug overlay prints, so a placement read off the screen
            // is typed in here verbatim with no conversion in between. 1,-5 is the
            // hexPath between tiles 0,-2 and 1,-3, because a hexPath's fine coordinate
            // is the sum of its two tiles.
            //
            // Swordsman and Horseman moved out one ring 2026-09-08, from the
            // plains/forest hexPaths beside the base to the plains/water shoreline.
            engine.state.units.push(createUnit(1, 'SWORDSMAN', '1,-5'));
            engine.state.units.push(createUnit(1, 'ARCHER', '-3,-1'));
            engine.state.units.push(createUnit(1, 'PIKEMAN', '-1,-3'));
            engine.state.units.push(createUnit(1, 'HORSEMAN', '-5,1'));

            engine.state.units.push(createUnit(2, 'SWORDSMAN', '-1,5'));
            engine.state.units.push(createUnit(2, 'ARCHER', '3,1'));
            engine.state.units.push(createUnit(2, 'PIKEMAN', '1,3'));
            engine.state.units.push(createUnit(2, 'HORSEMAN', '5,-1'));
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

// === Resuming a hosted match from a save file (B2) ===
//
// A room can start from a saved game instead of a fresh map. This is the worker's half:
// take a save that has ALREADY been through Testament on the uploader's machine and turn
// it back into a live board.
//
// Why migration happens on the client and not here: the modernisation question ("migrate
// to the modern ruleset?") is a decision only a person can make, and the person is the
// host player standing in the lobby. They answer it there, with the prompt that already
// exists, and what arrives here is a settled, current-version save. This worker never has
// to ask anybody anything, which is the only way it can stay a pure function of its input.
//
// The client's own load path (ApplyLoadedState + rehydrateGameState in js/client/save.js)
// does the same job plus a pile of things that have no meaning without a screen: canvas
// sizing, colour themes, CSS variables, animation state. Only the board half is repeated
// here, and the pieces it needs (buildFineGridIndex, UNIT_TYPES) are already in this
// bundle.
//
// The fields are listed rather than taken from Testament's SAVE_ENGINE_FIELDS because
// that list carries `profile` - who WROTE the file. That is metadata about a device, and
// pushing it onto engine.state would make the host adopt a stranger's identity and then
// write it into the next save. See the standing note in js/client/save.js.
const RESUME_ENGINE_FIELDS = [
    'gameMode', 'playerSide', 'gridRadius', 'playerColorSelections',
    'units', 'currentPlayer', 'globalTurnNumber', 'actionLog', 'matchHistory',
    'unitIdCounter', 'flags', 'respawnQueue', 'unitCounts', 'reach', 'rations',
    'baseCampPositions', 'gameOver', 'arcadeTotalTurns', 'playerActionTaken',
    'matchId',
];

function ResumeMatchFromSave(save) {
    if (!save || typeof save !== 'object') return { ok: false, error: 'no save data' };
    if (!save.tiles) return { ok: false, error: 'that save has no board in it' };

    // The grid has to exist at the right size before anything is poured into it, for the
    // same reason a map does: see the start-match handler in host/match-worker.js.
    const radius = save.gridRadius || 3;
    SetGridMode(radius);
    InitializeGridDimensions(radius);

    RESUME_ENGINE_FIELDS.forEach(field => {
        if (save[field] !== undefined) engine.state[field] = save[field];
    });

    // SetGridMode wrote a mode from the radius; the save's own mode is the truth and
    // overrides it. A radius-3 save of a match that was arcade stays arcade.
    if (save.gameMode !== undefined) engine.state.gameMode = save.gameMode;

    // NEVER carried over from a local save: the seats decide who plays which side in a
    // hosted match, and a save that recorded "this device is player 1" would otherwise
    // bind BOTH clients to the same army.
    engine.state.playerSide = null;

    engine.state.tiles = Array.isArray(save.tiles)
        ? new Map(save.tiles)
        : new Map(Object.entries(save.tiles || {}));

    // Edges are NOT stored by the lean schema - they are regenerated from the tiles, so
    // an absent edge list is the normal case for a file that has not been expanded yet.
    //
    // Leaving whatever InitializeGridDimensions built is wrong, and wrong in a way that
    // hides: for a map that fills its grid the fresh edges happen to be exactly the right
    // ones, so it looks correct. A save of a SMALL custom map resumed that way ended up
    // with 2 tiles and 90 edges. RebuildEdges is what ExpandSaveObject uses for the same
    // job, and it is in this bundle.
    const savedEdges = save.edges && (Array.isArray(save.edges) ? save.edges.length : true);
    if (savedEdges) {
        engine.state.edges = Array.isArray(save.edges)
            ? new Map(save.edges)
            : new Map(Object.entries(save.edges));
    } else {
        // RebuildEdges reads tile.q / tile.r and only joins tiles that both exist, so a
        // lean tile - which stores neither, both being derivable from its key - would
        // produce ZERO edges rather than an error. Filled in from the key first.
        engine.state.tiles.forEach((tile, key) => {
            if (tile && tile.q === undefined) {
                const [q, r] = String(key).split(",").map(Number);
                tile.q = q;
                tile.r = r;
            }
        });
        engine.state.edges = new Map(RebuildEdges([...engine.state.tiles], save.bridges));
    }

    RelinkResumedUnits();

    // Derived, never trusted from a file: a Map becomes {} through JSON.
    buildFineGridIndex();

    engine.visionCache = null;
    engine.visionDirty = true;

    if (!engine.state.matchId) engine.state.matchId = NewMatchId();
    engine.state.actionLog = engine.state.actionLog || [];

    return { ok: true, units: engine.state.units.length, tiles: engine.state.tiles.size };
}

// type/hp/maxHp are getters, dropped on the way into a save because they are derived.
// `enumerable: true` is load-bearing on all three: the codebase spreads units freely, and
// a non-enumerable `type` means `{ ...unit }` produces a unit with no type at all.
//
// `edge.units` is the opposite and MUST stay non-enumerable: it is a getter over the whole
// unit list, and an enumerable one serialises every unit on the board straight past fog
// redaction. That has happened once already, from the map-generation path.
function RelinkResumedUnits() {
    engine.state.units = engine.state.units || [];

    engine.state.units.forEach(unit => {
        if (!unit.typeId && unit.typeName) unit.typeId = unit.typeName;

        Object.defineProperty(unit, 'type', {
            get: function () { return UNIT_TYPES[this.typeId]; },
            configurable: true,
            enumerable: true,
        });
        Object.defineProperty(unit, 'hp', {
            get: function () { return this.stats.hp; },
            set: function (value) { this.stats.hp = value; },
            configurable: true,
            enumerable: true,
        });
        Object.defineProperty(unit, 'maxHp', {
            get: function () { return this.stats.maxHp; },
            set: function (value) { this.stats.maxHp = value; },
            configurable: true,
            enumerable: true,
        });

        // positionType/isFortified/fortifiedTileKey/tileKey/edgeKey. Stored fields
        // before the cutover, so a resumed unit used to get them by copying; derived
        // now, so they have to be put back.
        AttachDerivedUnitAccessors(unit);
    });

    // No reference relinking needed: an edge does not hold units, it computes them.
    engine.state.edges.forEach((edge, edgeKey) => {
        Object.defineProperty(edge, 'units', {
            get: function () {
                const fineKey = (edge.q1 + edge.q2) + ',' + (edge.r1 + edge.r2);
                return engine.state.units.filter(unit => unit.position === fineKey);
            },
            configurable: true,
            enumerable: false,
        });
    });
}
