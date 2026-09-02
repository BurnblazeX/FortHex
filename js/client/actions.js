// === Actions (MIXED functions split, client wrapper half — A1 step 7) ===
//
// Thin wrappers matching the ORIGINAL function names/signatures from core.js,
// so every existing call site (main.js, ai.js, ui.js, save.js, map-maker.js)
// keeps working unchanged. Each wrapper calls the pure function of the same
// name (but capitalized) in js/server/actions.js, then drains the engine's
// event queue and does the client-owned state + UI work the original inline
// code did — see FortHex_A1_Server_Core_Guide.md §3.
//
// Wrappers used to be handed an events array in the return value. Since the
// queue formalization they call HandleActionEvents() with no argument and it
// drains engine.DrainEvents() instead. The return value now carries only the
// facts a wrapper branches on.
//
// One consequence worth knowing: the queue is per-engine-instance, not
// per-call. If a wrapper takes an early return between calling into the engine
// and draining, whatever was queued isn't lost - it just gets flushed by the
// next drain. Every early return that could strand events has an explicit
// drain (see the arcade turn-cap branch in game-flow.js).
//
// applyFortificationDamageOnMove has no wrapper here: nothing outside
// handleMoveAction calls it (checked — grep found zero other call sites), and
// ApplyMoveAction already calls the pure ApplyFortificationDamageOnMove
// directly. Same for the pure-to-pure DestroyUnit calls inside actions.js.

// Player-facing wording for a rejection. Codes come from ACTION_SPECS in
// js/server/validation.js.
const REJECTION_TEXT = {
    not_your_turn:     "It's not your turn.",
    unit_not_found:    "That unit is no longer there.",
    tile_not_found:    "That tile doesn't exist.",
    edge_not_found:    "That position doesn't exist.",
    illegal_action:    "That move isn't allowed.",
    malformed_payload: "That request was incomplete.",
    unknown_action:    "Unrecognised action.",
};

function DescribeRejection(event) {
    return REJECTION_TEXT[event.error] || "That action was rejected.";
}

