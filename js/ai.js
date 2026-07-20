<<<<<<< Updated upstream
=======
// --- AI Memory System ---
const DEFAULT_AI_BRAIN = {
    version: 5, 
    matchesPlayed: 0,
    wins: 0,
    weights: {
        "atk_flag_carrier": 1,
        "atk_secure_kill": 1,
        "atk_damage_multiplier": 1,
        "atk_bridge": 1,
        "move_base_score": 1,
        "move_run_home_flag": 1,
        "move_pikeman_defend": 1,
        "move_pikeman_intercept": 1,
        "move_toward_base": 1,
        "move_chase_enemy": 1,
        "fortify_base_score": 1,
        "fortify_pikeman_bonus": 1,
        "fortify_heal_bonus": 1,
        "fortify_enemy_flag": 1,
        "fortify_distance_penalty": 1,
        "unfortify_full_hp_multiplier": 1,
        "recruit_melee": 1,
        "recruit_archer": 1,
        "recruit_pikeman": 1,
        "recruit_horseman": 1,
        "promote_tendency": 0.3,
        "penalty_zoc": 1,
        "penalty_vulnerable_exposure": 1,
        "bonus_favorable_exposure": 1,
        "build_bridge_base": 1,
        "build_bridge_forward": 1,
        "influence_map_weight": 1,
        "press_advantage_weight": 1,
        "aggression_scaling": 1,
        "formation_spread_bias": 0
    }
};

// --- Tournament Population Config ---
const AI_POPULATION_SIZE = 8;
const AI_EXPLOIT_COUNT = 4;                        // low-mutation "refine what works" cohort
const AI_EXPLORE_COUNT = AI_POPULATION_SIZE - AI_EXPLOIT_COUNT; // high-mutation "try weird stuff" cohort
const AI_POP_STORAGE_KEY = 'forthex_ai_population';
const AI_LEGACY_BRAIN_KEY = 'forthex_ai_brain';   // old single-brain save; used only for one-time migration

const AI_EXPLOIT_MUTATION_RATE = 0.08;             // exploit brains: small, careful nudges
const AI_EXPLOIT_MUTATION_STRENGTH = 0.10;
const AI_EXPLORE_MUTATION_RATE = 0.40;             // explore brains: big, frequent jumps
const AI_EXPLORE_MUTATION_STRENGTH = 0.50;

const AI_WEIGHT_MIN = 0.5;
const AI_WEIGHT_MAX = 500;                         // prevents runaway weights from multiplicative growth
const AI_MATCHES_PER_GENERATION = 16;              // tournament "round" length before culling/breeding
const AI_DRAW_PENALTY_RATE = 0.08;                 // stronger than the normal 0.05 win/loss learning rate

let aiPopulation = null;       // array of brain objects, persisted to AI_POP_STORAGE_KEY
let aiBrain = null;            // ACTIVE brain pointer - repointed every AI turn to whichever brain is playing
let matchesSinceEvolution = 0;

function clampWeight(v) {
    return Math.min(AI_WEIGHT_MAX, Math.max(AI_WEIGHT_MIN, v));
}

// promote_tendency is a 0-1 probability, not a score magnitude - it needs its own range
// or the generic [0.5, 500] weight clamp would floor it upward and break it.
function clampWeightForKey(key, v) {
    if (key === 'promote_tendency') return Math.min(1.0, Math.max(0.0, v));
    if (key === 'aggression_scaling') return Math.min(4.0, Math.max(0.1, v));
    if (key === 'formation_spread_bias') return Math.min(15, Math.max(-15, v));
    return clampWeight(v);
}

function createBrain(seedWeights, generation, role) {
    return {
        id: 'brain_' + Math.random().toString(36).slice(2, 9),
        generation: generation || 0,
        role: role || 'exploit',       // 'exploit' (curated/refined) or 'explore' (high-mutation experiment)
        weights: seedWeights ? JSON.parse(JSON.stringify(seedWeights)) : JSON.parse(JSON.stringify(DEFAULT_AI_BRAIN.weights)),
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0
    };
}

function mutateWeights(weights, rate, strength) {
    const mutRate = rate !== undefined ? rate : AI_EXPLOIT_MUTATION_RATE;
    const mutStrength = strength !== undefined ? strength : AI_EXPLOIT_MUTATION_STRENGTH;
    const out = {};
    for (const key in weights) {
        let v = weights[key];
        if (Math.random() < mutRate) {
            if (key === 'formation_spread_bias') {
                // Signed, zero-centered personality trait - multiplicative jitter can
                // never move a value off zero, so this one mutates additively instead.
                v = v + (Math.random() * 2 - 1) * mutStrength * 10;
            } else {
                v = v * (1 + (Math.random() * 2 - 1) * mutStrength);
            }
        }
        out[key] = clampWeightForKey(key, v);
    }
    return out;
}

