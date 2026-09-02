// === Save payload assembly ===
//
// Before the engine.state cutover a save was just `{...gameState}` plus the
// tiles/edges Maps, because gameState held everything. It doesn't any more, so
// spreading it silently dropped every engine-owned field (units, currentPlayer,
// flags, supplyPoints, gridRadius...) out of both the autosave and the .fhsave
// file, and loading rebuilt an empty radius-3 board. These two helpers are the
// single place that knows which fields live on which side.
//
// fineGrid is deliberately absent: it's derived, and rehydrateGameState()
// rebuilds it via buildFineGridIndex().
//
// A5 note: `profile` is deliberately NOT in this list. A save carries who wrote
// it, but that is a fact about the file, not state the engine owns - so it must
// not be pushed onto engine.state at load. See ApplyLoadedState below for where
// it does land, and why loading a save never adopts its author as this device.
const ENGINE_SAVE_FIELDS = [
    'gameMode', 'playerSide', 'gridRadius', 'playerColorSelections',
    'units', 'currentPlayer', 'globalTurnNumber', 'actionLog', 'matchHistory',
    'unitIdCounter', 'flags', 'respawnQueue', 'unitCounts', 'supplyPoints',
    'baseCampPositions', 'gameOver', 'arcadeTotalTurns', 'isTrainingMode',
    'mapMakerMode', 'playerActionTaken',

    // A6. Unlike `profile`, this one DOES belong on engine.state: which match this
    // is, is a fact about the match. It is what keeps a saved-then-resumed game
    // updating one archive record instead of forking a second partial one.
    'matchId'
];

// Goes through Testament's canonical serializer (A4 §8), the same one
// ResolveDisconnectOutcome uses — two paths to one nominal format would defeat
// having a single versioned schema at all.
//
// The result is the skeleton: no edge list (regenerated from the tiles), no action
// log (rebuilt from matchHistory), no type objects repeating a config-data.js
// constant, no coordinates the key already holds, and none of the client's
// presentation state, and no unit field that merely holds its default. Measured
// across the ten archived fixtures that is a 91% reduction. Everything dropped is
// either rebuilt at load or was never read back.
function BuildSaveState() {
    const { save } = BuildSaveObject(engine, { arcadeTurnTimer: gameState.arcadeTurnTimer });
    save.saveVersion = BUILD_VERSION;
    return save;
}

// Splits a loaded save back across the two owners. Call before
// rehydrateGameState(), which expects engine.state.tiles/edges to hold the
// raw arrays and turns them back into Maps.
function ApplyLoadedState(loadedState) {
    ENGINE_SAVE_FIELDS.forEach(field => {
        if (loadedState[field] !== undefined) {
            engine.state[field] = loadedState[field];
        }
    });
    if (loadedState.tiles !== undefined) engine.state.tiles = loadedState.tiles;
    if (loadedState.edges !== undefined) engine.state.edges = loadedState.edges;

    // What's left is the client's half. Strip the engine keys so gameState doesn't
    // accumulate a stale shadow copy of state it no longer owns.
    //
    // MERGED onto the live gameState rather than replacing it (changed in A4). The
    // lean schema deliberately saves almost no client state, so a wholesale replace
    // would leave gameState missing fields the client assumes exist — visualEffects
    // is pushed to unguarded by HandleActionEvent, and would be undefined on the
    // next flag capture. Merging keeps the client's own defaults for anything the
    // file legitimately doesn't carry; rehydrateGameState resets the transient ones
    // and re-links selectedUnit/draggingUnit, so nothing stale survives that matters.
    gameState = { ...gameState, ...loadedState };
    ENGINE_SAVE_FIELDS.forEach(field => { delete gameState[field]; });
    delete gameState.tiles;
    delete gameState.edges;

    // A6. A save written before this version has no match identity to keep, so it
    // gets one now — once, here, rather than inside a migration, which has to stay
    // pure. Everything written from B30 onward arrives with its own id and keeps it.
    if (!engine.state.matchId) engine.state.matchId = NewMatchId();

    // A5. `profile` is not an ENGINE_SAVE_FIELD, so it survives the merge above
    // and sits on gameState as a record of who wrote the file. Nothing reads it
    // back into localStorage, and that is the point: a save is evidence of who
    // played a match, never a credential. Loading a friend's save must not make
    // this browser think it is them - the only thing that writes a local profile
    // is js/client/profile.js, from the Online flow.
}

