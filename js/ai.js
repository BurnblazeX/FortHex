// --- AI Memory System ---
const DEFAULT_AI_BRAIN = {
    version: 6, 
    matchesPlayed: 0,
    wins: 0,
    weights: {
        "recruit_melee": 1,
        "recruit_archer": 1,
        "recruit_pikeman": 1,
        "recruit_horseman": 1,
        "promote_tendency": 0.3,
        "build_bridge_base": 1,
        "build_bridge_forward": 1
    }
};

// --- Tournament Population Config ---
const AI_POPULATION_SIZE = 16;
const AI_EXPLOIT_COUNT = 4;                        // low-mutation "refine what works" cohort
const AI_EXPLORE_COUNT = AI_POPULATION_SIZE - AI_EXPLOIT_COUNT; // high-mutation "try weird stuff" cohort
const AI_POP_STORAGE_KEY = 'forthex_ai_population';
const AI_LEGACY_BRAIN_KEY = 'forthex_ai_brain';   // old single-brain save; used only for one-time migration

const AI_EXPLOIT_MUTATION_RATE = 0.08;             // exploit brains: small, careful nudges
const AI_EXPLOIT_MUTATION_STRENGTH = 0.10;
const AI_EXPLORE_MUTATION_RATE = 0.40;             // explore brains: big, frequent jumps
const AI_EXPLORE_MUTATION_STRENGTH = 0.90;

const AI_WEIGHT_MIN = 0.5;
const AI_WEIGHT_MAX = 500;                         // prevents runaway weights from multiplicative growth
const AI_MATCHES_PER_GENERATION = 48;              // tournament "round" length before culling/breeding
const AI_DRAW_PENALTY_RATE = 0.08;                 // stronger than the normal 0.05 win/loss learning rate

let aiPopulation = null;       // array of brain objects, persisted to AI_POP_STORAGE_KEY
let aiBrain = null;            // ACTIVE brain pointer - repointed every AI turn to whichever brain is playing
let matchesSinceEvolution = 0;

// Stubbed: The old heuristic system used this. We keep an empty stub so main.js does not crash on timeout draws.
function applyDrawPenalty(brain) {}

function createBrain(generation, role, seedNetwork) {
    return {
        id: 'brain_' + Math.random().toString(36).slice(2, 9),
        generation: generation || 0,
        role: role || 'exploit',
        weights: JSON.parse(JSON.stringify(DEFAULT_AI_BRAIN.weights)),
        network: seedNetwork ? JSON.parse(JSON.stringify(seedNetwork)) : createRandomNetwork(),
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0
    };
}

function brainWinRate(brain) {
    const played = brain.matchesPlayed || 0;
    return (brain.wins + 1) / (played + 2);
}

function getChampionBrain() {
    if (!aiPopulation || aiPopulation.length === 0) return aiBrain;
    let best = aiPopulation[0];
    for (let i = 1; i < aiPopulation.length; i++) {
        if (brainWinRate(aiPopulation[i]) > brainWinRate(best)) best = aiPopulation[i];
    }
    return best;
}

function loadPopulation() {
    const saved = localStorage.getItem(AI_POP_STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                aiPopulation = parsed.map(b => ({
                    ...b,
                    role: b.role || 'exploit',
                    draws: b.draws || 0,
                    weights: { ...DEFAULT_AI_BRAIN.weights, ...b.weights },
                    network: b.network || createRandomNetwork()
                }));
                // Top up if the population size config changed since the last save
                while (aiPopulation.length < AI_POPULATION_SIZE) {
                    const champ = getChampionBrain();
                    const isExplore = aiPopulation.filter(b => b.role === 'explore').length < AI_EXPLORE_COUNT;
                    const brain = isExplore
                        ? createBrain(champ.generation, 'explore', mutateNetwork(champ.network, AI_EXPLORE_MUTATION_RATE, AI_EXPLORE_MUTATION_STRENGTH))
                        : createBrain(champ.generation, 'exploit', mutateNetwork(champ.network, AI_EXPLOIT_MUTATION_RATE, AI_EXPLOIT_MUTATION_STRENGTH));
                    aiPopulation.push(brain);
                }
                console.log(`[AI] Loaded tournament population: ${aiPopulation.length} brains.`);
                savePopulation();
                return;
            }
        } catch (e) {
            console.error("[AI] Failed to parse population save. Regenerating.", e);
        }
    }

    aiPopulation = [];
    let baseNetwork = createRandomNetwork();
    // Exploit cohort (4): slot 0 is the pure seed/default, unmutated; the rest get small jitters.
    aiPopulation.push(createBrain(0, 'exploit', baseNetwork));
    for (let i = 1; i < AI_EXPLOIT_COUNT; i++) {
        aiPopulation.push(createBrain(
            0, 'exploit',
            mutateNetwork(baseNetwork, AI_EXPLOIT_MUTATION_RATE, AI_EXPLOIT_MUTATION_STRENGTH)
        ));
    }
    // Explore cohort (4): big, frequent jitters, to actually try weird strategies.
    for (let i = 0; i < AI_EXPLORE_COUNT; i++) {
        aiPopulation.push(createBrain(
            0, 'explore',
            mutateNetwork(baseNetwork, AI_EXPLORE_MUTATION_RATE, AI_EXPLORE_MUTATION_STRENGTH)
        ));
    }
    console.log(`[AI] Initialized fresh tournament population: ${AI_EXPLOIT_COUNT} exploit + ${AI_EXPLORE_COUNT} explore brains.`);
    savePopulation();
}

