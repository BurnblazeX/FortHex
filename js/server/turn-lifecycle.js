// === Turn Lifecycle (MIXED functions split, pure half — A1 step 8) ===
//
// Same split pattern as js/server/actions.js (A1 step 7): pure state mutation
// + returned events, thin client wrapper of the same name in
// js/client/game-flow.js does the actual DOM/UI/AI-scheduling work.
//
// checkVictoryCondition and proceedToEndTurn also pull in the AI-reaction
// logic (evolveBrain, brain win/loss bookkeeping, finalizeTrainingSamples) per
// explicit user request — these are plain computation with zero localStorage/
// DOM dependency (verified by grep across ai.js). What stays client-side:
// savePopulation/loadPopulation/maybeEvolvePopulation/startNewTrainingMatch,
// which are localStorage-entangled (maybeEvolvePopulation calls
// savePopulation internally, startNewTrainingMatch conditionally calls
// loadPopulation) — the guide's own §7 guardrail already flags these as
// staying client-only until AI persistence is redesigned, not something this
// step should route around. executeAITurn (the actual AI move-playing loop)
// also stays client-side — it's async UI-turn orchestration, not a reaction
// to compute.
//
// gameState.gameOver moves from "client-owned by default" (A1 step 4's
// tentative classification, since it wasn't in the guide's explicit §5.1
// list) to genuinely engine-owned now that real turn-lifecycle logic needs to
// set it authoritatively. Flagging the reclassification rather than doing it
// silently.

function DetermineVictoryText() {
    if (gameState.gameOver) return null;
    let victoryText = null;

    if (gameState.isTrainingMode && gameState.globalTurnNumber >= 30) {
        const p1CurrentHP = gameState.units.filter(u => u.player === 1).reduce((sum, u) => sum + u.hp, 0);
        const p2CurrentHP = gameState.units.filter(u => u.player === 2).reduce((sum, u) => sum + u.hp, 0);

        const p1DamageDealt = 46 - p2CurrentHP;
        const p2DamageDealt = 46 - p1CurrentHP;

        if (p1DamageDealt > p2DamageDealt && p1DamageDealt > 0) {
            victoryText = "Player 1 Wins by Aggression (Tiebreaker)!";
        } else if (p2DamageDealt > p1DamageDealt && p2DamageDealt > 0) {
            victoryText = "Player 2 Wins by Aggression (Tiebreaker)!";
        } else {
            victoryText = "It's a Draw! (Timeout)";
        }
    }

    if (gameState.gameMode === 'arcade') {
        const player1Units = gameState.units.filter(u => u.player === 1);
        const player2Units = gameState.units.filter(u => u.player === 2);

        if (gameState.tiles.size > 0) {
            if (player1Units.length === 0 && player2Units.length > 0) {
                victoryText = "Player 2 Wins by Annihilation!";
            } else if (player2Units.length === 0 && player1Units.length > 0) {
                victoryText = "Player 1 Wins by Annihilation!";
            } else if (player1Units.length === 0 && player2Units.length === 0) {
                victoryText = "It's a Draw!";
            }
        }
    } else {
        for (const unit of gameState.units) {
            if (unit.isCarryingFlag) {
                const carrierPlayer = unit.player;
                const carrierHomeBaseData = gameState.baseCampPositions[`player${carrierPlayer}`];
                let isHome = false;

                if (Array.isArray(carrierHomeBaseData)) {
                    if (unit.positionType === 'center') {
                        if (carrierHomeBaseData.includes(unit.position)) {
                            isHome = true;
                        }
                    } else {
                        const [h1, h2] = parseEdgeKey(unit.position);
                        if (!isNaN(h1.q) && !isNaN(h2.q)) {
                            const t1 = getTileKey(h1.q, h1.r);
                            const t2 = getTileKey(h2.q, h2.r);
                            if (carrierHomeBaseData.includes(t1) && carrierHomeBaseData.includes(t2)) {
                                isHome = true;
                            }
                        }
                    }
                } else {
                    if (unit.position === carrierHomeBaseData) {
                        isHome = true;
                    } else if (unit.positionType === 'center') {
                        const [h1, h2] = parseEdgeKey(carrierHomeBaseData);
                        const t1 = getTileKey(h1.q, h1.r);
                        const t2 = getTileKey(h2.q, h2.r);
                        if (unit.position === t1 || unit.position === t2) {
                            isHome = true;
                        }
                    }
                }

                if (isHome) {
                    victoryText = `Player ${carrierPlayer} captured the flag and wins!`;
                    break;
                }
            }
        }

        if (!victoryText) {
            const player1Units = gameState.units.filter(u => u.player === 1);
            const player2Units = gameState.units.filter(u => u.player === 2);

            if (gameState.tiles.size > 0) {
                if (player1Units.length === 0 && player2Units.length > 0) {
                    victoryText = "Player 2 Wins by Annihilation!";
                } else if (player2Units.length === 0 && player1Units.length > 0) {
                    victoryText = "Player 1 Wins by Annihilation!";
                } else if (player1Units.length === 0 && player2Units.length === 0) {
                    victoryText = "It's a Draw!";
                }
            }
        }
    }

    return victoryText;
}