// Laplace-smoothed win rate so brains with only a few games played aren't ranked
// as a false 0% or 100% - keeps the tournament from over-trusting small samples.
// Draws count against a brain here too (they inflate matchesPlayed without wins),
// which is part of how draws get discouraged at the population-selection level.
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
                    weights: { ...DEFAULT_AI_BRAIN.weights, ...b.weights }
                }));
                // Top up if the population size config changed since last save
                while (aiPopulation.length < AI_POPULATION_SIZE) {
                    const champ = getChampionBrain();
                    const isExplore = aiPopulation.filter(b => b.role === 'explore').length < AI_EXPLORE_COUNT;
                    const brain = isExplore
                        ? createBrain(mutateWeights(champ.weights, AI_EXPLORE_MUTATION_RATE, AI_EXPLORE_MUTATION_STRENGTH), champ.generation, 'explore')
                        : createBrain(mutateWeights(champ.weights, AI_EXPLOIT_MUTATION_RATE, AI_EXPLOIT_MUTATION_STRENGTH), champ.generation, 'exploit');
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

    // --- MIGRATION: seed the new population from an old single-brain save, if one exists ---
    let seedWeights = null;
    const legacy = localStorage.getItem(AI_LEGACY_BRAIN_KEY);
    if (legacy) {
        try {
            const parsedLegacy = JSON.parse(legacy);
            seedWeights = { ...DEFAULT_AI_BRAIN.weights, ...parsedLegacy.weights };
            console.log("[AI] Migrating existing single-brain save into new population as seed Champion.");
        } catch (e) { /* fall through to fresh defaults */ }
    }

    aiPopulation = [];
    // Exploit cohort (4): slot 0 is the pure seed/default, unmutated; the rest get small jitters.
    aiPopulation.push(createBrain(seedWeights, 0, 'exploit'));
    for (let i = 1; i < AI_EXPLOIT_COUNT; i++) {
        aiPopulation.push(createBrain(
            mutateWeights(seedWeights || DEFAULT_AI_BRAIN.weights, AI_EXPLOIT_MUTATION_RATE, AI_EXPLOIT_MUTATION_STRENGTH),
            0, 'exploit'
        ));
    }
    // Explore cohort (4): big, frequent jitters, to actually try weird strategies.
    for (let i = 0; i < AI_EXPLORE_COUNT; i++) {
        aiPopulation.push(createBrain(
            mutateWeights(seedWeights || DEFAULT_AI_BRAIN.weights, AI_EXPLORE_MUTATION_RATE, AI_EXPLORE_MUTATION_STRENGTH),
            0, 'explore'
        ));
    }
    console.log(`[AI] Initialized fresh tournament population: ${AI_EXPLOIT_COUNT} exploit + ${AI_EXPLORE_COUNT} explore brains.`);
    savePopulation();
}

function savePopulation() {
    if (!aiPopulation) return;
    localStorage.setItem(AI_POP_STORAGE_KEY, JSON.stringify(aiPopulation));
}

// Kept so any existing call site (e.g. abortTrainingMode) that still calls saveAIBrain() keeps working.
function saveAIBrain() {
    savePopulation();
}

// Draws are penalized harder than a normal loss: both brains get pushed away from
// passive/stalling behavior (heavy fortifying, no forward pressure) since that's
// usually what produces a non-result, wasting a full match's worth of training data.
function applyDrawPenalty(brain) {
    const push = (key, increase) => {
        const adjustment = brain.weights[key] * AI_DRAW_PENALTY_RATE;
        brain.weights[key] = clampWeightForKey(key, brain.weights[key] + (increase ? adjustment : -adjustment));
    };
    push('move_toward_base', true);
    push('move_chase_enemy', true);
    push('atk_secure_kill', true);
    push('press_advantage_weight', true);
    push('fortify_base_score', false);
    push('fortify_pikeman_bonus', false);
    push('fortify_distance_penalty', true);
    console.log(`[AI Brain] Draw penalty applied to Brain #${aiPopulation.indexOf(brain)} (role: ${brain.role}).`);
}

