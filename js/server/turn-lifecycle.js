// === Turn Lifecycle (MIXED functions split, pure half — A1 step 8) ===
//
// Same split pattern as js/server/actions.js (A1 step 7): pure state mutation,
// player-visible outcomes pushed onto the engine's event queue via
// engine.Emit(), and a thin client wrapper of the same name in
// js/client/game-flow.js that drains the queue and does the DOM/UI/
// AI-scheduling work.
//
// The AI-reaction logic that used to live in CheckVictoryCondition (evolveBrain,
// brain win/loss bookkeeping, finalizeTrainingSamples) is NOT here any more.
// It was moved to ApplyTrainingMatchOutcome/ApplySingleplayerMatchOutcome in
// js/client/game-flow.js during the js/server/ purge: the brain population is
// localStorage-backed and client-only per the guide's §7 guardrail, so calling
// into it from here made this file unrunnable in a Worker. CheckVictoryCondition
// now returns the raw outcome (winningPlayer, isDraw, aiPlayerNum) and lets the
// client decide what to do with it. executeAITurn stays client-side too - it's
// async UI-turn orchestration, not a reaction to compute.
//
// engine.state.gameOver moves from "client-owned by default" (A1 step 4's
// tentative classification, since it wasn't in the guide's explicit §5.1
// list) to genuinely engine-owned now that real turn-lifecycle logic needs to
// set it authoritatively. Flagging the reclassification rather than doing it
// silently.