// Returns a result object the client wrapper uses to decide what to show:
//   victory: false — nothing else meaningful, wrapper just re-enables the
//     "new map" button.
//   victory: true, isTrainingMode: true — wrapper restarts training
//     (startNewTrainingMatch/executeAITurn) instead of showing the victory
//     screen. needsPopulationMaintenance tells it to call
//     maybeEvolvePopulation()+savePopulation() (localStorage, must stay
//     client-side).
//   victory: true, isTrainingMode: false — wrapper shows the standard DOM
//     victory screen. needsSavePopulation covers the singleplayer
//     champion-brain-update case.
function CheckVictoryCondition() {
    if (gameState.gameOver) return { victory: true, alreadyOver: true };

    const victoryText = DetermineVictoryText();
    if (!victoryText) {
        return { victory: false };
    }

    const events = [];

    if (gameState.isTrainingMode) {
        let winningPlayer = null;
        if (victoryText.includes("Player 1")) winningPlayer = 1;
        else if (victoryText.includes("Player 2")) winningPlayer = 2;

        if (winningPlayer && gameState.matchBrains) {
            const losingPlayer = winningPlayer === 1 ? 2 : 1;
            const winnerBrain = gameState.matchBrains[`player${winningPlayer}`];
            const loserBrain = gameState.matchBrains[`player${losingPlayer}`];

            winnerBrain.matchesPlayed++;
            winnerBrain.wins++;
            loserBrain.matchesPlayed++;
            loserBrain.losses++;

            evolveBrain(winnerBrain, true, victoryText, winningPlayer, gameState.matchHistory);
            evolveBrain(loserBrain, false, victoryText, losingPlayer, gameState.matchHistory);

            finalizeTrainingSamples(winningPlayer, 1);
            finalizeTrainingSamples(losingPlayer, 0);
        } else if (victoryText.includes("Draw") && gameState.matchBrains) {
            const brainA = gameState.matchBrains.player1;
            const brainB = gameState.matchBrains.player2;

            [brainA, brainB].forEach(brain => {
                brain.matchesPlayed++;
                brain.draws = (brain.draws || 0) + 1;
                applyDrawPenalty(brain);
            });

            finalizeTrainingSamples(1, 0.5);
            finalizeTrainingSamples(2, 0.5);
        }

        gameState.gameOver = false;

        return {
            victory: true,
            isTrainingMode: true,
            needsPopulationMaintenance: true,
            victoryText,
            events,
        };
    }

    let isSingleplayerVictory = false;
    let aiVictory = false;
    if (gameState.gameMode === 'singleplayer') {
        isSingleplayerVictory = true;
        const aiPlayerNum = gameState.playerSide === 1 ? 2 : 1;
        aiVictory = victoryText.includes(`Player ${aiPlayerNum}`);

        const championBrain = getChampionBrain();
        championBrain.matchesPlayed++;
        if (aiVictory) championBrain.wins++; else championBrain.losses++;
        evolveBrain(championBrain, aiVictory, victoryText, aiPlayerNum, gameState.matchHistory);
        finalizeTrainingSamples(aiPlayerNum, aiVictory ? 1 : 0);
    }

    gameState.gameOver = true;

    return {
        victory: true,
        isTrainingMode: false,
        isSingleplayerVictory,
        aiVictory,
        needsSavePopulation: isSingleplayerVictory,
        victoryText,
        events,
    };
}