// --- Tournament Match Pairing ---
// Picks two distinct brains from the population, randomizes which side of the board
// they play on (to avoid a positional bias), and starts a fresh match between them.
function startNewTrainingMatch() {
    if (!aiPopulation || aiPopulation.length < 2) loadPopulation();

    let i = Math.floor(Math.random() * aiPopulation.length);
    let j = Math.floor(Math.random() * aiPopulation.length);
    while (j === i) j = Math.floor(Math.random() * aiPopulation.length);

    const flip = Math.random() < 0.5;
    const brainP1 = flip ? aiPopulation[i] : aiPopulation[j];
    const brainP2 = flip ? aiPopulation[j] : aiPopulation[i];

    gameState.matchBrains = { player1: brainP1, player2: brainP2 };
    gameState.currentMatchSamples = []; // fresh NN-training sample buffer for this match
    aiBrain = brainP1; // sane default; executeAITurn() repoints this every turn anyway

    console.log(
        `[AI Tournament] New match: [#${aiPopulation.indexOf(brainP1)}] (${brainP1.role}, WR ${(brainWinRate(brainP1) * 100).toFixed(0)}%, gen ${brainP1.generation}) ` +
        `vs [#${aiPopulation.indexOf(brainP2)}] (${brainP2.role}, WR ${(brainWinRate(brainP2) * 100).toFixed(0)}%, gen ${brainP2.generation})`
    );

    initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3);
}

