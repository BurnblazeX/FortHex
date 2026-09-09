// === Actions (MIXED functions split, pure half - A1 step 7) ===
//
// These are the pure-mutation halves of core.js's MIXED action functions.
// None of them call UI functions. Anything the player needs to be told about
// goes out as a flat, serializable event via engine.Emit() - see
// FortHex_A1_Server_Core_Guide.md §3. The client wrapper of the same
// (lowercase) name in js/client/actions.js drains the queue with
// HandleActionEvents() and does the actual logAction/UI/animation work,
// reproducing what the original single function did.
//
// These functions originally each built a local `events` array and returned
// it; the queue formalization replaced that with engine.Emit(). The practical
// difference is that helpers nested several calls deep (DestroyUnit,
// AttemptToResupplyForts, ApplyFortificationDamageOnMove...) no longer have to
// hand their events back up through every caller to reach the client - they
// emit straight onto the instance queue. Return values now carry only the
// facts the wrapper branches on (destroyed, success, flagCapturedForPlayer...).
//
// This is also the shape Track B's transports need: "drain and render" and
// "drain and send over the wire" become the same drain, different sink.
//
// Everything here reads and writes the live engine instance - no client
// globals, no DOM. js/server/ has to stay runnable in a bare Worker.
//
// updateSupplyPointsBasedOnFlagStatus (ui.js) and updateAllHealingStatus
// (main.js) used to mutate game state directly from client-side files. Client
// files must not do that - their state-mutating logic now lives here as
// SetRationsForFlagStatus/RecalculateHealingEligibility, and
// ui.js/main.js's versions became thin wrappers (call the helper here, then do
// the actual UI refresh) so their existing external callers keep working.
//
// completeFortify/completeUnfortify/completeBuildBridge/completeAttack are
// handled with the async pattern below: per user design, animationsEnabled is
// server-relevant - the server delays applying the real mutation by the
// animation's duration (when animations are on) so the authoritative state
// change lands at roughly the same time as the client's purely-visual
// animation, instead of the old callback-driven `animation.onComplete` model.
// See [[project_forthex_animation_fow_design]].

// Moved from main.js - delay() has no DOM dependency, and the async action
// functions below need it too. Reads engine.state.isTrainingMode so training
// matches don't pay for animation waits.
function delay(ms) {
    if (engine.state.isTrainingMode) {
        return Promise.resolve();
    }
    return new Promise(resolve => setTimeout(resolve, ms));
}

// How far ahead of the animation's end the mutation lands. Waiting the FULL
// duration leaves a one-frame gap: the animation has finished and drawn the unit
// back at its old position, but the state that would draw it at its new one
// hasn't been applied yet - so a fortifying unit flickers on its edge before
// snapping to the tile centre. Landing the mutation a couple of frames early
// closes that gap; the tail of the animation just draws the already-committed
// result, which is what the eye expects anyway.
//
// Two frames at 60fps. One frame is enough in principle but leaves no room for
// rAF jitter; much more than this and the state change becomes visible BEFORE
// the animation finishes, which is the opposite artefact. Tune here.
const ANIMATION_SETTLE_LEAD_MS = 33;

// The server-side half of the animationsEnabled design: wait out the animation's
// duration before the caller applies its real mutation, so authoritative state
// changes land as the (client-drawn) animation finishes rather than instantly.
// Skipped entirely when animations are off.
async function WaitForAnimation(durationMs) {
    if (!engine.settings.animationsEnabled) return;

    // Never invert on very short animations - a 20ms effect should still wait
    // its own length rather than resolving before it starts.
    const wait = Math.max(0, durationMs - ANIMATION_SETTLE_LEAD_MS);
    await delay(wait);
}

async function ApplyBuildBridge(unit, targetEdgeKey, duration = 500) {
    // Same reasoning as ApplyMoveAction - see there.
    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = true;

    // Immediate (synchronous prefix, runs before the animation delay) - locks
    // the unit out of further major actions right away, matching the original
    // completeBuildBridge's timing exactly.
    unit.currentMove -= BUILD_BRIDGE_COST;
    unit.hasPerformedMajorAction = true;

    await WaitForAnimation(duration);

    const edgeToBridge = engine.state.edges.get(targetEdgeKey);
    edgeToBridge.bridge = true;
    edgeToBridge.bridgeHp = BRIDGE_MAX_HP;
    engine.Emit({ type: 'LOG', text: `${unit.type.name} built bridge on ${targetEdgeKey.substring(0,7)}... HP: ${edgeToBridge.bridgeHp}`, player: engine.state.currentPlayer, duration: 3000 });

    engine.actionManager.RecordHistory({
        type: "BUILD_BRIDGE", turn: engine.state.globalTurnNumber, player: engine.state.currentPlayer,
        actorId: unit.id,
        payload: { targetEdge: targetEdgeKey, bridgeHp: edgeToBridge.bridgeHp, unitState: GetUnitSnapshot(unit) }
    });

    return {};
}

async function ApplyUnfortify(unit, targetEdgeKey, duration = 600) {
    // Same reasoning as ApplyMoveAction - see there.
    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = true;

    // Immediate (synchronous prefix) - matches original timing.
    const startTileKey = unit.tileKey;
    const oldFortifiedTile = engine.state.tiles.get(startTileKey);
    if (oldFortifiedTile) {
        oldFortifiedTile.fortifiedByPlayer = null;
    }
    unit.supplyLine = null;
    unit.hasPerformedMajorAction = true;

    await WaitForAnimation(duration);

    const unfortifyingPlayer = unit.player;

    unit.fortifyCooldown = unit.turnsFortified * 5;

    if (unit.typeId === 'ARCHER') {
        unit.stats.damage -= 2;
    }
    unit.turnsFortifiedAtBase = 0;
    unit.turnsFortified = 0;
    unit.mountainAttritionTurns = 0;
    unit.supplyLine = null;
    // ONE write where there were four. isFortified, fortifiedTileKey and
    // positionType all read off this, so moving to a hexPath IS unfortifying.
    unit.position = FineKeyOfEdge(targetEdgeKey);
    unit.currentMove -= FORTIFY_UNFORTIFY_COST;
    unit.hasPerformedMajorAction = true;

    if (typeof engine !== 'undefined') {
        engine.actionManager.RecordHistory({
            type: "UNFORTIFY",
            turn: engine.state.globalTurnNumber,
            player: unfortifyingPlayer,
            actorId: unit.id,
            payload: {
                fromTile: startTileKey,
                toEdge: targetEdgeKey,
                relativeLocation: 'edge',
                unitState: GetUnitSnapshot(unit)
            }
        });
    }
    engine.Emit({ type: 'LOG', text: `${unit.type.name} unfortified to ${targetEdgeKey.substring(0,7)}...`, player: unfortifyingPlayer, duration: 2500 });

    recalculatePlayerSupplyNetwork(unfortifyingPlayer);

    return { unfortifyingPlayer };
}

