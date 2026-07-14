// --- AI Memory System ---
const DEFAULT_AI_BRAIN = {
    version: 5, 
    matchesPlayed: 0,
    wins: 0,
    weights: {
        "atk_flag_carrier": 795.9893115433262,
        "atk_secure_kill": 392.01291384586483,
        "atk_damage_multiplier": 26.006937637450577,
        "atk_bridge": 60,
        "move_base_score": 5,
        "move_run_home_flag": 300,
        "move_pikeman_defend": 159.1978623086652,
        "move_pikeman_intercept": 79.5989311543326,
        "move_toward_base": 38.046795010126644,
        "move_chase_enemy": 20,
        "fortify_base_score": 5,
        "fortify_pikeman_bonus": 25,
        "fortify_heal_bonus": 29.54910887578125,
        "fortify_enemy_flag": 795.9893115433262,
        "fortify_distance_penalty": 15,
        "unfortify_full_hp_multiplier": 3.317102156445312,
        "recruit_melee": 1613.5783085302178,
        "recruit_archer": 1138.160912192839,
        "recruit_pikeman": 625.8879632769316,
        "recruit_horseman": 1613.5783085302178,
        "promote_tendency": 0.3,
        "penalty_zoc": 118.196435503125,
        "penalty_vulnerable_exposure": 88.64732662734376,
        "bonus_favorable_exposure": 13.268408625781248,
        "build_bridge_base": 60,
        "build_bridge_forward": 56.212444406438166,
        "build_bridge_backward_penalty": 90,
        "absolute_advantage_aggression": 35,
        "absolute_disadvantage_caution": 45,
        "move_advance_from_base_bonus": 30,
        "move_stay_near_base_penalty": 42,
        "game_speed_urgency": 18
    }
};

let aiBrain = null;

function loadAIBrain() {
    const saved = localStorage.getItem('forthex_ai_brain');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            aiBrain = { 
                ...parsed, 
                weights: { ...DEFAULT_AI_BRAIN.weights, ...parsed.weights } 
            };
            console.log("[AI] Loaded Brain from memory. Matches played:", aiBrain.matchesPlayed);

            saveAIBrain(); 
        } catch (e) {
            console.error("Failed to parse AI Brain. Resetting to default.");
            aiBrain = JSON.parse(JSON.stringify(DEFAULT_AI_BRAIN));
            saveAIBrain(); 
        }
    } else {
        aiBrain = JSON.parse(JSON.stringify(DEFAULT_AI_BRAIN));
        console.log("[AI] Initialized fresh Brain.");
        saveAIBrain(); 
    }
}

function saveAIBrain() {
    if (!aiBrain) return;
    localStorage.setItem('forthex_ai_brain', JSON.stringify(aiBrain));
}

// Call this immediately so the brain is ready when the script loads
loadAIBrain();

function computeBattlefieldAdvantage(allAllies, allEnemies) {
    const scoreUnit = (unit) => {
        return unit.hp + (unit.stats.damage || 0) * 3 + (unit.stats.defense || 0) * 2 + (unit.stats.speed || 0);
    };

    const allyScore = allAllies.reduce((sum, unit) => sum + scoreUnit(unit), 0);
    const enemyScore = allEnemies.reduce((sum, unit) => sum + scoreUnit(unit), 0);
    const relative = (allyScore - enemyScore) / (allyScore + enemyScore + 1);

    return { allyScore, enemyScore, relative };
}

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
        const shouldPromote = (armySize >= maxUnits) || (promotableUnits.length > 0 && Math.random() < aiBrain.weights.promote_tendency);

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
// Recruit missing units based on Brain Weights
const counts = gameState.unitCounts[queueKey];

// Sort classes dynamically based on their learned weight (Highest weight first)
const preferredOrder = ['MELEE', 'ARCHER', 'PIKEMAN', 'HORSEMAN'].sort((a, b) => {
    const weightA = aiBrain.weights[`recruit_${a.toLowerCase()}`] || 100;
    const weightB = aiBrain.weights[`recruit_${b.toLowerCase()}`] || 100;
    return weightB - weightA; 
});

