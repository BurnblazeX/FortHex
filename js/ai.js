// --- AI Helper: Get Center Pixel of a Base ---
function getBaseCenter(baseData) {
    if (!baseData) return null;
    if (Array.isArray(baseData)) {
        return calculateBaseCentroid(baseData);
    } else if (typeof baseData === 'string') {
        const edge = gameState.edges.get(baseData);
        if (edge) return getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
    }
    return null;
}

// --- AI Reinforcements System ---
async function handleAIReinforcements() {
    const player = gameState.currentPlayer;
    const queueKey = `player${player}`;
    let queue = gameState.respawnQueue[queueKey];
    
    while (queue && queue.length > 0 && queue[0].turnsRemaining <= 0) {
        console.log(`[AI] Processing Reinforcements for Player ${player}...`);
        const armySize = gameState.units.filter(u => u.player === player).length;
        const maxUnits = getMaxUnitsForCurrentMap();
        let actionTaken = false;

        const promotableUnits = gameState.units.filter(u => u.player === player && u.level < 3);
        
        // AI Logic: Promote if army is full, or 30% chance to promote anyway if units are available
        const shouldPromote = (armySize >= maxUnits) || (promotableUnits.length > 0 && Math.random() < 0.3);

        if (shouldPromote && promotableUnits.length > 0) {
            // Pick a random eligible unit
            const targetUnit = promotableUnits[Math.floor(Math.random() * promotableUnits.length)];
            
            // Smart stat selection based on class
            let statPool = ['health', 'defense', 'damage', 'speed'];
            if (targetUnit.type.name === 'Archer') statPool = ['damage', 'speed'];
            if (targetUnit.type.name === 'Pikeman') statPool = ['health', 'defense'];
            if (targetUnit.type.name === 'Horseman') statPool = ['speed', 'damage'];
            
            const statToUpgrade = statPool[Math.floor(Math.random() * statPool.length)];
            
            console.log(`[AI] Promoted ${targetUnit.type.name} (+${statToUpgrade})`);
            applyUnitUpgrade(targetUnit, statToUpgrade);
            consumeRespawnCharge(player);
            actionTaken = true;
            await delay(800);

        } else if (armySize < maxUnits) {
            // Recruit missing units (Prioritize Melee > Archer > Pikeman > Horseman)
            const counts = gameState.unitCounts[queueKey];
            const preferredOrder = ['MELEE', 'ARCHER', 'PIKEMAN', 'HORSEMAN'];
            
            for (const typeKey of preferredOrder) {
                const unitName = UNIT_TYPES[typeKey].name;
                if (counts[unitName] < UNIT_CAPS[unitName]) {
                    const success = spawnUnit(player, UNIT_TYPES[typeKey]);
                    if (success) {
                        consumeRespawnCharge(player);
                        actionTaken = true;
                        await delay(800);
                        break;
                    }
                }
            }
        }

        if (!actionTaken) {
            console.log("[AI] Base blocked or unable to use reinforcement charge. Holding.");
            break; // Prevents infinite loop if base is blocked and all units are level 3
        }

        queue = gameState.respawnQueue[queueKey]; // Refresh queue for next while loop check
    }
}

