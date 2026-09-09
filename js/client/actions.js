// === Actions (MIXED functions split, client wrapper half - A1 step 7) ===
//
// Thin wrappers matching the ORIGINAL function names/signatures from core.js,
// so every existing call site (main.js, ai.js, ui.js, save.js, map-maker.js)
// keeps working unchanged. Each wrapper calls the pure function of the same
// name (but capitalized) in js/server/actions.js, then drains the engine's
// event queue and does the client-owned state + UI work the original inline
// code did - see FortHex_A1_Server_Core_Guide.md §3.
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
// handleMoveAction calls it (checked - grep found zero other call sites), and
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
        case 'VICTORY':
            // LOCAL match: deliberately nothing. The victory screen is rendered by
            // checkVictoryCondition (js/client/game-flow.js) from the verdict the
            // server holds on engine.pendingVictory, and drawing it here as well
            // would draw it twice.
            //
            // ONLINE match: this event IS the verdict. pendingVictory lives in the
            // host's worker and never crosses the wire, and checkVictoryCondition
            // refuses to adjudicate remotely - correctly, it is looking at a filtered
            // board. So without this line the host decided the match was over and no
            // client ever said so: the board simply stopped responding, which is
            // exactly how a capture-the-flag win presented in playtesting.
            //
            // ShowRemoteVictory is idempotent; the board view carrying `gameOver`
            // arrives moments later and calls it too.
            if (typeof IsRemoteMatch === 'function' && IsRemoteMatch()) {
                ShowRemoteVictory({ text: event.text, winner: event.winner, isDraw: event.isDraw });
            }
            break;
        // --- A6 archive ---------------------------------------------------
        // The server decided this moment is worth recording and that consent
        // allows it; the client owns the storage, so the write happens here.
        //
        // Fire-and-forget on purpose. An archive write must never be able to take
        // a turn down with it - a full quota or a browser blocking IndexedDB is a
        // reason to lose a record, not a reason to lose the match in progress.
        case 'ARCHIVE_DUE':
            ArchiveMatchSnapshot(event.complete).catch(err => {
                console.warn('[Archive] snapshot failed for match ' + event.matchId + ':', err);
            });
            break;
        case 'ACTION_REJECTED':
            // The server refused the request. Say so rather than leaving the UI
            // looking frozen, and keep it distinguishable from real game events.
            console.warn(`[Client] Action '${event.action}' rejected: ${event.error}`,
                         event.detail || '');
            showInstruction(DescribeRejection(event), 2500);
            break;
        // --- A3 session events -------------------------------------------
        // These carry everything B3's countdown needs (which player, and the
        // server's own deadline timestamp). Drawing that countdown is B3's
        // track, not this one, so all A3 does here is make the events visible
        // and mark where the UI attaches. Console-only is deliberate: a timer
        // rendered now would be UI built ahead of the track that owns it.
        case 'PLAYER_DISCONNECTED':
            console.warn(`[Client] Player ${event.player} disconnected (${event.reason}). ` +
                         `Deadline: ${new Date(event.deadline).toISOString()}`);
            // A3 put the deadline in this event and left drawing it to B3. This is it.
            ShowDisconnectCountdown(event.player, event.deadline);
            ShowWarning('Player ' + event.player + ' disconnected.');
            break;
        case 'PLAYER_TAKEN_OVER': {
            // Hot join: somebody NEW is now playing that side. Deliberately worded as a
            // different thing from a reconnect, because it is one - the player who
            // dropped is not coming back to this match, and the person left behind is
            // playing a stranger from here on.
            const who = event.name || 'Someone new';
            console.info('[Client] Player ' + event.player + ' taken over by ' + who + '.');
            HideDisconnectCountdown();
            // The "your opponent did not return" question, if it was asked, has just
            // been answered by somebody turning up.
            if (window.FortHexUI && window.FortHexUI.CloseResolution) {
                window.FortHexUI.CloseResolution();
            }
            // Not to the person who just did it - BeginOnlineMatchWith already told
            // them, in the second person, which is the version that reads properly.
            if (event.player !== engine.state.playerSide) {
                ShowSuccess(who + ' took over player ' + event.player + '.');
            }
            break;
        }
        case 'PLAYER_RECONNECTED':
            console.info(`[Client] Player ${event.player} reconnected.`);
            HideDisconnectCountdown();
            ShowSuccess('Player ' + event.player + ' reconnected.');
            break;
        case 'DISCONNECT_RESOLUTION_NEEDED':
            // B3 surfaces the choice; the answer goes back as a
            // 'resolve-disconnect' action (FH.resolve() drives it by hand today).
            console.warn(`[Client] Player ${event.player} did not return. ` +
                         `Resolution required: ${event.choices.join(' | ')}`);
            ShowAlert('Player ' + event.player + ' did not return.');
            // B3: A3 raised this and stopped, because the choice is a UI question and
            // A3 had no UI. This is where it gets asked.
            if (window.FortHexUI && window.FortHexUI.OpenResolution) {
                window.FortHexUI.OpenResolution({
                    player: event.player,
                    reason: event.reason,
                    choices: event.choices,
                });
            }
            break;
        case 'RESPAWN_QUEUE_TICKED':
            // The panel is redrawn either way; the modal only opens for the player whose
            // reinforcement it is, and only in a hosted match - locally, proceedToEndTurn
            // still owns that decision from its own return value.
            updateRespawnQueueDisplay();
            if (IsRemoteMatch() && event.unitReady && !IsForeignUnit({ player: event.player })) {
                showRespawnModal(event.player);
            }
            break;
        case 'DISCONNECT_RESOLVED':
            // B3. A4 already turned the live match into a save; this decides where that
            // save goes. Either way the match stops being online, so the socket is
            // released first - otherwise the host's next sync would overwrite whatever
            // we just loaded, which is the same trap the leave path fell into.
            ApplyDisconnectResolution_Client(event);
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
            // (RecalculateHealingEligibility, called from ApplyMoveAction) - no
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
        case 'TURN_ADVANCED':
            // Nothing to draw. The event exists so that a turn which changes nothing
            // else still produces a state-sync (js/server/turn-lifecycle.js explains
            // why); the view attached to that sync is what actually redraws the board.
            // Named here rather than left to the default so it does not log a warning
            // on every single turn.
            break;

        case 'SHIELD_BROKEN': {
            // Same ring as the grant, drawn inward instead of outward, so the two read
            // as opposites at a glance rather than as the same flourish twice.
            const brokenTile = engine.state.tiles.get(event.unit.tileKey);
            if (brokenTile) {
                const center = axialToPixel(brokenTile.q, brokenTile.r);
                gameState.visualEffects.push({
                    type: 'shield_break',
                    x: center.x, y: center.y,
                    unitRadius: FORTIFIED_UNIT_DRAW_SIZE,
                    startTime: Date.now(),
                    duration: 500
                });
            }
            break;
        }
        case 'SHIELD_GAINED': {
            const tile = engine.state.tiles.get(event.unit.tileKey);
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

    // In a hosted match there is no local result to act on. SendAction posted a REQUEST;
    // the host decides what happened and says so in the state-sync that follows, which
    // ApplyRemoteView writes into engine.state. Reading outcome.result here meant reading
    // fields off an ack that carries none - undefined.spearWalled and the like - which is
    // why attacking and ending a turn threw while plain moves (which never awaited the
    // ack) appeared to work.
    if (IsRemoteMatch()) return true;

    return outcome.ok ? outcome.result : false;
}

