// === Input Handlers (client-only — A1 step 8/12) ===
//
// Pure relocation from main.js, no logic changes — these are input
// translation (click/drag/tap -> a call into the action layer), which the
// guide explicitly classifies as staying entirely client-side and unchanged
// in shape for A1. The boundary these handlers call into (js/client/actions.js
// wrappers) already changed in step 7; that's the only thing A1 touches here.

function handleInteractionStart(x, y, isTouchEvent = false) {
            if (gameState.fillToolActive) {
                if (gameState.mapMakerBrush.type !== 'tile') {
                    showInstruction("Please select a tile type to fill with.", 2000);
                    return;
                }
                const coords = pixelToAxial(x, y);
                performFloodFill(coords.q, coords.r);
                return;
            }

            if (gameState.mapMakerMode) {
                gameState.isDragging = true;
                gameState.mapMakerLastPaintedHexKey = null;
                applyMapMakerBrush(x, y);
                return;
            }
            if (engine.state.gameOver) return;

            // --- ARCADE TIMER TRIGGER ---
            // Timer starts only after P1 interacts on Turn 1
            if (engine.state.gameMode === 'arcade' && !gameState.arcadeGameStartedInteraction) {
                gameState.arcadeGameStartedInteraction = true;
            }
            // ----------------------------

            // --- ARCADE SWAP INTERCEPTION ---
            if (engine.state.gameMode === 'arcade' && gameState.swapState === 'selecting_unit') {
                const baseClickRadius = isTouchEvent ? UNIT_CLICK_RADIUS * 1.5 : UNIT_CLICK_RADIUS;
                const clickRadius = baseClickRadius * gameState.renderScale;
                
                // Simple finding logic for Swap Click
                let clickedUnit = null;
                const edgeUnits = [];
                engine.state.edges.forEach(edge => edge.units.forEach(u => { if (u.positionType === 'edge') edgeUnits.push({unit:u, edge}); }));
                
                for (let i = edgeUnits.length - 1; i >= 0; i--) {
                     const {unit, edge} = edgeUnits[i];
                     if (unit.player !== engine.state.currentPlayer) continue;
                     const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                     // (Simplified math from main handler for brevity, full implementation recommended in production)
                     if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < clickRadius) {
                         clickedUnit = unit;
                         break;
                     }
                }
                // Also check fortified units (though rare in arcade)
                if (!clickedUnit) {
                    for (const unit of engine.state.units) {
                         if (unit.player === engine.state.currentPlayer && unit.isFortified) {
                             const tile = engine.state.tiles.get(unit.position);
                             if (tile) {
                                 const {x: tx, y: ty} = axialToPixel(tile.q, tile.r);
                                 if (Math.sqrt((x - tx)**2 + (y - ty)**2) < clickRadius) {
                                     clickedUnit = unit;
                                     break;
                                 }
                             }
                         }
                    }
                }

                if (clickedUnit) {
                    gameState.unitToSwap = clickedUnit;
                    gameState.swapState = 'selecting_class';
                    showSwapClassModal(clickedUnit);
                } else {
                    showInstruction("You must select a unit to SWAP!", 1500);
                }
                return; // Stop standard interaction
            }

            if (gameState.fillToolActive) {
                if (gameState.mapMakerBrush.type !== 'tile') {
                    showInstruction("Please select a tile type to fill with.", 2000);
                    return;
                }
                const coords = pixelToAxial(x, y);
                performFloodFill(coords.q, coords.r);
                return;
            }

            if (gameState.mapMakerMode) {
                gameState.isDragging = true;
                gameState.mapMakerLastPaintedHexKey = null;
                applyMapMakerBrush(x, y);
                return;
            }
            if (engine.state.gameOver || gameState.currentActionState !== ACTION_STATES.IDLE && gameState.currentActionState !== ACTION_STATES.UNIT_SELECTED) return;

            dragOperationJustConcluded = false; 
            clearDebugPath();
            gameState.dragStartX = x; 
            gameState.dragStartY = y; 
            gameState.draggedDistance = 0;

            let unitToDrag = null;
            
            // --- FIX: Apply renderScale to click radius ---
            const baseClickRadius = isTouchEvent ? UNIT_CLICK_RADIUS * 1.5 : UNIT_CLICK_RADIUS;
            const clickRadius = baseClickRadius * gameState.renderScale;
            // ----------------------------------------------

            const edgeUnits = [];
            engine.state.edges.forEach(edge => edge.units.forEach(u => { if (u.positionType === 'edge') edgeUnits.push({unit:u, edge}); }));
            
            for (let i = edgeUnits.length - 1; i >= 0; i--) {
                const {unit, edge} = edgeUnits[i];
                if (unit.player !== engine.state.currentPlayer) continue;
                if (engine.state.gameMode === 'singleplayer' && unit.player !== engine.state.playerSide) continue; 
                if (unit.isFortified || unit.currentMove < 1) continue;
                if (unit.hasPerformedMajorAction && !unit.type.canMoveAfterAttack) continue;
                if (unit.spearWalled) continue;
                 
                 const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                 let unitCenterX = mid.x, unitCenterY = mid.y;
                 const edgeUnitsOnly = edge.units.filter(u => u.positionType === 'edge');
                 const unitIndexOnEdge = edgeUnitsOnly.findIndex(u => u.id === unit.id);
                 if (edgeUnitsOnly.length > 1 && unitIndexOnEdge !== -1) {
                    const offsetSign = (unitIndexOnEdge % 2 === 0) ? -1 : 1;
                    const p1 = axialToPixel(edge.q1, edge.r1); const p2 = axialToPixel(edge.q2, edge.r2);
                    let dx_val = p2.x - p1.x, dy_val = p2.y - p1.y; const len = Math.sqrt(dx_val*dx_val + dy_val*dy_val) || 1;
                    let perpX = -dy_val / len, perpY = dx_val / len;
                    
                    // --- FIX: Apply renderScale to visual offset calculation ---
                    unitCenterX += perpX * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5); 
                    unitCenterY += perpY * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5);
                 }
                 
                 if (Math.sqrt((x - unitCenterX)**2 + (y - unitCenterY)**2) < clickRadius) { 
                     unitToDrag = unit; 
                     break; 
                 }
            }

            if (unitToDrag) {
                gameState.isDragging = true; 
                gameState.dragStartTime = Date.now();
                gameState.draggingUnit = unitToDrag;
                gameState.dragUnitOriginalPosition = unitToDrag.position; 
                gameState.dragUnitOriginalType = unitToDrag.positionType;
                gameState.dragUnitRenderX = x; 
                gameState.dragUnitRenderY = y;
                if (!gameState.selectedUnit || gameState.selectedUnit.id !== unitToDrag.id) {
                    gameState.selectedUnit = unitToDrag;
                    gameState.currentActionState = ACTION_STATES.UNIT_SELECTED;
                    console.log(`[Selection] Dragged Unit: ${gameState.selectedUnit.id}`);
                    updateSelectedUnitInfoPanel();
                }
                gameState.currentReachableMoves = getPossibleMoves(unitToDrag);
                canvas.style.cursor = 'grabbing'; 
            }
        }

        function handleInteractionMove(x, y) {
            if (gameState.mapMakerMode && gameState.isDragging) {
                applyMapMakerBrush(x, y);
                return;
            }
             if (gameState.isDragging && gameState.draggingUnit) {
                gameState.dragUnitRenderX = x; 
                gameState.dragUnitRenderY = y;
                gameState.draggedDistance = Math.sqrt((x - gameState.dragStartX)**2 + (y - gameState.dragStartY)**2);
                
                // --- FIX: Scale the hover detection radius ---
                const scaledHighlightRadius = HIGHLIGHT_CLICK_RADIUS * gameState.renderScale;
                
                let foundPathUnderCursor = null;
                for (const [targetEdgeKey, moveData] of gameState.currentReachableMoves) {
                     const finalTargetEdgeData = engine.state.edges.get(targetEdgeKey); if (!finalTargetEdgeData) continue;
                     const mid = getEdgeMidpoint(finalTargetEdgeData.q1, finalTargetEdgeData.r1, finalTargetEdgeData.q2, finalTargetEdgeData.r2);
                     if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < scaledHighlightRadius) { 
                        foundPathUnderCursor = moveData.path; 
                        break; 
                    }
                 }
                if (foundPathUnderCursor) {
                    const newPotentialPathKey = foundPathUnderCursor.join('-');
                    const currentPotentialPathKey = gameState.potentialDebugPathToDraw ? gameState.potentialDebugPathToDraw.join('-') : null;

                    if (newPotentialPathKey !== currentPotentialPathKey) {
                        gameState.potentialDebugPathToDraw = foundPathUnderCursor;
                        gameState.debugPathHoverStartTime = Date.now();
                        if (gameState.debugPathToDraw && gameState.debugPathToDraw.join('-') !== newPotentialPathKey) {
                            clearDebugPath(); 
                        }
                    }
                } else { 
                    if (gameState.potentialDebugPathToDraw) {
                       clearDebugPath(); 
                    }
                }
            }
        }

        function handleInteractionEnd(x, y, isTouchEvent = false) {
            if (gameState.mapMakerMode) {
                gameState.isDragging = false;
                gameState.mapMakerLastPaintedHexKey = null;
                gameState.needsRedraw = true;
                return;
            }
            if (!gameState.isDragging || !gameState.draggingUnit) return;
            
            dragOperationJustConcluded = true;
            let droppedOnValidTarget = false;
            
            if (gameState.draggedDistance >= DRAGGED_DISTANCE_THRESHOLD) {
                // --- FIX: Scale the drop radius ---
                const dropRadius = (isTouchEvent ? HIGHLIGHT_CLICK_RADIUS * 1.2 : HIGHLIGHT_CLICK_RADIUS) * gameState.renderScale;
                
                for (const [targetEdgeKey, moveData] of gameState.currentReachableMoves) {
                    const finalTargetEdgeData = engine.state.edges.get(targetEdgeKey); if (!finalTargetEdgeData) continue;
                    const mid = getEdgeMidpoint(finalTargetEdgeData.q1, finalTargetEdgeData.r1, finalTargetEdgeData.q2, finalTargetEdgeData.r2);
                    if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < dropRadius) {
                        const costToMove = moveData.cost; 
                        
                        let isTargetKnownEnemy = false;
                        if (finalTargetEdgeData.units.some(u => u.player !== gameState.draggingUnit.player)) {
                            if (engine.settings.fogOfWarEnabled && engine.state.gameMode !== 'arcade' && !gameState.mapMakerMode && gameState.visionCache) {
                                if (gameState.visionCache.edges.has(targetEdgeKey)) isTargetKnownEnemy = true;
                            } else {
                                isTargetKnownEnemy = true;
                            }
                        }
                        if (isTargetKnownEnemy) { showInstruction("Cannot move to enemy edge."); break; }
                        if (finalTargetEdgeData.units.filter(u => u.player === gameState.draggingUnit.player).length >= 2) { showInstruction("Target edge full."); break; }
                        
                        // Pass moveData.path
                        if (costToMove <= gameState.draggingUnit.currentMove && costToMove !== Infinity) { 
                            handleMoveAction(gameState.draggingUnit, targetEdgeKey, costToMove, moveData.path); 
                            droppedOnValidTarget = true; 
                        }
                        else { showInstruction(`Cannot move. Cost: ${costToMove.toFixed(1)}, Have: ${gameState.draggingUnit.currentMove.toFixed(1)}`); }
                        break;
                    }
                }
            }
            
            if (!droppedOnValidTarget) {
                 const unit = gameState.draggingUnit;
                if (unit) {
                    if (gameState.dragUnitOriginalType === 'edge' && gameState.dragUnitOriginalPosition) {
                         unit.position = gameState.dragUnitOriginalPosition; unit.positionType = 'edge';
                     }
                     if (gameState.draggedDistance >= DRAGGED_DISTANCE_THRESHOLD) showInstruction("Invalid drop. Unit returned.", 2000);
                     gameState.selectedUnit = unit;
                     gameState.currentActionState = ACTION_STATES.UNIT_SELECTED; 
                      if(unit && !unit.isFortified && unit.hp > 0 && !unit.hasPerformedMajorAction && unit.currentMove >=1) gameState.currentReachableMoves = getPossibleMoves(unit);
                      else gameState.currentReachableMoves.clear();
                }
            }
            
            gameState.isDragging = false; 
            gameState.dragStartTime = null;
            gameState.draggingUnit = null; 
            gameState.dragUnitOriginalPosition = null; 
            gameState.dragUnitOriginalType = null;
            clearDebugPath(); 
            canvas.style.cursor = gameState.hoveredUnitId ? 'pointer' : 'default'; 
            updateSelectedUnitInfoPanel(); 
        }

        function handleInteractionCancel() {
            dragOperationJustConcluded = true;
            clearDebugPath();
            if (gameState.isDragging && gameState.draggingUnit) {
                 const unit = gameState.draggingUnit;
                 if (gameState.dragUnitOriginalType === 'edge' && gameState.dragUnitOriginalPosition) {
                     unit.position = gameState.dragUnitOriginalPosition; unit.positionType = 'edge';
                 }
                gameState.isDragging = false; 
                gameState.dragStartTime = null;
                gameState.draggingUnit = null; 
                gameState.dragUnitOriginalPosition = null; 
                gameState.dragUnitOriginalType = null;
                showInstruction("Drag cancelled. Unit returned.", 2500);
                gameState.selectedUnit = unit; 
                gameState.currentActionState = ACTION_STATES.UNIT_SELECTED;
                if(unit && !unit.isFortified && unit.hp > 0 && !unit.hasPerformedMajorAction && unit.currentMove >=1) gameState.currentReachableMoves = getPossibleMoves(unit);
                else gameState.currentReachableMoves.clear();
                updateSelectedUnitInfoPanel();
            }
        }    

        function handleTapLogic(x, y) {
            if (gameState.mapMakerMode) return; 

            if (gameState.mustUnfortify) {
                // allow clicking an action target
                if (!handleActionTargetSelectionClick(x, y)) {
                    showInstruction("You MUST select an edge to retreat to!", 2000);
                }
                return; // Block all other canvas interactions
            }

            // --- DEBUG: Flag Selection ---
            if (gameSettings.debugModeEnabled) {
                let clickedFlagPlayer = null;
                const checkFlagClick = (player) => {
                    let flagX, flagY;
                    const baseData = engine.state.baseCampPositions[`player${player}`];
                    
                    if (engine.state.gridRadius === 4 && Array.isArray(baseData)) {
                        const pos = calculateBaseCentroid(baseData);
                        if (pos) { flagX = pos.x; flagY = pos.y; }
                    } else if (engine.state.gridRadius !== 4 && typeof baseData === 'string') {
                        const edge = engine.state.edges.get(baseData);
                        if (edge) {
                            const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                            flagX = mid.x; flagY = mid.y;
                        }
                    }

                    if (flagX !== undefined) {
                        const dist = Math.sqrt((x - flagX)**2 + (y - flagY)**2);
                        if (dist < (HEX_SIZE * gameState.renderScale * 0.5)) {
                            return true;
                        }
                    }
                    return false;
                };

                if (checkFlagClick(1)) clickedFlagPlayer = 1;
                else if (checkFlagClick(2)) clickedFlagPlayer = 2;

                if (clickedFlagPlayer) {
                    clearSelectionAndDebugState(); // Clear previous selection first
                    gameState.debugSelectedBasePlayer = clickedFlagPlayer;
                    showInstruction(`Debug: P${clickedFlagPlayer} Base Selected`, 1500);
                    // updateSelectedUnitInfoPanel is called in clearSelectionAndDebugState, 
                    // but we might want to refresh specific debug info here if we add a panel for it later.
                    return;
                }
            }
            // -----------------------------

            if (handleActionTargetSelectionClick(x, y)) { 
                // Click was handled by an action (e.g. Attack/Fortify confirmation)
                // Do not clear selection.
                return;
            } 
            
            if (handleUnitSelectionClick(x, y)) { 
                // A unit was selected or clicked.
                // handleUnitSelectionClick handles its own state setting,
                // but we ensure debug base selection is gone.
                gameState.debugSelectedBasePlayer = null; 
                return;
            }
            
            if (handleMoveClick(x, y)) { 
                // A move command was issued.
                return; 
            } 
            
            // If we reached here, the click was on empty space or invalid territory.
            if (gameState.selectedUnit || gameState.debugSelectedBasePlayer) {
                 clearSelectionAndDebugState();
            }
        }




        function handleMoveClick(x, y) {
    const { selectedUnit } = gameState;
    if (!selectedUnit || selectedUnit.isFortified || selectedUnit.currentMove < 1) {
        return false;
    }
    if (engine.state.gameMode === 'singleplayer' && selectedUnit.player !== engine.state.playerSide) {
        return false;
    }
    if (selectedUnit.hasPerformedMajorAction && !selectedUnit.type.canMoveAfterAttack) {
        return false;
    }
    
    // --- FIX: Scale the click radius ---
    const scaledClickRadius = HIGHLIGHT_CLICK_RADIUS * gameState.renderScale;

    for (const [targetEdgeKey, moveData] of gameState.currentReachableMoves) {
        const finalTargetEdgeData = engine.state.edges.get(targetEdgeKey); if (!finalTargetEdgeData) continue;
        const mid = getEdgeMidpoint(finalTargetEdgeData.q1, finalTargetEdgeData.r1, finalTargetEdgeData.q2, finalTargetEdgeData.r2);
        
        if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < scaledClickRadius) {
            const costToMove = moveData.cost;
            
            // Bypass enemy block if they are hidden in fog
            let isTargetKnownEnemy = false;
            if (finalTargetEdgeData.units.some(u => u.player !== selectedUnit.player)) {
                if (engine.settings.fogOfWarEnabled && engine.state.gameMode !== 'arcade' && !gameState.mapMakerMode && gameState.visionCache) {
                    if (gameState.visionCache.edges.has(targetEdgeKey)) isTargetKnownEnemy = true;
                } else {
                    isTargetKnownEnemy = true;
                }
            }
            if (isTargetKnownEnemy) { showInstruction("Cannot move to enemy edge."); return true; }
            if (finalTargetEdgeData.units.filter(u => u.player === selectedUnit.player).length >= 2) { showInstruction("Target edge full."); return true; }
            
            // Pass moveData.path to handleMoveAction for ambush resolution
            if (costToMove <= selectedUnit.currentMove && costToMove !== Infinity) handleMoveAction(selectedUnit, targetEdgeKey, costToMove, moveData.path);
            else showInstruction(`Cannot move. Cost: ${costToMove.toFixed(1)}, Have: ${selectedUnit.currentMove.toFixed(1)}`);
            return true;
        }
    }
     return false;
}

