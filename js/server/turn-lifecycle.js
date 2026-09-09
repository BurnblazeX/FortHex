// === Turn Lifecycle (MIXED functions split, pure half - A1 step 8) ===
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
                        if (carrierHomeBaseData.includes(unit.tileKey)) {
                            isHome = true;
                        }
                    } else {
                        const [h1, h2] = parseEdgeKey(unit.edgeKey);
                        if (!isNaN(h1.q) && !isNaN(h2.q)) {
                            const t1 = getTileKey(h1.q, h1.r);
                            const t2 = getTileKey(h2.q, h2.r);
                            if (carrierHomeBaseData.includes(t1) && carrierHomeBaseData.includes(t2)) {
                                isHome = true;
                            }
                        }
                    }
                } else {
                    // carrierHomeBaseData is an EDGE key here, so this arm asks
                    // "is the carrier standing on the home edge"; the arm below asks
                    // "is it fortified on one of that edge's two tiles".
                    if (unit.edgeKey === carrierHomeBaseData) {
                        isHome = true;
                    } else if (unit.positionType === 'center') {
                        const [h1, h2] = parseEdgeKey(carrierHomeBaseData);
                        const t1 = getTileKey(h1.q, h1.r);
                        const t2 = getTileKey(h2.q, h2.r);
                        if (unit.tileKey === t1 || unit.tileKey === t2) {
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
            // A PLAYER WITH REINFORCEMENTS COMING IS NOT ANNIHILATED.
            //
            // Outside arcade, a destroyed unit goes into respawnQueue and comes back a
            // few turns later, so "no units on the board" and "out of the match" are
            // different facts. Counting only live units conflated them, and the turn
            // START is exactly where they come apart: ApplyRespawnQueueTick runs FIRST,
            // then ZoC damage, then mountain attrition. A player whose last unit dies to
            // ZoC or attrition on the same turn a reinforcement became ready was
            // declared annihilated while their replacement was queued and waiting for
            // them to pick it - and worse, if both players were momentarily empty it
            // called the match a draw.
            //
            // Arcade has no respawn queue at all (ApplyRespawnQueueTick returns early),
            // so the queues are empty there and this reads exactly as it always did.
            const StillInTheMatch = (player) => {
                if (engine.state.units.some(u => u.player === player)) return true;
                const queue = engine.state.respawnQueue && engine.state.respawnQueue['player' + player];
                return !!(queue && queue.length > 0);
            };

            const p1Alive = StillInTheMatch(1);
            const p2Alive = StillInTheMatch(2);

            if (engine.state.tiles.size > 0) {
                if (!p1Alive && p2Alive) {
                    victoryText = "Player 2 Wins by Annihilation!";
                } else if (!p2Alive && p1Alive) {
                    victoryText = "Player 1 Wins by Annihilation!";
                } else if (!p1Alive && !p2Alive) {
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
    engine.matchVerdict = { text: victoryText, winner, isDraw: winner === null };

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

    // Kept for anyone who asks later. pendingVictory below is consumed by the first
    // caller; this is not, which is what lets a rejoining client be told the result
    // of a match that ended while they were away.
    engine.matchVerdict = { text: victoryText, winner: winningPlayer, isDraw };

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
            const edgeKey = unit.edgeKey;
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
                    const fortUnit = engine.state.units.find(u => u.tileKey === tKey && u.player === activePlayer);
                    if (fortUnit && !isZoCSuppressed(fortUnit)) return true;
                }
                return false;
            };

            if (checkTileZoC(tile1, tile1Key) || checkTileZoC(tile2, tile2Key)) {
                const zocDealt = ApplyDamageToUnit(unit, FORTIFICATION_DAMAGE, 'ZoC');
                if (zocDealt > 0) engine.Emit({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });

                zocEvents.push({
                    unitId: unit.id,
                    damage: zocDealt,
                    remainingHp: unit.hp,
                    isFatal: unit.hp <= 0
                });

                if (zocDealt > 0) engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} takes start-of-turn ZoC. HP: ${unit.hp}`, player: activePlayer, duration: 3500 });
                if (unit.hp <= 0 && !unitsToDestroy.find(u => u.id === unit.id)) {
                    unitsToDestroy.push(unit);
                }
            }
        } else if (unit.positionType === 'center' && unit.isFortified) {
            if (activePlayerBaseTiles.includes(unit.fortifiedTileKey)) {
                const baseZocDealt = ApplyDamageToUnit(unit, FORTIFICATION_DAMAGE, 'Base Camp ZoC');
                if (baseZocDealt > 0) engine.Emit({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });

                zocEvents.push({
                    unitId: unit.id,
                    damage: baseZocDealt,
                    remainingHp: unit.hp,
                    isFatal: unit.hp <= 0
                });

                if (baseZocDealt > 0) engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} takes Base Camp ZoC. HP: ${unit.hp}`, player: activePlayer, duration: 3500 });
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

        // Attrition asked this by hand - supplied AND the flag still home - which is
        // what CanUnitDrawOnSupply now names. Kept as one definition so the healing,
        // shield and attrition branches cannot drift apart about what supply means.
        if (CanUnitDrawOnSupply(unit)) {
            unit.mountainAttritionTurns = 0;
            return;
        }

        unit.mountainAttritionTurns = (unit.mountainAttritionTurns || 0) + 1;
        const damage = unit.mountainAttritionTurns;

        const attritionDealt = ApplyDamageToUnit(unit, damage, 'mountain attrition');
        if (attritionDealt > 0) engine.Emit({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });

        attritionEvents.push({
            unitId: unit.id,
            damage: attritionDealt,
            remainingHp: unit.hp,
            isFatal: unit.hp <= 0
        });

        if (attritionDealt > 0) engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} takes ${damage} mountain attrition. HP: ${unit.hp}`, player: activePlayer, duration: 3500 });

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

    // A STOLEN FLAG STOPS HEALING, NOT SHIELDS.
    //
    // This used to return outright, which was correct while shield was the top rung of
    // the healing ladder and is wrong now that it is a separate thing. Losing your flag
    // cuts your supply - SetRationsForFlagStatus zeroes the pool - and being cut
    // off is precisely the case the shield rework exists to cover: no recovery, but a
    // buffer. Blocking both would make the flag the one form of being cut off that
    // gives you nothing, which is the opposite of what the rule says.
    let healingEvents = [];

    // RATIONS ARE SPENT HERE, and this is the only place they are spent.
    //
    // Counted rather than decremented in the loop, so the regeneration rule below has
    // a single honest answer to "did this player spend anything at all this turn".
    const activePlayer = engine.state.currentPlayer;
    let rationsSpent = 0;

    // HEALING AND SHIELD ARE NOW SEPARATE THINGS.
    //
    // Shield used to be the 1 HP of overheal at the top of the healing ladder, which
    // made it a reward for being safe AND supplied AND already whole - the position
    // that needs help least. It is now a one-hit sponge (ApplyDamageToUnit), granted
    // to a fortified unit that has gone a turn untouched and is EITHER at full health
    // on supply OR cut off entirely. That second branch is the point of the rework:
    // an unsupplied unit cannot heal, so it gets a buffer instead of recovery.
    //
    // Healing therefore stops at maxHp. Nothing overheals any more.
    engine.state.units.forEach(unit => {
        if (unit.player !== engine.state.currentPlayer || !unit.isFortified) {
            return;
        }

        // One clear turn, for both. Being hit interrupts a shield exactly as it
        // interrupts healing - the sponge is what you get for being left alone.
        const recentlyAttacked = engine.state.globalTurnNumber < unit.lastAttackedByHostileOnTurn + 2;
        if (recentlyAttacked) {
            return;
        }

        // ONE definition, shared with CanUnitGainShield - the healing branch and the
        // shield branch must agree about what supply means, or a unit falls between them.
        const canDrawOnSupply = CanUnitDrawOnSupply(unit);

        // AN INTERCEPTED LINE STILL DRAINS. The ration is spent - stolen - and the unit
        // at the far end heals nothing. Checked BEFORE the healing branch because
        // CanUnitDrawOnSupply answers false for an intercepted unit, so it would
        // otherwise fall straight through to the shield branch and cost the enemy
        // nothing at all. This is what makes interception an attack on the economy
        // rather than a simple block.
        //
        // Only a unit that would otherwise have healed is worth intercepting, so a
        // unit already at full health does not drain anything.
        if (!canDrawOnSupply && unit.hp < unit.maxHp && IsSupplyLineIntercepted(unit)) {
            if (SpendRation(unit.player, RATION_COST_PER_HEAL)) {
                rationsSpent += RATION_COST_PER_HEAL;
                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name}'s supply was intercepted - the rations are lost.`, player: activePlayer, duration: 3000 });
            }
            return;
        }

        // Peaks are excluded from healing as they always were, and now from shield
        // too - see CanUnitGainShield for why the archer on the mountain is the one
        // position that gets neither.
        if (canDrawOnSupply && !isUnitOnMountainPeak(unit) && unit.hp < unit.maxHp) {
            // Healing COSTS one ration. An empty pool means it simply does not happen -
            // the unit falls through to the shield branch below, which is the correct
            // outcome: a player who cannot feed a unit is a player whose unit is cut
            // off, and a cut-off unit gets the buffer instead.
            if (SpendRation(unit.player, RATION_COST_PER_HEAL)) {
                rationsSpent += RATION_COST_PER_HEAL;
                unit.hp++;

                healingEvents.push({ unitId: unit.id, type: 'HEAL', amount: 1, finalHp: unit.hp });

                if (unit.hp === unit.maxHp) {
                    engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} healed to full HP.`, player: activePlayer, duration: 2500 });
                } else {
                    engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} healed 1 HP.`, player: activePlayer, duration: 2500 });
                }
                return;
            }
        }

        // Asked AFTER healing, so the turn a unit reaches full health is spent
        // healing and the next one earns the shield. Granting both in one tick would
        // let a unit walk out of a fight and be whole plus sponged a turn later.
        if (CanUnitGainShield(unit)) {
            unit.hasShield = true;

            healingEvents.push({ unitId: unit.id, type: 'SHIELD', amount: 0, finalHp: unit.hp });

            engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} gained a shield!`, player: activePlayer, duration: 2500 });
            engine.Emit({ type: 'SHIELD_GAINED', unit });
        }
    });

    // REGENERATION: +1 for a turn in which nothing was spent at all.
    //
    // Spending and regenerating are mutually exclusive rather than concurrent, so a
    // player who heals every turn never recovers and the pool refills by RESTING. The
    // condition is "spent nothing", not "healed nobody", and the two differ in exactly
    // one place: an intercepted line drains without healing anyone, and that is a turn
    // in which the player's economy was attacked - not a rest.
    //
    // Blocked while the flag is stolen, which is redundant with SetRations clamping a
    // zeroed pool but is stated anyway, because "a stolen flag stops regeneration" is a
    // rule and not an emergent property of the clamp.
    const playerFlag = engine.state.flags ? engine.state.flags[`p${activePlayer}_flag`] : null;
    const flagStolen = !!(playerFlag && playerFlag.status === 'carried');

    if (rationsSpent === 0 && !flagStolen) {
        SetRations(activePlayer, RationsFor(activePlayer) + RATION_REGEN_PER_REST_TURN);
    }

    // AT ZERO, EVERY LINE IS CUT. The pool is what keeps a network alive, not what
    // pays for its geometry - so running out is not merely "no more healing", it is
    // the network collapsing. recalculatePlayerSupplyNetwork refuses to re-grant while
    // the pool is empty, so this stays true until the player rests back above zero.
    if (RationsFor(activePlayer) <= 0) {
        SeverSupplyLinesForPlayer(activePlayer);
        engine.Emit({ type: 'LOG', text: `P${activePlayer} is out of rations - every supply line is cut.`, player: activePlayer, duration: 4000 });
    }

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
// silently is a client-side decision - the wrapper makes it.
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

    // Emitted as well as returned. The return value only reaches whoever called
    // SubmitAction - which in a hosted match is an ack the client is not supposed to
    // read state from - so a remote player was never told a reinforcement was ready and
    // the choice modal never opened for them.
    engine.Emit({
        type: 'RESPAWN_QUEUE_TICKED',
        player,
        hasQueue: true,
        unitReady,
        remaining: queue.map(item => ({
            // The queue stores the whole unit template under `unitType`; only the name
            // is worth putting in an event.
            typeName: item.unitType ? item.unitType.typeName : null,
            turnsRemaining: item.turnsRemaining,
        })),
    });

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

    // THE TURN CHANGING IS ITSELF AN EVENT, and it has to be said out loud.
    //
    // LocalTransport.Flush returns null when the queue is empty (js/transport.js), so a
    // turn that emits nothing sends no state-sync at all and a remote client never
    // learns the turn passed. Until now this never happened, by accident:
    // recalculatePlayerSupplyNetwork emitted SUPPLY_CHANGED on EVERY call whether the
    // number moved or not, which acted as an unintended heartbeat. The supply overhaul
    // made that event honest - it now fires only when the pool actually changes - and
    // the heartbeat went with it. tools/host-smoke.js caught it immediately.
    //
    // Emitted unconditionally, because unlike the pool this genuinely did change every
    // time this line is reached. Note arcade mode has always skipped the supply
    // recalculation entirely, so an uneventful arcade turn had this bug all along.
    engine.Emit({
        type: 'TURN_ADVANCED',
        player: engine.state.currentPlayer,
        previousPlayer: previousPlayer,
        globalTurnNumber: engine.state.globalTurnNumber,
    });

    engine.state.units.forEach(unit => {
        if (unit.player === engine.state.currentPlayer) {
            unit.hasPerformedMajorAction = false;
            unit.spearWalled = false;
            unit.ambushed = false;

            unit.currentMove = TurnStartMovePool(unit);

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
    // belongs with the other turn-start logs above - in the original, it
    // fires from inside finalizeVisuals, AFTER the pass-device overlay
    // resolves, while everything above fires immediately/before the overlay.
    // The client wrapper (proceedToEndTurn) logs it itself at the right time.

    return {
        arcadeMaxTurnsReached: false,
        turnNumberAdvanced,
        respawnResult,
    };
}