// --- Generational Culling / Breeding ---
// Every AI_MATCHES_PER_GENERATION matches, rank the full population by win rate. The
// top 4 overall become next generation's EXPLOIT cohort (low-mutation refinements of
// what's actually winning - a good explore brain can "graduate" into this group). The
// EXPLORE cohort is re-rolled from the full ranked list every generation with heavy
// mutation, so experimentation never stops even after the exploit side converges.
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
        createBrain(mutateWeights(e.weights, AI_EXPLOIT_MUTATION_RATE, AI_EXPLOIT_MUTATION_STRENGTH), nextGen, 'exploit')
    ));
    for (let i = 0; i < AI_EXPLORE_COUNT; i++) {
        const parent = ranked[Math.floor(Math.random() * ranked.length)];
        newPopulation.push(
            createBrain(mutateWeights(parent.weights, AI_EXPLORE_MUTATION_RATE, AI_EXPLORE_MUTATION_STRENGTH), nextGen, 'explore')
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
// Which tile(s) a unit "occupies" for territorial purposes. Fortified units sit on a
// single tile; everyone else stands on an edge between two tiles.
function getUnitTileKeys(u) {
    if (u.isFortified) return [u.position];
    const edgeCoords = parseEdgeKey(u.position);
    if (!edgeCoords || edgeCoords.length !== 2 || isNaN(edgeCoords[0].q)) return [];
    return [getTileKey(edgeCoords[0].q, edgeCoords[0].r), getTileKey(edgeCoords[1].q, edgeCoords[1].r)];
}

// Radiates positive influence from friendly units and negative influence from enemy
// units across the hex grid, so the AI can reason about *territory and formations*
// instead of only "distance to the single nearest enemy". Archers project further out
// (their threat range), Pikemen radiate more strongly at close range (their defensive
// bite) - matching their actual combat roles rather than treating every unit the same.
function buildInfluenceMap(allAllies, allEnemies) {
    const map = new Map(); // tileKey -> signed influence (+friendly control, -enemy control)

    const radiate = (u, sign) => {
        const sourceTiles = getUnitTileKeys(u);
        if (sourceTiles.length === 0) return;

        let baseStrength = 10;
        let reach = 1; // hex-distance the unit's influence meaningfully reaches
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

    // Exposed for optional debug rendering later (e.g. an overlay in render.js)
    gameState.lastInfluenceMap = map;
    return map;
}

// Sums the influence of the tile(s) touching an edge - this is what move/fortify scoring reads.
function getEdgeInfluence(influenceMap, edgeKey) {
    const coords = parseEdgeKey(edgeKey);
    if (!coords || coords.length !== 2 || isNaN(coords[0].q)) return 0;
    const k1 = getTileKey(coords[0].q, coords[0].r);
    const k2 = getTileKey(coords[1].q, coords[1].r);
    return (influenceMap.get(k1) || 0) + (influenceMap.get(k2) || 0);
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
            const weightA = (aiBrain.weights[`recruit_${a.toLowerCase()}`] || 100) * (1 + (Math.random() * 0.1 - 0.05));
            const weightB = (aiBrain.weights[`recruit_${b.toLowerCase()}`] || 100) * (1 + (Math.random() * 0.1 - 0.05));
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

// --- NN TRAINING PIPELINE (Stage 1): sample buffer + export ---
const AI_TRAINING_DATA_KEY = 'forthex_training_data';
const AI_TRAINING_DATA_MAX_BUFFERED = 20000; // localStorage-safe cap; export regularly to avoid hitting it

// Called every time the AI actually takes an action (not for every candidate it considered -
// just the one it picked). Buffered in memory for the current match only; labeled with the
// outcome and moved to persistent storage once the match resolves.
function logTrainingSample(action) {
    if (!gameState.currentMatchSamples) gameState.currentMatchSamples = [];
    gameState.currentMatchSamples.push({
        player: gameState.currentPlayer,
        actionType: action.type,
        score: action.score,
        features: action.features || {}
    });
}

// Call once a match resolves: labels every sample belonging to `player` with the outcome
// (1 = win, 0 = loss, 0.5 = draw) and appends it to the persistent export buffer.
function finalizeTrainingSamples(player, outcomeLabel) {
    if (!gameState.currentMatchSamples || gameState.currentMatchSamples.length === 0) return;
    const labeled = gameState.currentMatchSamples
        .filter(s => s.player === player)
        .map(s => ({ ...s, outcome: outcomeLabel }));
    if (labeled.length === 0) return;

    let buffer = [];
    try {
        const saved = localStorage.getItem(AI_TRAINING_DATA_KEY);
        if (saved) buffer = JSON.parse(saved);
    } catch (e) { buffer = []; }

    buffer = buffer.concat(labeled);
    if (buffer.length > AI_TRAINING_DATA_MAX_BUFFERED) {
        console.warn(`[AI Training Data] Buffer passed ${AI_TRAINING_DATA_MAX_BUFFERED} samples - trimming oldest. Export soon with exportTrainingData()!`);
        buffer = buffer.slice(buffer.length - AI_TRAINING_DATA_MAX_BUFFERED);
    }

    try {
        localStorage.setItem(AI_TRAINING_DATA_KEY, JSON.stringify(buffer));
    } catch (e) {
        console.error('[AI Training Data] Failed to save (localStorage full?). Export and clear soon.', e);
    }
}

// Console-callable: run `exportTrainingData()` in devtools to download everything collected
// so far as a .jsonl file (one JSON sample per line - the format the Python trainer expects).
// Clears the buffer afterward, so repeated sessions just produce more files to concatenate offline.
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

>>>>>>> Stashed changes
function getUnitAIAction(unit, strategy, allEnemies, allAllies) {
    if (unit.hasPerformedMajorAction) return null;

    let possibleActions = [];

<<<<<<< Updated upstream
=======
    const enemyPlayer = unit.player === 1 ? 2 : 1;
    const enemyBasePos = getBaseCenter(gameState.baseCampPositions[`player${enemyPlayer}`]);
    const myBasePos = getBaseCenter(gameState.baseCampPositions[`player${unit.player}`]);
    const influenceMap = buildInfluenceMap(allAllies, allEnemies);

    // --- ABSOLUTE ADVANTAGE: how far ahead/behind are we right now, in HP and headcount? ---
    // Ranges roughly -1 (crushed) to +1 (dominant). Used to make the AI more aggressive
    // and willing to take risks when it's winning, and more careful/defensive when losing,
    // rather than playing every position with the same fixed risk tolerance.
    const myTotalHP = allAllies.reduce((sum, u) => sum + u.hp, 0);
    const enemyTotalHP = allEnemies.reduce((sum, u) => sum + u.hp, 0);
    const hpAdvantage = (myTotalHP - enemyTotalHP) / Math.max(1, myTotalHP + enemyTotalHP);
    const countAdvantage = (allAllies.length - allEnemies.length) / Math.max(1, allAllies.length + allEnemies.length);
    const absoluteAdvantage = Math.max(-1, Math.min(1, (hpAdvantage + countAdvantage) / 2));

    // --- NN TRAINING PIPELINE (Stage 1): raw feature logging ---
    // Purely additive - doesn't change any scoring or behavior. Captures the state-level
    // context for this unit's decision (same for every action it's considering right now),
    // plus per-action terms that scoreMove/scoreAttack stash into `lastActionFeatures` right
    // before they return. This is the dataset that'll eventually train a network to replace
    // the linear dot-product below with a learned combination.
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

>>>>>>> Stashed changes
    // --- SUB-FUNCTION to score a potential attack ---
    const scoreAttack = (targetInfo) => {
        let score = 50.0;
        let predictedDmg = 0;
        if(targetInfo.unit){
            if(targetInfo.unit.isCarryingFlag) score += 200;
            
<<<<<<< Updated upstream
            // UPDATE: Use mutable stats for damage calculation
            let predictedDmg = unit.stats.damage;
=======
            predictedDmg = unit.stats.damage;
>>>>>>> Stashed changes
            
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
<<<<<<< Updated upstream

            // Kill Priority
            if(targetInfo.unit.hp <= predictedDmg) score += 100;
            
            // Damage Value
            score += predictedDmg * 10;

        } else { 
            // Bridge Attack
            score = 5; 
=======
            if(targetInfo.unit.hp <= predictedDmg) score += aiBrain.weights.atk_secure_kill; 
            score += predictedDmg * aiBrain.weights.atk_damage_multiplier; 
        } else { 
            score = aiBrain.weights.atk_bridge; 
            if (enemyBasePos) {
                const bridgeMid = getEdgeMidpoint(...parseEdgeKey(targetInfo.edgeKey).flatMap(c=>[c.q,c.r]));
                const distToEnemyBase = pointDistance(bridgeMid, enemyBasePos);
                // If the bridge is between us and the enemy, it's worth destroying. Otherwise ignore it.
                if (distToEnemyBase < pointDistance(getUnitScreenPosition(unit), enemyBasePos)) {
                    score += 40.0;
                }
            }
>>>>>>> Stashed changes
        } 
        // Press the advantage when ahead; hold back on marginal attacks when behind.
        score += absoluteAdvantage * 20 * (aiBrain.weights.aggression_scaling || 1) * (aiBrain.weights.press_advantage_weight || 1);

        lastActionFeatures = {
            isBridgeAttack: targetInfo.unit ? 0 : 1,
            targetHpRatio: targetInfo.unit ? targetInfo.unit.hp / Math.max(1, targetInfo.unit.maxHp) : 0,
            predictedDamage: predictedDmg,
            targetIsFlagCarrier: (targetInfo.unit && targetInfo.unit.isCarryingFlag) ? 1 : 0
        };
        return score;
    };

    // --- SUB-FUNCTION to score a potential move ---
    const scoreMove = (edgeKey) => {
<<<<<<< Updated upstream
        let moveScore = 5.0; // Base incentive to not just stand still
=======
        let moveScore = aiBrain.weights.move_base_score; 
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======

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

        // --- 4. INFLUENCE MAP: prefer moving into friendly-controlled territory, avoid enemy-controlled ---
        // This is what stops a lone unit from walking into a wall of enemies - it's not
        // reacting to one nearby unit anymore, it's reading the aggregate territorial pull.
        const destInfluence = getEdgeInfluence(influenceMap, edgeKey);
        moveScore += destInfluence * (aiBrain.weights.influence_map_weight || 1) * 0.5;

        // --- 5. FORMATION STRATEGY: cluster vs. spread out, a learnable per-brain trait ---
        // The influence map above always rewards huddling near allies (that's what makes a
        // tile "safe"). This term is separate: it lets a brain evolve an actual formation
        // *preference* on top of that - some brains learn to mass together, others learn
        // to spread out and threaten from multiple angles - instead of every brain
        // defaulting to the same blob behavior.
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
            // Positive bias = this brain prefers spreading out (crowding is penalized).
            // Negative bias = this brain prefers clustering (crowding is rewarded). 0 = no opinion.
            moveScore -= nearbyAllyCount * (aiBrain.weights.formation_spread_bias || 0);
        }

        // --- 6. ABSOLUTE ADVANTAGE: scale risk tolerance and reward contesting enemy ground ---
        // When we're ahead, threats matter less (we can afford to trade) and pushing into
        // contested/enemy-leaning territory becomes attractive - actively taking ground and
        // "inflicting" a bad position on the opponent rather than always playing it safe.
        // When we're behind, the opposite: threats matter more, so it plays cautiously.
        const advantageFactor = Math.max(-0.6, Math.min(0.6, absoluteAdvantage * (aiBrain.weights.aggression_scaling || 1) * 0.5));
        threatPenalty *= (1 - advantageFactor);

        if (destInfluence < 0) {
            const denialIncentive = Math.max(0, absoluteAdvantage) * Math.abs(destInfluence) *
                (aiBrain.weights.aggression_scaling || 1) * (aiBrain.weights.press_advantage_weight || 1) * 0.3;
            moveScore += denialIncentive;
        }

        moveScore -= threatPenalty;

        lastActionFeatures = {
            destInfluence,
            threatPenalty,
            nearbyAllyCount,
            minDistToEnemy: minDist === Infinity ? -1 : minDist
        };
>>>>>>> Stashed changes
        return moveScore;
    };


    // === ACTION GENERATION ===

    // 1. Actions from CURRENT POSITION (no move)
    if (!unit.isFortified) {
        // ATTACK_ONLY
        const attackTargets = getValidMeleeAttackTargets(unit).concat(getValidArcherAttackTargets(unit));
        attackTargets.forEach(targetInfo => {
            const atkScore = scoreAttack(targetInfo);
            possibleActions.push({ type: 'ATTACK_ONLY', unit, targetInfo, score: atkScore, features: { ...stateFeatures, ...lastActionFeatures, actionType: 'ATTACK_ONLY' } });
        });
<<<<<<< Updated upstream
=======
        
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
                    }
                }
                
                possibleActions.push({ type: 'BUILD_BRIDGE', unit, targetEdgeKey: edgeKey, score, features: { ...stateFeatures, actionType: 'BUILD_BRIDGE' } });
            });
        }