function ApplyStartOfTurnZoCDamage() {
    const events = [];
    const activePlayer = gameState.currentPlayer;
    const enemyPlayer = activePlayer === 1 ? 2 : 1;
    let unitsToDestroy = [];
    let zocEvents = [];

    const activePlayerBaseData = gameState.baseCampPositions[`player${activePlayer}`];
    let activePlayerBaseTiles = [];

    if (Array.isArray(activePlayerBaseData)) {
        activePlayerBaseTiles = activePlayerBaseData;
    } else if (typeof activePlayerBaseData === 'string') {
        activePlayerBaseTiles = activePlayerBaseData.split('_');
    }

    gameState.units.forEach(unit => {
        if (unit.player !== enemyPlayer) return;

        if (unit.positionType === 'edge' && !unit.isFortified) {
            const edgeKey = unit.position;
            const edgeTileCoords = parseEdgeKey(edgeKey);
            if (edgeTileCoords.some(coord => isNaN(coord.q))) return;

            const tile1Key = getTileKey(edgeTileCoords[0].q, edgeTileCoords[0].r);
            const tile2Key = getTileKey(edgeTileCoords[1].q, edgeTileCoords[1].r);
            const tile1 = gameState.tiles.get(tile1Key);
            const tile2 = gameState.tiles.get(tile2Key);

            const checkTileZoC = (tile, tKey) => {
                if (!tile) return false;
                if (activePlayerBaseTiles.includes(tKey)) return true;

                if (tile.fortifiedByPlayer === activePlayer) {
                    const fortUnit = gameState.units.find(u => u.isFortified && u.position === tKey && u.player === activePlayer);
                    if (fortUnit && !isZoCSuppressed(fortUnit)) return true;
                }
                return false;
            };

            if (checkTileZoC(tile1, tile1Key) || checkTileZoC(tile2, tile2Key)) {
                unit.hp -= FORTIFICATION_DAMAGE;
                events.push({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });

                zocEvents.push({
                    unitId: unit.id,
                    damage: FORTIFICATION_DAMAGE,
                    remainingHp: unit.hp,
                    isFatal: unit.hp <= 0
                });

                events.push({ type: 'LOG', text: `P${unit.player} ${unit.type.name} takes start-of-turn ZoC. HP: ${unit.hp}`, player: activePlayer, duration: 3500 });
                if (unit.hp <= 0 && !unitsToDestroy.find(u => u.id === unit.id)) {
                    unitsToDestroy.push(unit);
                }
            }
        } else if (unit.positionType === 'center' && unit.isFortified) {
            if (activePlayerBaseTiles.includes(unit.fortifiedTileKey)) {
                unit.hp -= FORTIFICATION_DAMAGE;
                events.push({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });

                zocEvents.push({
                    unitId: unit.id,
                    damage: FORTIFICATION_DAMAGE,
                    remainingHp: unit.hp,
                    isFatal: unit.hp <= 0
                });

                events.push({ type: 'LOG', text: `P${unit.player} ${unit.type.name} takes Base Camp ZoC. HP: ${unit.hp}`, player: activePlayer, duration: 3500 });
                if (unit.hp <= 0 && !unitsToDestroy.find(u => u.id === unit.id)) {
                    unitsToDestroy.push(unit);
                }
            }
        }
    });

    if (zocEvents.length > 0 && typeof ActionManager !== 'undefined') {
        ActionManager.submitAction({
            type: "TURN_START_ZOC",
            turn: gameState.globalTurnNumber,
            player: activePlayer,
            payload: { events: zocEvents }
        });
    }

    for (const u of unitsToDestroy) {
        const deathResult = DestroyUnitIfExists(u, "zoc_turn_start");
        events.push(...deathResult.events);
    }

    return { events };
}