function savePopulation() {
    if (!aiPopulation) return;
    try {
        localStorage.setItem(AI_POP_STORAGE_KEY, JSON.stringify(aiPopulation));
    } catch (e) {
        console.error('[AI] Failed to save population (localStorage full?).', e);
    }
}

// Kept so any existing call site (e.g. abortTrainingMode) that still calls saveAIBrain() keeps working.
function saveAIBrain() {
    savePopulation();
}

// --- Generational Culling / Breeding ---
function maybeEvolvePopulation() {
    matchesSinceEvolution++;
    if (matchesSinceEvolution < AI_MATCHES_PER_GENERATION) return;
    matchesSinceEvolution = 0;

    const ranked = [...aiPopulation].sort((a, b) => brainWinRate(b) - brainWinRate(a));
    const nextGen = (ranked[0].generation || 0) + 1;
    const elites = ranked.slice(0, AI_EXPLOIT_COUNT);

    console.log(
        `[AI Tournament] === Generation ${nextGen} === Champion winrate: ` +
        `${(brainWinRate(ranked[0]) * 100).toFixed(1)}% (${ranked[0].wins}W / ${ranked[0].draws || 0}D / ${ranked[0].matchesPlayed}G, role: ${ranked[0].role})`
    );

    const newPopulation = [];
    elites.forEach(e => newPopulation.push(
        createBrain(
            nextGen, 
            'exploit',
            mutateNetwork(e.network, AI_EXPLOIT_MUTATION_RATE, AI_EXPLOIT_MUTATION_STRENGTH)
        )
    ));
    for (let i = 0; i < AI_EXPLORE_COUNT; i++) {
        const parent = ranked[Math.floor(Math.random() * ranked.length)];
        newPopulation.push(
            createBrain(
                nextGen, 
                'explore',
                mutateNetwork(parent.network, AI_EXPLORE_MUTATION_RATE, AI_EXPLORE_MUTATION_STRENGTH)
            )
        );
    }

    aiPopulation = newPopulation;
    savePopulation();
}

// Call this immediately so the population is ready when the script loads
loadPopulation();
aiBrain = getChampionBrain();

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

// --- AI: Influence Map ("Heatmap") ---
function getUnitTileKeys(u) {
    if (u.isFortified) return [u.position];
    const edgeCoords = parseEdgeKey(u.position);
    if (!edgeCoords || edgeCoords.length !== 2 || isNaN(edgeCoords[0].q)) return [];
    return [getTileKey(edgeCoords[0].q, edgeCoords[0].r), getTileKey(edgeCoords[1].q, edgeCoords[1].r)];
}

function buildInfluenceMap(allAllies, allEnemies) {
    const map = new Map();

    const radiate = (u, sign) => {
        const sourceTiles = getUnitTileKeys(u);
        if (sourceTiles.length === 0) return;

        let baseStrength = 10;
        let reach = 1; 
        if (u.type.name === 'Pikeman') { baseStrength = 12; reach = 1; }
        else if (u.type.name === 'Archer') { baseStrength = 8; reach = 2; }
        else if (u.type.name === 'Horseman') { baseStrength = 9; reach = 1; }

        gameState.tiles.forEach((tile, tileKey) => {
            const [tq, tr] = tileKey.split(',').map(Number);
            let minDist = Infinity;
            for (const stKey of sourceTiles) {
                const [sq, sr] = stKey.split(',').map(Number);
                const d = axialDistance(sq, sr, tq, tr);
                if (d < minDist) minDist = d;
            }
            if (minDist > reach) return;

            const falloff = minDist === 0 ? 1.0 : (minDist === 1 ? 0.5 : 0.3);
            map.set(tileKey, (map.get(tileKey) || 0) + sign * baseStrength * falloff);
        });
    };

    allAllies.forEach(a => radiate(a, +1));
    allEnemies.forEach(e => radiate(e, -1));

    gameState.lastInfluenceMap = map;
    return map;
}

