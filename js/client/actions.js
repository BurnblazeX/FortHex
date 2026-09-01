// === Actions (MIXED functions split, client wrapper half — A1 step 7) ===
//
// Thin wrappers matching the ORIGINAL function names/signatures from core.js,
// so every existing call site (main.js, ai.js, map.js, ui.js, save.js, and
// core.js's still-untouched animation-deferred functions) keeps working
// unchanged. Each wrapper calls the pure function of the same name (but
// capitalized) in js/server/actions.js, then drains/handles the returned
// events and does the client-owned state + UI work the original inline code
// did — see FortHex_A1_Server_Core_Guide.md §3.
//
// applyFortificationDamageOnMove has no wrapper here: nothing outside
// handleMoveAction calls it (checked — grep found zero other call sites), and
// ApplyMoveAction already calls the pure ApplyFortificationDamageOnMove
// directly. Same for the pure-to-pure DestroyUnit calls inside actions.js.

function HandleActionEvent(event) {
    switch (event.type) {
        case 'LOG':
            logAction(event.text, event.player, event.duration);
            break;
        case 'UNIT_DAMAGED':
            triggerDamageVisual(event.unit, event.attackStatus);
            break;
        case 'FLAG_CAPTURED': {
            // Healing eligibility (unit.canHeal) is already recomputed server-side
            // (RecalculateHealingEligibility, called from ApplyMoveAction) — no
            // client-side gameState mutation needed here, just the UI refresh.
            updateRespawnQueueDisplay();
            const unitPos = getUnitScreenPosition(event.carrierUnit);
            if (unitPos) {
                gameState.visualEffects.push({
                    type: 'flag_capture_burst',
                    x: unitPos.x,
                    y: unitPos.y,
                    player: event.player,
                    startTime: Date.now(),
                    duration: 500
                });
            }
            break;
        }
        case 'SHIELD_GAINED': {
            const tile = gameState.tiles.get(event.unit.position);
            if (tile) {
                const center = axialToPixel(tile.q, tile.r);
                gameState.visualEffects.push({
                    type: 'shield_ring',
                    x: center.x, y: center.y,
                    unitRadius: FORTIFIED_UNIT_DRAW_SIZE,
                    startTime: Date.now(),
                    duration: 600
                });
            }
            break;
        }
        default:
            console.warn('[HandleActionEvent] Unhandled event type:', event.type);
    }
}

function HandleActionEvents(events) {
    events.forEach(HandleActionEvent);
}

function destroyUnit(unitToDestroy, reason = "destroyed") {
    const result = DestroyUnit(unitToDestroy, reason);
    HandleActionEvents(result.events);

    if (gameState.gameMode !== 'arcade') {
        updateRespawnQueueDisplay();
    }
    updateSupplyPointsDisplay();

    // Client-owned selection/hover/drag state — was never engine-owned, so
    // this whole block moved here wholesale rather than being split further.
    if (gameState.selectedUnit && gameState.selectedUnit.id === result.destroyedUnitId) {
        gameState.selectedUnit = null;
        gameState.currentReachableMoves.clear();
        resetActionSelectionStates();
        updateSelectedUnitInfoPanel();
        gameState.mustUnfortify = false;
    }
    if (gameState.hoveredUnitId === result.destroyedUnitId) {
        gameState.hoveredUnitId = null;
        canvas.style.cursor = 'default';
    }
    if (gameState.draggingUnit && gameState.draggingUnit.id === result.destroyedUnitId) {
        gameState.isDragging = false;
        gameState.draggingUnit = null;
        canvas.style.cursor = 'default';
    }

    gameState.visionDirty = true;
    checkVictoryCondition();
    gameState.needsRedraw = true;
}

function handleUnitDeath(unitToDie, reason = "destroyed") {
    const unitExists = gameState.units.some(u => u.id === unitToDie.id);
    if (!unitExists) return;
    destroyUnit(unitToDie, reason);
}

function severSupplyLinesForPlayer(playerNum) {
    const result = SeverSupplyLinesForPlayer(playerNum);
    HandleActionEvents(result.events);
}

function attemptToResupplyForts(playerNum) {
    const result = AttemptToResupplyForts(playerNum);
    HandleActionEvents(result.events);
    updateSupplyPointsDisplay();
}

function applyUnitUpgrade(unit, statType) {
    const result = ApplyUnitUpgrade(unit, statType);
    HandleActionEvents(result.events);
    if (result.success) {
        updateSelectedUnitInfoPanel();
    }
    return result.success;
}

function performSwap(unit, newType) {
    const result = ApplyClassSwap(unit, newType);
    HandleActionEvents(result.events);

    gameState.swapState = 'complete';
    gameState.unitToSwap = null;

    updateSupplyPointsDisplay();
    showInstruction("Swap complete! Turn begins.", 2000);
}