function saveSettings() {
    try {
        // animationsEnabled and fogOfWarEnabled live on engine.settings now, but
        // they're still user preferences that have to survive a reload - the
        // engine owns the value, localStorage just persists it.
        const settingsString = JSON.stringify({
            ...gameSettings,
            animationsEnabled: engine.settings.animationsEnabled,
            fogOfWarEnabled: engine.settings.fogOfWarEnabled,
        });
        localStorage.setItem(SETTINGS_STORAGE_KEY, settingsString);
    } catch (error) {
        console.error("Could not save settings:", error);
    }
}

function loadSettings() {
    try {
        const savedSettingsString = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (savedSettingsString) {
            const { animationsEnabled, fogOfWarEnabled, ...clientPrefs } = JSON.parse(savedSettingsString);
            gameSettings = Object.assign({}, gameSettings, clientPrefs);
            if (typeof animationsEnabled === 'boolean') engine.settings.animationsEnabled = animationsEnabled;
            if (typeof fogOfWarEnabled === 'boolean') engine.settings.fogOfWarEnabled = fogOfWarEnabled;
        }
    } catch (error) {
        console.error("Could not load settings:", error);
    }
}

function saveColorPreferences() {
    try {
        const prefsString = JSON.stringify(engine.state.playerColorSelections);
        localStorage.setItem(COLOR_PREF_STORAGE_KEY, prefsString);
    } catch (error) {
        console.error("Could not save color preferences:", error);
    }
}

function loadColorPreferences() {
    try {
        const savedPrefsString = localStorage.getItem(COLOR_PREF_STORAGE_KEY);
        if (savedPrefsString) {
            const loadedPrefs = JSON.parse(savedPrefsString);
            engine.state.playerColorSelections = Object.assign({}, engine.state.playerColorSelections, loadedPrefs);

            TEAM_COLORS.player1 = { ...COLOR_THEMES[engine.state.playerColorSelections.player1].player1 };
            TEAM_COLORS.player2 = { ...COLOR_THEMES[engine.state.playerColorSelections.player2].player2 };
        }
    } catch (error) {
        console.error("Could not load color preferences:", error);
    }
}

function autoSaveGame(isSilent = false) {
    if (engine.state.isTrainingMode) return;
    if (gameState.isDragging) {
        // console.log("[Autosave] Skipped: Unit is dragging."); // Optional spam reduction
        if (!isSilent) showInstruction("Cannot save while dragging.", 2000);
        return;
    }
    if (gameState.isTestingMap) {
        return; 
    }

    try {
        console.groupCollapsed("[Autosave] Saving Game State...");
        console.log("Current Mode:", engine.state.gameMode);
        console.log("Current Radius:", engine.state.gridRadius);
        console.log("Turn:", engine.state.globalTurnNumber);
        
        if (engine.state.gameMode === 'arcade') {
            console.log("Arcade Timer:", gameState.arcadeTurnTimer);
            console.log("Swap State:", gameState.swapState);
        }

        const gameStateString = JSON.stringify(BuildSaveState());
        const saveKey = engine.state.gameMode === 'singleplayer' ? 'forthexSaveGame_sp' : 'forthexSaveGame';
        
        console.log(`Saving to key: ${saveKey}`);
        console.log("Serialized Length:", gameStateString.length);

        localStorage.setItem(saveKey, gameStateString);
        
        if (!isSilent) { showInstruction("Game Saved!", 2000); }
        console.log("Autosave successful.");
        console.groupEnd();
    } catch (error) {
        console.error("[Autosave] CRITICAL ERROR:", error);
        showInstruction("Could not save game. See console.", 3000);
        console.groupEnd();
    }
}