function destroyUnit(unitToDestroy, reason = "destroyed") {
    // DestroyUnit is a SERVER mutator. In a hosted match the host has already run it on
    // the authoritative board and the result arrives as a state-sync; running it again
    // here would mutate the local drawing surface a second time, and the next view
    // would overwrite whatever that produced. The console command is the only caller
    // that reaches this in an online match, and it should not.
    if (typeof IsRemoteMatch === 'function' && IsRemoteMatch()) {
        console.warn('[Online] destroyUnit ignored - the host owns the board.');
        return null;
    }

    const result = DestroyUnit(unitToDestroy, reason);
    HandleActionEvents();

    if (engine.state.gameMode !== 'arcade') {
        updateRespawnQueueDisplay();
    }
    updateSupplyPointsDisplay();

    // Client-owned selection/hover/drag state - was never engine-owned, so
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
    if (IsRemoteMatch()) return;
    if (!outcome.ok) return false;
    const result = outcome.result;
    if (result.success) {
        updateSelectedUnitInfoPanel();
    }
    return result.success;
}

function performSwap(unit, newType) {
    const outcome = SendAction('swap-class', { unitId: unit.id, newTypeName: newType.name });
    if (IsRemoteMatch()) return;
    if (!outcome.ok) return;
    const result = outcome.result;

    gameState.swapState = 'complete';
    gameState.unitToSwap = null;

    updateSupplyPointsDisplay();
    ShowSuccess("Swap complete! Turn begins.");
}