function ApplyMountainAttrition() {
    const events = [];
    const activePlayer = gameState.currentPlayer;
    const attritionEvents = [];
    const unitsToDestroy = [];

    gameState.units.forEach(unit => {
        if (unit.player !== activePlayer || !isUnitOnMountainPeak(unit)) return;

        const playerFlag = gameState.flags ? gameState.flags[`p${unit.player}_flag`] : null;
        const flagStolen = !!(playerFlag && playerFlag.status === 'carried');

        if (!flagStolen && isUnitSupplied(unit)) {
            unit.mountainAttritionTurns = 0;
            return;
        }

        unit.mountainAttritionTurns = (unit.mountainAttritionTurns || 0) + 1;
        const damage = unit.mountainAttritionTurns;

        unit.hp -= damage;
        events.push({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });

        attritionEvents.push({
            unitId: unit.id,
            damage: damage,
            remainingHp: unit.hp,
            isFatal: unit.hp <= 0
        });

        events.push({ type: 'LOG', text: `P${unit.player} ${unit.type.name} takes ${damage} mountain attrition. HP: ${unit.hp}`, player: activePlayer, duration: 3500 });

        if (unit.hp <= 0 && !unitsToDestroy.find(u => u.id === unit.id)) {
            unitsToDestroy.push(unit);
        }
    });

    if (attritionEvents.length > 0 && typeof ActionManager !== 'undefined') {
        ActionManager.submitAction({
            type: "TURN_START_MOUNTAIN_ATTRITION",
            turn: gameState.globalTurnNumber,
            player: activePlayer,
            payload: { events: attritionEvents }
        });
    }

    unitsToDestroy.forEach(u => {
        const deathResult = DestroyUnitIfExists(u, "mountain_attrition");
        events.push(...deathResult.events);
    });

    return { events };
}

function ApplyStartOfTurnHealing() {
    const events = [];
    if (gameState.gameMode === 'arcade') return { events };

    const playerFlag = gameState.flags[`p${gameState.currentPlayer}_flag`];
    if (playerFlag && playerFlag.status === 'carried') {
        return { events };
    }

    let healingEvents = [];

    gameState.units.forEach(unit => {
        if (unit.player !== gameState.currentPlayer || !unit.isFortified || unit.hp >= (unit.maxHp + 1)) {
            return;
        }

        const recentlyAttacked = gameState.globalTurnNumber < unit.lastAttackedByHostileOnTurn + 2;
        if (recentlyAttacked) {
            return;
        }

        if (isUnitOnMountainPeak(unit)) {
            return;
        }

        if (isUnitSupplied(unit)) {
            const oldHp = unit.hp;
            unit.hp++;
            const activePlayer = gameState.currentPlayer;

            let type = 'HEAL';
            if (unit.hp === unit.maxHp + 1) type = 'SHIELD';

            healingEvents.push({
                unitId: unit.id,
                type: type,
                amount: 1,
                finalHp: unit.hp
            });

            if (oldHp < unit.maxHp && unit.hp === unit.maxHp) {
                events.push({ type: 'LOG', text: `P${unit.player} ${unit.type.name} healed to full HP.`, player: activePlayer, duration: 2500 });
            } else if (unit.hp === unit.maxHp + 1) {
                events.push({ type: 'LOG', text: `P${unit.player} ${unit.type.name} gained a shield!`, player: activePlayer, duration: 2500 });
                events.push({ type: 'SHIELD_GAINED', unit });
            } else {
                events.push({ type: 'LOG', text: `P${unit.player} ${unit.type.name} healed 1 HP.`, player: activePlayer, duration: 2500 });
            }
        }
    });

    if (healingEvents.length > 0 && typeof ActionManager !== 'undefined') {
        ActionManager.submitAction({
            type: "TURN_START_HEAL",
            turn: gameState.globalTurnNumber,
            player: gameState.currentPlayer,
            payload: { events: healingEvents }
        });
    }

    return { events };
}

function LogSiegeStatus() {
    const events = [];
    if (gameState.gameMode === 'arcade' || !gameState.flags) return { events };

    const activePlayer = gameState.currentPlayer;
    const playerFlag = gameState.flags[`p${activePlayer}_flag`];

    if (playerFlag && playerFlag.status === 'carried') {
        const existingLog = gameState.actionLog[gameState.actionLog.length - 1];
        if (!existingLog || !existingLog.message.includes('Healing is disabled')) {
            events.push({ type: 'LOG', text: `P${activePlayer}'s flag is stolen! All healing is disabled.`, player: activePlayer });
        }
    }

    gameState.units.forEach(unit => {
        if (unit.player === activePlayer && unit.isFortified && unit.supplyLine && unit.supplyLine.path) {
            const isIntercepted = unit.supplyLine.path.some(edgeKey => {
                const edge = gameState.edges.get(edgeKey);
                return edge && edge.units.some(u => u.player !== unit.player);
            });

            if (isIntercepted) {
                events.push({ type: 'LOG', text: `P${unit.player} ${unit.type.name} is under siege and cannot heal!`, player: activePlayer });
            }
        }
    });

    return { events };
}