function saveGameToFile() {

    if (gameState.isTestingMap) {
        showInstruction("Cannot download saves while testing a map.", 2500);
        return;
    }

    // --- Create the custom filename ---
    const now = new Date();
    const day = padZero(now.getDate());
    const month = padZero(now.getMonth() + 1); // JS months are 0-indexed
    const year = now.getFullYear();
    const hours = padZero(now.getHours());
    const minutes = padZero(now.getMinutes());
    const seconds = padZero(now.getSeconds());
    const modePrefix = engine.state.gameMode === 'singleplayer' ? 'SP-' : '';
    const fileName = `FortHex-${BUILD_VERSION}-${modePrefix}SaveGame-${day}.${month}.${year}-${hours}:${minutes}:${seconds}.fhsave`;

    try {
        // --- Serialize the game state (same as autosave) ---
        const gameStateString = JSON.stringify(BuildSaveState(), null, 2); // Using indentation for readability

        // --- Trigger the file download ---
        const blob = new Blob([gameStateString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showInstruction("Save file downloaded!", 2500);

    } catch (error) {
        console.error("Error saving game to file:", error);
        showInstruction("Could not create save file. See console.", 3000);
    }
}

// === Loading, through Testament (A4) ===
//
// This replaced attemptLegacyConversion: one reactive pass that tried to patch
// every broken shape from B20 to B29 at once, with no idea which version it was
// actually looking at. The ordered chain that does that job properly lives in
// js/testament.js, shared by both sides. What is left here is the client edge —
// running the chain, reporting what it found, and handing the rest of this file
// the shape it already expects.
function LoadThroughTestament(data) {
    const outcome = MigrateSave(data);
    // The action log is rebuilt from matchHistory rather than stored, so expansion
    // needs to know who is watching: under fog a player's log shows their own
    // actions and what happened to their own units, not the whole board's history.
    const expanded = ExpandSaveObject(outcome.data, {
        forPlayer: outcome.data.playerSide || outcome.data.currentPlayer,
        fogOfWarEnabled: engine.settings.fogOfWarEnabled,
    });
    const report = outcome.report;

    const from = report.fromVersion === null ? 'unrecognised' : 'v' + report.fromVersion;
    console.groupCollapsed('[Testament] ' + from + ' -> v' + report.toVersion +
                           (report.steps.length ? ' (' + report.steps.join(', ') + ')' : ' (already current)'));
    report.warnings.forEach(w => console.warn(w));
    report.corrections.forEach(c => console.log('corrected: ' + c));
    console.groupEnd();

    // Repairs are worth saying out loud — the player's file was wrong and is not
    // any more. Warnings stay in the console; they are not the player's problem.
    if (report.corrections.length) {
        showInstruction('Repaired ' + report.corrections.length + ' problem(s) in this file.', 3000);
    }

    // Back-compat for the rest of save.js, which predates the lean schema: a map
    // file is read through `radius`, and loadMapFromDataObject gates on the build
    // label rather than on the schema version.
    expanded.saveVersion = BUILD_VERSION;
    if (expanded.radius === undefined) expanded.radius = expanded.gridRadius;

    return expanded;
}

function createMapDataObject() {
    const mapData = {
        saveVersion: BUILD_VERSION,
        radius: engine.state.gridRadius,
        tiles: Array.from(engine.state.tiles.entries()),
        units: engine.state.units.map(u => ({
            id: u.id,
            player: u.player,
            typeName: (u.type && u.type.name) ? u.type.name.toUpperCase() : (u.typeId || 'MELEE'),
            position: u.position
        })),
        baseCampPositions: engine.state.baseCampPositions
    };
    return mapData;
}

function loadAutoSave() {
    console.group("[LoadAutosave] Process Started");

    if (engine.state.mapMakerMode) {
        const savedMapString = localStorage.getItem(MAP_MAKER_AUTOSAVE_KEY);
        if (!savedMapString) {
            showInstruction("No autosaved map found.", 2000);
            console.groupEnd();
            return;
        }
        try {
            let mapData = JSON.parse(savedMapString);
            loadMapFromDataObject(mapData);
        } catch (error) {
            console.error(error);
            showInstruction("Map Load Error.", 3000);
        }
    } else {
        const saveKey = engine.state.gameMode === 'singleplayer' ? 'forthexSaveGame_sp' : 'forthexSaveGame';
        console.log("Loading key:", saveKey);
        
        const savedStateString = localStorage.getItem(saveKey);
        if (!savedStateString) {
            showInstruction("No saved game found.", 2000);
            console.groupEnd();
            return;
        }

        try {
            let loadedState = JSON.parse(savedStateString);
            
            // 1. Convert
            loadedState = LoadThroughTestament(loadedState);

            // 2. Resize Environment (Calculates renderScale global)
            const radiusToLoad = loadedState.gridRadius || 3;
            console.log(`Resizing grid to Radius ${radiusToLoad}`);
            resizeMapGrid(radiusToLoad);
            
            // CAPTURE THE CORRECT SCALE calculated by resizeMapGrid
            const correctScale = gameState.renderScale;
            const correctOffset = gameState.renderOffset;

            // 3. Apply State
            console.log("Applying State...");
            ApplyLoadedState(loadedState);
            
            // RESTORE THE CORRECT SCALE (In case loadedState had undefined/wrong scale)
            gameState.renderScale = correctScale;
            gameState.renderOffset = correctOffset;
            console.log(`Forced Render Scale to: ${gameState.renderScale}`);

            // 4. Rehydrate
            rehydrateGameState();
            
            // 5. Restore UI
            if (engine.state.gameMode === 'arcade') {
                ui.endTurnButton.classList.add('arcade-timer-active');
                const timerVal = gameState.arcadeTurnTimer || 0;
                const pct = Math.max(0, (timerVal / ARCADE_TURN_TIME_SEC) * 100);
                const activeColor = '#E04030'; 
                const emptyColor = '#C03020';
                ui.endTurnButton.style.background = `linear-gradient(to right, ${activeColor} ${pct}%, ${emptyColor} ${pct}%)`;
                ui.endTurnButton.textContent = `End Turn (${Math.ceil(timerVal)}s)`;
                
                const supplyContainer = document.getElementById('supplyPointsContainer');
                if (supplyContainer) supplyContainer.style.display = 'block';
            } else {
                ui.endTurnButton.classList.remove('arcade-timer-active');
                ui.endTurnButton.style.background = '';
                ui.endTurnButton.textContent = "End Turn";
            }

            fullGameRedraw();
            showInstruction("Game Loaded.", 2000);

            // A4: singleplayer and online saves ask which side to continue on.
            // Local pass-device resumes on whoever was to move and never asks.
            MaybePromptForSide();
        } catch (error) {
            console.error("Load Critical Failure:", error);
            showInstruction("Save File Corrupted.", 3000);
        }
    }
    console.groupEnd();
}

function rehydrateGameState() {
    console.groupCollapsed("[Rehydrate] Restoring Game Objects...");
    
    try {
        // 1. Restore Tiles
        if (Array.isArray(engine.state.tiles)) {
            engine.state.tiles = new Map(engine.state.tiles);
        } else {
            engine.state.tiles = new Map(Object.entries(engine.state.tiles || {}));
        }

        // 2. Restore Edges
        if (Array.isArray(engine.state.edges)) {
            engine.state.edges = new Map(engine.state.edges);
        } else {
            engine.state.edges = new Map(Object.entries(engine.state.edges || {}));
        }

        // 3. Restore Reachable Moves
        if (Array.isArray(gameState.currentReachableMoves)) {
            gameState.currentReachableMoves = new Map(gameState.currentReachableMoves);
        } else {
            gameState.currentReachableMoves = new Map();
        }

        // 3b. Rebuild the fine-grid index from the freshly restored tiles/edges.
        // It's derived data — never trust whatever the save serialised it into (a Map
        // becomes a plain {} through JSON, which would break resolveFineCoord()).
        buildFineGridIndex();

        // 4. Restore Global Color State
        if (engine.state.playerColorSelections) {
            const p1Theme = COLOR_THEMES[engine.state.playerColorSelections.player1];
            const p2Theme = COLOR_THEMES[engine.state.playerColorSelections.player2];
            if (p1Theme && p2Theme) {
                TEAM_COLORS.player1 = { ...p1Theme.player1 };
                TEAM_COLORS.player2 = { ...p2Theme.player2 };
                currentDrawingColors.player1 = { ...TEAM_COLORS.player1 };
                currentDrawingColors.player2 = { ...TEAM_COLORS.player2 };
                updateCssVariables();
            }
        }

        gameState.activeAnimations = [];
        
        // --- TRANSIENT VISUAL STATE RESET ---
        // Prevents loaded JSON objects from breaking Map/Set functions
        gameState.fogAnimState = null;
        engine.visionCache = null;
        engine.visionDirty = true;
        gameState.isPassDeviceTransition = false;

        // 5. Restore Unit Logic (Getters & Stats)
        //
        // enumerable: true is LOAD-BEARING, not decoration. A live unit from
        // createUnit carries type/hp/maxHp as ordinary enumerable properties, and
        // the codebase spreads units freely — ai.js builds a `ghostUnit` as
        // `{ ...unit, position }` to score a hypothetical move, then reads
        // ghostUnit.type.attackType.
        //
        // Object.defineProperty only defaults an unspecified attribute to false
        // when the property is NEW. Before A4 these three were always already
        // present as enumerable data properties (the old save format stored them),
        // so converting them to accessors silently KEPT enumerable:true and every
        // spread still worked. A4's lean schema stopped saving them — correctly,
        // they're derived — which made them new properties here, and non-enumerable
        // by default. Spreading then dropped them, and the AI's first ghost unit
        // died on `undefined.attackType`.
        //
        // So: say enumerable explicitly, and loaded units behave exactly like units
        // that were never saved at all.
        engine.state.units.forEach(unit => {
            // Re-attach 'type' getter
            Object.defineProperty(unit, 'type', {
                get: function() { return UNIT_TYPES[this.typeId]; },
                configurable: true,
                enumerable: true
            });

            // Re-attach legacy 'hp'/'maxHp' getters/setters for compatibility
            Object.defineProperty(unit, 'hp', {
                get: function() { return this.stats.hp; },
                set: function(val) { this.stats.hp = val; },
                configurable: true,
                enumerable: true
            });
            Object.defineProperty(unit, 'maxHp', {
                get: function() { return this.stats.maxHp; },
                set: function(val) { this.stats.maxHp = val; },
                configurable: true,
                enumerable: true
            });

            // Ensure Linkage
            if (!unit.typeId && unit.typeName) unit.typeId = unit.typeName;
            if (!unit.type) console.warn("Unknown Unit Type ID:", unit.typeId);
        });

        // 5b. Re-link unit REFERENCES to the real array members. JSON has no reference
        // sharing, so selectedUnit/draggingUnit/unitToSwap deserialise as detached clones
        // that the getter loop above never touched. Acting on a clone mutates the copy
        // while tile state mutates the real board, desyncing the game.
        const relinkUnitRef = (ref) => {
            if (!ref || !ref.id) return null;
            return engine.state.units.find(u => u.id === ref.id) || null;
        };
        gameState.selectedUnit = relinkUnitRef(gameState.selectedUnit);
        gameState.draggingUnit = relinkUnitRef(gameState.draggingUnit);
        gameState.unitToSwap = relinkUnitRef(gameState.unitToSwap);

        // 6. Re-link Units to Edges (Re-attach Getters)
        engine.state.edges.forEach((edge, edgeKey) => {
            Object.defineProperty(edge, 'units', {
                get: function() { 
                    return engine.state.units.filter(u => u.positionType === 'edge' && u.position === edgeKey);
                },
                configurable: true,
                enumerable: false
            });
        });

        // 7. Clean Sweep / Sanity Checks
        console.log("Running post-load sanity checks...");
        
        // A. Fix illegally fortified units (Defense <= 0)
        // We clone the array because handleUnitDeath modifies engine.state.units
        const unitsToCheck = [...engine.state.units]; 
        for (const unit of unitsToCheck) {
            if (unit.isFortified && unit.stats.defense <= 0) {
                console.warn(`[Clean Sweep] Unit ${unit.id} illegally fortified. Evicting...`);
                const validTargets = getPotentialUnfortifyTargets(unit);
                
                if (validTargets.length === 0) {
                    handleUnitDeath(unit, "crushed");
                } else {
                    logAction(`P${unit.player} ${unit.type.name} was forced to retreat due to 0 defense.`, unit.player);
                    // This queues the unfortify animation to play as soon as the canvas loads!
                    completeUnfortify(unit, validTargets[0]); 
                }
            }
        }

        // B. Check for stuck Reinforcement Modals
        if (engine.state.gameMode !== 'arcade') {
            const activePlayer = engine.state.currentPlayer;
            const queueKey = `player${activePlayer}`;
            const queue = engine.state.respawnQueue[queueKey];
            
            if (queue && queue.length > 0 && queue[0].turnsRemaining <= 0) {
                console.warn(`[Clean Sweep] P${activePlayer} has pending reinforcements. Opening modal...`);
                // We use a tiny timeout so it pops up AFTER fullGameRedraw() finishes setting up the UI
                setTimeout(() => showRespawnModal(activePlayer), 100);
            }
        }

    } catch (err) {
        console.error("[Rehydrate] Error:", err);
    }
    console.groupEnd();
}



function autoSaveMap() {
    if (!engine.state.mapMakerMode) return;
    try {
        const mapData = createMapDataObject();
        localStorage.setItem(MAP_MAKER_AUTOSAVE_KEY, JSON.stringify(mapData));
        console.log("Map autosaved to localStorage.");
    } catch (error) {
        console.error("Error autosaving map:", error);
    }
}

function loadMapFromDataObject(mapData) {
    try {
        mapData = LoadThroughTestament(mapData);
    } catch (error) {
        console.error("Conversion failed:", error);
        showInstruction(error.message, 3000);
        return false;
    }

    if (!mapData || mapData.saveVersion !== BUILD_VERSION) {
        showInstruction("Map data is invalid.", 3000);
        return false;
    }

    if (!engine.state.mapMakerMode) {
        enterMapMakerMode();
    }

    let loadedRadius = mapData.radius || 3;
    resizeMapGrid(loadedRadius);

    engine.state.units = [];
    engine.state.tiles.clear();

    mapData.tiles.forEach(([key, tile]) => {
        const rehydratedTile = { ...tile,
            type: TILE_TYPES[tile.type.name.toUpperCase()]
        };
        engine.state.tiles.set(key, rehydratedTile);
    });

    mapData.units.forEach(unitInfo => {
        // Map files store typeName; game saves store typeId. Accept either, or every
        // unit in a .fhsave opened through the map maker is silently dropped.
        const typeKey = (unitInfo.typeName || unitInfo.typeId || "").toUpperCase();
        const unitType = UNIT_TYPES[typeKey];
        
        if (unitType) {
            const newUnit = createUnit(unitInfo.player, unitType, unitInfo.position, unitInfo.id);
            engine.state.units.push(newUnit);
            const edge = engine.state.edges.get(unitInfo.position);
            if (edge) {
                edge.units.push(newUnit);
            }
        } else {
            console.warn(`Skipped unknown unit type: ${unitInfo.typeName}`);
        }
    });

    engine.state.baseCampPositions = mapData.baseCampPositions || { player1: null, player2: null };

    // resizeMapGrid(2) nulls engine.state.flags for arcade, so this must be guarded the same
    // way startMapTest does it — otherwise loading any Compact (radius 2) map throws.
    if (engine.state.flags) {
        engine.state.flags.p1_flag.homePosition = engine.state.baseCampPositions.player1;
        engine.state.flags.p2_flag.homePosition = engine.state.baseCampPositions.player2;
    }

    const setBaseFlags = (baseData) => {
        if (!baseData) return;
        if (Array.isArray(baseData)) {
            baseData.forEach(k => {
                const tile = engine.state.tiles.get(k);
                if (tile) { 
                    tile.type = TILE_TYPES.PLAINS; 
                    tile.isBaseCampTile = true; 
                }
            });
        } else if (typeof baseData === 'string') {
            const [h1, h2] = parseEdgeKey(baseData);
            [getTileKey(h1.q, h1.r), getTileKey(h2.q, h2.r)].forEach(k => {
                const tile = engine.state.tiles.get(k);
                if (tile) { 
                    tile.type = TILE_TYPES.PLAINS; 
                    tile.isBaseCampTile = true; 
                }
            });
        }
    };
    setBaseFlags(engine.state.baseCampPositions.player1);
    setBaseFlags(engine.state.baseCampPositions.player2);

    const sliderToRotations = [3, 2, 1, 0, -1, -2];
    let matchingSliderValue = '3'; 

    if (mapData.baseCampPositions.player1 && typeof mapData.baseCampPositions.player1 === 'string') {
        for (let i = 0; i < sliderToRotations.length; i++) {
            const rotations = sliderToRotations[i];
            const p1_default = parseEdgeKey(DEFAULT_FLAG_HOME_POSITIONS.player1);
            const p1_h1_rotated = rotateAxial(p1_default[0].q, p1_default[0].r, rotations);
            const p1_h2_rotated = rotateAxial(p1_default[1].q, p1_default[1].r, rotations);
            const testEdgeKey = getEdgeKey(p1_h1_rotated.q, p1_h1_rotated.r, p1_h2_rotated.q, p1_h2_rotated.r);

            if (testEdgeKey === mapData.baseCampPositions.player1) {
                matchingSliderValue = i.toString();
                break; 
            }
        }
    }

    const bcSlider = document.getElementById('baseCampSlider');
    if (bcSlider) bcSlider.value = matchingSliderValue;

    // engine.state.tiles was cleared and repopulated from mapData above, so the index
    // resizeMapGrid built no longer necessarily matches the board.
    buildFineGridIndex();

    showInstruction("Map loaded successfully!", 2000);
    return true;
}


// === Reference match log capture ===
//
// Downloads the current match's action ledger with enough context that two
// captures can be meaningfully diffed. The A1 handoff wants a before/after
// reference set taken before Track C's fine-grid migration, and A2 touched the
// whole action path, so the same trick catches drift there too.
//
// Console:  ExportMatchHistory('before-trackC')
//
// Play the same opening the same way twice - same map, same moves, same order -
// and diff the two files. Divergence means a rule changed, not that the new
// architecture is "differently correct".
function ExportMatchHistory(label = 'reference') {
    const capture = {
        label,
        capturedAt: new Date().toISOString(),
        build: BUILD_VERSION,

        // Context that changes what a legal move even is, so a diff can rule out
        // "different map" before it starts blaming the code.
        setup: {
            gameMode: engine.state.gameMode,
            playerSide: engine.state.playerSide,
            gridRadius: engine.state.gridRadius,
            fogOfWarEnabled: engine.settings.fogOfWarEnabled,
            baseCampPositions: engine.state.baseCampPositions,
        },

        // Where the match ended up. A matching history with a different final
        // board means a mutation changed without its ledger entry changing.
        outcome: {
            turn: engine.state.globalTurnNumber,
            currentPlayer: engine.state.currentPlayer,
            gameOver: engine.state.gameOver,
            supplyPoints: engine.state.supplyPoints,
            units: engine.state.units
                .map(u => ({ id: u.id, player: u.player, type: u.type.name, hp: u.hp,
                             pos: u.position, fortified: !!u.isFortified }))
                .sort((a, b) => a.id - b.id),
        },

        entryCount: engine.state.matchHistory.length,
        matchHistory: engine.state.matchHistory,
    };

    const safeLabel = String(label).replace(/[^A-Za-z0-9_-]/g, '-');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([JSON.stringify(capture, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FortHex-${BUILD_VERSION}-matchlog-${safeLabel}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`[Capture] ${capture.entryCount} ledger entries exported as "${safeLabel}".`);
    showInstruction(`Match log exported (${capture.entryCount} entries).`, 2500);
    return capture;
}