function getEdgeInfluence(influenceMap, edgeKey) {
    const coords = parseEdgeKey(edgeKey);
    if (!coords || coords.length !== 2 || isNaN(coords[0].q)) return 0;
    const k1 = getTileKey(coords[0].q, coords[0].r);
    const k2 = getTileKey(coords[1].q, coords[1].r);
    return (influenceMap.get(k1) || 0) + (influenceMap.get(k2) || 0);
}

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
        const shouldPromote = (armySize >= maxUnits) || (promotableUnits.length > 0 && Math.random() < aiBrain.weights.promote_tendency);

        if (shouldPromote && promotableUnits.length > 0) {
            const targetUnit = promotableUnits[Math.floor(Math.random() * promotableUnits.length)];
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
            const counts = { Melee: 0, Archer: 0, Pikeman: 0, Horseman: 0 };
            gameState.units.forEach(u => {
                if (u.player === player && u.type && u.type.name) {
                    counts[u.type.name] = (counts[u.type.name] || 0) + 1;
                }
            });

            const preferredOrder = ['MELEE', 'ARCHER', 'PIKEMAN', 'HORSEMAN'].sort((a, b) => {
                const weightA = (aiBrain.weights[`recruit_${a.toLowerCase()}`] || 100) * (1 + (Math.random() * 0.1 - 0.05));
                const weightB = (aiBrain.weights[`recruit_${b.toLowerCase()}`] || 100) * (1 + (Math.random() * 0.1 - 0.05));
                return weightB - weightA; 
            });
            
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
            break; 
        }
        queue = gameState.respawnQueue[queueKey]; 
    }
}

// --- NN TRAINING PIPELINE (Stage 1): sample buffer + export ---
const AI_TRAINING_DATA_KEY = 'forthex_training_data';
const AI_TRAINING_DATA_MAX_BUFFERED = 20000; 

function logTrainingSample(action) {
    if (!gameState.currentMatchSamples) gameState.currentMatchSamples = [];
    gameState.currentMatchSamples.push({
        player: gameState.currentPlayer,
        actionType: action.type,
        score: action.score,
        features: action.features || {}
    });
}

function finalizeTrainingSamples(player, outcomeLabel) {
    // We are using Neuroevolution, so we do not need to save JSON samples to localStorage anymore.
    return; 
}

function exportTrainingData() {
    let buffer = [];
    try {
        const saved = localStorage.getItem(AI_TRAINING_DATA_KEY);
        if (saved) buffer = JSON.parse(saved);
    } catch (e) { buffer = []; }

    if (buffer.length === 0) {
        console.log('[AI Training Data] Nothing to export yet - run some training matches first.');
        return;
    }

    const jsonl = buffer.map(s => JSON.stringify(s)).join('\n');
    const blob = new Blob([jsonl], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forthex_training_data_${Date.now()}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`[AI Training Data] Exported ${buffer.length} samples. Buffer cleared.`);
    localStorage.removeItem(AI_TRAINING_DATA_KEY);
}
if (typeof window !== 'undefined') window.exportTrainingData = exportTrainingData;

// --- NN TRAINING PIPELINE (Stage 2): Feature Vectorization ---
const ACTION_FEATURE_KEYS = [
    'turn',
    'myTotalHP', 'enemyTotalHP',
    'myUnitCount', 'enemyUnitCount',
    'absoluteAdvantage',
    'unitHpRatio', 'unitLevel', 'unitIsFortified',
    'destInfluence', 'threatPenalty', 'nearbyAllyCount', 'minDistToEnemy',
    'predictedDamage', 'targetHpRatio', 'targetIsFlagCarrier', 'isBridgeAttack',
    'isMoveAction', 'isAttackAction', 'isFortifyAction', 'isUnfortifyAction',
    'isMelee', 'isArcher', 'isPikeman', 'isHorseman'
];

function featuresToVector(features) {
    const vec = new Float32Array(ACTION_FEATURE_KEYS.length);
    
    const isAction = (type) => features.actionType && features.actionType.includes(type) ? 1.0 : 0.0;
    const isClass = (type) => features.unitType === type ? 1.0 : 0.0;

    const vals = {
        turn: Math.min(1.0, (features.turn || 0) / 150.0),
        myTotalHP: (features.myTotalHP || 0) / 80.0,
        enemyTotalHP: (features.enemyTotalHP || 0) / 80.0,
        myUnitCount: (features.myUnitCount || 0) / 6.0,
        enemyUnitCount: (features.enemyUnitCount || 0) / 6.0,
        absoluteAdvantage: features.absoluteAdvantage || 0.0,
        
        unitHpRatio: features.unitHpRatio || 0.0,
        unitLevel: (features.unitLevel || 0) / 3.0,
        unitIsFortified: features.unitIsFortified || 0.0,
        
        destInfluence: Math.max(-1.0, Math.min(1.0, (features.destInfluence || 0) / 50.0)),
        threatPenalty: Math.tanh((features.threatPenalty || 0) / 100.0),
        nearbyAllyCount: (features.nearbyAllyCount || 0) / 6.0,
        minDistToEnemy: features.minDistToEnemy === -1 ? 1.0 : Math.min(1.0, (features.minDistToEnemy || 0) / 15.0),
        
        predictedDamage: (features.predictedDamage || 0) / 10.0,
        targetHpRatio: features.targetHpRatio || 0.0,
        targetIsFlagCarrier: features.targetIsFlagCarrier || 0.0,
        isBridgeAttack: features.isBridgeAttack || 0.0,

        isMoveAction: isAction('MOVE'),
        isAttackAction: isAction('ATTACK'),
        isFortifyAction: isAction('FORTIFY'),
        isUnfortifyAction: isAction('UNFORTIFY'),
        
        isMelee: isClass('Melee'),
        isArcher: isClass('Archer'),
        isPikeman: isClass('Pikeman'),
        isHorseman: isClass('Horseman')
    };

    for (let i = 0; i < ACTION_FEATURE_KEYS.length; i++) {
        vec[i] = vals[ACTION_FEATURE_KEYS[i]] || 0.0;
    }

    return vec;
}