// Pure half of handleRespawnQueue: decrements timers (engine-owned
// respawnQueue) and reports whether a unit is ready. Whether that means
// showing the respawn modal (human) or letting the AI/training loop handle it
// silently is a client-side decision — the wrapper makes it.
function ApplyRespawnQueueTick() {
    if (gameState.gameMode === 'arcade') return { hasQueue: false, unitReady: false };

    const player = gameState.currentPlayer;
    const queueKey = `player${player}`;
    const queue = gameState.respawnQueue[queueKey];

    if (!queue || queue.length === 0) {
        return { hasQueue: false, unitReady: false };
    }

    queue.forEach(item => {
        if (item.turnsRemaining > 0) {
            item.turnsRemaining--;
        }
    });

    const firstItem = queue[0];
    const unitReady = !!(firstItem && firstItem.turnsRemaining <= 0);

    return { hasQueue: true, unitReady, player };
}

// Pure half of proceedToEndTurn: the actual turn-switch + per-unit reset
// rules, plus calling the pure siblings above in the original order. All the
// pass-device overlay / AI-kickoff-timer / autosave / arcade-timer UI
// orchestration stays in the client wrapper (js/client/game-flow.js).
async function AdvanceTurn() {
    const events = [];

    if (gameState.gameMode === 'arcade' && gameState.currentPlayer === 2) {
        gameState.arcadeTotalTurns++;
        if (gameState.arcadeTotalTurns >= ARCADE_MAX_TURNS) {
            return { arcadeMaxTurnsReached: true, events };
        }
    }

    const previousPlayer = gameState.currentPlayer;
    gameState.playerActionTaken[`player${previousPlayer}`] = false;

    gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
    gameState.playerActionTaken[`player${gameState.currentPlayer}`] = false;

    let turnNumberAdvanced = false;
    if (previousPlayer === 2 && gameState.currentPlayer === 1) {
        gameState.globalTurnNumber++;
        turnNumberAdvanced = true;
    }

    gameState.units.forEach(unit => {
        if (unit.player === gameState.currentPlayer) {
            unit.hasPerformedMajorAction = false;
            unit.spearWalled = false;
            unit.ambushed = false;

            let baseMoveForTurn = unit.stats.speed;
            if (unit.isCarryingFlag) { baseMoveForTurn -= 1; }
            unit.currentMove = Math.max(0, baseMoveForTurn);

            if (unit.isFortified) {
                unit.turnsFortified++;
            } else {
                unit.turnsFortified = 0;
                if (unit.fortifyCooldown > 0) unit.fortifyCooldown = Math.max(0, unit.fortifyCooldown - 5);
            }

            const playerBaseTiles = GetBaseCamp(unit.player);
            if (unit.isFortified && playerBaseTiles.includes(unit.fortifiedTileKey)) {
                unit.turnsFortifiedAtBase++;
                if (unit.turnsFortifiedAtBase > MAX_BASE_CAMP_TURNS) {
                    const deathResult = DestroyUnitIfExists(unit, "cowardice");
                    events.push(...deathResult.events);
                }
            }
        }
    });

    const respawnResult = ApplyRespawnQueueTick();

    const zocResult = ApplyStartOfTurnZoCDamage();
    events.push(...zocResult.events);

    const resupplyResult = AttemptToResupplyForts(gameState.currentPlayer);
    events.push(...resupplyResult.events);

    const siegeResult = LogSiegeStatus();
    events.push(...siegeResult.events);

    const attritionResult = ApplyMountainAttrition();
    events.push(...attritionResult.events);

    const healingResult = ApplyStartOfTurnHealing();
    events.push(...healingResult.events);

    // NOTE: "Turn Begins" is NOT pushed here even though it looks like it
    // belongs with the other turn-start logs above — in the original, it
    // fires from inside finalizeVisuals, AFTER the pass-device overlay
    // resolves, while everything above fires immediately/before the overlay.
    // The client wrapper (proceedToEndTurn) logs it itself at the right time.

    return {
        arcadeMaxTurnsReached: false,
        turnNumberAdvanced,
        respawnResult,
        events,
    };
}