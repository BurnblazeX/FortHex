function getUnitAIAction(unit, strategy, allEnemies, allAllies) {
    if (unit.hasPerformedMajorAction) return null;

    let possibleActions = [];

    // --- SUB-FUNCTION to score a potential attack ---
    const scoreAttack = (targetInfo) => {
        let score = 50.0;
        if(targetInfo.unit){
            if(targetInfo.unit.isCarryingFlag) score += 200;
            
            // UPDATE: Use mutable stats for damage calculation
            let predictedDmg = unit.stats.damage;
            
            // Archer Fortification Bonus
            if (unit.isFortified && unit.type.name === 'Archer') {
                predictedDmg += 1;
            }
            
            // Advantage/Disadvantage
            if(unit.type.strengths.includes(targetInfo.unit.type.name)) predictedDmg += 1;
            if(unit.type.weaknesses.includes(targetInfo.unit.type.name)) predictedDmg -= 1;

            // UPDATE: Account for Target Defense
            let targetDefense = targetInfo.unit.stats.defense;
            
            // Fortification Check
            if (targetInfo.unit.isFortified) {
                // Check Combined Arms (Simple check for AI)
                const hasPartner = allAllies.some(u => 
                    u.position === unit.position && 
                    u.id !== unit.id && 
                    u.type.attackType !== unit.type.attackType
                );
                
                if (hasPartner) {
                    // Ignore positive defense
                    if (targetDefense < 0) predictedDmg -= targetDefense; 
                } else {
                    // Apply defense
                    predictedDmg -= targetDefense;
                }
            } else {
                // Not Fortified: Only apply vulnerability
                if (targetDefense < 0) predictedDmg -= targetDefense;
            }

            // Min Damage Cap
            predictedDmg = Math.max(1, predictedDmg);

            // Kill Priority
            if(targetInfo.unit.hp <= predictedDmg) score += 100;
            
            // Damage Value
            score += predictedDmg * 10;

        } else { 
            // Bridge Attack
            score = 5; 
        } 
        return score;
    };

    // --- SUB-FUNCTION to score a potential move ---
    const scoreMove = (edgeKey) => {
        let moveScore = 5.0; // Base incentive to not just stand still
        const unitPos = getUnitScreenPosition(unit);
        if (!unitPos) return 0;
        
        const moveMidPoint = getEdgeMidpoint(...parseEdgeKey(edgeKey).flatMap(c=>[c.q,c.r]));
        
        // Role-based scoring for the move itself
        if (unit.type.name === 'Pikeman' && strategy === 'IRON_WALL') {
            const centerDist = axialDistance(...edgeKey.split('_')[0].split(',').map(Number), 0, 0);
            moveScore += (4 - centerDist) * 5; // Move to the center to form the wall
        } else if (unit.type.name === 'Horseman' && strategy === 'BLITZ') {
            const flankTarget = allEnemies.find(e => e.type.name === 'Archer' || e.type.name === 'Melee');
            if(flankTarget) {
                const targetPos = getUnitScreenPosition(flankTarget);
                const currentDist = pointDistance(unitPos, targetPos);
                const afterDist = pointDistance(moveMidPoint, targetPos);
                if(afterDist < currentDist) moveScore += (1 - (afterDist / currentDist)) * 40;
            }
        } else { // Generic advance for others
             const closestEnemy = allEnemies[0];
             if(closestEnemy){
                const targetPos = getUnitScreenPosition(closestEnemy);
                const currentDist = pointDistance(unitPos, targetPos);
                const afterDist = pointDistance(moveMidPoint, targetPos);
                if(afterDist < currentDist) moveScore += (1 - (afterDist / currentDist)) * 20;
             }
        }
        return moveScore;
    };


    // === ACTION GENERATION ===

    // 1. Actions from CURRENT POSITION (no move)
    if (!unit.isFortified) {
        // ATTACK_ONLY
        const attackTargets = getValidMeleeAttackTargets(unit).concat(getValidArcherAttackTargets(unit));
        attackTargets.forEach(targetInfo => {
            possibleActions.push({ type: 'ATTACK_ONLY', unit, targetInfo, score: scoreAttack(targetInfo) });
        });
        // FORTIFY_ONLY
        if (unit.stats.defense > 0) {
             const edgeCoords = parseEdgeKey(unit.position);
             if (edgeCoords.length === 2 && !isNaN(edgeCoords[0].q)) {
                [getTileKey(edgeCoords[0].q, edgeCoords[0].r), getTileKey(edgeCoords[1].q, edgeCoords[1].r)].forEach(tileKey => {
                    const tile = gameState.tiles.get(tileKey);
                    // Check logic for fortification
                    // TODO: Check enemy base tiles if necessary (omitted for brevity in AI)
                    if(tile && tile.type.canFortify && tile.fortifiedByPlayer === null) {
                         let score = 5 - unit.fortifyCooldown;
                         if(strategy === 'IRON_WALL' && unit.type.name === 'Pikeman') score += 25;
                         if(unit.hp < unit.maxHp) score+=20;
                         if(axialDistance(...tileKey.split(',').map(Number),0,0) > 1) score-= 15;
                         if(score > 0) possibleActions.push({ type: 'FORTIFY_ONLY', unit, targetTileKey: tileKey, score });
                    }
                });
             }
        }
    } else { // Unit is fortified
        // UNFORTIFY_ONLY
        const unfortifyTargets = getPotentialUnfortifyTargets(unit);
        if (unfortifyTargets.length > 0) {
            let score = (unit.hp >= unit.maxHp && unit.turnsFortified > 2) ? (unit.turnsFortified * 5) : 0;
            if(score > 0) possibleActions.push({ type: 'UNFORTIFY_ONLY', unit, targetEdgeKey: unfortifyTargets[0], score });
        }
    }

    // 2. Actions AFTER MOVING
    const possibleMoves = getPossibleMoves(unit);
    possibleMoves.forEach((moveData, edgeKey) => {
        const moveScore = scoreMove(edgeKey);
        
        // Ghost Unit for calculation: Update position AND Move Points
        const ghostUnit = { 
            ...unit, 
            position: edgeKey, 
            currentMove: unit.currentMove - moveData.cost,
            positionType: 'edge' // Assume moving to edge
        };

        // MOVE_AND_ATTACK (for Horseman)
        if (unit.type.canMoveAfterAttack && ghostUnit.currentMove >= ATTACK_COST) {
            const attackTargets = getValidMeleeAttackTargets(ghostUnit);
            if (attackTargets.length > 0) {
                const bestTarget = attackTargets.sort((a,b) => scoreAttack(b) - scoreAttack(a))[0];
                const combinedScore = moveScore + scoreAttack(bestTarget);
                possibleActions.push({ type: 'MOVE_AND_ATTACK', unit, moveData, targetInfo: bestTarget, score: combinedScore });
            }
        }
        
        // MOVE_ONLY is always an option
        possibleActions.push({ type: 'MOVE_ONLY', unit, moveData, score: moveScore });
    });
    
    if (possibleActions.length === 0) return null;
    
    // Return the single best action for this unit
    possibleActions.sort((a, b) => b.score - a.score);
    return possibleActions[0];
}