function HandleActionEvent(event) {
    switch (event.type) {
        case 'LOG':
            logAction(event.text, event.player, event.duration);
            break;
        case 'UNIT_DAMAGED':
            triggerDamageVisual(event.unit, event.attackStatus);
            break;
        case 'ACTION_REJECTED':
            // The server refused the request. Say so rather than leaving the UI
            // looking frozen, and keep it distinguishable from real game events.
            console.warn(`[Client] Action '${event.action}' rejected: ${event.error}`,
                         event.detail || '');
            showInstruction(DescribeRejection(event), 2500);
            break;
        case 'SUPPLY_CHANGED':
            updateSupplyPointsDisplay();
            break;
        case 'VISION_INVALIDATED':
            engine.visionDirty = true;
            gameState.needsRedraw = true;
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
            const tile = engine.state.tiles.get(event.unit.position);
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

// Handles the events an engine function returned, then flushes anything the
// engine queued via engine.Emit(). Deep helpers like recalculatePlayerSupplyNetwork
// and SpawnUnit sit too far down the call chain to thread an events array back
// out of, so they emit instead - this is the single drain point that picks
// those up.
function HandleActionEvents() {
    transport.Flush();
}

// Player intents go to the server as {type:'action'} messages and come back as
// {type:'state-sync'}. The events are dispatched by the subscriber registered
// in js/main.js; what's returned here is the result the wrapper branches on.
// Server-internal cascades (DestroyUnit, SeverSupplyLinesForPlayer, the
// turn-lifecycle sub-steps) deliberately do NOT go through here - they aren't
// things a client requests, they're consequences the server decided on.
function SendAction(action, payload) {
    return transport.Send(MakeActionMessage(action, payload));
}

// Payloads carry ids and keys only (A2 §4). The server resolves them against
// its own engine.state, so nothing the client says about a unit's condition is
// believed - only which unit it means. A rejected action returns
// { ok:false, error } and changes nothing; wrappers must check before using
// `result`, which is absent on rejection.

// Thin wrapper over js/server/rules.js's SpawnUnit, so its callers in ai.js,
// main.js and ui.js keep the original name/signature and still get the
// respawn log lines that used to be a direct logAction() call inside it.
function spawnUnit(player, unitType) {
    const outcome = SendAction('spawn-unit', { player, unitTypeName: unitType.name });
    return outcome.ok ? outcome.result : false;
}

function destroyUnit(unitToDestroy, reason = "destroyed") {
    const result = DestroyUnit(unitToDestroy, reason);
    HandleActionEvents();

    if (engine.state.gameMode !== 'arcade') {
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

    engine.visionDirty = true;
    checkVictoryCondition();
    gameState.needsRedraw = true;
}

function handleUnitDeath(unitToDie, reason = "destroyed") {
    const unitExists = engine.state.units.some(u => u.id === unitToDie.id);
    if (!unitExists) return;
    destroyUnit(unitToDie, reason);
}

function severSupplyLinesForPlayer(playerNum) {
    const result = SeverSupplyLinesForPlayer(playerNum);
    HandleActionEvents();
}

function attemptToResupplyForts(playerNum) {
    const result = AttemptToResupplyForts(playerNum);
    HandleActionEvents();
    updateSupplyPointsDisplay();
}

function applyUnitUpgrade(unit, statType) {
    const outcome = SendAction('upgrade-unit', { unitId: unit.id, statType });
    if (!outcome.ok) return false;
    const result = outcome.result;
    if (result.success) {
        updateSelectedUnitInfoPanel();
    }
    return result.success;
}

function performSwap(unit, newType) {
    const outcome = SendAction('swap-class', { unitId: unit.id, newTypeName: newType.name });
    if (!outcome.ok) return;
    const result = outcome.result;

    gameState.swapState = 'complete';
    gameState.unitToSwap = null;

    updateSupplyPointsDisplay();
    showInstruction("Swap complete! Turn begins.", 2000);
}

function handleMoveAction(unitToMove, targetEdgeKey, costToMove, path = null) {
    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = true;

    // cost and path are deliberately not sent - the server recomputes both from
    // its own getPossibleMoves, which is also how it verifies the move is legal.
    const outcome = SendAction('move', { unitId: unitToMove.id, targetEdgeKey });
    if (!outcome.ok) return;
    const result = outcome.result;
    if (!result.unitFound) {
        console.error("CRITICAL: Unit not found.");
        return;
    }

    engine.visionDirty = true;
    gameState.needsRedraw = true;

    checkVictoryCondition();

    if (result.unitStillAlive) {
        if (result.shouldRecalcReachableMoves) {
            if (engine.state.gameMode !== 'singleplayer' || result.unit.player === engine.state.playerSide) {
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
    const edgeToBridge = engine.state.edges.get(targetEdgeKey);
    if (!edgeToBridge || edgeToBridge.bridge) {
        showInstruction("Cannot build bridge here.", 2000);
        resetActionSelectionStates();
        updateSelectedUnitInfoPanel();
        return;
    }

    gameState.currentReachableMoves.clear(); // client-owned, cleared immediately

    const duration = 500;
    if (engine.settings.animationsEnabled) {
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

    await SendAction('build-bridge', { unitId: selectedUnit.id, targetEdgeKey, duration });
    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = true;
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
}

async function completeUnfortify(unitToUnfortify, targetEdgeKey) {
    if (!unitToUnfortify || !unitToUnfortify.isFortified || unitToUnfortify.hasPerformedMajorAction) {
        showInstruction("Cannot unfortify now.", 2000);
        return;
    }
    const targetEdge = engine.state.edges.get(targetEdgeKey);
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
    if (engine.settings.animationsEnabled) {
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

    await SendAction('unfortify', { unitId: unitToUnfortify.id, targetEdgeKey, duration });

    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = true;
    gameState.mustUnfortify = false;
    ui.endTurnButton.disabled = false;

    HandleActionEvents();

    engine.visionDirty = true;

    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
}

async function completeFortify(unitToFortify, targetTileKeyToFortify) {
    if (!unitToFortify || unitToFortify.hasPerformedMajorAction || unitToFortify.isFortified) { showInstruction("Cannot fortify now.", 2000); return; }
    const targetTileObject = engine.state.tiles.get(targetTileKeyToFortify);
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
    if (engine.settings.animationsEnabled) {
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

    await SendAction('fortify', { unitId: unitToFortify.id, targetTileKey: targetTileKeyToFortify, duration });

    engine.state.playerActionTaken[`player${engine.state.currentPlayer}`] = true;

    engine.visionDirty = true;
    gameState.currentReachableMoves.clear();
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
    if (!engine.state.gameOver) checkVictoryCondition();
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
    const liveAttacker = engine.state.units.find(u => u.id === attackingUnit.id);
    if (!liveAttacker) { console.error("Attacker missing from master list"); return; }
    attackingUnit = liveAttacker;

    gameState.currentReachableMoves.clear(); // client-owned, cleared immediately

    // --- Animation setup (pixel-space — a client-only concern per the guide).
    // This computes `duration`, which is all the server-side ApplyAttack needs
    // to know how long to wait before applying the real mutation. ---
    let duration = 0;
    if (engine.settings.animationsEnabled) {
        if (targetUnitInfo.isBridgeTarget) {
            const bridgeEdge = engine.state.edges.get(targetUnitInfo.edgeKey);
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
            const edgeOfTarget = targetUnitInfo.edgeKey ? engine.state.edges.get(targetUnitInfo.edgeKey) : null;
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

    const outcome = await SendAction('attack', {
        unitId: attackingUnit.id,
        targetUnitId: targetUnitInfo.unit ? targetUnitInfo.unit.id : null,
        targetEdgeKey: targetUnitInfo.edgeKey || null,
        isBridgeTarget: !!targetUnitInfo.isBridgeTarget,
        attackType,
        duration
    });
    if (!outcome.ok) return;
    const result = outcome.result;

    // Replicate original's post-mutation currentReachableMoves branching
    // (client-owned) — attackingUnit is the same object ApplyAttack just
    // mutated, so its fields (currentMove, spearWalled) already reflect the
    // outcome; result.spearWalled/bridgeDestroyed cover the branches that
    // depend on combat-resolution details rather than just the unit's fields.
    if (attackingUnit.type.canMoveAfterAttack) {
        if (result.spearWalled) {
            gameState.currentReachableMoves.clear();
        } else if (attackingUnit.currentMove > 0) {
            if (engine.state.gameMode !== 'singleplayer' || attackingUnit.player === engine.state.playerSide) {
                gameState.currentReachableMoves = getPossibleMoves(attackingUnit);
            }
        } else {
            gameState.currentReachableMoves.clear();
        }
    } else {
        gameState.currentReachableMoves.clear();
    }
    if (result.bridgeDestroyed && attackingUnit.type.name === 'Horseman') {
        if (engine.state.gameMode !== 'singleplayer' || attackingUnit.player === engine.state.playerSide) {
            gameState.currentReachableMoves = getPossibleMoves(attackingUnit);
        }
    }

    updateSupplyPointsDisplay();
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
    if (!engine.state.gameOver) checkVictoryCondition();
}