>>>>>>> Stashed changes
        // FORTIFY_ONLY
        if (unit.stats.defense > 0) {
             const edgeCoords = parseEdgeKey(unit.position);
             if (edgeCoords.length === 2 && !isNaN(edgeCoords[0].q)) {
                [getTileKey(edgeCoords[0].q, edgeCoords[0].r), getTileKey(edgeCoords[1].q, edgeCoords[1].r)].forEach(tileKey => {
                    const tile = gameState.tiles.get(tileKey);
<<<<<<< Updated upstream
                    // Check logic for fortification
                    // TODO: Check enemy base tiles if necessary (omitted for brevity in AI)
                    if(tile && tile.type.canFortify && tile.fortifiedByPlayer === null) {
                         let score = 5 - unit.fortifyCooldown;
                         if(strategy === 'IRON_WALL' && unit.type.name === 'Pikeman') score += 25;
                         if(unit.hp < unit.maxHp) score+=20;
                         if(axialDistance(...tileKey.split(',').map(Number),0,0) > 1) score-= 15;
                         if(score > 0) possibleActions.push({ type: 'FORTIFY_ONLY', unit, targetTileKey: tileKey, score });
=======
                    
                    if(tile && tile.type.canFortify && tile.fortifiedByPlayer === null && tileKey !== myFlagTileKey && (!enemyBaseTileKeys.has(tileKey) || tileKey === enemyFlagTileKey)) {
                         let score = aiBrain.weights.fortify_base_score - unit.fortifyCooldown;
                         if(unit.type.name === 'Pikeman') score += aiBrain.weights.fortify_pikeman_bonus; 
                         if(unit.hp < unit.maxHp) score += aiBrain.weights.fortify_heal_bonus; 
                         if(tileKey === enemyFlagTileKey) score += aiBrain.weights.fortify_enemy_flag; 
                         if(axialDistance(...tileKey.split(',').map(Number),0,0) > 1) score -= aiBrain.weights.fortify_distance_penalty;
                         score += (influenceMap.get(tileKey) || 0) * (aiBrain.weights.influence_map_weight || 1) * 0.3;
                         // Behind on HP/headcount -> fortifying (digging in) becomes more attractive.
                         score += Math.max(0, -absoluteAdvantage) * 15 * (aiBrain.weights.aggression_scaling || 1);
                         if(score > 0) possibleActions.push({ type: 'FORTIFY_ONLY', unit, targetTileKey: tileKey, score, features: { ...stateFeatures, actionType: 'FORTIFY_ONLY' } });
>>>>>>> Stashed changes
                    }
                });
             }
        }
    } else { // Unit is fortified
        // UNFORTIFY_ONLY
        const unfortifyTargets = getPotentialUnfortifyTargets(unit);
        if (unfortifyTargets.length > 0) {
<<<<<<< Updated upstream
            let score = (unit.hp >= unit.maxHp && unit.turnsFortified > 2) ? (unit.turnsFortified * 5) : 0;
            if(score > 0) possibleActions.push({ type: 'UNFORTIFY_ONLY', unit, targetEdgeKey: unfortifyTargets[0], score });
=======
            let score = (unit.hp >= unit.maxHp && unit.turnsFortified > 2) ? (unit.turnsFortified * aiBrain.weights.unfortify_full_hp_multiplier) : 0;
            if(score > 0) possibleActions.push({ type: 'UNFORTIFY_ONLY', unit, targetEdgeKey: unfortifyTargets[0], score, features: { ...stateFeatures, actionType: 'UNFORTIFY_ONLY' } });
>>>>>>> Stashed changes
        }
    }

    // 2. Actions AFTER MOVING
    const possibleMoves = getPossibleMoves(unit);
    possibleMoves.forEach((moveData, edgeKey) => {
        const moveScore = scoreMove(edgeKey);
        const moveFeatures = { ...stateFeatures, ...lastActionFeatures, actionType: 'MOVE_ONLY' }; // snapshot now - scoreAttack() below would otherwise clobber lastActionFeatures
        
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
                possibleActions.push({ type: 'MOVE_AND_ATTACK', unit, moveData, targetInfo: bestTarget, score: combinedScore, features: { ...stateFeatures, ...lastActionFeatures, actionType: 'MOVE_AND_ATTACK' } });
            }
        }
        