function getUnitAIAction(unit, strategy, allEnemies, allAllies) {
    if (unit.hasPerformedMajorAction) return null;

    let possibleActions = [];

    const enemyPlayer = unit.player === 1 ? 2 : 1;
    const enemyBasePos = getBaseCenter(gameState.baseCampPositions[`player${enemyPlayer}`]);
    const myBasePos = getBaseCenter(gameState.baseCampPositions[`player${unit.player}`]);

    // --- SUB-FUNCTION to score a potential attack ---
    const scoreAttack = (targetInfo) => {
        let score = 50.0;
        if(targetInfo.unit){
            if(targetInfo.unit.isCarryingFlag) score += 300; // MUST kill flag carrier!
            
            let predictedDmg = unit.stats.damage;
            
            if (unit.isFortified && unit.type.name === 'Archer') predictedDmg += 1;
            if (unit.type.strengths.includes(targetInfo.unit.type.name)) predictedDmg += 1;
            if (unit.type.weaknesses.includes(targetInfo.unit.type.name)) predictedDmg -= 1;

            let targetDefense = targetInfo.unit.stats.defense;
            
            if (targetInfo.unit.isFortified) {
                const hasPartner = allAllies.some(u => 
                    u.position === unit.position && 
                    u.id !== unit.id && 
                    u.type.attackType !== unit.type.attackType
                );
                if (hasPartner) {
                    if (targetDefense < 0) predictedDmg -= targetDefense; 
                } else {
                    predictedDmg -= targetDefense;
                }
            } else {
                if (targetDefense < 0) predictedDmg -= targetDefense;
            }

            predictedDmg = Math.max(1, predictedDmg);
            if(targetInfo.unit.hp <= predictedDmg) score += 100; // High priority on securing kills
            score += predictedDmg * 10;
        } else { 
            score = 15; // Bridge Attack
        } 
        return score;
    };

    // --- SUB-FUNCTION to score a potential move ---
    const scoreMove = (edgeKey) => {
        let moveScore = 5.0; 
        const unitPos = getUnitScreenPosition(unit);
        if (!unitPos) return 0;
        
        const moveMidPoint = getEdgeMidpoint(...parseEdgeKey(edgeKey).flatMap(c=>[c.q,c.r]));
        
        // Find true closest enemy
        let minDist = Infinity;
        let actualClosest = null;
        allEnemies.forEach(e => {
            const ep = getUnitScreenPosition(e);
            if (ep) {
                const d = pointDistance(unitPos, ep);
                if (d < minDist) { minDist = d; actualClosest = e; }
            }
        });

        if (unit.isCarryingFlag && myBasePos) {
            // RUN HOME! Ignore everything else.
            const currentDist = pointDistance(unitPos, myBasePos);
            const afterDist = pointDistance(moveMidPoint, myBasePos);
            if (afterDist < currentDist) moveScore += (1 - (afterDist / currentDist)) * 300;
        } else if (unit.type.name === 'Pikeman' && myBasePos) {
            // DEFEND BASE
            const currentDist = pointDistance(unitPos, myBasePos);
            const afterDist = pointDistance(moveMidPoint, myBasePos);
            
            const defenseRadius = HEX_SIZE * 2.5 * gameState.renderScale;
            if (currentDist > defenseRadius) {
                 if (afterDist < currentDist) moveScore += 60; // Walk back home
            } else if (actualClosest) {
                 const ep = getUnitScreenPosition(actualClosest);
                 if (ep) {
                     const aDist = pointDistance(moveMidPoint, ep);
                     if (aDist < minDist) moveScore += 30; // Intercept intruders
                 }
            }
        } else {
            // ATTACK / CAPTURE
            if (enemyBasePos) {
                const currentDistBase = pointDistance(unitPos, enemyBasePos);
                const afterDistBase = pointDistance(moveMidPoint, enemyBasePos);
                if (afterDistBase < currentDistBase) moveScore += (1 - (afterDistBase / currentDistBase)) * 40;
            }
            
            // Chase nearby enemies
            if (actualClosest) {
                const ep = getUnitScreenPosition(actualClosest);
                const aDist = pointDistance(moveMidPoint, ep);
                if (aDist < minDist) moveScore += (1 - (aDist / minDist)) * 20;
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
        if (unit.stats.defense > 0 && !unit.isCarryingFlag) {
             const edgeCoords = parseEdgeKey(unit.position);
             if (edgeCoords.length === 2 && !isNaN(edgeCoords[0].q)) {
                // Ensure we don't fortify on our own flag tile
                let myFlagTileKey = null;
                const baseData = gameState.baseCampPositions[`player${unit.player}`];
                if (Array.isArray(baseData) && baseData.length === 3) {
                    const tiles = baseData.map(k => ({ q: Number(k.split(',')[0]), r: Number(k.split(',')[1]), key: k }));
                    const [t1, t2, t3] = tiles;
                    if (axialDistance(t1.q, t1.r, t2.q, t2.r) === 1 && axialDistance(t3.q, t3.r, t1.q, t1.r) === 1) myFlagTileKey = tiles[0].key;
                    else if (axialDistance(t1.q, t1.r, t2.q, t2.r) === 1 && axialDistance(t2.q, t2.r, t3.q, t3.r) === 1) myFlagTileKey = tiles[1].key;
                    else myFlagTileKey = tiles[2].key;
                }

                [getTileKey(edgeCoords[0].q, edgeCoords[0].r), getTileKey(edgeCoords[1].q, edgeCoords[1].r)].forEach(tileKey => {
                    const tile = gameState.tiles.get(tileKey);
                    if(tile && tile.type.canFortify && tile.fortifiedByPlayer === null && tileKey !== myFlagTileKey) {
                         let score = 5 - unit.fortifyCooldown;
                         if(unit.type.name === 'Pikeman') score += 25; // Pikemen love fortifying
                         if(unit.hp < unit.maxHp) score+=20; // Heal up
                         if(score > 0) possibleActions.push({ type: 'FORTIFY_ONLY', unit, targetTileKey: tileKey, score });
                    }
                });
             }
        }
    } else { 
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
        
        const ghostUnit = { 
            ...unit, 
            position: edgeKey, 
            currentMove: unit.currentMove - moveData.cost,
            positionType: 'edge' 
        };

        // MOVE_AND_ATTACK (Horseman hit & run)
        if (unit.type.canMoveAfterAttack && ghostUnit.currentMove >= ATTACK_COST && !unit.isCarryingFlag) {
            const attackTargets = getValidMeleeAttackTargets(ghostUnit);
            if (attackTargets.length > 0) {
                const bestTarget = attackTargets.sort((a,b) => scoreAttack(b) - scoreAttack(a))[0];
                const combinedScore = moveScore + scoreAttack(bestTarget);
                possibleActions.push({ type: 'MOVE_AND_ATTACK', unit, moveData, targetInfo: bestTarget, score: combinedScore });
            }
        }
        
        possibleActions.push({ type: 'MOVE_ONLY', unit, moveData, score: moveScore });
    });
    
    if (possibleActions.length === 0) return null;
    
    possibleActions.sort((a, b) => b.score - a.score);
    return possibleActions[0];
}

async function executeAIAction(action) {
    if (!action) return;
    console.log(`[AI] Executing: ${action.type} for ${action.unit.type.name}`, `Score: ${action.score.toFixed(2)}`);
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


async function executeAITurn() {
    if (gameState.gameOver) return;
    console.log(`--- AI Turn ${gameState.globalTurnNumber} (Player ${gameState.currentPlayer}) ---`);

    // 1. Process Reinforcements / Promotions
    await handleAIReinforcements();

    // 2. Execute Unit Actions
    const aiStrategy = 'STANDARD';
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
            console.log("[AI] No more possible actions.");
            break;
        }

        const actingUnit = bestActionOverall.unit;
        await executeAIAction(bestActionOverall);
        
        actingUnit.hasPerformedMajorAction = true;
        unitsToProcess = unitsToProcess.filter(u => u.id !== actingUnit.id);
    }

    console.log("--- AI Turn Finished ---");
    if (!gameState.gameOver) {
        ui.endTurnButton.disabled = false;
        ui.endTurnButton.click();
    }
}