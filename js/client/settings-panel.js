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

// Settings stays vanilla DOM — B4 adopts React for NEW screens and explicitly does
// not retrofit working modals. What changed in B1 is only who opens it.
//
// The old handler faded the menu out, waited 350ms, then faded settings in, and the
// Back button reversed that. None of it is needed now: .modal-overlay sits at
// z-index 3000 and the React menu at 900, so the modal simply covers it and the menu
// is still there underneath when it closes. That also removes the failure mode where
// a mistimed Back left the player looking at neither.
function OpenSettingsModal() {
    clearSelectionAndDebugState();

    const settingsModal = document.getElementById('settingsModal');
    if (!settingsModal) return;

    settingsModal.style.display = 'flex';
    setTimeout(() => settingsModal.classList.add('modal-visible'), 10);
}

function CloseSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    if (!settingsModal) return;

    settingsModal.classList.remove('modal-visible');
    setTimeout(() => { settingsModal.style.display = 'none'; }, 300);
}

function WireSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');

    document.getElementById('settingsBackButton').addEventListener('click', CloseSettingsModal);
    settingsModal.addEventListener('click', (e) => {
        if (e.target.id === 'settingsModal') CloseSettingsModal();
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

    if (gameSettings.debugModeEnabled) {
        consoleModal.style.display = 'flex';
        // Reset position to top-right default on load
        consoleModal.style.top = '10px';
        consoleModal.style.right = '10px';
        consoleModal.style.left = 'auto';

        toggleCalibrationCard(true); 
    } else {
        consoleModal.style.display = 'none';

        toggleCalibrationCard(false);
    }

    debugModeCheckbox.addEventListener('change', (e) => {
        gameSettings.debugModeEnabled = e.target.checked;
        saveSettings();

        if (!gameSettings.debugModeEnabled) {
            clearSelectionAndDebugState(); 
            consoleModal.style.display = 'none';
            toggleCalibrationCard(false); 
        } else {
            consoleModal.style.display = 'flex';
            consoleModal.style.top = '10px';
            consoleModal.style.right = '10px';
            consoleModal.style.left = 'auto';
            toggleCalibrationCard(true);
        }
        console.log(`Debug Mode: ${gameSettings.debugModeEnabled ? 'ON' : 'OFF'}`);
    });
}
