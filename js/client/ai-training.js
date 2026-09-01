// === AI Training Simulator (moved from main.js — A1 step 12) ===
//
// The headless AI-vs-AI training loop. Client-side for A1 on purpose: it drives
// the population machinery in ai.js, which is localStorage-backed (guide §7),
// and it orchestrates whole matches rather than being part of the rules.
// engine.state.isTrainingMode is engine-owned, though - it changes the victory
// rule (30-turn cap), so the server has to know about it.

//  AI TRAINING SIMULATOR FUNCTIONS

function abortTrainingMode() {
    if (!engine.state.isTrainingMode) return;

    console.log("--- TRAINING SIMULATION ABORTED BY USER ---");
    engine.state.isTrainingMode = false;
    engine.state.gameOver = true; // Kills the execution loop
    document.getElementById('trainingBanner').style.display = 'none';

    const blocker = document.getElementById('trainingInteractionBlocker');
    if (blocker) blocker.style.display = 'none';

    showInstruction("Training Aborted. Brain Saved.", 3000);
    if (typeof saveAIBrain === 'function') saveAIBrain();

    // --- PROPER SETTINGS RESTORATION & DOM SYNC ---
    if (gameState.preTrainingSettings) {
        // Restore Backend Logic
        engine.settings.animationsEnabled = gameState.preTrainingSettings.animations;
        gameSettings.fancyVisualsEnabled = gameState.preTrainingSettings.fancy;
        gameSettings.passTurnConfirmationEnabled = gameState.preTrainingSettings.passTurn;
        gameSettings.tooltipsEnabled = gameState.preTrainingSettings.tooltips;

        // Restore Frontend HTML Checkboxes to match
        const chkAnim = document.getElementById('settingAnimations');
        const chkFancy = document.getElementById('settingFancyVisuals');
        const chkPass = document.getElementById('settingPassTurnConfirmation');
        const chkTooltips = document.getElementById('settingTooltips');

        if (chkAnim) chkAnim.checked = engine.settings.animationsEnabled;
        if (chkFancy) chkFancy.checked = gameSettings.fancyVisualsEnabled;
        if (chkPass) chkPass.checked = gameSettings.passTurnConfirmationEnabled;
        if (chkTooltips) chkTooltips.checked = gameSettings.tooltipsEnabled;
    } else {
        loadSettings(); // Fallback if data is missing
    }

    // Full Board Sanitization
    setTimeout(() => { 
        engine.state.gameMode = 'local';
        engine.state.playerSide = null;
        engine.state.gameOver = false;

        clearSelectionAndDebugState(); 
        initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3);

        const modal = document.getElementById('gameMenuModal');
        document.getElementById('mainMenuContent').style.display = 'block';
        document.getElementById('singleplayerMenuContent').style.display = 'none';
        document.getElementById('multiplayerMenuContent').style.display = 'none';
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('modal-visible'), 10);
        }
    }, 100); 
}