<<<<<<< Updated upstream
        // MOVE_ONLY is always an option
        possibleActions.push({ type: 'MOVE_ONLY', unit, moveData, score: moveScore });
=======
        possibleActions.push({ type: 'MOVE_ONLY', unit, moveData, score: moveScore, features: moveFeatures });
>>>>>>> Stashed changes
    });
    
    if (possibleActions.length === 0) return null;
    possibleActions.forEach(action => {
        action.score += (Math.random() * 5.0) - 2.5;
    });
    
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

    // Point the active brain at whichever population member is playing this side.
    // Turns are sequential (never concurrent), so a single reassigned global is safe.
    if (gameState.isTrainingMode && gameState.matchBrains) {
        aiBrain = gameState.matchBrains[`player${gameState.currentPlayer}`] || getChampionBrain();
    } else {
        aiBrain = getChampionBrain();
    }

    console.log(`--- AI Turn ${gameState.globalTurnNumber} (Player ${gameState.currentPlayer}) using brain #${aiPopulation.indexOf(aiBrain)} ---`);

    const aiStrategy = 'IRON_WALL'; // Will be dynamic later
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
            console.log("AI has no more possible actions.");
            break;
        }

        const actingUnit = bestActionOverall.unit;
        logTrainingSample(bestActionOverall);
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
<<<<<<< Updated upstream
=======