async function ApplyFortify(unit, targetTileKey, duration = 450) {
    // Same reasoning as ApplyMoveAction - see there.
    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = true;

    // Immediate (synchronous prefix) - matches original timing.
    unit.hasPerformedMajorAction = true;

    await WaitForAnimation(duration);

    const fortifyingPlayer = unit.player;
    const targetTileObject = engine.state.tiles.get(targetTileKey);

    unit.mountainAttritionTurns = 0;
    if (unit.typeId === 'ARCHER') {
        unit.stats.damage += 2;
    }
    // And the mirror of unfortify: standing on the tile centre IS being
    // fortified there.
    unit.position = FineKeyOfTile(targetTileKey);
    unit.currentMove -= FORTIFY_UNFORTIFY_COST;
    unit.hasPerformedMajorAction = true;
    targetTileObject.fortifiedByPlayer = fortifyingPlayer;

    if (typeof engine !== 'undefined') {
        engine.actionManager.RecordHistory({
            type: "FORTIFY",
            turn: engine.state.globalTurnNumber,
            player: fortifyingPlayer,
            actorId: unit.id,
            payload: {
                tile: targetTileKey,
                relativeLocation: 'center',
                unitState: GetUnitSnapshot(unit)
            }
        });
    }
    engine.Emit({ type: 'LOG', text: `${unit.type.name} fortified on tile ${targetTileKey.substring(0,5)}...`, player: fortifyingPlayer, duration: 2500 });

    let flagCapturedForPlayer = null;
    if (engine.state.gameMode !== 'arcade' && engine.state.flags) {
        const enemyPlayer = unit.player === 1 ? 2 : 1;
        const enemyFlagTileKey = getFlagTileKey(enemyPlayer);

        if (targetTileKey === enemyFlagTileKey) {
            const enemyFlagObj = unit.player === 1 ? engine.state.flags.p2_flag : engine.state.flags.p1_flag;

            if (enemyFlagObj && enemyFlagObj.status === 'at_base') {
                enemyFlagObj.status = 'carried';
                enemyFlagObj.carrierId = unit.id;
                unit.isCarryingFlag = true;

                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} has captured the flag from the fort!`, player: engine.state.currentPlayer });

                const healingResult = RecalculateHealingEligibility();

                const severResult = SeverSupplyLinesForPlayer(enemyPlayer);

                const victimPlayerQueue = engine.state.respawnQueue[`player${enemyPlayer}`];
                victimPlayerQueue.forEach(item => {
                    if (!item.timerHalved) {
                        item.turnsRemaining = Math.ceil(item.turnsRemaining / 2);
                        item.timerHalved = true;
                    }
                });

                SetRationsForFlagStatus(enemyPlayer);

                flagCapturedForPlayer = enemyPlayer;
                engine.Emit({ type: 'FLAG_CAPTURED', player: enemyPlayer, carrierId: unit.id, carrierUnit: unit });
            }
        }
    }

    if (engine.state.gameMode !== 'arcade') {
        const playerFlag = engine.state.flags[`p${fortifyingPlayer}_flag`];
        if (playerFlag && playerFlag.status !== 'carried') {
            recalculatePlayerSupplyNetwork(fortifyingPlayer);
        } else {
            engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} fortified, but is unsupplied due to stolen flag.`, player: fortifyingPlayer, duration: 3000 });
        }
    }

    let unitsToDestroy = [];
    let zocHits = [];

    getNeighbors(targetTileObject.q, targetTileObject.r).forEach(neighborCoords => {
        const edgeKey = getEdgeKey(targetTileObject.q, targetTileObject.r, neighborCoords.q, neighborCoords.r);
        const adjacentEdge = engine.state.edges.get(edgeKey);
        if (adjacentEdge) {
            adjacentEdge.units.forEach(enemyUnit => {
                if (enemyUnit.player !== fortifyingPlayer && enemyUnit.positionType === 'edge') {
                    const fortZocDealt = ApplyDamageToUnit(enemyUnit, FORTIFICATION_DAMAGE, 'ZoC');

                    zocHits.push({
                        unitId: enemyUnit.id,
                        damage: fortZocDealt,
                        isFatal: enemyUnit.hp <= 0
                    });

                    if (fortZocDealt > 0) engine.Emit({ type: 'LOG', text: `P${enemyUnit.player} ${enemyUnit.type.name} takes ZoC. HP: ${enemyUnit.hp}`, player: fortifyingPlayer });
                    if (enemyUnit.hp <= 0 && !unitsToDestroy.find(u => u.id === enemyUnit.id)) unitsToDestroy.push(enemyUnit);
                }
            });
        }
    });

    if (zocHits.length > 0 && typeof engine !== 'undefined') {
        engine.actionManager.RecordHistory({
            type: "FORTIFY_ZOC_BLAST",
            turn: engine.state.globalTurnNumber,
            player: fortifyingPlayer,
            actorId: unit.id,
            payload: { hits: zocHits }
        });
    }

    unitsToDestroy.forEach(u => {
        const deathResult = DestroyUnitIfExists(u, "zoc_fort");
    });

    return { flagCapturedForPlayer };
}