async function runTrainingHyperLoop() {
    const banner = document.getElementById('trainingBanner');
    let epochCounter = 0;

    // Inject the HTML for the banner including the Touch STOP button
    if (banner) {
        banner.innerHTML = `
            AI TOURNAMENT TRAINING ACTIVE  <br> 
            Generation: <span id="trainGenCount" style="color: #2ecc71;">0</span> |
            Champion WR: <span id="trainChampWR" style="color: #2ecc71;">--%</span> |
            Turns: <span id="trainTurnCount">0</span> <br>
            <span id="trainPopSummary" style="font-size: 0.75em; opacity: 0.85;"></span> <br>
            <button id="abortTrainingBtn" style="margin-top: 10px; padding: 6px 20px; background: #FFC020; color: #182830; border: none; border-radius: 5px; font-weight: bold; font-family: 'Exo 2', sans-serif; cursor: pointer; box-shadow: 0 3px #C09000;">STOP TRAINING</button>
            <div style="font-size: 0.8em; margin-top: 5px;">(Or press Alt + X)</div>
        `;
        // Bind the button to the abort function
        document.getElementById('abortTrainingBtn').addEventListener('click', abortTrainingMode);
    }

    while (engine.state.isTrainingMode) {
        // Run 5 turns instantly without letting the browser breathe
        for (let i = 0; i < 5; i++) {
            if (!engine.state.isTrainingMode) break;

            if (engine.state.gameOver) {
                engine.state.gameOver = false;
                startNewTrainingMatch();
            } else {
                await executeAITurn();
            }
        }

        epochCounter += 5;

        // Only update text nodes to avoid destroying the button
        if (banner && engine.state.isTrainingMode && aiPopulation) {
            const champion = getChampionBrain();
            const genEl = document.getElementById('trainGenCount');
            const wrEl = document.getElementById('trainChampWR');
            const turnCountEl = document.getElementById('trainTurnCount');
            const popEl = document.getElementById('trainPopSummary');

            if (genEl) genEl.textContent = champion.generation;
            if (wrEl) wrEl.textContent = `${(brainWinRate(champion) * 100).toFixed(0)}% (${champion.wins}W/${champion.matchesPlayed}G)`;
            if (turnCountEl) turnCountEl.textContent = epochCounter;
            if (popEl) {
                const summary = aiPopulation
                    .map((b, idx) => `#${idx}:${(brainWinRate(b) * 100).toFixed(0)}%`)
                    .join(' &nbsp;');
                popEl.innerHTML = summary;
            }
        }

        // Yield to the browser for 1 tick so the tab doesn't freeze
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

function startTrainingMode() {
    exitMapMakerMode(); 
    hideAllModals(); 

    engine.state.isTrainingMode = true;
    engine.state.gameMode = 'singleplayer';
    engine.state.playerSide = null; // Setting to null means BOTH players are AI

    // --- PROPER SETTINGS BACKUP & OVERRIDE ---
    // 1. Backup all configurable settings
    gameState.preTrainingSettings = {
        animations: engine.settings.animationsEnabled,
        fancy: gameSettings.fancyVisualsEnabled,
        passTurn: gameSettings.passTurnConfirmationEnabled,
        tooltips: gameSettings.tooltipsEnabled
    };

    // 2. Override internal game logic for max performance
    engine.settings.animationsEnabled = false;
    gameSettings.fancyVisualsEnabled = false;
    gameSettings.passTurnConfirmationEnabled = false;
    gameSettings.tooltipsEnabled = false;

    // 3. Uncheck the physical HTML toggles so the UI reflects the override
    const chkAnim = document.getElementById('settingAnimations');
    const chkFancy = document.getElementById('settingFancyVisuals');
    const chkPass = document.getElementById('settingPassTurnConfirmation');
    const chkTooltips = document.getElementById('settingTooltips');

    if (chkAnim) chkAnim.checked = false;
    if (chkFancy) chkFancy.checked = false;
    if (chkPass) chkPass.checked = false;
    if (chkTooltips) chkTooltips.checked = false;

    document.getElementById('trainingBanner').style.display = 'block';

    // --- INTERACTION BLOCKER ---
    let blocker = document.getElementById('trainingInteractionBlocker');
    if (!blocker) {
        blocker = document.createElement('div');
        blocker.id = 'trainingInteractionBlocker';
        blocker.style.position = 'fixed';
        blocker.style.top = '0';
        blocker.style.left = '0';
        blocker.style.width = '100vw';
        blocker.style.height = '100vh';
        blocker.style.zIndex = '9000'; 
        blocker.style.backgroundColor = 'rgba(0,0,0,0.1)'; 
        blocker.style.cursor = 'not-allowed';
        blocker.addEventListener('click', (e) => { e.stopPropagation(); });
        document.body.appendChild(blocker);
    }
    blocker.style.display = 'block';

    engine.state.gridRadius = 3;
    gameState.renderScale = 1.0;
    gameState.renderOffset = { x: 0, y: 0 };
    startNewTrainingMatch(); // picks the first tournament pairing and initializes the grid

    console.log("--- TRAINING SIMULATION STARTED ---");

    runTrainingHyperLoop();
}