function handleActionTargetSelectionClick(x, y) {
    const { selectedUnit, currentActionState } = gameState;
    if (!selectedUnit) return false;

    let clickHandled = true;
    let clickedValidTarget = false;

    switch (currentActionState) {
        case ACTION_STATES.SELECTING_FORTIFY_TILE:
            const clickedAxial = pixelToAxial(x, y);
            const clickedTileKey = getTileKey(clickedAxial.q, clickedAxial.r);
            if (gameState.validFortifyTargetTileKeys.includes(clickedTileKey)) {
                completeFortify(selectedUnit, clickedTileKey);
                clickedValidTarget = true;
            }
            break;

            case ACTION_STATES.SELECTING_UNFORTIFY_EDGE:
            // --- FIX: Scale radius for unfortify selection ---
            const scaledUnfortifyRadius = HIGHLIGHT_CLICK_RADIUS * gameState.renderScale;
            
            for (const edgeKey of gameState.validUnfortifyTargetEdgeKeys) {
                const edge = engine.state.edges.get(edgeKey);
                if (edge) {
                    const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                    if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < scaledUnfortifyRadius) {
                        completeUnfortify(selectedUnit, edgeKey);
                        clickedValidTarget = true;
                        break;
                    }
                }
            }
            break;

        case ACTION_STATES.SELECTING_BRIDGE_EDGE:
            for (const edgeKey of gameState.validBridgeTargetEdgeKeys) {
                const edge = engine.state.edges.get(edgeKey);
                if (edge) {
                    const p = { x, y };
                    const p1_center = axialToPixel(edge.q1, edge.r1);
                    const p2_center = axialToPixel(edge.q2, edge.r2);

                    // --- Define the line segment endpoints for the edge ---
                    const edgeMidX = (p1_center.x + p2_center.x) / 2;
                    const edgeMidY = (p1_center.y + p2_center.y) / 2;
                    let perp_dx = -(p2_center.y - p1_center.y);
                    let perp_dy = p2_center.x - p1_center.x;
                    const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);

                    if (len_perp_vec > 0) {
                        const scale = (HEX_SIZE * gameState.renderScale) / 2;
                        perp_dx = (perp_dx / len_perp_vec) * scale;
                        perp_dy = (perp_dy / len_perp_vec) * scale;
                        const v = { x: edgeMidX + perp_dx, y: edgeMidY + perp_dy };
                        const w = { x: edgeMidX - perp_dx, y: edgeMidY - perp_dy };

                        // --- Check distance from click to the line segment ---
                        if (distToSegmentSquared(p, v, w) < (BRIDGE_CLICK_TOLERANCE * gameState.renderScale * 2)**2) {
                            completeBuildBridge(edgeKey);
                            clickedValidTarget = true;
                            break;
                        }
                    }
                }
            }
            break;
        
        case ACTION_STATES.SELECTING_ATTACK_TARGET:
            const currentAttackTargets = selectedUnit.type.attackType === 'melee' 
                ? gameState.validMeleeAttackTargets 
                : gameState.validArcherAttackTargets;
            const attackType = selectedUnit.type.attackType === 'melee' ? 'Melee' : 'Archer';

            for (const targetInfo of currentAttackTargets) {
                if (targetInfo.isBridgeTarget && targetInfo.edgeKey) {
                    const edge = engine.state.edges.get(targetInfo.edgeKey);
                    if (edge && edge.bridge) {
                        const p = { x, y };
                        const p1_center = axialToPixel(edge.q1, edge.r1); const p2_center = axialToPixel(edge.q2, edge.r2);
                        const edgeMidX = (p1_center.x + p2_center.x) / 2; const edgeMidY = (p1_center.y + p2_center.y) / 2;
                        let perp_dx = -(p2_center.y - p1_center.y); let perp_dy = p2_center.x - p1_center.x;
                        const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);

                        if (len_perp_vec > 0) {
                            const scale = (HEX_SIZE * gameState.renderScale) / 2;
                            perp_dx = (perp_dx / len_perp_vec) * scale;
                            perp_dy = (perp_dy / len_perp_vec) * scale;
                            const v = { x: edgeMidX + perp_dx, y: edgeMidY + perp_dy };
                            const w = { x: edgeMidX - perp_dx, y: edgeMidY - perp_dy };

                            if (distToSegmentSquared(p, v, w) < (BRIDGE_CLICK_TOLERANCE * gameState.renderScale * 2)**2) {
                                completeAttack(selectedUnit, targetInfo, attackType);
                                clickedValidTarget = true;
                                break;
                            }
                        }
                    }
                } else if (targetInfo.unit) {
                    const targetUnit = targetInfo.unit; let unitX_val, unitY_val, clickRadius = UNIT_CLICK_RADIUS * gameState.renderScale;
                    if (targetUnit.isFortified && targetUnit.positionType === 'center' && targetInfo.tileKeyForTarget) {
                        const tile = engine.state.tiles.get(targetInfo.tileKeyForTarget);
                        if (tile) { const centerPixel = axialToPixel(tile.q, tile.r); unitX_val = centerPixel.x; unitY_val = centerPixel.y; clickRadius = (FORTIFIED_UNIT_DRAW_SIZE * gameState.renderScale) * 1.5; }
                        else continue;
                    } else if (targetInfo.edgeKey) {
                        const edgeOfTarget = engine.state.edges.get(targetInfo.edgeKey); if (!edgeOfTarget) continue;
                        const mid = getEdgeMidpoint(edgeOfTarget.q1, edgeOfTarget.r1, edgeOfTarget.q2, edgeOfTarget.r2); unitX_val = mid.x; unitY_val = mid.y;
                        const edgeUnitsOnly = edgeOfTarget.units.filter(u => u.positionType === 'edge');
                        const unitIndexOnEdge = edgeUnitsOnly.findIndex(u => u.id === targetUnit.id);
                        if (edgeUnitsOnly.length > 1 && unitIndexOnEdge !== -1) {
                            const offsetSign = (unitIndexOnEdge % 2 === 0) ? -1 : 1;
                            const p1 = axialToPixel(edgeOfTarget.q1, edgeOfTarget.r1); const p2 = axialToPixel(edgeOfTarget.q2, edgeOfTarget.r2);
                            let dx_val = p2.x - p1.x, dy_val = p2.y - p1.y; const len = Math.sqrt(dx_val*dx_val + dy_val*dy_val) || 1;
                            let perpX = -dy_val / len, perpY = dx_val / len;
                            unitX_val += perpX * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5); unitY_val += perpY * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5);
                        }
                    } else continue;
                    if (Math.sqrt((x - unitX_val)**2 + (y - unitY_val)**2) < clickRadius) { 
                        completeAttack(selectedUnit, targetInfo, attackType); 
                        clickedValidTarget = true; 
                        break; 
                    }
                }
            }
            if (clickedValidTarget) break; 
            break; 

        default:
            clickHandled = false;
            break;
    }

    if (clickHandled && !clickedValidTarget) {
        showInstruction("Invalid selection. Click a highlighted target or Cancel.", 2000);
    }
    return clickHandled;
}