// duration is computed by the client wrapper (pixel-distance-dependent for
// projectiles) and passed in - this function never touches pixel space.
// Returns spearWalled/bridgeDestroyed so the wrapper can replicate the
// original's currentReachableMoves branching without duplicating the combat
// logic that decides them (currentReachableMoves is client-owned).
async function ApplyAttack(attackingUnit, targetUnitInfo, attackType, duration = 250) {
    // Immediate (synchronous prefix) - matches original timing.
    attackingUnit.hasPerformedMajorAction = true;

    await WaitForAnimation(duration);

    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = true;

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

    // --- MOVEMENT LOGIC (Hit & Run) ---
    let hitAndRunMessage = "";
    let spearWalled = false;
    if (attackingUnit.type.canMoveAfterAttack) {
        attackingUnit.currentMove -= ATTACK_COST;
        const spearWallOnAttacker = isEdgeAdjacentToSpearWall(attackingUnit, attackingUnit.edgeKey);
        const spearWallOnTarget = targetUnitInfo.edgeKey ? isEdgeAdjacentToSpearWall(attackingUnit, targetUnitInfo.edgeKey) : false;
        if (spearWallOnAttacker || spearWallOnTarget) {
            hitAndRunMessage = "Spear Wall prevents further movement!";
            attackingUnit.spearWalled = true;
            spearWalled = true;
        } else if (attackingUnit.currentMove > 0) {
            hitAndRunMessage = "Horseman can move again!";
        }
    } else {
        attackingUnit.currentMove = 0;
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

    let bridgeDestroyed = false;

    // --- COMBAT RESOLUTION ---
    if (targetUnitInfo.isBridgeTarget && targetUnitInfo.edgeKey) {
        ledgerPayload.targetType = 'BRIDGE';
        ledgerPayload.targetEdge = targetUnitInfo.edgeKey;
        ledgerPayload.damageDealt = baseDamage;

        const bridgeEdge = engine.state.edges.get(targetUnitInfo.edgeKey);
        if (bridgeEdge && bridgeEdge.bridge) {
            bridgeEdge.bridgeHp -= baseDamage;
            engine.Emit({ type: 'UNIT_DAMAGED', unit: { position: targetUnitInfo.edgeKey, isFortified: false }, attackStatus: 'normal' });
            logParts.push(`P${attackingUnit.player} ${attackingUnit.type.name} targets bridge for ${baseDamage}.<br>Bridge HP: ${bridgeEdge.bridgeHp}/${BRIDGE_MAX_HP}.`);

            if (bridgeEdge.bridgeHp <= 0) {
                ledgerPayload.isKill = true;
                logParts.push(`Bridge destroyed!`);
                bridgeEdge.bridge = false;
                bridgeEdge.bridgeHp = null;
                bridgeDestroyed = true;

                // A6. The ATTACK entry records isKill, but a destroyed bridge is a
                // board change with its own consequences - severed supply, drowned
                // units - and reads as an ordinary attack without this.
                engine.actionManager.RecordHistory({
                    type: "BRIDGE_DESTROYED", turn: engine.state.globalTurnNumber,
                    player: attackingUnit.player, actorId: attackingUnit.id,
                    payload: { edge: targetUnitInfo.edgeKey }
                });
                recalculatePlayerSupplyNetwork(1);
                recalculatePlayerSupplyNetwork(2);

                const [h1, h2] = parseEdgeKey(targetUnitInfo.edgeKey);
                const tile1 = engine.state.tiles.get(getTileKey(h1.q, h1.r));
                const tile2 = engine.state.tiles.get(getTileKey(h2.q, h2.r));
                const isBeach = (tile1 && tile1.type !== TILE_TYPES.WATER) || (tile2 && tile2.type !== TILE_TYPES.WATER);
                [...bridgeEdge.units].forEach(unitOnCollapse => {
                    if (isBeach) {
                        const fallDamage = 5;
                        const fallDealt = ApplyDamageToUnit(unitOnCollapse, fallDamage, 'the fall');
                        if (fallDealt > 0) logParts.push(`P${unitOnCollapse.player} ${unitOnCollapse.type.name} fell as the bridge collapsed and takes ${fallDamage} damage! HP: ${unitOnCollapse.hp}`);
                        else logParts.push(`P${unitOnCollapse.player} ${unitOnCollapse.type.name} fell as the bridge collapsed, shielded from the drop.`);
                        if (unitOnCollapse.hp <= 0) {
                            const deathResult = DestroyUnitIfExists(unitOnCollapse, "bridge_collapse");
                        }
                    } else {
                        const deathResult = DestroyUnitIfExists(unitOnCollapse, "bridge_collapse");
                    }
                });
            }
        } else logParts.push("Target bridge missing.");

    } else if (targetUnitInfo.unit) {
        const targetUnit = engine.state.units.find(u => u.id === targetUnitInfo.unit.id);

        if (targetUnit) {
            ledgerPayload.targetId = targetUnit.id;

            if (attackingUnit.player !== targetUnit.player) {
                targetUnit.lastAttackedByHostileOnTurn = engine.state.globalTurnNumber;
            }

            let actualDamage = baseDamage;
            let defenseMessage = "";

            let targetDefense = 0;
            if (targetUnit.stats && typeof targetUnit.stats.defense === 'number') targetDefense = targetUnit.stats.defense;
            else targetDefense = targetUnit.type.defense || 0;

            // Mountain peaks only. The FOREST half of this was removed 2026-09-03: it
            // entered the game inside commit 9d1be7d ("Split monolithic file into
            // parts", 24 Jun 2026) labelled `// Forest Penalty Logic (New)`, appears in
            // no patch, balance or bug note, and was never designed. Forest does not
            // inherently lower defense - combined arms is what strips defense there
            // (Track C / C2 in the roadmap).
            //
            // The Mountain clause was appended later and is left standing: a peak is a
            // deliberate archer-only position (canUnitFortifyOnTile, rules.js:489) whose
            // tradeoffs are intentional. Whether -1 defense should be one of them is a
            // separate open question, not something this removal decides.
            //
            // KNOWN MISMATCH: ai.js scoreMove predicts damage from raw stats.defense and
            // never applied this modifier, so the AI under-predicts its own damage
            // against a peak archer by 1. Untouched here rather than changing AI
            // behaviour inside a balance fix.
            const fortTile = engine.state.tiles.get(targetUnit.tileKey);
            if (targetUnit.isFortified && fortTile && fortTile.type.name === 'Mountain') {
                targetDefense -= 1;
            }

            if (targetUnit.isFortified) {
                let hasCombinedArmsPartner = false;
                const edge = engine.state.edges.get(attackingUnit.edgeKey);
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

            actualDamage = Math.max(1, actualDamage);
            if (defenseMessage) logParts.push(defenseMessage);
            engine.Emit({ type: 'UNIT_DAMAGED', unit: targetUnit, attackStatus });

            if (attackType === 'Archer' && targetUnitInfo.edgeKey && !targetUnit.isFortified) {
                const edgeOfTarget = engine.state.edges.get(targetUnitInfo.edgeKey);
                const allEnemyUnitsOnEdge = edgeOfTarget ? edgeOfTarget.units.filter(u => u.player === targetUnit.player) : [];

                if (allEnemyUnitsOnEdge.length === 2) {
                    ledgerPayload.targetType = 'UNIT_SPLIT';
                    let splitDamage = Math.max(1, Math.round(actualDamage / 2));
                    ledgerPayload.damageDealt = splitDamage;
                    ledgerPayload.splitTargets = allEnemyUnitsOnEdge.map(u => u.id);
                    ledgerModifiers.push("SPLIT_DAMAGE");

                    logParts.push(`Damage split between 2 units!`);
                    allEnemyUnitsOnEdge.forEach(unitToHit => {
                        const liveSplitTarget = engine.state.units.find(u => u.id === unitToHit.id);
                        if (liveSplitTarget) {
                            const splitDealt = ApplyDamageToUnit(liveSplitTarget, splitDamage, 'split');
                            if (splitDealt > 0) {
                                engine.Emit({ type: 'UNIT_DAMAGED', unit: liveSplitTarget, attackStatus });
                                logParts.push(`P${liveSplitTarget.player} ${liveSplitTarget.type.name} takes ${splitDealt} damage. HP: ${liveSplitTarget.hp}`);
                            }
                            if (attackingUnit.player !== liveSplitTarget.player) liveSplitTarget.lastAttackedByHostileOnTurn = engine.state.globalTurnNumber;
                            if (liveSplitTarget.hp <= 0) {
                                const deathResult = DestroyUnitIfExists(liveSplitTarget, "destroyed");
                            }
                        }
                    });
                } else {
                    ledgerPayload.targetType = 'UNIT';
                    const hitDealtA = ApplyDamageToUnit(targetUnit, actualDamage, 'the blow');
                    ledgerPayload.damageDealt = hitDealtA;
                    if (hitDealtA > 0) logParts.push(`P${attackingUnit.player} ${attackingUnit.type.name} hits P${targetUnit.player} ${targetUnit.type.name} for ${hitDealtA}.<br>HP: ${targetUnit.hp}/${targetUnit.maxHp}`);
                    else logParts.push(`P${targetUnit.player} ${targetUnit.type.name}'s shield absorbs the blow.`);
                    if (targetUnit.hp <= 0) {
                        const deathResult = DestroyUnitIfExists(targetUnit, "destroyed");
                        ledgerPayload.isKill = true;
                    }
                }
            } else {
                ledgerPayload.targetType = 'UNIT';
                const hitDealtB = ApplyDamageToUnit(targetUnit, actualDamage, 'the blow');
                ledgerPayload.damageDealt = hitDealtB;
                if (hitDealtB > 0) logParts.push(`P${attackingUnit.player} ${attackingUnit.type.name} hits P${targetUnit.player} ${targetUnit.type.name} for ${hitDealtB}.<br>HP: ${targetUnit.hp}/${targetUnit.maxHp}`);
                else logParts.push(`P${targetUnit.player} ${targetUnit.type.name}'s shield absorbs the blow.`);
                if (targetUnit.hp <= 0) {
                    const deathResult = DestroyUnitIfExists(targetUnit, "destroyed");
                    ledgerPayload.isKill = true;
                }
            }

            if (targetUnit.type.name === 'Horseman' && attackingUnit.type.attackType === 'melee' && targetUnitInfo.edgeKey) {
                const edgeOfHorseman = engine.state.edges.get(targetUnitInfo.edgeKey);
                const retaliatingArcher = edgeOfHorseman ? edgeOfHorseman.units.find(u => u.player === targetUnit.player && u.type.name === 'Archer') : null;
                if (retaliatingArcher) {
                    let retDmg = retaliatingArcher.stats ? retaliatingArcher.stats.damage : retaliatingArcher.type.damage;
                    const retaliationDamage = Math.ceil(retDmg / 2);
                    const retDealt = ApplyDamageToUnit(attackingUnit, retaliationDamage, 'the retaliation');
                    if (retDealt > 0) {
                        engine.Emit({ type: 'UNIT_DAMAGED', unit: attackingUnit, attackStatus: 'normal' });
                        logParts.push(`Cavalry Screen! P${retaliatingArcher.player} ${retaliatingArcher.type.name} retaliates for ${retDealt} damage.<br>Attacker HP: ${attackingUnit.hp}/${attackingUnit.maxHp}`);
                    }
                    ledgerModifiers.push(`RETALIATION_DMG_${retaliationDamage}`);
                    if (attackingUnit.hp <= 0) {
                        const deathResult = DestroyUnitIfExists(attackingUnit, "retaliation");
                    }
                }
            }
        } else {
            console.error("Target unit not found in live gamestate!");
        }
    }
    if (hitAndRunMessage) logParts.push(hitAndRunMessage);

    if (typeof engine !== 'undefined') {
        engine.actionManager.RecordHistory({
            type: "ATTACK",
            turn: engine.state.globalTurnNumber,
            player: attackingUnit.player,
            actorId: attackingUnit.id,
            payload: {
                ...ledgerPayload,
                modifiers: ledgerModifiers,
                attackerState: GetUnitSnapshot(attackingUnit),
                targetState: targetUnitInfo.unit ? GetUnitSnapshot(targetUnitInfo.unit) : null
            }
        });
    }

    engine.Emit({ type: 'LOG', text: logParts.join('<br>'), player: engine.state.currentPlayer, duration: 4500 });

    return { spearWalled, bridgeDestroyed };
}

// Compact per-unit record attached to matchHistory entries. Moved here from
// core.js during the js/server/ purge - it's pure, and every caller is in this
// file, but living client-side meant ApplyMoveAction threw ReferenceError the
// moment the server actually ran in a Worker.
function GetUnitSnapshot(unit) {
    if (!unit) return null;
    return {
        id: unit.id,
        hp: unit.hp, // Getter accesses unit.stats.hp
        mp: Number(unit.currentMove.toFixed(2)), // Clean float precision
        // Board space, so one field says where AND whether fortified. The archive
        // keeps isFortified alongside it because a log is read by humans and by
        // Testament's rebuild, and neither should have to know the parity rule.
        pos: unit.position,
        isFortified: unit.isFortified
    };
}

// A stolen flag ZEROES the pool; recovering it refills it.
//
// The zeroing is the rule Burn set and the code already did. The REFILL is the older
// half and it is worth naming rather than leaving implicit: getting your flag back
// hands you a full larder regardless of what you had spent before it was taken. That
// is generous under a consumable model, and it is left exactly as it was, because
// changing it is a balance decision and this change is a mechanical one.
function SetRationsForFlagStatus(playerNum) {
    const playerFlag = engine.state.flags[`p${playerNum}_flag`];
    const stolen = !!(playerFlag && playerFlag.status === 'carried');

    // BOTH pools. Zeroing reach is what the original did and it follows from the
    // severing: with every line cut there is no network reserving any of the budget,
    // and a player who cannot supply anything has no reach to spend. Recovering the
    // flag hands both back full, which is the same generosity the old code had - see
    // the note below.
    SetReach(playerNum, stolen ? 0 : MAX_SUPPLY_REACH);
    SetRations(playerNum, stolen ? 0 : STARTING_RATIONS);
}

function RecalculateHealingEligibility() {
    if (engine.state.gameMode === 'arcade') return {};

    const p1FlagStolen = engine.state.flags.p1_flag.status === 'carried';
    const p2FlagStolen = engine.state.flags.p2_flag.status === 'carried';

    engine.state.units.forEach(unit => {
        if (unit.isFortified) {
            unit.canHeal = unit.player === 1 ? !p1FlagStolen : !p2FlagStolen;
        } else {
            unit.canHeal = false; // Unfortified units can't heal anyway
        }
    });

    if (p1FlagStolen) engine.Emit({ type: 'LOG', text: `P1's flag is stolen! Healing is disabled.`, player: 2, duration: 3000 });
    if (p2FlagStolen) engine.Emit({ type: 'LOG', text: `P2's flag is stolen! Healing is disabled.`, player: 1, duration: 3000 });

    return {};
}

function DestroyUnit(unitToDestroy, reason = "destroyed") {
    const activePlayer = engine.state.currentPlayer;
    const destroyedPlayer = unitToDestroy.player;
    const wasFortified = unitToDestroy.isFortified;

    if (unitToDestroy.isCarryingFlag) {
        const flag = Object.values(engine.state.flags).find(f => f.carrierId === unitToDestroy.id);
        if (flag) {
            flag.status = 'at_base';
            flag.carrierId = null;
            unitToDestroy.isCarryingFlag = false;
            engine.Emit({ type: 'LOG', text: `The P${flag.player} flag has been returned to base!`, player: activePlayer });

            SetRationsForFlagStatus(flag.player);
            recalculatePlayerSupplyNetwork(flag.player);

            // A6. A flag going home was a LOG line and nothing else, so a rebuilt
            // log could not reproduce it and the archive could not show why a
            // capture attempt failed. Server-decided, like the two below it:
            // nobody requested this, it is a consequence of the carrier dying.
            engine.actionManager.RecordHistory({
                type: "FLAG_RETURNED", turn: engine.state.globalTurnNumber, player: flag.player,
                actorId: unitToDestroy.id,
                payload: { flagId: flag.id, carrierId: unitToDestroy.id, at: unitToDestroy.position }
            });
        }
    }

    if (engine.state.gameMode !== 'arcade') {
        const queueKey = `player${destroyedPlayer}`;
        engine.state.respawnQueue[queueKey].push({
            unitType: unitToDestroy.type,
            turnsRemaining: RESPAWN_TURN_TIMER,
            timerHalved: false
        });
    }

    // --- CENTRALIZED DEATH LOGGING ---
    if (reason === "bridge_collapse") {
        engine.Emit({ type: 'LOG', text: `P${destroyedPlayer} ${unitToDestroy.type.name} fell as the bridge collapsed!`, player: activePlayer, duration: 3500 });
    } else if (reason === "zoc_move" || reason === "zoc_turn_start" || reason === "fort_zoc" || reason === "zoc_fort") {
        engine.Emit({ type: 'LOG', text: `P${destroyedPlayer} ${unitToDestroy.type.name} destroyed by ZoC!`, player: activePlayer, duration: 3500 });
    } else if (reason === "cowardice") {
        engine.Emit({ type: 'LOG', text: `P${destroyedPlayer} ${unitToDestroy.type.name} was destroyed for cowardice!`, player: activePlayer, duration: 3500 });
    } else if (reason === "crushed") {
        engine.Emit({ type: 'LOG', text: `P${destroyedPlayer} ${unitToDestroy.type.name}'s defenses collapsed, and they were crushed with no escape!`, player: activePlayer, duration: 3500 });
    } else {
        engine.Emit({ type: 'LOG', text: `P${destroyedPlayer} ${unitToDestroy.type.name} has been destroyed!`, player: activePlayer, duration: 3000 });
    }

    // A6. Death was only ever inferable from ATTACK.isKill, which misses every
    // death that was not an attack - ZoC, bridge collapse, cowardice, mountain
    // attrition. Recorded here rather than at each call site precisely because
    // this function is the one place they all converge.
    //
    // The snapshot is taken NOW, while the unit is still in engine.state.units:
    // a moment later it is filtered out and its final hp and position are gone.
    engine.actionManager.RecordHistory({
        type: "UNIT_DESTROYED", turn: engine.state.globalTurnNumber, player: destroyedPlayer,
        actorId: unitToDestroy.id,
        payload: {
            reason,
            typeName: unitToDestroy.type ? unitToDestroy.type.name : null,
            wasFortified,
            unitState: GetUnitSnapshot(unitToDestroy),
        }
    });

    // --- Nuclear Tile Clearing ---
    if (unitToDestroy.positionType === 'edge') {
        const edgeOfUnit = engine.state.edges.get(unitToDestroy.edgeKey);
        if (edgeOfUnit) edgeOfUnit.units = edgeOfUnit.units.filter(u => u.id !== unitToDestroy.id);
    } else if (unitToDestroy.positionType === 'center' || wasFortified) {
        // One expression where there were two branches: both used to name the same
        // tile by different routes, and tileKey IS that tile.
        const tileKey = unitToDestroy.tileKey;
        const fortifiedTile = engine.state.tiles.get(tileKey);
        if (fortifiedTile) {
            fortifiedTile.fortifiedByPlayer = null;
        }
    }

    engine.state.units = engine.state.units.filter(u => u.id !== unitToDestroy.id);

    if (wasFortified) {
        // A dead fortified unit hands back the REACH its line was reserving, because
        // that budget was paying for geometry which no longer exists. Normally the
        // recalculation below works that out for itself; the else branch is for the
        // one case where it cannot run - the flag is stolen, so supply is severed
        // wholesale and there is no network to recompute.
        //
        // Note this is reach only. Rations are not refunded by a death: they pay for
        // healing, and a unit dying does not un-eat what it ate.
        const playerFlag = engine.state.flags[`p${destroyedPlayer}_flag`];
        if (playerFlag && playerFlag.status !== 'carried') {
            recalculatePlayerSupplyNetwork(destroyedPlayer);
        } else if (unitToDestroy.supplyLine && unitToDestroy.supplyLine.cost > 0) {
            SetReach(destroyedPlayer, ReachFor(destroyedPlayer) + Math.round(unitToDestroy.supplyLine.cost));
        }
    }

    return { destroyedUnitId: unitToDestroy.id };
}

// Pure counterpart of handleUnitDeath: the existence check + delegate to DestroyUnit.
function DestroyUnitIfExists(unitToDie, reason = "destroyed") {
    const unitExists = engine.state.units.some(u => u.id === unitToDie.id);
    if (!unitExists) return { destroyedUnitId: null };
    return DestroyUnit(unitToDie, reason);
}

function SeverSupplyLinesForPlayer(playerNum) {
    engine.Emit({ type: 'LOG', text: `P${playerNum}'s flag was stolen! Supply lines have been broken.`, player: playerNum === 1 ? 2 : 1 });
    engine.state.units.forEach(unit => {
        if (unit.player === playerNum && unit.isFortified) {
            unit.supplyLine = null;
        }
    });
    return {};
}

// Consolidated from three near-duplicate functions per user request:
// fundNewFortification (single-unit, dead code, no callers),
// recalculateSupplyLinesForPlayer (full-recompute, dead code, no callers),
// and attemptToResupplyForts (afford-check on unsupplied forts, the one
// actually called - from main.js's turn lifecycle). All three were hand-rolled
// variants of what recalculatePlayerSupplyNetwork (rules.js) already does
// correctly and completely - full re-path + cost-gated greedy assignment with
// shared-road discounting. This just calls that, then diffs supply-line state
// before/after to report which forts newly became supplied (matching
// attemptToResupplyForts's original per-unit logging), covering all three
// original use cases: a single newly-fortified unit, a full post-flag-return
// recompute, or a routine per-turn resupply attempt.
function AttemptToResupplyForts(playerNum) {
    if (engine.state.gameMode === 'arcade' || !engine.state.flags) return {};

    const wasSupplied = new Map();
    engine.state.units.forEach(u => {
        if (u.player === playerNum && u.isFortified) wasSupplied.set(u.id, !!u.supplyLine);
    });

    recalculatePlayerSupplyNetwork(playerNum);

    engine.state.units.forEach(u => {
        if (u.player === playerNum && u.isFortified && u.supplyLine && !wasSupplied.get(u.id)) {
            engine.Emit({ type: 'LOG', text: `P${playerNum} ${u.type.name} is now in supply! (Cost: ${Math.round(u.supplyLine.cost)})`, player: playerNum });
        }
    });

    return {};
}

// ZoC IS PAID FOR EVERY HEXPATH CROSSED, not only the one a unit stops on.
//
// A move is resolved as a single jump - position is assigned once, at the destination -
// so this used to fire exactly once, against the destination edge. A unit could
// therefore run the length of an enemy's fortified frontage and pay for one step of it,
// which made a fortification something to route THROUGH rather than around: the cheapest
// way past a defended line was to sprint along it and stop somewhere quiet.
//
// So the whole traversed path is charged, one hit per hexPath, in the order they were
// entered. Three things that follow from that and are deliberate:
//
//   THE ORIGIN IS NOT CHARGED. path[0] is where the unit was already standing; it paid
//   for that hexPath when it entered it, and start-of-turn ZoC bills it for staying.
//
//   AN AMBUSHED MOVE IS CHARGED ONLY AS FAR AS IT GOT. The caller passes the truncated
//   path, so a unit halted on step two does not take damage for the four steps it never
//   walked.
//
//   THE SHIELD ABSORBS ONE HIT, NOT THE CROSSING. Three fortified hexPaths against a
//   shielded unit is one absorbed and two landed - which is the whole point of the
//   sponge being per-instance rather than per-turn.
function ApplyFortificationDamageAlongPath(unitMoving, traversedEdges) {
    for (const edgeKey of traversedEdges) {
        const result = ApplyFortificationDamageOnMove(unitMoving, edgeKey);
        if (result.destroyed) return { destroyed: true };
    }
    return { destroyed: false };
}

function ApplyFortificationDamageOnMove(unitMoving, newEdgeKey) {
    if (!unitMoving || unitMoving.isFortified || unitMoving.positionType !== 'edge') return { destroyed: false };
    const tileCoords = parseEdgeKey(newEdgeKey);
    if (tileCoords.some(coord => isNaN(coord.q))) return { destroyed: false };
    let unitDestroyed = false;
    const enemyPlayer = unitMoving.player === 1 ? 2 : 1;

    const checkAndApply = (tile, tileKey) => {
        if (tile && tile.fortifiedByPlayer === enemyPlayer && !unitDestroyed) {
            const fortUnit = engine.state.units.find(u => u.tileKey === tileKey && u.player === enemyPlayer);
            // The mover is already standing on the destination edge by now
            // (unit.position was assigned above), so exclude it - it should not
            // suppress the zone it is walking into.
            if (fortUnit && isZoCSuppressed(fortUnit, unitMoving.id)) {
                return false;
            }

            const moveZocDealt = ApplyDamageToUnit(unitMoving, FORTIFICATION_DAMAGE, 'ZoC');

            if (typeof engine !== 'undefined') {
                engine.actionManager.RecordHistory({
                    type: "MOVEMENT_ZOC_HIT",
                    turn: engine.state.globalTurnNumber,
                    player: unitMoving.player,
                    actorId: unitMoving.id,
                    payload: {
                        location: newEdgeKey,
                        damage: moveZocDealt,
                        isFatal: unitMoving.hp <= 0
                    }
                });
            }

            if (moveZocDealt > 0) engine.Emit({ type: 'LOG', text: `P${unitMoving.player} ${unitMoving.type.name} takes ZoC. HP: ${unitMoving.hp}`, player: engine.state.currentPlayer, duration: 3500 });
            if (unitMoving.hp <= 0) {
                const deathResult = DestroyUnit(unitMoving, "zoc_move");
                unitDestroyed = true;
            }
            return true;
        }
        return false;
    };

    const tile1Key = getTileKey(tileCoords[0].q, tileCoords[0].r);
    const tile2Key = getTileKey(tileCoords[1].q, tileCoords[1].r);
    const tile1 = engine.state.tiles.get(tile1Key);
    const tile2 = engine.state.tiles.get(tile2Key);

    if (!checkAndApply(tile1, tile1Key)) {
        checkAndApply(tile2, tile2Key);
    }
    return { destroyed: unitDestroyed };
}

// Spends one reinforcement charge from a player's queue.
//
// This lived in the CLIENT until B30 (consumeRespawnCharge, js/client/ui.js), called
// after the client decided the spawn or promotion had worked. Two consequences, and the
// second one is the one that corrupted saves:
//
//   Online - the client spent a charge the server knew nothing about, and the next view
//   handed it straight back. Promotions appeared to do nothing.
//
//   Everywhere - the queue was only ever debited by whichever UI path remembered to
//   call it. Any path that did not spent nothing. That is how a B29 save ended up with
//   a level-3 unit AND a fresh reinforcement on three deaths' worth of charges: four
//   spent, three earned, because the accounting never lived next to the thing it paid
//   for.
//
// It is now spent HERE, by the action that consumes it, and only on success.
function SpendReinforcementCharge(player) {
    const queue = engine.state.respawnQueue[`player${player}`];
    if (!queue || queue.length === 0) return false;

    queue.shift();
    return true;
}

function ApplyUnitUpgrade(unit, statType) {
    if (!unit || unit.level >= UPGRADE_CONSTANTS.MAX_LEVEL) {
        console.warn("Upgrade failed: Max level reached or invalid unit.");
        return { success: false };
    }

    // A promotion is PAID FOR with a reinforcement charge, so refuse it when there is
    // none. Nothing checked this before: the queue was debited afterwards by the client,
    // which meant an empty queue simply shifted nothing and the promotion happened free.
    const queue = engine.state.respawnQueue[`player${unit.player}`];
    if (!queue || queue.length === 0 || queue[0].turnsRemaining > 0) {
        return { success: false, error: 'no_reinforcement_ready' };
    }

    const validStats = ['health', 'speed', 'damage', 'defense'];
    if (!validStats.includes(statType)) {
        console.error("Upgrade failed: Invalid stat type", statType);
        return { success: false };
    }

    unit.level++;
    unit.upgrades[statType]++;

    const boostAmount = UPGRADE_CONSTANTS.BOOST_VALUES[statType];

    if (statType === 'health') {
        unit.stats.maxHp += boostAmount;
        unit.stats.hp += boostAmount;
    } else if (statType === 'speed') {
        unit.stats.speed += boostAmount;
        unit.currentMove += boostAmount;
    } else {
        unit.stats[statType] += boostAmount;
    }

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

    engine.Emit({ type: 'UNIT_DAMAGED', unit, attackStatus: 'upgrade' });

    let logMsg = `${unit.type.name} reached Level ${unit.level}! (+${boostAmount} ${statType})`;
    if (penaltyApplied > 0) {
        logMsg += ` (Penalty: -${penaltyApplied} ${pairedStat})`;
    }
    engine.Emit({ type: 'LOG', text: logMsg, player: unit.player });

    if (typeof engine !== 'undefined') {
        engine.actionManager.RecordHistory({
            type: "UNIT_UPGRADE",
            turn: engine.state.globalTurnNumber,
            player: unit.player,
            actorId: unit.id,
            payload: {
                stat: statType,
                level: unit.level,
                penaltyStat: penaltyApplied > 0 ? pairedStat : null,
                unitState: GetUnitSnapshot(unit)
            }
        });
    }


    // Paid for. Spent here rather than by the caller, so the debit cannot be skipped by
    // a path that forgets, and so it lands on the authoritative board.
    SpendReinforcementCharge(unit.player);

    return { success: true };
}

// Pure half of performSwap.
function ApplyClassSwap(unit, newType) {
    const oldRatio = unit.stats.hp / unit.stats.maxHp;

    const newTypeKey = newType.typeName ? newType.typeName.toUpperCase() : newType.name.toUpperCase();
    const template = UNIT_TYPES[newTypeKey];

    let newHp = Math.floor(template.hp * oldRatio);
    if (newHp < 1) newHp = 1;

    const oldType = unit.type.name;

    unit.typeId = newTypeKey;

    unit.stats.maxHp = template.hp;
    unit.stats.hp = newHp;
    // Through SpeedForPreset, not template.speed: a morph in a Normal-pool match
    // must hand out that match's pool, or swapping class would be a free +3 movement.
    unit.stats.speed = SpeedForPreset(newTypeKey, ActiveUnitSpeedPreset());
    unit.stats.damage = template.damage;
    if (unit.isFortified && newTypeKey === 'ARCHER') {
        unit.stats.damage += 2;
    }
    unit.stats.defense = template.defense;
    unit.stats.range = template.attackType === 'ranged' ? 2 : 1;

    unit.currentMove = unit.stats.speed;

    engine.Emit({ type: 'UNIT_DAMAGED', unit, attackStatus: 'normal' });
    engine.Emit({ type: 'LOG', text: `P${unit.player} morphed ${oldType} into ${template.name}.`, player: unit.player });

    engine.actionManager.RecordHistory({
        type: "CLASS_SWAP", turn: engine.state.globalTurnNumber, player: unit.player,
        actorId: unit.id,
        payload: { fromType: oldType, toType: template.name, unitState: GetUnitSnapshot(unit) }
    });

    return {};
}

function ApplyMoveAction(unitToMove, targetEdgeKey, costToMove, path = null) {
    // Marked HERE, not by the caller. js/client/actions.js used to set this itself
    // before sending the request - a client writing authoritative state, which A2 rules
    // out. Locally it looked fine; online the server never set it, so the view that came
    // back said "no action taken" and overwrote the client's optimistic true. The result
    // was the pass-turn confirmation asking whether you were sure after every move.
    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = true;

    const masterUnit = engine.state.units.find(u => u.id === unitToMove.id);
    if (!masterUnit) return { unitFound: false };
    const unit = masterUnit;
    const originPos = unit.edgeKey;

    // --- AMBUSH RESOLUTION ---
    let actualTarget = targetEdgeKey;
    let actualCost = costToMove;
    let ambushed = false;

    // The hexPaths the unit actually entered, origin excluded, in order. Built here
    // rather than derived afterwards because an ambush truncates the route and only
    // this loop knows where it stopped.
    let traversedEdges = [];

    if (path && path.length > 1) {
        let accumulatedCost = 0;
        let lastValidEdge = path[0];

        for (let i = 1; i < path.length; i++) {
            const stepEdgeKey = path[i];
            const stepEdgeObj = engine.state.edges.get(stepEdgeKey);
            const stepCost = getEdgeCost(unit, stepEdgeKey);

            const hasEnemy = stepEdgeObj && stepEdgeObj.units.some(u => u.player !== unit.player);
            const friendlyCount = stepEdgeObj ? stepEdgeObj.units.filter(u => u.player === unit.player).length : 0;
            const isFull = friendlyCount >= 2 && !stepEdgeObj.units.some(u => u.id === unit.id);

            if (hasEnemy || isFull) {
                ambushed = true;
                actualTarget = lastValidEdge;
                accumulatedCost += stepCost;
                break;
            }

            accumulatedCost += stepCost;
            lastValidEdge = stepEdgeKey;
            traversedEdges.push(stepEdgeKey);
        }

        if (ambushed) {
            actualCost = accumulatedCost;
            unit.ambushed = true;
            if (actualTarget === originPos) {
                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} was ambushed and halted immediately!`, player: engine.state.currentPlayer, duration: 3000 });
            } else {
                engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} was ambushed and halted at ${actualTarget.substring(0,5)}...`, player: engine.state.currentPlayer, duration: 3000 });
            }
        }
    }

    // Nothing walked. Two ways to get here: a caller that supplied no path at all, and
    // an ambush on the very first step, which leaves the unit exactly where it started.
    // Both fall back to charging actualTarget once, which is what this code did for
    // every move before the walk existed - preserved rather than re-judged, because
    // whether standing still next to a fortification should cost anything is a rule
    // question and start-of-turn ZoC already has an answer to it.
    if (!traversedEdges.length) traversedEdges = [actualTarget];

    unit.position = FineKeyOfEdge(actualTarget);
    unit.currentMove = Math.max(0, unit.currentMove - actualCost);

    // FLAG CAPTURE LOGIC
    let flagCapturedForPlayer = null;
    if (engine.state.gameMode !== 'arcade' && engine.state.flags) {
        const enemyPlayer = unit.player === 1 ? 2 : 1;
        let enemyFlagHome = null;
        if (engine.state.gridRadius === 4) {
            if (isInternalBaseEdge(actualTarget)) {
                const [h1, h2] = parseEdgeKey(actualTarget);
                const t1 = getTileKey(h1.q, h1.r);
                const enemyBase = engine.state.baseCampPositions[`player${enemyPlayer}`];
                if (Array.isArray(enemyBase) && enemyBase.includes(t1)) enemyFlagHome = true;
            }
        } else {
            const flagObj = unit.player === 1 ? engine.state.flags.p2_flag : engine.state.flags.p1_flag;
            if (flagObj && flagObj.homePosition === actualTarget) enemyFlagHome = true;
        }

        const enemyFlagObj = unit.player === 1 ? engine.state.flags.p2_flag : engine.state.flags.p1_flag;
        if (enemyFlagHome && enemyFlagObj.status === 'at_base') {
            enemyFlagObj.status = 'carried';
            enemyFlagObj.carrierId = unit.id;
            unit.isCarryingFlag = true;
            unit.currentMove = 0;
            engine.Emit({ type: 'LOG', text: `P${unit.player} ${unit.type.name} has picked up the flag!`, player: engine.state.currentPlayer });

            const severResult = SeverSupplyLinesForPlayer(enemyPlayer);

            const victimPlayerQueue = engine.state.respawnQueue[`player${enemyPlayer}`];
            victimPlayerQueue.forEach(item => {
                if (!item.timerHalved) {
                    item.turnsRemaining = Math.ceil(item.turnsRemaining / 2);
                    item.timerHalved = true;
                }
            });

            SetRationsForFlagStatus(enemyPlayer);

            const healingResult = RecalculateHealingEligibility();

            flagCapturedForPlayer = enemyPlayer;
            engine.Emit({ type: 'FLAG_CAPTURED', player: enemyPlayer, carrierId: unit.id, carrierUnit: unit });

            // Until now a flag being stolen left no trace in the ledger at all -
            // a capture-the-flag win read as a sequence of ordinary MOVEs. A6's
            // archive is meant to be the corpus Gospel learns from, so the
            // game-defining events have to be in it.
            engine.actionManager.RecordHistory({
                type: "FLAG_TAKEN", turn: engine.state.globalTurnNumber, player: unit.player,
                actorId: unit.id,
                payload: { victimPlayer: enemyPlayer, at: actualTarget, unitState: GetUnitSnapshot(unit) }
            });
        }
    }

    const fortDamageResult = ApplyFortificationDamageAlongPath(unit, traversedEdges);
    const unitDestroyedByZoC = fortDamageResult.destroyed;

    if (typeof engine !== 'undefined') {
        engine.actionManager.RecordHistory({
            type: "MOVE", turn: engine.state.globalTurnNumber, player: engine.state.currentPlayer,
            actorId: unit.id, payload: { from: originPos, to: actualTarget, cost: actualCost, unitState: GetUnitSnapshot(unit) }
        });
    }

    let shouldRecalcReachableMoves = false;
    let unitStillAlive = !unitDestroyedByZoC && unit.hp > 0;
    if (unitStillAlive) {
        if (!ambushed) engine.Emit({ type: 'LOG', text: `${unit.type.name} moved. MP: ${Math.floor(unit.currentMove)}`, player: engine.state.currentPlayer });
        if (unit.currentMove >= 1 && (!unit.hasPerformedMajorAction || unit.type.canMoveAfterAttack) && !unit.ambushed) {
            shouldRecalcReachableMoves = true;
        }
    }

    return {
        unitFound: true,
        unit,
        ambushed,
        unitDestroyedByZoC,
        unitStillAlive,
        shouldRecalcReachableMoves,
        flagCapturedForPlayer,
    };
}