console.log(`[AI] Recruitment preferred order:`, preferredOrder);
            
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
            if(targetInfo.unit.isCarryingFlag) score += aiBrain.weights.atk_flag_carrier; 
            
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
            if(targetInfo.unit.hp <= predictedDmg) score += aiBrain.weights.atk_secure_kill; 
            score += predictedDmg * aiBrain.weights.atk_damage_multiplier; 

            const battlefieldAdvantage = computeBattlefieldAdvantage(allAllies, allEnemies);
            const advantageFactor = battlefieldAdvantage.relative;
            if (advantageFactor > 0) {
                score += advantageFactor * aiBrain.weights.absolute_advantage_aggression * 2.0;
            } else {
                score -= (-advantageFactor) * aiBrain.weights.absolute_disadvantage_caution * 0.8;
            }
        } else { 
            score = aiBrain.weights.atk_bridge; 
        } 
        return score;
    };

    // --- SUB-FUNCTION to score a potential move ---
    const scoreMove = (edgeKey) => {
        let moveScore = aiBrain.weights.move_base_score; 
        const battlefieldAdvantage = computeBattlefieldAdvantage(allAllies, allEnemies);
        const advantageFactor = battlefieldAdvantage.relative;
        const unitPos = getUnitScreenPosition(unit);
        if (!unitPos) return 0;
        
        const moveMidPoint = getEdgeMidpoint(...parseEdgeKey(edgeKey).flatMap(c=>[c.q,c.r]));
        
        // --- 1. FIND CLOSEST ENEMY ---
        let minDist = Infinity;
        let actualClosest = null;
        allEnemies.forEach(e => {
            const ep = getUnitScreenPosition(e);
            if (ep) {
                const d = pointDistance(unitPos, ep);
                if (d < minDist) { minDist = d; actualClosest = e; }
            }
        });

        // --- 1.5. CHECK FLAG STATUS ---
        const myFlag = (gameState.flags && gameState.gameMode !== 'arcade') ? gameState.flags[`p${unit.player}_flag`] : null;
        const isMyFlagStolen = myFlag && myFlag.status === 'carried';
        let myFlagCarrier = null;
        if (isMyFlagStolen) {
            myFlagCarrier = allEnemies.find(e => e.id === myFlag.carrierId);
        }

        // --- 2. BASE MOVEMENT LOGIC ---
        
        // A. WE HAVE THEIR FLAG! RUN HOME!
        if (unit.isCarryingFlag && myBasePos) {
            const currentDist = pointDistance(unitPos, myBasePos);
            const afterDist = pointDistance(moveMidPoint, myBasePos);
            if (afterDist < currentDist) {
                moveScore += aiBrain.weights.move_run_home_flag;
                moveScore += (currentDist - afterDist) * 0.5; 
            }
        } 
        // B. HUNT THE THIEF! 
        else if (isMyFlagStolen && myFlagCarrier) {
            const thiefPos = getUnitScreenPosition(myFlagCarrier);
            if (thiefPos) {
                const currentDist = pointDistance(unitPos, thiefPos);
                const afterDist = pointDistance(moveMidPoint, thiefPos);
                if (afterDist < currentDist) {
                    moveScore += aiBrain.weights.atk_flag_carrier; 
                    moveScore += (currentDist - afterDist) * 0.5; 
                }
            }
        }
        // C. PIKEMAN DEFENSE
        else if (unit.type.name === 'Pikeman' && myBasePos) {
            const currentDist = pointDistance(unitPos, myBasePos);
            const afterDist = pointDistance(moveMidPoint, myBasePos);
            const defenseRadius = HEX_SIZE * 2.5 * gameState.renderScale;
            
            if (currentDist > defenseRadius) {
                 if (afterDist < currentDist) moveScore += aiBrain.weights.move_pikeman_defend;
            } else if (actualClosest) {
                 const ep = getUnitScreenPosition(actualClosest);
                 if (ep) {
                     const aDist = pointDistance(moveMidPoint, ep);
                     if (aDist < minDist) moveScore += aiBrain.weights.move_pikeman_intercept;
                 }
            }
        } 
        // D. STANDARD ATTACK/CAPTURE (Gravitate to Enemy Base)
        else {
            let currentDistOwnBase = Infinity;
            let afterDistOwnBase = Infinity;
            let retreatBonusAllowed = true;
            if (myBasePos) {
                currentDistOwnBase = pointDistance(unitPos, myBasePos);
                afterDistOwnBase = pointDistance(moveMidPoint, myBasePos);
                const baseThreatRadius = HEX_SIZE * 2.5 * gameState.renderScale;
                if (actualClosest) {
                    const closestEnemyPos = getUnitScreenPosition(actualClosest);
                    if (closestEnemyPos && pointDistance(closestEnemyPos, myBasePos) <= baseThreatRadius) {
                        retreatBonusAllowed = false;
                    }
                }

                if (currentDistOwnBase <= baseThreatRadius && afterDistOwnBase < currentDistOwnBase && !isMyFlagStolen) {
                    moveScore += aiBrain.weights.move_advance_from_base_bonus;
                } else if (currentDistOwnBase <= baseThreatRadius && afterDistOwnBase >= currentDistOwnBase && retreatBonusAllowed && !unit.isCarryingFlag) {
                    moveScore -= aiBrain.weights.move_stay_near_base_penalty;
                }
            }

            if (enemyBasePos) {
                // --- NEW: FLAG GRAB OVERRIDE ---
                let isEnemyFlagEdge = false;
                const enemyFlagObj = (gameState.flags && gameState.gameMode !== 'arcade') ? gameState.flags[`p${enemyPlayer}_flag`] : null;
                
                const enemyBaseData = gameState.baseCampPositions[`player${enemyPlayer}`];
                let enemyBaseTiles = Array.isArray(enemyBaseData) ? enemyBaseData : (typeof enemyBaseData === 'string' ? enemyBaseData.split('_') : []);

                if (gameState.gridRadius === 4) {
                     if (isInternalBaseEdge(edgeKey)) {
                        const [eh1, eh2] = parseEdgeKey(edgeKey); 
                        const et1 = getTileKey(eh1.q, eh1.r);
                        if (enemyBaseTiles.includes(et1)) isEnemyFlagEdge = true;
                    }
                } else {
                    if (enemyFlagObj && enemyFlagObj.homePosition === edgeKey) isEnemyFlagEdge = true;
                }

                // If this is the flag edge and the flag is sitting there, CRUSH the ZoC penalty!
                if (isEnemyFlagEdge && enemyFlagObj && enemyFlagObj.status === 'at_base') {
                    moveScore += (aiBrain.weights.atk_flag_carrier * 1.5); // ~450 points!
                }

                // Standard Gravity
                const currentDistBase = pointDistance(unitPos, enemyBasePos);
                const afterDistBase = pointDistance(moveMidPoint, enemyBasePos);
                if (afterDistBase < currentDistBase) {
                    moveScore += aiBrain.weights.move_toward_base; 
                    moveScore += (currentDistBase - afterDistBase) * 0.2; 
                    moveScore += aiBrain.weights.game_speed_urgency;
                } else if (advantageFactor < 0) {
                    moveScore -= (-advantageFactor) * aiBrain.weights.absolute_disadvantage_caution * 2;
                }

                if (advantageFactor > 0 && afterDistBase < currentDistBase) {
                    moveScore += advantageFactor * aiBrain.weights.absolute_advantage_aggression * 4;
                }
            }
            if (actualClosest) {
                const ep = getUnitScreenPosition(actualClosest);
                const aDist = pointDistance(moveMidPoint, ep);
                if (aDist < minDist) {
                    moveScore += aiBrain.weights.move_chase_enemy;
                }
            }
        }

        // --- 3. FORESIGHT: THREAT ASSESSMENT ---
        let threatPenalty = 0;
        
        // A. Zone of Control (ZoC) Check
        const [h1, h2] = parseEdgeKey(edgeKey);
        const tile1 = gameState.tiles.get(getTileKey(h1.q, h1.r));
        const tile2 = gameState.tiles.get(getTileKey(h2.q, h2.r));
        
        const enemyBaseData = gameState.baseCampPositions[`player${enemyPlayer}`];
        let enemyBaseTiles = Array.isArray(enemyBaseData) ? enemyBaseData : (typeof enemyBaseData === 'string' ? enemyBaseData.split('_') : []);

        const checkZoC = (tile, tileKey) => {
            if (!tile) return false;
            if (enemyBaseTiles.includes(tileKey)) return true;
            if (tile.fortifiedByPlayer === enemyPlayer) {
                const fortUnit = gameState.units.find(u => u.isFortified && u.position === tileKey && u.player === enemyPlayer);
                if (fortUnit && !isZoCSuppressed(fortUnit)) return true;
            }
            return false;
        };

        if (checkZoC(tile1, getTileKey(h1.q, h1.r)) || checkZoC(tile2, getTileKey(h2.q, h2.r))) {
            threatPenalty += (aiBrain.weights.penalty_zoc || 80.0);
            
            // --- NEW: SUICIDE DETERRENT ---
            // If the unit has 1 HP, stepping in ZoC is guaranteed death. 
            // Don't suicide to grab the flag, let a healthier unit do it!
            if (unit.hp <= 1) { 
                threatPenalty += 1000.0; 
            }
        }

        // B. Matchup Exposure Check
        allEnemies.forEach(enemy => {
            const ep = getUnitScreenPosition(enemy);
            if (ep) {
                const distToDestination = pointDistance(moveMidPoint, ep);
                const attackRangePixels = (enemy.stats.speed * HEX_SIZE * gameState.renderScale) + 
                                          (enemy.type.attackType === 'ranged' ? HEX_SIZE * 1.5 * gameState.renderScale : 0);
                
                if (distToDestination <= attackRangePixels) {
                    if (enemy.type.strengths && enemy.type.strengths.includes(unit.type.name)) {
                        threatPenalty += (aiBrain.weights.penalty_vulnerable_exposure || 60.0);
                    } else if (unit.type.strengths && unit.type.strengths.includes(enemy.type.name)) {
                        threatPenalty -= (aiBrain.weights.bonus_favorable_exposure || 20.0);
                    } else {
                        threatPenalty += 10.0; 
                    }
                }
            }
        });

        const threatMultiplier = advantageFactor > 0
            ? Math.max(0.6, 1 - advantageFactor * 0.4)
            : 1 + Math.min(0.5, -advantageFactor * 0.5);

        moveScore -= threatPenalty * threatMultiplier;
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
        
        // BUILD_BRIDGE
        if (unit.type.canBuildBridge && unit.currentMove >= BUILD_BRIDGE_COST && !unit.isCarryingFlag) {
            const bridgeTargets = getPotentialBridgeTargets(unit);
            bridgeTargets.forEach(edgeKey => {
                let score = aiBrain.weights.build_bridge_base;
                
                // Boost the score if this bridge goes TOWARD the enemy base
                const moveMidPoint = getEdgeMidpoint(...parseEdgeKey(edgeKey).flatMap(c=>[c.q,c.r]));
                if (enemyBasePos) {
                    const currentDistBase = pointDistance(getUnitScreenPosition(unit), enemyBasePos);
                    const afterDistBase = pointDistance(moveMidPoint, enemyBasePos);
                    if (afterDistBase < currentDistBase) {
                        score += aiBrain.weights.build_bridge_forward; // Greatly prefers aggressive bridges
                    } else {
                        score -= aiBrain.weights.build_bridge_backward_penalty; // Discourage bridges away from the front
                    }
                }
                    
                possibleActions.push({ type: 'BUILD_BRIDGE', unit, targetEdgeKey: edgeKey, score });
            });
        }

        // FORTIFY_ONLY
        if (unit.stats.defense > 0 && !unit.isCarryingFlag) {
             const edgeCoords = parseEdgeKey(unit.position);
             if (edgeCoords.length === 2 && !isNaN(edgeCoords[0].q)) {
                
                const myFlagTileKey = getFlagTileKey(unit.player);
                const enemyPlayer = unit.player === 1 ? 2 : 1;
                const enemyFlagTileKey = getFlagTileKey(enemyPlayer);
                const enemyBaseData = gameState.baseCampPositions[`player${enemyPlayer}`];
                const enemyBaseTileKeys = new Set(Array.isArray(enemyBaseData) ? enemyBaseData : []);

                [getTileKey(edgeCoords[0].q, edgeCoords[0].r), getTileKey(edgeCoords[1].q, edgeCoords[1].r)].forEach(tileKey => {
                    const tile = gameState.tiles.get(tileKey);
                    
                    if(tile && tile.type.canFortify && tile.fortifiedByPlayer === null && tileKey !== myFlagTileKey && (!enemyBaseTileKeys.has(tileKey) || tileKey === enemyFlagTileKey)) {
                         let score = aiBrain.weights.fortify_base_score - unit.fortifyCooldown;
                         if(unit.type.name === 'Pikeman') score += aiBrain.weights.fortify_pikeman_bonus; 
                         if(unit.hp < unit.maxHp) score += aiBrain.weights.fortify_heal_bonus; 
                         if(tileKey === enemyFlagTileKey) score += aiBrain.weights.fortify_enemy_flag; 
                         if(axialDistance(...tileKey.split(',').map(Number),0,0) > 1) score -= aiBrain.weights.fortify_distance_penalty;
                         if(score > 0) possibleActions.push({ type: 'FORTIFY_ONLY', unit, targetTileKey: tileKey, score });
                    }
                });
             }
        }
    } else { 
        // UNFORTIFY_ONLY
        const unfortifyTargets = getPotentialUnfortifyTargets(unit);
        if (unfortifyTargets.length > 0) {
            let score = (unit.hp >= unit.maxHp && unit.turnsFortified > 2) ? (unit.turnsFortified * aiBrain.weights.unfortify_full_hp_multiplier) : 0;
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
        if (!gameState.isTrainingMode) {
            gameState.potentialDebugPathToDraw = moveData.path;
            gameState.debugPathHoverStartTime = Date.now() - PATH_DRAW_HOVER_DELAY_MS;
            await delay(PATH_DRAW_ANIMATION_DURATION_MS + 200);
        }
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
        case 'BUILD_BRIDGE':
            completeBuildBridge(action.targetEdgeKey);
            await delay(500);
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

function evolveAIBrain(aiVictory, victoryReason, aiPlayerNum, matchHistory) {
    const LEARNING_RATE = 0.05;

    aiBrain.matchesPlayed++;
    if (aiVictory) aiBrain.wins++;

    const adjustWeight = (key, increase) => {
        const adjustment = aiBrain.weights[key] * LEARNING_RATE;
        aiBrain.weights[key] += increase ? adjustment : -adjustment;
        if (aiBrain.weights[key] < 1.0) aiBrain.weights[key] = 1.0; 
    };

    console.group(`[AI Brain] Evolving Weights (Match ${aiBrain.matchesPlayed})`);
    console.log(`Result: ${aiVictory ? "WIN" : "LOSS"} via ${victoryReason}`);

    // --- 1. EVALUATE OVERALL STRATEGY ---
    if (aiVictory) {
        adjustWeight('atk_damage_multiplier', true);
        adjustWeight('atk_secure_kill', true);
        adjustWeight('build_bridge_forward', true); 

        if (victoryReason.includes('captured the flag')) {
            adjustWeight('move_toward_base', true);
            adjustWeight('fortify_enemy_flag', true);
        }
    } else {
        if (victoryReason.includes('captured the flag')) {
            adjustWeight('move_pikeman_defend', true);
            adjustWeight('move_pikeman_intercept', true);
            adjustWeight('atk_flag_carrier', true);
            adjustWeight('move_toward_base', false); 
            adjustWeight('build_bridge_forward', false); 
        } else if (victoryReason.includes('Annihilation')) {
            adjustWeight('fortify_heal_bonus', true);
            adjustWeight('unfortify_full_hp_multiplier', false);
            adjustWeight('atk_damage_multiplier', false); 
            
            adjustWeight('penalty_zoc', true);
            adjustWeight('penalty_vulnerable_exposure', true);
            adjustWeight('bonus_favorable_exposure', false); 
        }
    }

    // --- 2. EVALUATE UNIT UTILITY FROM HISTORY ---
    let classUtility = { MELEE: 0, ARCHER: 0, PIKEMAN: 0, HORSEMAN: 0 };
    let totalActions = 0;
    let totalUpgrades = 0;

    matchHistory.forEach(action => {
        if (action.player === aiPlayerNum && action.actorId) {
            // Extract the unit class from the actorId (e.g., u_p2_ARCHER_t1_1)
            const unitClass = action.actorId.split('_')[2]; 
            
            if (classUtility[unitClass] !== undefined) {
                totalActions++;

                // Give points for dealing damage and getting kills
                if (action.type === 'ATTACK' && action.payload) {
                    classUtility[unitClass] += (action.payload.damageDealt || 0);
                    if (action.payload.isKill) classUtility[unitClass] += 10; // Bonus for securing a kill
                }
                // Give points for effective Zone of Control damage
                else if (action.type === 'FORTIFY_ZOC_BLAST' && action.payload && action.payload.hits) {
                    classUtility[unitClass] += action.payload.hits.reduce((sum, hit) => sum + hit.damage, 0);
                }
                // Track if the AI used promotions
                else if (action.type === 'UNIT_UPGRADE') {
                    totalUpgrades++;
                }
            }
        }
    });

    console.log("[AI] Unit Utility Scores:", classUtility);

    // --- 3. ADJUST RECRUITMENT WEIGHTS ---
    ['MELEE', 'ARCHER', 'PIKEMAN', 'HORSEMAN'].forEach(unitClass => {
        const weightKey = `recruit_${unitClass.toLowerCase()}`;
        const utility = classUtility[unitClass] || 0;

        // If the unit performed well, increase its likelihood of being recruited.
        // If it performed poorly (or wasn't used efficiently), decrease it.
        if (utility > 5) {
            adjustWeight(weightKey, true);
            console.log(`Boosted ${unitClass} recruit weight.`);
        } else if (!aiVictory) {
            // Only punish units if we lost. If we won, don't fix what isn't broken.
            adjustWeight(weightKey, false);
            console.log(`Lowered ${unitClass} recruit weight.`);
        }
    });

    // --- 4. ADJUST PROMOTION TENDENCY ---
    // If we won and used upgrades, promote more! If we lost and used upgrades, maybe rely on fresh recruits.
    const upgradeRatio = totalUpgrades / (totalActions || 1);
    if (aiVictory && upgradeRatio > 0.05) {
        aiBrain.weights.promote_tendency = Math.min(1.0, aiBrain.weights.promote_tendency + 0.02);
    } else if (!aiVictory && upgradeRatio > 0.05) {
        aiBrain.weights.promote_tendency = Math.max(0.0, aiBrain.weights.promote_tendency - 0.02);
    }

    console.log("New Brain Weights:", aiBrain.weights);
    console.groupEnd();

    saveAIBrain();
}