function handleMoveAction(unitToMove, targetEdgeKey, costToMove, path = null) {

    // cost and path are deliberately not sent - the server recomputes both from
    // its own getPossibleMoves, which is also how it verifies the move is legal.
    const outcome = SendAction('move', { unitId: unitToMove.id, targetEdgeKey });
    if (IsRemoteMatch()) return;
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
            if (!IsForeignUnit(result.unit)) {
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
        ShowWarning("Cannot build bridge.");
        resetActionSelectionStates();
        updateSelectedUnitInfoPanel();
        return;
    }
    const edgeToBridge = engine.state.edges.get(targetEdgeKey);
    if (!edgeToBridge || edgeToBridge.bridge) {
        ShowWarning("Cannot build bridge here.");
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
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
}

async function completeUnfortify(unitToUnfortify, targetEdgeKey) {
    if (!unitToUnfortify || !unitToUnfortify.isFortified || unitToUnfortify.hasPerformedMajorAction) {
        ShowWarning("Cannot unfortify now.");
        return;
    }
    const targetEdge = engine.state.edges.get(targetEdgeKey);
    if (!targetEdge) {
        ShowWarning("Invalid target edge.");
        return;
    }
    if (targetEdge.units.some(u => u.player !== unitToUnfortify.player) || targetEdge.units.filter(u => u.player === unitToUnfortify.player).length >= 2) {
        ShowWarning("Target edge blocked.");
        resetActionSelectionStates();
        updateSelectedUnitInfoPanel();
        return;
    }

    const duration = 600;
    if (engine.settings.animationsEnabled) {
        gameState.activeAnimations.push({
            type: 'unfortify',
            unit: unitToUnfortify,
            startTileKey: unitToUnfortify.tileKey,
            targetEdgeKey: targetEdgeKey,
            startTime: Date.now(),
            duration,
        });
    }

    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();

    await SendAction('unfortify', { unitId: unitToUnfortify.id, targetEdgeKey, duration });

    gameState.mustUnfortify = false;
    ui.endTurnButton.disabled = false;

    HandleActionEvents();

    engine.visionDirty = true;

    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
}

async function completeFortify(unitToFortify, targetTileKeyToFortify) {
    if (!unitToFortify || unitToFortify.hasPerformedMajorAction || unitToFortify.isFortified) { ShowWarning("Cannot fortify now."); return; }
    const targetTileObject = engine.state.tiles.get(targetTileKeyToFortify);
    if (!targetTileObject || !canUnitFortifyOnTile(unitToFortify, targetTileObject)) { ShowWarning("Invalid tile to fortify."); return; }
    if (targetTileObject.fortifiedByPlayer !== null) {
        ShowWarning(`Tile ${targetTileKeyToFortify.substring(0,5)}... already fortified.`);
        resetActionSelectionStates();
        updateSelectedUnitInfoPanel(); return;
    }

    const myFlagTileKey = getFlagTileKey(unitToFortify.player);
    if (targetTileKeyToFortify === myFlagTileKey && !unitToFortify.isCarryingFlag) {
        ShowWarning("Cannot fortify on the flag tile.");
        resetActionSelectionStates();
        updateSelectedUnitInfoPanel(); return;
    }

    // Enforced here, not just in the UI - the player-facing paths already blocked
    // this, but nothing stopped a non-UI caller from fortifying inside enemy base
    // camp tiles. The enemy FLAG tile remains a legal capture target.
    const enemyPlayer = unitToFortify.player === 1 ? 2 : 1;
    const enemyFlagTileKey = getFlagTileKey(enemyPlayer);
    if (GetBaseCamp(enemyPlayer).includes(targetTileKeyToFortify) && targetTileKeyToFortify !== enemyFlagTileKey) {
        ShowWarning("Cannot fortify inside the enemy base camp.");
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


    engine.visionDirty = true;
    gameState.currentReachableMoves.clear();
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
    if (!engine.state.gameOver) checkVictoryCondition();
}

async function completeAttack(attackingUnit, targetUnitInfo, attackType) {
    // 1. Validate Attacker
    if (!attackingUnit || attackingUnit.currentMove < ATTACK_COST || attackingUnit.hasPerformedMajorAction) {
        ShowWarning("Cannot complete attack.");
        resetActionSelectionStates();
        updateSelectedUnitInfoPanel();
        return;
    }

    // 2. Refresh Attacker Reference (Safety)
    const liveAttacker = engine.state.units.find(u => u.id === attackingUnit.id);
    if (!liveAttacker) { console.error("Attacker missing from master list"); return; }
    attackingUnit = liveAttacker;

    gameState.currentReachableMoves.clear(); // client-owned, cleared immediately

    // --- Animation setup (pixel-space - a client-only concern per the guide).
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
    if (IsRemoteMatch()) {

    // In a hosted match there is no local result to act on. SendAction posted a REQUEST;
    // the host decides what happened and says so in the state-sync that follows, which
    // ApplyRemoteView writes into engine.state. Reading outcome.result here meant reading
    // fields off an ack that carries none - undefined.spearWalled and the like - which is
    // why attacking and ending a turn threw while plain moves (which never awaited the
    // ack) appeared to work.
        resetActionSelectionStates();
        updateSelectedUnitInfoPanel();
        return;
    }

    if (!outcome.ok) return;
    const result = outcome.result;

    // Replicate original's post-mutation currentReachableMoves branching
    // (client-owned) - attackingUnit is the same object ApplyAttack just
    // mutated, so its fields (currentMove, spearWalled) already reflect the
    // outcome; result.spearWalled/bridgeDestroyed cover the branches that
    // depend on combat-resolution details rather than just the unit's fields.
    if (attackingUnit.type.canMoveAfterAttack) {
        if (result.spearWalled) {
            gameState.currentReachableMoves.clear();
        } else if (attackingUnit.currentMove > 0) {
            if (!IsForeignUnit(attackingUnit)) {
                gameState.currentReachableMoves = getPossibleMoves(attackingUnit);
            }
        } else {
            gameState.currentReachableMoves.clear();
        }
    } else {
        gameState.currentReachableMoves.clear();
    }
    if (result.bridgeDestroyed && attackingUnit.type.name === 'Horseman') {
        if (!IsForeignUnit(attackingUnit)) {
            gameState.currentReachableMoves = getPossibleMoves(attackingUnit);
        }
    }

    updateSupplyPointsDisplay();
    resetActionSelectionStates();
    updateSelectedUnitInfoPanel();
    if (!engine.state.gameOver) checkVictoryCondition();
}
