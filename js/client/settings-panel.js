// === Settings panel wiring (moved from main.js — A1 step 12) ===
//
// The settings modal and every control inside it. Note which side each setting
// is read from and written to: animationsEnabled and fogOfWarEnabled live on
// engine.settings (they change server behaviour), the rest are client
// presentation prefs on gameSettings. saveSettings() persists both.

function SyncSettingControls() {

    // Sync UI checkboxes safely to match the loaded settings
    const elAnim = document.getElementById('settingAnimations');
    if (elAnim) elAnim.checked = engine.settings.animationsEnabled;

    const elFancy = document.getElementById('settingFancyVisuals');
    if (elFancy) elFancy.checked = gameSettings.fancyVisualsEnabled;

    const elPass = document.getElementById('settingPassTurnConfirmation');
    if (elPass) elPass.checked = gameSettings.passTurnConfirmationEnabled;

    const elTool = document.getElementById('settingTooltips');
    if (elTool) elTool.checked = gameSettings.tooltipsEnabled;

    const elFog = document.getElementById('settingFogOfWar');
    if (elFog) elFog.checked = engine.settings.fogOfWarEnabled;

    const elBlur = document.getElementById('settingPassDeviceBlur');
    if (elBlur) {
        elBlur.checked = gameSettings.passDeviceBlurEnabled;
        elBlur.disabled = !engine.settings.fogOfWarEnabled;
    }
}

function WireSettingsModal() {
    const settingsButton = document.getElementById('settingsButton');
    const settingsModal = document.getElementById('settingsModal');
    const settingsBackButton = document.getElementById('settingsBackButton');
    const gameMenuModal = document.getElementById('gameMenuModal');

    settingsButton.addEventListener('click', () => {
        clearSelectionAndDebugState();
        if (gameMenuModal) {
            gameMenuModal.classList.remove('modal-visible');
            setTimeout(() => { gameMenuModal.style.display = 'none'; }, 300);
        }
        if (settingsModal) {
            setTimeout(() => {
                settingsModal.style.display = 'flex';
                setTimeout(() => settingsModal.classList.add('modal-visible'), 10);
            }, 350);
        }
    });

    settingsBackButton.addEventListener('click', () => {
        if (settingsModal) {
            settingsModal.classList.remove('modal-visible');
            setTimeout(() => { settingsModal.style.display = 'none'; }, 300);
        }
        if (gameMenuModal) {
             setTimeout(() => {
                gameMenuModal.style.display = 'flex';
                setTimeout(() => gameMenuModal.classList.add('modal-visible'), 10);
            }, 350);
        }
    });

    settingsModal.addEventListener('click', (e) => {
        if (e.target.id === 'settingsModal') {
            const modal = e.target;
            modal.classList.remove('modal-visible');
            setTimeout(() => modal.style.display = 'none', 300);
        }
    });
}