function handleMoveAction(unitToMove, targetEdgeKey, costToMove, path = null) {
    gameState.playerActionTaken[`player${gameState.currentPlayer}`] = true;

    const result = ApplyMoveAction(unitToMove, targetEdgeKey, costToMove, path);
    if (!result.unitFound) {
        console.error("CRITICAL: Unit not found.");
        return;
    }
    HandleActionEvents(result.events);

    gameState.visionDirty = true;
    gameState.needsRedraw = true;

    checkVictoryCondition();

    if (result.unitStillAlive) {
        if (result.shouldRecalcReachableMoves) {
            if (gameState.gameMode !== 'singleplayer' || result.unit.player === gameState.playerSide) {
                gameState.currentReachableMoves = getPossibleMoves(result.unit);
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

async function completeBuildBridge(targetEdgeKey) {
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

    gameState.currentReachableMoves.clear(); // client-owned, cleared immediately

    const duration = 500;
    if (gameSettings.animationsEnabled) {
        gameState.activeAnimations.push({
            type: 'build_bridge',
            unit: selectedUnit,
            targetEdgeKey: targetEdgeKey,
            startTime: Date.now(),
            duration,
        });
    }

    // Matches original timing: UI resets immediately, doesn't wait for the
    // animation/mutation to land.
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();

    const result = await ApplyBuildBridge(selectedUnit, targetEdgeKey, duration);
    gameState.playerActionTaken[`player${gameState.currentPlayer}`] = true;
    HandleActionEvents(result.events);
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
}

async function completeUnfortify(unitToUnfortify, targetEdgeKey) {
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

    const duration = 600;
    if (gameSettings.animationsEnabled) {
        gameState.activeAnimations.push({
            type: 'unfortify',
            unit: unitToUnfortify,
            startTileKey: unitToUnfortify.position,
            targetEdgeKey: targetEdgeKey,
            startTime: Date.now(),
            duration,
        });
    }

    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();

    const result = await ApplyUnfortify(unitToUnfortify, targetEdgeKey, duration);

    gameState.playerActionTaken[`player${gameState.currentPlayer}`] = true;
    gameState.mustUnfortify = false;
    ui.endTurnButton.disabled = false;

    HandleActionEvents(result.events);

    gameState.visionDirty = true;

    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
}

async function completeFortify(unitToFortify, targetTileKeyToFortify) {
    if (!unitToFortify || unitToFortify.hasPerformedMajorAction || unitToFortify.isFortified) { showInstruction("Cannot fortify now.", 2000); return; }
    const targetTileObject = gameState.tiles.get(targetTileKeyToFortify);
    if (!targetTileObject || !canUnitFortifyOnTile(unitToFortify, targetTileObject)) { showInstruction("Invalid tile to fortify.", 2000); return; }
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

    // Enforced here, not just in the UI — the player-facing paths already blocked
    // this, but nothing stopped a non-UI caller from fortifying inside enemy base
    // camp tiles. The enemy FLAG tile remains a legal capture target.
    const enemyPlayer = unitToFortify.player === 1 ? 2 : 1;
    const enemyFlagTileKey = getFlagTileKey(enemyPlayer);
    if (GetBaseCamp(enemyPlayer).includes(targetTileKeyToFortify) && targetTileKeyToFortify !== enemyFlagTileKey) {
        showInstruction("Cannot fortify inside the enemy base camp.", 2500);
        resetActionSelectionStates();
        updateSelectedUnitInfoPanel(); return;
    }

    gameState.currentReachableMoves.clear(); // client-owned, cleared immediately

    const duration = 450;
    if (gameSettings.animationsEnabled) {
        gameState.activeAnimations.push({
            type: 'fortify',
            unit: unitToFortify,
            targetTileKey: targetTileKeyToFortify,
            startTime: Date.now(),
            duration,
        });
    }

    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();

    const result = await ApplyFortify(unitToFortify, targetTileKeyToFortify, duration);

    gameState.playerActionTaken[`player${gameState.currentPlayer}`] = true;
    HandleActionEvents(result.events);

    gameState.visionDirty = true;
    gameState.currentReachableMoves.clear();
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
    if (!gameState.gameOver) checkVictoryCondition();
}

async function completeAttack(attackingUnit, targetUnitInfo, attackType) {
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

    gameState.currentReachableMoves.clear(); // client-owned, cleared immediately

    // --- Animation setup (pixel-space — a client-only concern per the guide).
    // This computes `duration`, which is all the server-side ApplyAttack needs
    // to know how long to wait before applying the real mutation. ---
    let duration = 0;
    if (gameSettings.animationsEnabled) {
        if (targetUnitInfo.isBridgeTarget) {
            const bridgeEdge = gameState.edges.get(targetUnitInfo.edgeKey);
            if (bridgeEdge) {
                const targetPos = getEdgeMidpoint(bridgeEdge.q1, bridgeEdge.r1, bridgeEdge.q2, bridgeEdge.r2);
                const dummyTarget = { isFortified: false, position: targetUnitInfo.edgeKey, getScreenPosition: () => targetPos };
                const originalGetUnitScreenPosition = getUnitScreenPosition;
                getUnitScreenPosition = (unit) => {
                    if (unit === dummyTarget) return unit.getScreenPosition();
                    return originalGetUnitScreenPosition(unit);
                };

                const animation = { attacker: attackingUnit, targetInfo: targetUnitInfo, startTime: Date.now() };
                if (attackingUnit.type.attackType === 'melee') {
                    animation.type = 'attack_lunge'; animation.duration = 250; animation.target = dummyTarget;
                    duration = 250;
                    gameState.activeAnimations.push(animation);
                } else if (attackingUnit.type.attackType === 'ranged') {
                    animation.targets = [dummyTarget];
                    const startPos = originalGetUnitScreenPosition(attackingUnit);
                    const maxDistance = pointDistance(startPos, targetPos);
                    const travelDuration = maxDistance / PROJECTILE_SPEED_PIXELS_PER_MS;
                    animation.type = 'attack_projectile'; animation.duration = 150 + 250 + travelDuration;
                    animation.preShotDuration = { draw: 150, hold: 250 }; animation.travelDuration = travelDuration;
                    duration = animation.duration;
                    gameState.activeAnimations.push(animation);
                }
                setTimeout(() => { getUnitScreenPosition = originalGetUnitScreenPosition; }, duration + 50);
            }
        } else if (attackingUnit.type.attackType === 'melee') {
            duration = 250;
            gameState.activeAnimations.push({
                attacker: attackingUnit, targetInfo: targetUnitInfo, startTime: Date.now(),
                type: 'attack_lunge', duration, target: targetUnitInfo.unit
            });
        } else if (attackingUnit.type.attackType === 'ranged') {
            let targets = []; let maxDistance = 0;
            const edgeOfTarget = targetUnitInfo.edgeKey ? gameState.edges.get(targetUnitInfo.edgeKey) : null;
            const enemyUnitsOnEdge = edgeOfTarget ? edgeOfTarget.units.filter(u => u.player !== attackingUnit.player) : [];
            if (edgeOfTarget && enemyUnitsOnEdge.length === 2 && !targetUnitInfo.unit.isFortified) { targets = enemyUnitsOnEdge; } else { targets.push(targetUnitInfo.unit); }
            const startPos = getUnitScreenPosition(attackingUnit);
            if (startPos) {
                targets.forEach(t => {
                    const targetPos = getUnitScreenPosition(t);
                    if (targetPos) { const distance = pointDistance(startPos, targetPos); if (distance > maxDistance) maxDistance = distance; }
                });
            }
            if (maxDistance > 0) {
                const preShotDrawDuration = 150; const preShotHoldDuration = 250; const travelDuration = maxDistance / PROJECTILE_SPEED_PIXELS_PER_MS;
                duration = preShotDrawDuration + preShotHoldDuration + travelDuration;
                gameState.activeAnimations.push({
                    attacker: attackingUnit, targetInfo: targetUnitInfo, startTime: Date.now(),
                    type: 'attack_projectile', duration, targets,
                    preShotDuration: { draw: preShotDrawDuration, hold: preShotHoldDuration }, travelDuration
                });
            }
        }
    }

    const result = await ApplyAttack(attackingUnit, targetUnitInfo, attackType, duration);
    HandleActionEvents(result.events);

    // Replicate original's post-mutation currentReachableMoves branching
    // (client-owned) — attackingUnit is the same object ApplyAttack just
    // mutated, so its fields (currentMove, spearWalled) already reflect the
    // outcome; result.spearWalled/bridgeDestroyed cover the branches that
    // depend on combat-resolution details rather than just the unit's fields.
    if (attackingUnit.type.canMoveAfterAttack) {
        if (result.spearWalled) {
            gameState.currentReachableMoves.clear();
        } else if (attackingUnit.currentMove > 0) {
            if (gameState.gameMode !== 'singleplayer' || attackingUnit.player === gameState.playerSide) {
                gameState.currentReachableMoves = getPossibleMoves(attackingUnit);
            }
        } else {
            gameState.currentReachableMoves.clear();
        }
    } else {
        gameState.currentReachableMoves.clear();
    }
    if (result.bridgeDestroyed && attackingUnit.type.name === 'Horseman') {
        if (gameState.gameMode !== 'singleplayer' || attackingUnit.player === gameState.playerSide) {
            gameState.currentReachableMoves = getPossibleMoves(attackingUnit);
        }
    }

    updateSupplyPointsDisplay();
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
    if (!gameState.gameOver) checkVictoryCondition();
}