function DetermineVictoryText() {
    if (engine.state.gameOver) return null;
    let victoryText = null;

    if (engine.state.isTrainingMode && engine.state.globalTurnNumber >= 30) {
        const p1CurrentHP = engine.state.units.filter(u => u.player === 1).reduce((sum, u) => sum + u.hp, 0);
        const p2CurrentHP = engine.state.units.filter(u => u.player === 2).reduce((sum, u) => sum + u.hp, 0);

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

    if (engine.state.gameMode === 'arcade') {
        const player1Units = engine.state.units.filter(u => u.player === 1);
        const player2Units = engine.state.units.filter(u => u.player === 2);

        if (engine.state.tiles.size > 0) {
            if (player1Units.length === 0 && player2Units.length > 0) {
                victoryText = "Player 2 Wins by Annihilation!";
            } else if (player2Units.length === 0 && player1Units.length > 0) {
                victoryText = "Player 1 Wins by Annihilation!";
            } else if (player1Units.length === 0 && player2Units.length === 0) {
                victoryText = "It's a Draw!";
            }
        }
    } else {
        for (const unit of engine.state.units) {
            if (unit.isCarryingFlag) {
                const carrierPlayer = unit.player;
                const carrierHomeBaseData = engine.state.baseCampPositions[`player${carrierPlayer}`];
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
            const player1Units = engine.state.units.filter(u => u.player === 1);
            const player2Units = engine.state.units.filter(u => u.player === 2);

            if (engine.state.tiles.size > 0) {
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
//   victory: false - nothing else meaningful, wrapper just re-enables the
//     "new map" button.
//   victory: true, isTrainingMode: true - wrapper restarts training
//     (startNewTrainingMatch/executeAITurn) instead of showing the victory
//     screen, and does the brain bookkeeping for the finished match.
//   victory: true, isTrainingMode: false - wrapper shows the standard DOM
//     victory screen, and updates the champion brain when isSingleplayerVictory.
//
// The AI population bookkeeping that used to run here (matchBrains win/loss
// tallies, evolveBrain, finalizeTrainingSamples) moved to the wrapper in
// js/client/game-flow.js. It has to: the brain population is client-side for
// A1 because it is backed by localStorage, so reaching for it from here made
// the server unrunnable in a Worker. What this function returns instead is the
// raw outcome - who won, whether it was a draw, which player the AI was - and
// the client decides what to do with it.
// Arcade's time-limit ending: whoever has more total HP when the turn cap is
// reached wins. This lived entirely in js/client/game-flow.js until A2 - the
// client summed the HP, decided the winner, and set engine.state.gameOver
// itself, which is exactly the client-authoritative pattern A2 exists to close.
// The client now renders what this returns.
function CheckArcadeTimeLimitVictory() {
    const p1HP = engine.state.units.filter(u => u.player === 1).reduce((sum, u) => sum + u.hp, 0);
    const p2HP = engine.state.units.filter(u => u.player === 2).reduce((sum, u) => sum + u.hp, 0);

    let victoryText;
    let winner = null;
    if (p1HP > p2HP)      { victoryText = "Time Limit! Player 1 Wins by Health!"; winner = 1; }
    else if (p2HP > p1HP) { victoryText = "Time Limit! Player 2 Wins by Health!"; winner = 2; }
    else                  { victoryText = "Time Limit! It's a Draw!"; }

    engine.state.gameOver = true;

    return { victory: true, victoryText, winner, isDraw: winner === null, p1HP, p2HP };
}

function CheckVictoryCondition() {
    if (engine.state.gameOver) {
        // The server now detects victory on its own (ActionManager.SubmitAction
        // calls this after every accepted gameplay action), so by the time the
        // client asks, the match may already be over. Hand it the verdict once
        // rather than a bare alreadyOver, or the victory screen and the
        // champion-brain update never run.
        if (engine.pendingVictory) {
            const verdict = engine.pendingVictory;
            engine.pendingVictory = null;
            return verdict;
        }
        return { victory: true, alreadyOver: true };
    }

    const victoryText = DetermineVictoryText();
    if (!victoryText) {
        return { victory: false };
    }


    let winningPlayer = null;
    if (victoryText.includes("Player 1")) winningPlayer = 1;
    else if (victoryText.includes("Player 2")) winningPlayer = 2;
    const isDraw = victoryText.includes("Draw");

    if (engine.state.isTrainingMode) {
        engine.state.gameOver = false;

        return {
            victory: true,
            isTrainingMode: true,
            needsPopulationMaintenance: true,
            victoryText,
            winningPlayer,
            isDraw,
        };
    }

    let isSingleplayerVictory = false;
    let aiVictory = false;
    let aiPlayerNum = null;
    if (engine.state.gameMode === 'singleplayer') {
        isSingleplayerVictory = true;
        aiPlayerNum = engine.state.playerSide === 1 ? 2 : 1;
        aiVictory = victoryText.includes(`Player ${aiPlayerNum}`);
    }

    engine.state.gameOver = true;

    const verdict = {
        victory: true,
        isTrainingMode: false,
        isSingleplayerVictory,
        aiVictory,
        aiPlayerNum,
        needsSavePopulation: isSingleplayerVictory,
        victoryText,
        winningPlayer,
        isDraw,
    };

    engine.Emit({ type: 'VICTORY', text: victoryText, winner: winningPlayer, isDraw });
    engine.actionManager.RecordHistory({
        type: "VICTORY", turn: engine.state.globalTurnNumber, player: winningPlayer,
        payload: { victoryText, winner: winningPlayer, isDraw }
    });

    // Held for whichever client asks next. Consumed above.
    engine.pendingVictory = verdict;

    // A6. The completion signal comes from HERE rather than from RecordAccepted,
    // because RecordAccepted runs BEFORE SettleMatchState and therefore before
    // gameOver is set - a match-ending move would have signalled itself as merely
    // another turn. This is the moment the match is actually over.
    SignalArchiveDue(engine, true);

    return verdict;
}

// Arcade forces a random class swap on a random unit. Choosing the victim and
// the replacement type is a rule - it reads unit state and honours the
// "a fortified unit can't become a class with no defense" constraint - so it
// lives here. Showing the modal and ending the turn is the client's half
// (handleForcedSwap in js/client/game-flow.js). Split out of core.js when the
// /js root was cleaned up.
function PickForcedSwap() {
    if (engine.state.gameMode !== 'arcade') return { applicable: false };

    const myUnits = engine.state.units.filter(u => u.player === engine.state.currentPlayer);
    if (myUnits.length === 0) return { applicable: true, victim: null };

    const victim = myUnits[Math.floor(Math.random() * myUnits.length)];
    const validTypes = Object.values(UNIT_TYPES).filter(t => {
        if (t.name === victim.type.name) return false;
        if (victim.isFortified && t.defense <= 0) return false;
        return true;
    });

    return {
        applicable: true,
        victim,
        newType: validTypes[Math.floor(Math.random() * validTypes.length)]
    };
}

function ApplyStartOfTurnZoCDamage() {
    const activePlayer = engine.state.currentPlayer;
    const enemyPlayer = activePlayer === 1 ? 2 : 1;
    let unitsToDestroy = [];
    let zocEvents = [];

    const activePlayerBaseData = engine.state.baseCampPositions[`player${activePlayer}`];
    let activePlayerBaseTiles = [];

    if (Array.isArray(activePlayerBaseData)) {
        activePlayerBaseTiles = activePlayerBaseData;
    } else if (typeof activePlayerBaseData === 'string') {
        activePlayerBaseTiles = activePlayerBaseData.split('_');
    }

    engine.state.units.forEach(unit => {
        if (unit.player !== enemyPlayer) return;

        if (unit.positionType === 'edge' && !unit.isFortified) {
            const edgeKey = unit.position;
            const edgeTileCoords = parseEdgeKey(edgeKey);
            if (edgeTileCoords.some(coord => isNaN(coord.q))) return;

            const tile1Key = getTileKey(edgeTileCoords[0].q, edgeTileCoords[0].r);
            const tile2Key = getTileKey(edgeTileCoords[1].q, edgeTileCoords[1].r);
            const tile1 = engine.state.tiles.get(tile1Key);
            const tile2 = engine.state.tiles.get(tile2Key);

            const checkTileZoC = (tile, tKey) => {
                if (!tile) return false;
                if (activePlayerBaseTiles.includes(tKey)) return true;

                if (tile.fortifiedByPlayer === activePlayer) {
                    const fortUnit = engine.state.units.find(u => u.isFortified && u.position === tKey && u.player === activePlayer);
                    if (fortUnit && !isZoCSuppressed(fortUnit)) return true;
                }
                return false;
            };

            if (checkTileZoC(tile1, tile1Key) || checkTileZoC(tile2, tile2Key)) {
                unit.hp -= FORTIFICATION_DAMAGE;
                engine.Emit({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });

                zocEvents.push({
                    unitId: unit.id,
                    damage: FORTIFICATION_DAMAGE,
                    remainingHp: unit.hp,
                    isFatal: unit.hp <= 0
                });

                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} takes start-of-turn ZoC. HP: ${unit.hp}`, player: activePlayer, duration: 3500 });
                if (unit.hp <= 0 && !unitsToDestroy.find(u => u.id === unit.id)) {
                    unitsToDestroy.push(unit);
                }
            }
        } else if (unit.positionType === 'center' && unit.isFortified) {
            if (activePlayerBaseTiles.includes(unit.fortifiedTileKey)) {
                unit.hp -= FORTIFICATION_DAMAGE;
                engine.Emit({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });

                zocEvents.push({
                    unitId: unit.id,
                    damage: FORTIFICATION_DAMAGE,
                    remainingHp: unit.hp,
                    isFatal: unit.hp <= 0
                });

                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} takes Base Camp ZoC. HP: ${unit.hp}`, player: activePlayer, duration: 3500 });
                if (unit.hp <= 0 && !unitsToDestroy.find(u => u.id === unit.id)) {
                    unitsToDestroy.push(unit);
                }
            }
        }
    });

    if (zocEvents.length > 0 && typeof engine !== 'undefined') {
        engine.actionManager.RecordHistory({
            type: "TURN_START_ZOC",
            turn: engine.state.globalTurnNumber,
            player: activePlayer,
            payload: { events: zocEvents }
        });
    }

    for (const u of unitsToDestroy) {
        const deathResult = DestroyUnitIfExists(u, "zoc_turn_start");
    }

    return {};
}

function ApplyMountainAttrition() {
    const activePlayer = engine.state.currentPlayer;
    const attritionEvents = [];
    const unitsToDestroy = [];

    engine.state.units.forEach(unit => {
        if (unit.player !== activePlayer || !isUnitOnMountainPeak(unit)) return;

        const playerFlag = engine.state.flags ? engine.state.flags[`p${unit.player}_flag`] : null;
        const flagStolen = !!(playerFlag && playerFlag.status === 'carried');

        if (!flagStolen && isUnitSupplied(unit)) {
            unit.mountainAttritionTurns = 0;
            return;
        }

        unit.mountainAttritionTurns = (unit.mountainAttritionTurns || 0) + 1;
        const damage = unit.mountainAttritionTurns;

        unit.hp -= damage;
        engine.Emit({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });

        attritionEvents.push({
            unitId: unit.id,
            damage: damage,
            remainingHp: unit.hp,
            isFatal: unit.hp <= 0
        });

        engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} takes ${damage} mountain attrition. HP: ${unit.hp}`, player: activePlayer, duration: 3500 });

        if (unit.hp <= 0 && !unitsToDestroy.find(u => u.id === unit.id)) {
            unitsToDestroy.push(unit);
        }
    });

    if (attritionEvents.length > 0 && typeof engine !== 'undefined') {
        engine.actionManager.RecordHistory({
            type: "TURN_START_MOUNTAIN_ATTRITION",
            turn: engine.state.globalTurnNumber,
            player: activePlayer,
            payload: { events: attritionEvents }
        });
    }

    unitsToDestroy.forEach(u => {
        const deathResult = DestroyUnitIfExists(u, "mountain_attrition");
    });

    return {};
}

function ApplyStartOfTurnHealing() {
    if (engine.state.gameMode === 'arcade') return {};

    const playerFlag = engine.state.flags[`p${engine.state.currentPlayer}_flag`];
    if (playerFlag && playerFlag.status === 'carried') {
        return {};
    }

    let healingEvents = [];

    engine.state.units.forEach(unit => {
        if (unit.player !== engine.state.currentPlayer || !unit.isFortified || unit.hp >= (unit.maxHp + 1)) {
            return;
        }

        const recentlyAttacked = engine.state.globalTurnNumber < unit.lastAttackedByHostileOnTurn + 2;
        if (recentlyAttacked) {
            return;
        }

        if (isUnitOnMountainPeak(unit)) {
            return;
        }

        if (isUnitSupplied(unit)) {
            const oldHp = unit.hp;
            unit.hp++;
            const activePlayer = engine.state.currentPlayer;

            let type = 'HEAL';
            if (unit.hp === unit.maxHp + 1) type = 'SHIELD';

            healingEvents.push({
                unitId: unit.id,
                type: type,
                amount: 1,
                finalHp: unit.hp
            });

            if (oldHp < unit.maxHp && unit.hp === unit.maxHp) {
                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} healed to full HP.`, player: activePlayer, duration: 2500 });
            } else if (unit.hp === unit.maxHp + 1) {
                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} gained a shield!`, player: activePlayer, duration: 2500 });
                engine.Emit({ type: 'SHIELD_GAINED', unit });
            } else {
                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} healed 1 HP.`, player: activePlayer, duration: 2500 });
            }
        }
    });

    if (healingEvents.length > 0 && typeof engine !== 'undefined') {
        engine.actionManager.RecordHistory({
            type: "TURN_START_HEAL",
            turn: engine.state.globalTurnNumber,
            player: engine.state.currentPlayer,
            payload: { events: healingEvents }
        });
    }

    return {};
}