// --- NN TRAINING PIPELINE (Stage 3): Neural Network Core ---
const NN_INPUT_SIZE = ACTION_FEATURE_KEYS.length;
const NN_HIDDEN_SIZE = 24;

function createRandomNetwork() {
    const W1 = Array(NN_HIDDEN_SIZE).fill(0).map(() => 
        Array(NN_INPUT_SIZE).fill(0).map(() => Math.random() - 0.5)
    );
    const b1 = Array(NN_HIDDEN_SIZE).fill(0);
    const W2 = Array(NN_HIDDEN_SIZE).fill(0).map(() => Math.random() - 0.5);
    const b2 = 0;

    return { W1, b1, W2, b2 };
}

function forwardPass(network, inputVector) {
    const hidden = new Float32Array(NN_HIDDEN_SIZE);
    
    for (let i = 0; i < NN_HIDDEN_SIZE; i++) {
        let sum = network.b1[i];
        for (let j = 0; j < NN_INPUT_SIZE; j++) {
            sum += network.W1[i][j] * inputVector[j];
        }
        hidden[i] = Math.max(0, sum);
    }

    let outputSum = network.b2;
    for (let i = 0; i < NN_HIDDEN_SIZE; i++) {
        outputSum += network.W2[i] * hidden[i];
    }

    return Math.tanh(outputSum);
}

function mutateNetwork(network, rate, strength) {
    const mutated = {
        W1: network.W1.map(row => [...row]),
        b1: [...network.b1],
        W2: [...network.W2],
        b2: network.b2
    };

    const applyNoise = (val) => {
        if (Math.random() < rate) {
            const noise = (Math.random() + Math.random() + Math.random() - 1.5) * strength;
            return val + noise;
        }
        return val;
    };

    for (let i = 0; i < NN_HIDDEN_SIZE; i++) {
        for (let j = 0; j < NN_INPUT_SIZE; j++) {
            mutated.W1[i][j] = applyNoise(mutated.W1[i][j]);
        }
        mutated.b1[i] = applyNoise(mutated.b1[i]);
        mutated.W2[i] = applyNoise(mutated.W2[i]);
    }
    mutated.b2 = applyNoise(mutated.b2);

    return mutated;
}