function handleUnitSelectionClick(x, y) {
            let clickedOnUnit = null;
            
            for (const unit of engine.state.units) {
                if (unit.isFortified && unit.positionType === 'center') {
                    const tile = engine.state.tiles.get(unit.position);
                    if (tile) {
                        const {x: tileCenterX, y: tileCenterY} = axialToPixel(tile.q, tile.r);
                        if (Math.sqrt((x - tileCenterX)**2 + (y - tileCenterY)**2) < (FORTIFIED_UNIT_DRAW_SIZE * gameState.renderScale) * 1.5) {
                            if (unit.player === engine.state.currentPlayer) {
                                if (engine.state.gameMode === 'singleplayer' && unit.player !== engine.state.playerSide) {
                                    showInstruction(`That is an AI unit.`);
                                    return true;
                                }
                                clickedOnUnit = unit;
                                break;
                            } else { 
                                // --- FOG CHECK ---
                                if (engine.settings.fogOfWarEnabled && engine.state.gameMode !== 'arcade' && !gameState.mapMakerMode && gameState.visionCache) {
                                    if (!gameState.visionCache.tiles.has(unit.position)) continue; // Treat as empty space
                                }
                                showInstruction(`Enemy ${unit.type.name} fortified.`); 
                                return true; 
                            }
                        }
                    }
                }
            }
            
            if (!clickedOnUnit) {
                 const unitEdgePairs = [];
                 engine.state.edges.forEach((edge, edgeKey) => { edge.units.forEach(u => { if (u.positionType === 'edge') unitEdgePairs.push({ unit: u, edge: edge }); }); });
                
                for (let i = unitEdgePairs.length - 1; i >= 0; i--) {
                    const {unit, edge} = unitEdgePairs[i]; 
                    const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                    let unitX = mid.x, unitY = mid.y;
                    
                    const edgeUnitsOnly = edge.units.filter(u => u.positionType === 'edge');
                    const unitIndexOnEdge = edgeUnitsOnly.findIndex(u => u.id === unit.id);
                    if (edgeUnitsOnly.length > 1 && unitIndexOnEdge !== -1) {
                        const offsetSign = (unitIndexOnEdge % 2 === 0) ? -1 : 1;
                        const p1 = axialToPixel(edge.q1, edge.r1); 
                        const p2 = axialToPixel(edge.q2, edge.r2);
                        let dx_val = p2.x - p1.x, dy_val = p2.y - p1.y; 
                        const len = Math.sqrt(dx_val*dx_val + dy_val*dy_val) || 1;
                        let perpX = -dy_val / len, perpY = dx_val / len;
                        unitX += perpX * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5); 
                        unitY += perpY * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5);
                    }
                    
                    if (Math.sqrt((x - unitX)**2 + (y - unitY)**2) < (UNIT_CLICK_RADIUS * gameState.renderScale)) {
                       if (unit.player === engine.state.currentPlayer) {
                            if (engine.state.gameMode === 'singleplayer' && unit.player !== engine.state.playerSide) {
                                showInstruction(`That is an AI unit.`);
                                return true;
                            }
                            clickedOnUnit = unit;
                            break;
                        } else { 
                            // --- FOG CHECK ---
                            if (engine.settings.fogOfWarEnabled && engine.state.gameMode !== 'arcade' && !gameState.mapMakerMode && gameState.visionCache) {
                                if (!gameState.visionCache.edges.has(unit.position)) continue; // Treat as empty space
                            }
                            showInstruction(`Enemy ${unit.type.name} on edge.`); 
                            return true; 
                        }
                    }
                }
            }

            if (clickedOnUnit) {
                if (gameState.selectedUnit && gameState.selectedUnit.id === clickedOnUnit.id) {
                    gameState.selectedUnit = null; 
                    gameState.currentReachableMoves.clear();
                    resetActionSelectionStates(); 
                } else {
                    gameState.selectedUnit = clickedOnUnit;
                    console.log(`[Selection] Unit Selected: ${gameState.selectedUnit.id}`);
                    resetActionSelectionStates();
                    const unit = gameState.selectedUnit;
                    const canPhysicallyMove = !unit.isFortified && unit.positionType === 'edge' && unit.currentMove >= 1 && !unit.spearWalled;
                    const isAllowedToMove = !unit.hasPerformedMajorAction || unit.type.canMoveAfterAttack;
                    if (canPhysicallyMove && isAllowedToMove) {
                        gameState.currentReachableMoves = getPossibleMoves(unit);
                    } else {
                        gameState.currentReachableMoves.clear();
                    }
                }
                updateSelectedUnitInfoPanel(); 
                return true;
            }
            return false;
        }
    
        function handleFortifyActionLogic() {
            const { selectedUnit } = gameState;
            if (!selectedUnit || selectedUnit.hasPerformedMajorAction || selectedUnit.isFortified || selectedUnit.positionType !== 'edge') { 
                showInstruction("Cannot fortify.", 2000); 
                return; 
            }
            
            const edgeCoords = parseEdgeKey(selectedUnit.position);
            if (!edgeCoords || edgeCoords.length !== 2 || isNaN(edgeCoords[0].q)) { 
                showInstruction("Unit not on valid edge.", 2000); 
                return; 
            }

            const enemyPlayer = selectedUnit.player === 1 ? 2 : 1;
            const enemyBaseData = engine.state.baseCampPositions[`player${enemyPlayer}`];
            const enemyBaseTileKeys = new Set();
            
            if (Array.isArray(enemyBaseData)) {
                enemyBaseData.forEach(k => enemyBaseTileKeys.add(k));
            } else if (typeof enemyBaseData === 'string') {
                const [h1, h2] = parseEdgeKey(enemyBaseData);
                if (!isNaN(h1.q)) enemyBaseTileKeys.add(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) enemyBaseTileKeys.add(getTileKey(h2.q, h2.r));
            }

            const myFlagTileKey = getFlagTileKey(selectedUnit.player);
            const enemyFlagTileKey = getFlagTileKey(enemyPlayer);

            const tile1Key = getTileKey(edgeCoords[0].q, edgeCoords[0].r); 
            const tile2Key = getTileKey(edgeCoords[1].q, edgeCoords[1].r);
            const tile1 = engine.state.tiles.get(tile1Key); 
            const tile2 = engine.state.tiles.get(tile2Key);
            
            gameState.validFortifyTargetTileKeys = [];

            if (tile1 && canUnitFortifyOnTile(selectedUnit, tile1) && tile1.fortifiedByPlayer === null && (tile1Key !== myFlagTileKey || selectedUnit.isCarryingFlag) && (!enemyBaseTileKeys.has(tile1Key) || tile1Key === enemyFlagTileKey)) {
                gameState.validFortifyTargetTileKeys.push(tile1Key);
            }
            if (tile2 && canUnitFortifyOnTile(selectedUnit, tile2) && tile2.fortifiedByPlayer === null && (tile2Key !== myFlagTileKey || selectedUnit.isCarryingFlag) && (!enemyBaseTileKeys.has(tile2Key) || tile2Key === enemyFlagTileKey)) {
                gameState.validFortifyTargetTileKeys.push(tile2Key);
            }

            if (gameState.validFortifyTargetTileKeys.length === 0) { 
                showInstruction("No valid adjacent tile to fortify.", 2000); 
                return; 
            }
            
            if (gameState.validFortifyTargetTileKeys.length === 1) {
                completeFortify(selectedUnit, gameState.validFortifyTargetTileKeys[0]);
            } else { 
                gameState.currentActionState = ACTION_STATES.SELECTING_FORTIFY_TILE;
                showInstruction("Select tile to fortify.", 3000); 
            }
            updateSelectedUnitInfoPanel();
        }
        
        function handleUnfortifyActionLogic() {
            const { selectedUnit } = gameState;
            if (!selectedUnit || !selectedUnit.isFortified || selectedUnit.hasPerformedMajorAction) { showInstruction("Cannot unfortify.", 2000); return; }
            gameState.validUnfortifyTargetEdgeKeys = getPotentialUnfortifyTargets(selectedUnit);
            if (gameState.validUnfortifyTargetEdgeKeys.length === 0) { showInstruction("No valid edge to unfortify to.", 2500); return; }
            
            gameState.currentActionState = ACTION_STATES.SELECTING_UNFORTIFY_EDGE;
            showInstruction("Select edge to move to.", 3000); 
            updateSelectedUnitInfoPanel();
        }

        function handleFortifyUnfortifyButtonClick() {
            if (engine.state.gameMode === 'singleplayer' && gameState.selectedUnit && gameState.selectedUnit.player !== engine.state.playerSide) return;
            if (gameState.isDragging) return; 
            const { selectedUnit } = gameState; 
            if (!selectedUnit) return;

            if (gameState.currentActionState === ACTION_STATES.SELECTING_FORTIFY_TILE || gameState.currentActionState === ACTION_STATES.SELECTING_UNFORTIFY_EDGE) {
                const message = gameState.currentActionState === ACTION_STATES.SELECTING_FORTIFY_TILE ? "Fortify cancelled." : "Unfortify cancelled.";
                resetActionSelectionStates();
                showInstruction(message, 1500);
            } else if (selectedUnit.isFortified) {
                handleUnfortifyActionLogic();
            } else {
                handleFortifyActionLogic();
            }
            updateSelectedUnitInfoPanel();
        }

        function handleBuildBridgeAction() {
            if (engine.state.gameMode === 'singleplayer' && gameState.selectedUnit && gameState.selectedUnit.player !== engine.state.playerSide) return;
            if (gameState.isDragging) return; 
            const { selectedUnit } = gameState;

            if (gameState.currentActionState === ACTION_STATES.SELECTING_BRIDGE_EDGE) {
                resetActionSelectionStates();
                showInstruction("Bridge selection cancelled.", 1500);
                updateSelectedUnitInfoPanel(); 
                return;
            }
            if (!selectedUnit || !selectedUnit.type.canBuildBridge || selectedUnit.isFortified || selectedUnit.hasPerformedMajorAction) {
                showInstruction(selectedUnit && selectedUnit.hasPerformedMajorAction ? "Unit acted." : "Cannot build bridge.", 2000); 
                return;
            }
            gameState.validBridgeTargetEdgeKeys = getPotentialBridgeTargets(selectedUnit);
            if (gameState.validBridgeTargetEdgeKeys.length === 0) {
                showInstruction("No valid water edge for bridge.", 2000);
            } else { 
                gameState.currentActionState = ACTION_STATES.SELECTING_BRIDGE_EDGE;
                showInstruction("Select water edge for bridge.", 3000); 
            }
            updateSelectedUnitInfoPanel();
        }

        function handleAttackAction() {
            if (engine.state.gameMode === 'singleplayer' && gameState.selectedUnit && gameState.selectedUnit.player !== engine.state.playerSide) return;
            if (gameState.isDragging) return; 
            const { selectedUnit } = gameState;
            
            if (gameState.currentActionState === ACTION_STATES.SELECTING_ATTACK_TARGET) {
                 resetActionSelectionStates(); 
                 showInstruction("Attack cancelled.", 1500); 
                 updateSelectedUnitInfoPanel(); 
                 return;
            }

             if (!selectedUnit || selectedUnit.currentMove < ATTACK_COST || selectedUnit.hasPerformedMajorAction) {
                showInstruction(selectedUnit && selectedUnit.hasPerformedMajorAction ? "Unit acted." : "Cannot attack.", 2500); return;
            }

            gameState.debugAttackRangeHighlights = []; 

            if (selectedUnit.type.attackType === 'melee') {
                gameState.validMeleeAttackTargets = getValidMeleeAttackTargets(selectedUnit);
                gameState.debugAttackRangeHighlights = gameState.validMeleeAttackTargets
                    .filter(t => t.edgeKey && !t.isBridgeTarget)
                    .map(t => t.edgeKey);

                if (gameState.validMeleeAttackTargets.length === 0) {
                    showInstruction("No valid melee targets.", 2000);
                } else {
                    gameState.currentActionState = ACTION_STATES.SELECTING_ATTACK_TARGET;
                    showInstruction("Select target to attack.", 3000);
                }
            } else if (selectedUnit.type.attackType === 'ranged') {
                gameState.validArcherAttackTargets = getValidArcherAttackTargets(selectedUnit);
                gameState.debugAttackRangeHighlights = gameState.validArcherAttackTargets
                    .filter(t => t.edgeKey && !t.isBridgeTarget)
                    .map(t => t.edgeKey);

                if (gameState.validArcherAttackTargets.length === 0) {
                    showInstruction("No valid archer targets.", 2000);
                } else {
                    gameState.currentActionState = ACTION_STATES.SELECTING_ATTACK_TARGET;
                    showInstruction("Select target to attack.", 3000);
                }
            }
            updateSelectedUnitInfoPanel();
        }