function LogSiegeStatus() {
    if (engine.state.gameMode === 'arcade' || !engine.state.flags) return {};

    const activePlayer = engine.state.currentPlayer;
    const playerFlag = engine.state.flags[`p${activePlayer}_flag`];

    if (playerFlag && playerFlag.status === 'carried') {
        const existingLog = engine.state.actionLog[engine.state.actionLog.length - 1];
        if (!existingLog || !existingLog.message.includes('Healing is disabled')) {
            engine.Emit({ type: 'LOG', text: `P${activePlayer}'s flag is stolen! All healing is disabled.`, player: activePlayer });
        }
    }

    // A6. Siege was never a ledger type either (A4 §5.1). Collected into ONE entry
    // per turn rather than one per unit: "who is under siege this turn" is a single
    // fact about the board, even though the live log prints it unit by unit.
    const besieged = [];

    engine.state.units.forEach(unit => {
        if (unit.player === activePlayer && unit.isFortified && unit.supplyLine && unit.supplyLine.path) {
            const isIntercepted = unit.supplyLine.path.some(edgeKey => {
                const edge = engine.state.edges.get(edgeKey);
                return edge && edge.units.some(u => u.player !== unit.player);
            });

            if (isIntercepted) {
                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} is under siege and cannot heal!`, player: activePlayer });
                besieged.push(unit.id);
            }
        }
    });

    if (besieged.length > 0) {
        engine.actionManager.RecordHistory({
            type: "SIEGE_STATUS", turn: engine.state.globalTurnNumber, player: activePlayer,
            payload: { besieged }
        });
    }

    return {};
}

// Pure half of handleRespawnQueue: decrements timers (engine-owned
// respawnQueue) and reports whether a unit is ready. Whether that means
// showing the respawn modal (human) or letting the AI/training loop handle it
// silently is a client-side decision — the wrapper makes it.
function ApplyRespawnQueueTick() {
    if (engine.state.gameMode === 'arcade') return { hasQueue: false, unitReady: false };

    const player = engine.state.currentPlayer;
    const queueKey = `player${player}`;
    const queue = engine.state.respawnQueue[queueKey];

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

    if (engine.state.gameMode === 'arcade' && engine.state.currentPlayer === 2) {
        engine.state.arcadeTotalTurns++;
        if (engine.state.arcadeTotalTurns >= ARCADE_MAX_TURNS) {
            return { arcadeMaxTurnsReached: true };
        }
    }

    const previousPlayer = engine.state.currentPlayer;
    engine.state.playerActionTaken[`player${previousPlayer}`] = false;

    engine.state.currentPlayer = engine.state.currentPlayer === 1 ? 2 : 1;
    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = false;

    let turnNumberAdvanced = false;
    if (previousPlayer === 2 && engine.state.currentPlayer === 1) {
        engine.state.globalTurnNumber++;
        turnNumberAdvanced = true;
    }

    engine.state.units.forEach(unit => {
        if (unit.player === engine.state.currentPlayer) {
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
                }
            }
        }
    });

    const respawnResult = ApplyRespawnQueueTick();

    const zocResult = ApplyStartOfTurnZoCDamage();

    const resupplyResult = AttemptToResupplyForts(engine.state.currentPlayer);

    const siegeResult = LogSiegeStatus();

    const attritionResult = ApplyMountainAttrition();

    const healingResult = ApplyStartOfTurnHealing();

    // NOTE: "Turn Begins" is NOT pushed here even though it looks like it
    // belongs with the other turn-start logs above — in the original, it
    // fires from inside finalizeVisuals, AFTER the pass-device overlay
    // resolves, while everything above fires immediately/before the overlay.
    // The client wrapper (proceedToEndTurn) logs it itself at the right time.

    return {
        arcadeMaxTurnsReached: false,
        turnNumberAdvanced,
        respawnResult,
    };
}