function WireSettingControls() {
    const gameWrapper = document.getElementById('gameWrapper');
    const animationsCheckbox = document.getElementById('settingAnimations');
    const passTurnCheckbox = document.getElementById('settingPassTurnConfirmation');
    const fancyVisualsCheckbox = document.getElementById('settingFancyVisuals');
    const tooltipsCheckbox = document.getElementById('settingTooltips');
    const fogOfWarCheckbox = document.getElementById('settingFogOfWar'); 
    const passDeviceBlurCheckbox = document.getElementById('settingPassDeviceBlur'); 
    const uiScaleSlider = document.getElementById('settingUiScale');
    const uiScaleValueLabel = document.getElementById('uiScaleValueLabel');

    function applyUiScale() {
        uiScaleSlider.value = gameSettings.uiScale;
        uiScaleValueLabel.textContent = `${Math.round(gameSettings.uiScale * 100)}%`;
        gameWrapper.style.transform = `scale(${gameSettings.uiScale})`;
    }

    // Sync settings logic
    animationsCheckbox.checked = engine.settings.animationsEnabled;
    passTurnCheckbox.checked = gameSettings.passTurnConfirmationEnabled;
    fancyVisualsCheckbox.checked = gameSettings.fancyVisualsEnabled;
    tooltipsCheckbox.checked = gameSettings.tooltipsEnabled;
    fogOfWarCheckbox.checked = engine.settings.fogOfWarEnabled; 
    passDeviceBlurCheckbox.checked = gameSettings.passDeviceBlurEnabled;
    applyUiScale(); 

    animationsCheckbox.addEventListener('change', (e) => {
        engine.settings.animationsEnabled = e.target.checked;
        saveSettings();
        gameState.needsRedraw = true;
    });

    passTurnCheckbox.addEventListener('change', (e) => {
        gameSettings.passTurnConfirmationEnabled = e.target.checked;
        saveSettings();
    });

    fancyVisualsCheckbox.addEventListener('change', (e) => {
        gameSettings.fancyVisualsEnabled = e.target.checked;
        saveSettings();
        gameState.needsRedraw = true;
    });

    tooltipsCheckbox.addEventListener('change', (e) => {
        gameSettings.tooltipsEnabled = e.target.checked;
        saveSettings();
    });

    if (fogOfWarCheckbox) {
        fogOfWarCheckbox.addEventListener('change', (e) => {
            engine.settings.fogOfWarEnabled = e.target.checked;

            if (passDeviceBlurCheckbox) {
                passDeviceBlurCheckbox.disabled = !engine.settings.fogOfWarEnabled;
                if (!engine.settings.fogOfWarEnabled) {
                    gameSettings.passDeviceBlurEnabled = false;
                    passDeviceBlurCheckbox.checked = false;
                }
            }

            saveSettings();
            engine.visionDirty = true; 
            gameState.needsRedraw = true; 
        });
    }

    passDeviceBlurCheckbox.addEventListener('change', (e) => {
        gameSettings.passDeviceBlurEnabled = e.target.checked;
        saveSettings();
    });

    uiScaleSlider.addEventListener('input', (e) => {
        const scaleValue = parseFloat(e.target.value);
        gameSettings.uiScale = scaleValue;
        applyUiScale(); 
        saveSettings(); 
        gameState.needsRedraw = true;
    });

    // --- Debug Mode Toggle ---
    const debugModeCheckbox = document.getElementById('settingDebugMode');
    debugModeCheckbox.checked = gameSettings.debugModeEnabled;

    // Set initial console visibility based on loaded settings
    const consoleModal = document.getElementById('debugConsoleModal');
    const trainingBtn = document.getElementById('trainingModeButton'); // <-- ADD THIS

    if (gameSettings.debugModeEnabled) {
        consoleModal.style.display = 'flex';
        // Reset position to top-right default on load
        consoleModal.style.top = '10px';
        consoleModal.style.right = '10px';
        consoleModal.style.left = 'auto';

        toggleCalibrationCard(true); 
        if (trainingBtn) trainingBtn.style.display = 'block'; // <-- ADD THIS
    } else {
        consoleModal.style.display = 'none';

        toggleCalibrationCard(false);
        if (trainingBtn) trainingBtn.style.display = 'none'; // <-- ADD THIS
    }

    debugModeCheckbox.addEventListener('change', (e) => {
        gameSettings.debugModeEnabled = e.target.checked;
        saveSettings();
        const trainingBtn = document.getElementById('trainingModeButton'); 

        if (!gameSettings.debugModeEnabled) {
            clearSelectionAndDebugState(); 
            consoleModal.style.display = 'none';
            toggleCalibrationCard(false); 
            if(trainingBtn) trainingBtn.style.display = 'none'; 
        } else {
            consoleModal.style.display = 'flex';
            consoleModal.style.top = '10px';
            consoleModal.style.right = '10px';
            consoleModal.style.left = 'auto';
            toggleCalibrationCard(true);
            if(trainingBtn) trainingBtn.style.display = 'block'; 
        }
        console.log(`Debug Mode: ${gameSettings.debugModeEnabled ? 'ON' : 'OFF'}`);
    });
}