function getUnitAIAction(unit, strategy, allEnemies, allAllies) {
    if (unit.hasPerformedMajorAction) return null;

    let possibleActions = [];

    const enemyPlayer = unit.player === 1 ? 2 : 1;
    const enemyBasePos = getBaseCenter(gameState.baseCampPositions[`player${enemyPlayer}`]);
    const myBasePos = getBaseCenter(gameState.baseCampPositions[`player${unit.player}`]);
    const influenceMap = buildInfluenceMap(allAllies, allEnemies);

    const myTotalHP = allAllies.reduce((sum, u) => sum + u.hp, 0);
    const enemyTotalHP = allEnemies.reduce((sum, u) => sum + u.hp, 0);
    const hpAdvantage = (myTotalHP - enemyTotalHP) / Math.max(1, myTotalHP + enemyTotalHP);
    const countAdvantage = (allAllies.length - allEnemies.length) / Math.max(1, allAllies.length + allEnemies.length);
    const absoluteAdvantage = Math.max(-1, Math.min(1, (hpAdvantage + countAdvantage) / 2));

    const stateFeatures = {
        turn: gameState.globalTurnNumber,
        myTotalHP, enemyTotalHP,
        myUnitCount: allAllies.length, enemyUnitCount: allEnemies.length,
        absoluteAdvantage,
        unitHpRatio: unit.hp / Math.max(1, unit.maxHp),
        unitLevel: unit.level || 1,
        unitType: unit.type.name,
        unitIsFortified: unit.isFortified ? 1 : 0
    };
    let lastActionFeatures = {};

    // --- SUB-FUNCTION to score a potential attack ---
    const scoreAttack = (targetInfo) => {
        let predictedDmg = 0;
        if(targetInfo.unit){
            predictedDmg = unit.stats.damage;
            
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
        } 

        lastActionFeatures = {
            isBridgeAttack: targetInfo.unit ? 0 : 1,
            targetHpRatio: targetInfo.unit ? targetInfo.unit.hp / Math.max(1, targetInfo.unit.maxHp) : 0,
            predictedDamage: predictedDmg,
            targetIsFlagCarrier: (targetInfo.unit && targetInfo.unit.isCarryingFlag) ? 1 : 0
        };
        
        const fullFeatures = { ...stateFeatures, ...lastActionFeatures, actionType: 'ATTACK' };
        const vec = featuresToVector(fullFeatures);
        return forwardPass(aiBrain.network, vec) * 100;
    };

    // --- SUB-FUNCTION to score a potential move ---
    const scoreMove = (edgeKey) => {
        const unitPos = getUnitScreenPosition(unit);
        if (!unitPos) return 0;
        
        const moveMidPoint = getEdgeMidpoint(...parseEdgeKey(edgeKey).flatMap(c=>[c.q,c.r]));
        
        let minDist = Infinity;
        let actualClosest = null;
        allEnemies.forEach(e => {
            const ep = getUnitScreenPosition(e);
            if (ep) {
                const d = pointDistance(unitPos, ep);
                if (d < minDist) { minDist = d; actualClosest = e; }
            }
        });

        let threatPenalty = 0;
        
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
            threatPenalty += 80.0;
            if (unit.hp <= 1) { 
                threatPenalty += 1000.0; 
            }
        }

        allEnemies.forEach(enemy => {
            const ep = getUnitScreenPosition(enemy);
            if (ep) {
                const distToDestination = pointDistance(moveMidPoint, ep);
                const attackRangePixels = (enemy.stats.speed * HEX_SIZE * gameState.renderScale) + 
                                          (enemy.type.attackType === 'ranged' ? HEX_SIZE * 1.5 * gameState.renderScale : 0);
                
                if (distToDestination <= attackRangePixels) {
                    if (enemy.type.strengths && enemy.type.strengths.includes(unit.type.name)) {
                        threatPenalty += 60.0;
                    } else if (unit.type.strengths && unit.type.strengths.includes(enemy.type.name)) {
                        threatPenalty -= 20.0;
                    } else {
                        threatPenalty += 10.0; 
                    }
                }
            }
        });

        const destInfluence = getEdgeInfluence(influenceMap, edgeKey);

        const destCoords = parseEdgeKey(edgeKey);
        let nearbyAllyCount = 0;
        if (destCoords.length === 2 && !isNaN(destCoords[0].q)) {
            const destTileKeys = [getTileKey(destCoords[0].q, destCoords[0].r), getTileKey(destCoords[1].q, destCoords[1].r)];
            allAllies.forEach(a => {
                if (a.id === unit.id) return;
                const allyTiles = getUnitTileKeys(a);
                const isNear = allyTiles.some(at => {
                    const [aq, ar] = at.split(',').map(Number);
                    return destTileKeys.some(dt => {
                        const [dq, dr] = dt.split(',').map(Number);
                        return axialDistance(aq, ar, dq, dr) <= 1;
                    });
                });
                if (isNear) nearbyAllyCount++;
            });
        }

        lastActionFeatures = {
            destInfluence,
            threatPenalty,
            nearbyAllyCount,
            minDistToEnemy: minDist === Infinity ? -1 : minDist
        };
        
        const fullFeatures = { ...stateFeatures, ...lastActionFeatures, actionType: 'MOVE' };
        const vec = featuresToVector(fullFeatures);
        return forwardPass(aiBrain.network, vec) * 100;
    };

    if (!unit.isFortified) {
        const attackTargets = getValidMeleeAttackTargets(unit).concat(getValidArcherAttackTargets(unit));
        attackTargets.forEach(targetInfo => {
            const atkScore = scoreAttack(targetInfo);
            possibleActions.push({ type: 'ATTACK_ONLY', unit, targetInfo, score: atkScore, features: { ...stateFeatures, ...lastActionFeatures, actionType: 'ATTACK_ONLY' } });
        });
        
        if (unit.type.canBuildBridge && unit.currentMove >= BUILD_BRIDGE_COST && !unit.isCarryingFlag) {
            const bridgeTargets = getPotentialBridgeTargets(unit);
            bridgeTargets.forEach(edgeKey => {
                const vec = featuresToVector({ ...stateFeatures, actionType: 'BUILD_BRIDGE' });
                const score = forwardPass(aiBrain.network, vec) * 100;
                possibleActions.push({ type: 'BUILD_BRIDGE', unit, targetEdgeKey: edgeKey, score, features: { ...stateFeatures, actionType: 'BUILD_BRIDGE' } });
            });
        }

        if (unit.stats.defense > 0 && !unit.isCarryingFlag) {
             const edgeCoords = parseEdgeKey(unit.position);
             if (edgeCoords.length === 2 && !isNaN(edgeCoords[0].q)) {
                
                const myFlagTileKey = getFlagTileKey(unit.player);
                const enemyPlayer = unit.player === 1 ? 2 : 1;
                const enemyFlagTileKey = getFlagTileKey(enemyPlayer);
                const enemyBaseTileKeys = new Set(getBaseTileKeys(enemyPlayer));
                const myBaseTileKeys = new Set(getBaseTileKeys(unit.player));

                [getTileKey(edgeCoords[0].q, edgeCoords[0].r), getTileKey(edgeCoords[1].q, edgeCoords[1].r)].forEach(tileKey => {
                    const tile = gameState.tiles.get(tileKey);

                    if(tile && tile.type.canFortify && tile.fortifiedByPlayer === null && tileKey !== myFlagTileKey && !myBaseTileKeys.has(tileKey) && (!enemyBaseTileKeys.has(tileKey) || tileKey === enemyFlagTileKey)) {
                         const destInfluence = influenceMap.get(tileKey) || 0;
                         const fortifyFeatures = { ...stateFeatures, destInfluence, actionType: 'FORTIFY_ONLY' };
                         const vec = featuresToVector(fortifyFeatures);
                         const score = forwardPass(aiBrain.network, vec) * 100;
                         possibleActions.push({ type: 'FORTIFY_ONLY', unit, targetTileKey: tileKey, score, features: fortifyFeatures });
                    }
                });
             }
        }
    } else { 
        const unfortifyTargets = getPotentialUnfortifyTargets(unit);
        if (unfortifyTargets.length > 0) {
            const vec = featuresToVector({ ...stateFeatures, actionType: 'UNFORTIFY_ONLY' });
            const score = forwardPass(aiBrain.network, vec) * 100;
            possibleActions.push({ type: 'UNFORTIFY_ONLY', unit, targetEdgeKey: unfortifyTargets[0], score, features: { ...stateFeatures, actionType: 'UNFORTIFY_ONLY' } });
        }
    }

    const possibleMoves = getPossibleMoves(unit);
    possibleMoves.forEach((moveData, edgeKey) => {
        const moveScore = scoreMove(edgeKey);
        const moveFeatures = { ...stateFeatures, ...lastActionFeatures, actionType: 'MOVE_ONLY' };
        
        const ghostUnit = { 
            ...unit, 
            position: edgeKey, 
            currentMove: unit.currentMove - moveData.cost,
            positionType: 'edge' 
        };

        if (unit.type.canMoveAfterAttack && ghostUnit.currentMove >= ATTACK_COST && !unit.isCarryingFlag) {
            const attackTargets = getValidMeleeAttackTargets(ghostUnit);
            if (attackTargets.length > 0) {
                const bestTarget = attackTargets.sort((a,b) => scoreAttack(b) - scoreAttack(a))[0];
                const combinedScore = moveScore + scoreAttack(bestTarget);
                possibleActions.push({ type: 'MOVE_AND_ATTACK', unit, moveData, targetInfo: bestTarget, score: combinedScore, features: { ...stateFeatures, ...lastActionFeatures, actionType: 'MOVE_AND_ATTACK' } });
            }
        }
        
        possibleActions.push({ type: 'MOVE_ONLY', unit, moveData, score: moveScore, features: moveFeatures });
    });
    
    if (possibleActions.length === 0) return null;
    possibleActions.forEach(action => {
        action.score += (Math.random() * 1.0) - 0.5;
    });
    
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
            if (gameSettings.fogOfWarEnabled && gameState.gameMode === 'singleplayer' && unit.player !== gameState.playerSide) {
                gameState.potentialDebugPathToDraw = null;
            } else {
                gameState.potentialDebugPathToDraw = moveData.path;
            }
            gameState.debugPathHoverStartTime = Date.now() - PATH_DRAW_HOVER_DELAY_MS;
            await delay(PATH_DRAW_ANIMATION_DURATION_MS + 200);
        }
        handleMoveAction(unit, moveData.path[moveData.path.length - 1], moveData.cost, moveData.path);
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

    if (gameState.isTrainingMode && gameState.matchBrains) {
        aiBrain = gameState.matchBrains[`player${gameState.currentPlayer}`] || getChampionBrain();
    } else {
        aiBrain = getChampionBrain();
    }

    console.log(`--- AI Turn ${gameState.globalTurnNumber} (Player ${gameState.currentPlayer}) using brain #${aiPopulation.indexOf(aiBrain)} ---`);

    await handleAIReinforcements();

    const aiStrategy = 'STANDARD';
    const allEnemies = gameState.units.filter(u => u.player !== gameState.currentPlayer);
    const allAllies = gameState.units.filter(u => u.player === gameState.currentPlayer);
    
    let unitsToProcess = allAllies.filter(u => !u.hasPerformedMajorAction);

    while (unitsToProcess.length > 0) {
        
        unitsToProcess.sort(() => Math.random() - 0.5);

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
        logTrainingSample(bestActionOverall);
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

function evolveBrain(brain, aiVictory, victoryReason, aiPlayerNum, matchHistory) {
    const LEARNING_RATE = 0.05;

    let efficiencyMultiplier = 1.0;
    if (aiVictory) {
        efficiencyMultiplier = Math.max(0.1, 1.0 - (gameState.globalTurnNumber / 50));
    }

    const clampWeight = (v) => Math.min(500, Math.max(0.5, v));
    const clampProb = (v) => Math.min(1.0, Math.max(0.0, v));

    const adjustWeight = (key, increase) => {
        if (brain.weights[key] === undefined) return;
        const adjustment = brain.weights[key] * LEARNING_RATE * efficiencyMultiplier;
        brain.weights[key] = clampWeight(brain.weights[key] + (increase ? adjustment : -adjustment));
    };

    console.group(`[AI Brain] Evolving Logistics (Brain #${aiPopulation.indexOf(brain)}, Match ${brain.matchesPlayed})`);
    console.log(`Result: ${aiVictory ? "WIN" : "LOSS"} via ${victoryReason}. (Efficiency: ${efficiencyMultiplier.toFixed(2)}x)`);

    if (!aiVictory && victoryReason.includes('Timeout')) {
        brain.weights.promote_tendency = clampProb(brain.weights.promote_tendency - 0.05);
    }

    let classUtility = { MELEE: 0, ARCHER: 0, PIKEMAN: 0, HORSEMAN: 0 };
    let totalActions = 0;
    let totalUpgrades = 0;

    matchHistory.forEach(action => {
        if (action.player === aiPlayerNum && action.actorId) {
            const unitClass = action.actorId.split('_')[2]; 
            
            if (classUtility[unitClass] !== undefined) {
                totalActions++;
                if (action.type === 'ATTACK' && action.payload) {
                    classUtility[unitClass] += (action.payload.damageDealt || 0);
                    if (action.payload.isKill) classUtility[unitClass] += 10; 
                }
                else if (action.type === 'FORTIFY_ZOC_BLAST' && action.payload && action.payload.hits) {
                    classUtility[unitClass] += action.payload.hits.reduce((sum, hit) => sum + hit.damage, 0);
                }
                else if (action.type === 'UNIT_UPGRADE') {
                    totalUpgrades++;
                }
            }
        }
    });

    ['MELEE', 'ARCHER', 'PIKEMAN', 'HORSEMAN'].forEach(unitClass => {
        const weightKey = `recruit_${unitClass.toLowerCase()}`;
        const utility = classUtility[unitClass] || 0;

        if (utility > 5) {
            adjustWeight(weightKey, true);
            console.log(`Boosted ${unitClass} recruit weight.`);
        } else if (!aiVictory) {
            adjustWeight(weightKey, false);
            console.log(`Lowered ${unitClass} recruit weight.`);
        }
    });

    const upgradeRatio = totalUpgrades / (totalActions || 1);
    if (aiVictory && upgradeRatio > 0.05) {
        brain.weights.promote_tendency = clampProb(brain.weights.promote_tendency + 0.02);
    } else if (!aiVictory && upgradeRatio > 0.05) {
        brain.weights.promote_tendency = clampProb(brain.weights.promote_tendency - 0.02);
    }

    if (!gameState.isTrainingMode) {
        console.log("[AI] Analyzing Human 'Gospel' Gameplay...");
        
        const humanPlayerNum = aiPlayerNum === 1 ? 2 : 1;
        const GOSPEL_RATE = aiVictory ? 0.15 : 0.25; 

        let humanClassUsage = { MELEE: 0, ARCHER: 0, PIKEMAN: 0, HORSEMAN: 0 };
        let humanUpgrades = 0;
        let humanBridgeBuilds = 0;
        let humanActionCount = 0;

        matchHistory.forEach(action => {
            if (action.player === humanPlayerNum) {
                humanActionCount++;
                if (action.actorId) {
                    const unitClass = action.actorId.split('_')[2];
                    if (humanClassUsage[unitClass] !== undefined) {
                        humanClassUsage[unitClass]++;
                    }
                }
                if (action.type === 'UNIT_UPGRADE') humanUpgrades++;
                if (action.type === 'BUILD_BRIDGE') humanBridgeBuilds++;
            }
        });

        if (humanActionCount > 0) {
            ['MELEE', 'ARCHER', 'PIKEMAN', 'HORSEMAN'].forEach(unitClass => {
                const usagePercentage = humanClassUsage[unitClass] / humanActionCount;
                if (usagePercentage > 0.20) {
                    const weightKey = `recruit_${unitClass.toLowerCase()}`;
                    brain.weights[weightKey] = clampWeight(brain.weights[weightKey] + brain.weights[weightKey] * GOSPEL_RATE);
                    console.log(`[Imitation] Human heavily utilizes ${unitClass}. Ramping up recruitment weight.`);
                }
            });

            const promoteRate = humanUpgrades / humanActionCount;
            if (promoteRate > 0.05) {
                brain.weights.promote_tendency = clampProb(brain.weights.promote_tendency + 0.05);
                console.log(`[Imitation] Human relies on Veterans. Increasing AI promote tendency.`);
            }

            if (humanBridgeBuilds > 0) {
                brain.weights.build_bridge_base = clampWeight(brain.weights.build_bridge_base + brain.weights.build_bridge_base * GOSPEL_RATE);
                brain.weights.build_bridge_forward = clampWeight(brain.weights.build_bridge_forward + brain.weights.build_bridge_forward * GOSPEL_RATE);
                console.log(`[Imitation] Human utilizes bridges. AI will now track bridge logistics.`);
            }
        }
    }

    console.log("Final Evolved Brain Logistics:", brain.weights);
    console.groupEnd();

    saveAIBrain();
}

window.abortBenchmark = false;
window.stopBenchmark = function() {
    window.abortBenchmark = true;
    console.log("Halting benchmark after the current match...");
};

async function runHeadlessBenchmark(brainA, brainB, numMatches) {
    window.abortBenchmark = false;
    let winsA = 0, winsB = 0, draws = 0, totalTurns = 0;
    
    const origGameMode = gameState.gameMode;
    const origIsTraining = gameState.isTrainingMode;
    const origMatchBrains = gameState.matchBrains;
    const origEvolveBrain = window.evolveBrain;
    const origSavePop = window.savePopulation;
    const origFinalize = window.finalizeTrainingSamples;
    const origMaybeEvolve = window.maybeEvolvePopulation;
    const origStartNewMatch = window.startNewTrainingMatch;
    const origSetTimeout = window.setTimeout;

    window.evolveBrain = () => {};
    window.savePopulation = () => {};
    window.finalizeTrainingSamples = () => {};
    window.maybeEvolvePopulation = () => {};
    
    let matchFinished = false;
    window.startNewTrainingMatch = () => { matchFinished = true; }; 
    
    window.setTimeout = (fn, delay) => {
        if (delay === 0 && fn.toString().includes('executeAITurn')) return 0; 
        return origSetTimeout(fn, delay);
    };

    gameState.gameMode = 'local';
    gameState.isTrainingMode = true;
    
    console.log(`[Benchmark] Starting ${numMatches} matches... Run stopBenchmark() to abort.`);

    for (let i = 0; i < numMatches; i++) {
        if (window.abortBenchmark) {
            console.log("[Benchmark] Aborted early.");
            break;
        }

        const flip = i % 2 !== 0; 
        
        const testBrainA = JSON.parse(JSON.stringify(brainA));
        const testBrainB = JSON.parse(JSON.stringify(brainB));
        
        testBrainA.wins = testBrainA.wins || 0;
        testBrainB.wins = testBrainB.wins || 0;
        
        gameState.matchBrains = {
            player1: flip ? testBrainB : testBrainA,
            player2: flip ? testBrainA : testBrainB
        };
        
        gameState.currentMatchSamples = []; 
        matchFinished = false;
        
        initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3);
        
        while (!matchFinished && gameState.globalTurnNumber < 150) { 
            await executeAITurn();
            if (gameState.gameOver) break; 
        }
        
        if (testBrainA.wins > (brainA.wins || 0)) winsA++;
        else if (testBrainB.wins > (brainB.wins || 0)) winsB++;
        else draws++;
        
        totalTurns += gameState.globalTurnNumber;
        
        if ((i + 1) % 5 === 0 || i === numMatches - 1) {
            console.log(`[Benchmark] Progress: ${i + 1}/${numMatches} matches. (A:${winsA}, B:${winsB}, D:${draws})`);
        }
        await new Promise(resolve => origSetTimeout(resolve, 0));
    }
    
    window.evolveBrain = origEvolveBrain;
    window.savePopulation = origSavePop;
    window.finalizeTrainingSamples = origFinalize;
    window.maybeEvolvePopulation = origMaybeEvolve;
    window.startNewTrainingMatch = origStartNewMatch;
    window.setTimeout = origSetTimeout;
    
    gameState.gameMode = origGameMode;
    gameState.isTrainingMode = origIsTraining;
    gameState.matchBrains = origMatchBrains;
    
    const actualMatches = winsA + winsB + draws;
    const result = { winsA, winsB, draws, avgTurns: actualMatches > 0 ? totalTurns / actualMatches : 0 };
    console.log(`[Benchmark] COMPLETE: A=${winsA} B=${winsB} Draws=${draws} AvgTurns=${result.avgTurns.toFixed(1)}`);
    return result;
}
window.runHeadlessBenchmark = runHeadlessBenchmark;

window.benchmarkGenerationalProgress = async function() {
    const championNow = getChampionBrain();
    console.log(`[Benchmark] Evaluating Gen ${championNow.generation} Champion vs Fresh Random Brain...`);
    
    const randomBrain = createBrain(0, 'exploit');
    
    const result = await runHeadlessBenchmark(championNow, randomBrain, 30);
    
    const winRate = ((result.winsA + (result.draws * 0.5)) / 30) * 100;
    
    console.log(`[Progress] Champion Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`Details -> Champ Wins: ${result.winsA} | Random Wins: ${result.winsB} | Draws: ${result.draws}`);
    
    if (winRate > 55) {
        console.log("Real learning confirmed! The Champion is beating random noise.");
    } else {
        console.log("Evolution is struggling to beat random noise.");
    }
};