function evolveBrain(brain, aiVictory, victoryReason, aiPlayerNum, matchHistory) {
    const LEARNING_RATE = 0.05;

    // --- NEW: EFFICIENCY MULTIPLIER ---
    // Max turns is 150. Faster wins = higher multiplier.
    let efficiencyMultiplier = 1.0;
    if (aiVictory) {
        // e.g., Turn 30 / 150 = 0.2. Math.max(0.1, 1.0 - 0.2) = 0.8x learning boost.
        efficiencyMultiplier = Math.max(0.1, 1.0 - (gameState.globalTurnNumber / 50));
    }

    const adjustWeight = (key, increase) => {
        // Apply the efficiency multiplier so fast wins create stronger habits!
        const adjustment = brain.weights[key] * LEARNING_RATE * efficiencyMultiplier;
        brain.weights[key] = clampWeight(brain.weights[key] + (increase ? adjustment : -adjustment));
    };

    console.group(`[AI Brain] Evolving Weights (Brain #${aiPopulation.indexOf(brain)}, Match ${brain.matchesPlayed})`);
    console.log(`Result: ${aiVictory ? "WIN" : "LOSS"} via ${victoryReason}. (Efficiency: ${efficiencyMultiplier.toFixed(2)}x)`);

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
        if (victoryReason.includes('Timeout')) {
            // --- NEW: STALEMATE PUNISHMENT ---
            // If the AI timed out, it was camping. Heavily punish defensive/passive traits.
            console.log("AI timed out/camped. Punishing passive traits.");
            adjustWeight('move_toward_base', true); // Force it forward
            adjustWeight('penalty_zoc', false); // Tell it to stop being so afraid of ZoC
            adjustWeight('move_pikeman_defend', false); // Stop camping at base
            brain.weights.promote_tendency = Math.max(0.0, brain.weights.promote_tendency - 0.05);
        }
        else if (victoryReason.includes('captured the flag')) {
            adjustWeight('move_pikeman_defend', true);
            adjustWeight('move_pikeman_intercept', true);
            adjustWeight('atk_flag_carrier', true); 
            adjustWeight('move_toward_base', false); 
            adjustWeight('build_bridge_forward', false); 
        } 
        else if (victoryReason.includes('Annihilation')) {
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
        brain.weights.promote_tendency = Math.min(1.0, brain.weights.promote_tendency + 0.02);
    } else if (!aiVictory && upgradeRatio > 0.05) {
        brain.weights.promote_tendency = Math.max(0.0, brain.weights.promote_tendency - 0.02);
    }

    console.log("New Brain Weights:", brain.weights);
    console.groupEnd();

    // =========================================================
    // --- 5. "GOSPEL" IMITATION LEARNING (Learn from Human) ---
    // =========================================================
    
    // We ONLY want to copy the opponent if it's a real human, not during AI-vs-AI training
    if (!gameState.isTrainingMode) {
        console.log("[AI] Analyzing Human 'Gospel' Gameplay...");
        
        // Identify the human's player number
        const humanPlayerNum = aiPlayerNum === 1 ? 2 : 1;
        
        // Gospel Rate: 15% shift per game (3x faster than normal learning)
        // If the human beat the AI, make the AI copy the human EVEN HARDER (25% shift)
        const GOSPEL_RATE = aiVictory ? 0.15 : 0.25; 

        let humanClassUsage = { MELEE: 0, ARCHER: 0, PIKEMAN: 0, HORSEMAN: 0 };
        let humanUpgrades = 0;
        let humanBridgeBuilds = 0;
        let humanBridgeAttacks = 0;
        let humanActionCount = 0;

        // Parse the ledger to see exactly what the human did
        matchHistory.forEach(action => {
            if (action.player === humanPlayerNum) {
                humanActionCount++;
                
                // Track which units the human prefers to use
                if (action.actorId) {
                    const unitClass = action.actorId.split('_')[2]; // Extracts 'MELEE' from 'u_p1_MELEE_t1_1'
                    if (humanClassUsage[unitClass] !== undefined) {
                        humanClassUsage[unitClass]++;
                    }
                }

                // Track human tactical quirks
                if (action.type === 'UNIT_UPGRADE') humanUpgrades++;
                if (action.type === 'BUILD_BRIDGE') humanBridgeBuilds++;
                if (action.type === 'ATTACK' && action.payload && action.payload.targetType === 'BRIDGE') humanBridgeAttacks++;
            }
        });

        if (humanActionCount > 0) {
            // 1. Copy Human Army Composition
            ['MELEE', 'ARCHER', 'PIKEMAN', 'HORSEMAN'].forEach(unitClass => {
                const usagePercentage = humanClassUsage[unitClass] / humanActionCount;
                
                // If the human uses a unit heavily (> 20% of their total actions), treat it as Gospel
                if (usagePercentage > 0.20) {
                    const weightKey = `recruit_${unitClass.toLowerCase()}`;
                    brain.weights[weightKey] = clampWeight(brain.weights[weightKey] + brain.weights[weightKey] * GOSPEL_RATE);
                    console.log(`[Imitation] Human heavily utilizes ${unitClass}. Ramping up recruitment weight.`);
                }
            });

            // 2. Copy Human Veterancy Strategy
            const promoteRate = humanUpgrades / humanActionCount;
            if (promoteRate > 0.05) {
                // Human likes to promote units. Copy them!
                brain.weights.promote_tendency = Math.min(1.0, brain.weights.promote_tendency + 0.05);
                console.log(`[Imitation] Human relies on Veterans. Increasing AI promote tendency.`);
            }

            // 3. Copy Human Bridge Mechanics
            if (humanBridgeBuilds > 0) {
                brain.weights.build_bridge_base = clampWeight(brain.weights.build_bridge_base + brain.weights.build_bridge_base * GOSPEL_RATE);
                brain.weights.build_bridge_forward = clampWeight(brain.weights.build_bridge_forward + brain.weights.build_bridge_forward * GOSPEL_RATE);
                console.log(`[Imitation] Human utilizes bridges. AI will now build more bridges.`);
            }
            if (humanBridgeAttacks > 0) {
                brain.weights.atk_bridge = clampWeight(brain.weights.atk_bridge + brain.weights.atk_bridge * GOSPEL_RATE);
                console.log(`[Imitation] Human attacks bridges. AI will now prioritize breaking bridges.`);
            }
        }
    }
    // =========================================================

    console.log("Final Evolved Brain Weights:", brain.weights);
    console.groupEnd();

    saveAIBrain();
}
>>>>>>> Stashed changes