// AI Executor: Takes a chosen action and performs it with animations.
async function executeAIAction(action) {
    if (!action) return;
    console.log(`AI Executing: ${action.type} for ${action.unit.type.name}`, `Score: ${action.score.toFixed(2)}`);
    gameState.selectedUnit = action.unit;
    updateSelectedUnitInfoPanel();
    await delay(400);

    const animateAndMove = async (unit, moveData) => {
        gameState.potentialDebugPathToDraw = moveData.path;
        gameState.debugPathHoverStartTime = Date.now() - PATH_DRAW_HOVER_DELAY_MS;
        await delay(PATH_DRAW_ANIMATION_DURATION_MS + 200);
        handleMoveAction(unit, moveData.path[moveData.path.length - 1], moveData.cost);
    };

    switch (action.type) {
        case 'MOVE_ONLY':
            await animateAndMove(action.unit, action.moveData);
            break;
        case 'ATTACK_ONLY':
            completeAttack(action.unit, action.targetInfo, action.unit.type.attackType === 'melee' ? 'Melee' : 'Archer');
            await delay(800);
            break;
        case 'FORTIFY_ONLY':
            completeFortify(action.unit, action.targetTileKey);
            await delay(600);
            break;
        case 'UNFORTIFY_ONLY':
            completeUnfortify(action.unit, action.targetEdgeKey);
            await delay(700);
            break;
        case 'MOVE_AND_ATTACK':
            await animateAndMove(action.unit, action.moveData);
            await delay(400);
            completeAttack(action.unit, action.targetInfo, action.unit.type.attackType === 'melee' ? 'Melee' : 'Archer');
            await delay(800);
            break;
    }

    gameState.selectedUnit = null;
    updateSelectedUnitInfoPanel();
    await delay(400);
}


// AI Turn Manager: The main loop that commands the AI turn.
async function executeAITurn() {
    if (gameState.gameOver) return;
    console.log(`--- AI Turn ${gameState.globalTurnNumber} (Player ${gameState.currentPlayer}) ---`);

    const aiStrategy = 'IRON_WALL'; // Will be dynamic later
    const allEnemies = gameState.units.filter(u => u.player !== gameState.currentPlayer);
    const allAllies = gameState.units.filter(u => u.player === gameState.currentPlayer);
    
    let unitsToProcess = allAllies.filter(u => !u.hasPerformedMajorAction);

    while (unitsToProcess.length > 0) {
        let bestActionOverall = null;

        for (const unit of unitsToProcess) {
            const bestActionForThisUnit = getUnitAIAction(unit, aiStrategy, allEnemies, allAllies);
            if (bestActionForThisUnit) {
                if (!bestActionOverall || bestActionForThisUnit.score > bestActionOverall.score) {
                    bestActionOverall = bestActionForThisUnit;
                }
            }
        }
        
        if (!bestActionOverall) {
            console.log("AI has no more possible actions.");
            break;
        }

        const actingUnit = bestActionOverall.unit;
        await executeAIAction(bestActionOverall);
        
        // This is the correct way to handle the action attempt.
        actingUnit.hasPerformedMajorAction = true;
        unitsToProcess = unitsToProcess.filter(u => u.id !== actingUnit.id);
    }

    console.log("AI turn finished.");
    if (!gameState.gameOver) {
        ui.endTurnButton.disabled = false;
        ui.endTurnButton.click();
    }
}
