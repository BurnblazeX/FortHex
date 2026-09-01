

        ui.fortifyUnfortifyButton.addEventListener('click', handleFortifyUnfortifyButtonClick);
        ui.buildBridgeButton.addEventListener('click', handleBuildBridgeAction);
        ui.attackButton.addEventListener('click', handleAttackAction);








ui.endTurnButton.addEventListener('click', () => {
    if (gameState.mapMakerMode) {
        // --- Clear Map Functionality ---
        document.getElementById('customConfirmMessage').textContent = 'Are you sure you want to clear the entire map? This cannot be undone.';
        currentConfirmAction = clearMapForMaker;
        
        if (ui.customConfirmModal) {
            ui.customConfirmModal.style.display = 'flex';
            setTimeout(() => ui.customConfirmModal.classList.add('modal-visible'), 10);
        }
    } else {
        // --- Original End Turn Functionality ---
        const playerHasActed = gameState.playerActionTaken[`player${gameState.currentPlayer}`];

        if (playerHasActed || !gameSettings.passTurnConfirmationEnabled || gameState.gameOver) {
            proceedToEndTurn();
        } else {
            document.getElementById('customConfirmMessage').textContent = 'You have not performed any actions. Are you sure you want to end your turn?';
            currentConfirmAction = proceedToEndTurn;
            
            if (ui.customConfirmModal) {
                ui.customConfirmModal.style.display = 'flex';
                setTimeout(() => ui.customConfirmModal.classList.add('modal-visible'), 10);
            }
        }
    }
});

document.getElementById('customMapButton').addEventListener('click', () => {
    hideNewMapModal();

    if (gameState.mapMakerMode) {
        setTimeout(() => {
            exitMapMakerMode();
            resizeMapGrid(3); 
            initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3); 
            showInstruction("New Local Multiplayer game started.", 3000);
        }, 350); 
    } else {
        setTimeout(() => {
            enterMapMakerMode();
        }, 350);
    }
});

document.getElementById('selectMapButton').addEventListener('click', showSelectMapView);

document.getElementById('newMapButton').addEventListener('click', () => {
    const generateButton = document.getElementById('generateMapFromModalButton');
    const customMapButton = document.getElementById('customMapButton');

    if (gameState.mapMakerMode || gameState.gameMode === 'singleplayer') {
        generateButton.disabled = true;
    } else {
        generateButton.disabled = false;
    }

    if (gameState.mapMakerMode) {
        customMapButton.textContent = 'Return to Game';
        customMapButton.classList.add('return-to-game-button');
    } else {
        customMapButton.textContent = 'Custom Map';
        customMapButton.classList.remove('return-to-game-button');
    }
    showNewMapModal();
});

const newMapModalOverlay = document.getElementById('newMapModal');
newMapModalOverlay.addEventListener('click', (event) => {
    if (event.target === newMapModalOverlay) {
        hideNewMapModal();
    }
});

document.getElementById('newMapModalCloseButton').addEventListener('click', hideNewMapModal);

document.getElementById('generateMapFromModalButton').addEventListener('click', () => {
    hideNewMapModal();

    const confirmModal = document.getElementById('customConfirmModal');
    const confirmMessage = document.getElementById('customConfirmMessage');
    const okButton = document.getElementById('customConfirmOkButton');
    const cancelButton = document.getElementById('customConfirmCancelButton');

    confirmMessage.textContent = 'Are you sure you want to generate a new map? This will reset the current game.';

    const onConfirm = () => {
        handleGenerateNewMap();
        confirmModal.classList.remove('modal-visible');
        setTimeout(() => confirmModal.style.display = 'none', 300);
        okButton.removeEventListener('click', onConfirm);
        cancelButton.removeEventListener('click', onCancel);
    };

    const onCancel = () => {
        confirmModal.classList.remove('modal-visible');
        setTimeout(() => confirmModal.style.display = 'none', 300);
        setTimeout(() => { showNewMapModal(); }, 350);
        okButton.removeEventListener('click', onConfirm);
        cancelButton.removeEventListener('click', onCancel);
    };

    okButton.addEventListener('click', onConfirm, { once: true });
    cancelButton.addEventListener('click', onCancel, { once: true });

    if (confirmModal) {
        confirmModal.style.display = 'flex';
        setTimeout(() => confirmModal.classList.add('modal-visible'), 10);
    }
});

ui.customConfirmOkButton.addEventListener('click', () => {
    if (ui.customConfirmModal) {
        ui.customConfirmModal.classList.remove('modal-visible');
        setTimeout(() => ui.customConfirmModal.style.display = 'none', 300); 
    }
    if (typeof currentConfirmAction === 'function') {
        currentConfirmAction();
        currentConfirmAction = null; 
    }
    currentCancelAction = null; 
});

ui.customConfirmCancelButton.addEventListener('click', () => {
     if (ui.customConfirmModal) {
        ui.customConfirmModal.classList.remove('modal-visible');
        setTimeout(() => ui.customConfirmModal.style.display = 'none', 300); 
    }
    if (typeof currentCancelAction === 'function') {
        currentCancelAction();
        currentCancelAction = null;
    }
});

document.getElementById('saveGameButton').addEventListener('click', () => {
    if (gameState.mapMakerMode) {
        const mapData = createMapDataObject();
        const mapString = JSON.stringify(mapData, null, 2);
        const blob = new Blob([mapString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `FortHex-Map-${Date.now()}.fhmap`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showInstruction("Map file saved!", 2500);
    } else {
        saveGameToFile();
    }
});

document.getElementById('loadGameButton').addEventListener('click', () => {
    fileLoadContext = gameState.mapMakerMode ? 'edit_map' : 'game_save';
    showLoadGameModal();
});

// PWA INSTALLATION LOGIC (Replaces old HTML download)
let deferredPrompt;

// 1. Catch the install prompt from the browser
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Prevent Chrome's default mini-infobar
    deferredPrompt = e; // Stash the event so we can trigger it later
    ui.downloadButton.style.display = 'flex'; // Show the button!
});

// 2. Bind the new install functionality to your Download Button
ui.downloadButton.addEventListener('click', async () => {
    if (!deferredPrompt) {
        showInstruction("App cannot be installed right now.", 2000);
        return;
    }
    // Show the native browser install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        console.log('User installed FortHex');
        showInstruction('FortHex installed successfully!', 3000);
    }
    
    // We've used the prompt, throw it away and hide the button
    deferredPrompt = null;
    ui.downloadButton.style.display = 'none';
});

// 3. Hide button immediately if they install it successfully
window.addEventListener('appinstalled', () => {
    ui.downloadButton.style.display = 'none';
    deferredPrompt = null;
});

// 4. Register the Service Worker (Required for PWA to work)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('Service Worker Registration Failed:', err);
        });
    });
}

if (ui.tutorialButton) {
    ui.tutorialButton.addEventListener('click', () => {
        if (ui.tutorialModalOverlay) {
            ui.tutorialModalOverlay.style.display = 'flex'; 
            setTimeout(() => {
                ui.tutorialModalOverlay.classList.add('modal-visible');
            }, 10); 
        }
    });
}

function closeTutorialModal() {
    if (ui.tutorialModalOverlay) {
        ui.tutorialModalOverlay.classList.remove('modal-visible');
        setTimeout(() => {
            ui.tutorialModalOverlay.style.display = 'none';
        }, 300); 
    }
}

if (ui.tutorialCloseButton) {
    ui.tutorialCloseButton.addEventListener('click', closeTutorialModal);
}
if (ui.tutorialModalOverlay) {
    ui.tutorialModalOverlay.addEventListener('click', (event) => {
        if (event.target === ui.tutorialModalOverlay) { 
            closeTutorialModal();
        }
    });
}

if (ui.tutorialSectionHeaders) {
    ui.tutorialSectionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const arrow = header.querySelector('.tutorial-arrow');
            const isActive = header.classList.contains('active');

            ui.tutorialSectionHeaders.forEach(otherHeader => {
                if (otherHeader !== header) {
                    otherHeader.classList.remove('active');
                    otherHeader.nextElementSibling.classList.remove('open');
                    const otherArrow = otherHeader.querySelector('.tutorial-arrow');
                    if (otherArrow) otherArrow.innerHTML = '&#9658;'; 
                }
            });

            if (isActive) {
                header.classList.remove('active');
                content.classList.remove('open');
                if (arrow) arrow.innerHTML = '&#9658;'; 
            } else {
                header.classList.add('active');
                content.classList.add('open');
                if (arrow) arrow.innerHTML = '&#9660;'; 
            }
        });
    });
}

// CANVAS EVENT LISTENERS (CRITICAL)
canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('mousedown', handleCanvasMouseDown);
canvas.addEventListener('mousemove', handleCanvasMouseMove);
canvas.addEventListener('mouseup', handleCanvasMouseUp);
window.addEventListener('mouseup', handleCanvasMouseUp);
canvas.addEventListener('mouseleave', handleCanvasMouseLeave);
canvas.addEventListener('touchstart', handleCanvasTouchStart, { passive: false });
canvas.addEventListener('touchmove', handleCanvasTouchMove, { passive: false });
canvas.addEventListener('touchend', handleCanvasTouchEnd);
canvas.addEventListener('touchcancel', handleCanvasTouchCancel);
canvas.addEventListener('contextmenu', (event) => {
    if (gameState.mapMakerMode) {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const { x, y } = getRelativeCoordinates(event.clientX, event.clientY); 
        eraseAt(x, y);

    }
});

        window.onload = function () {
        
            // --- Initialize Debug Console System Immediately ---
            setupDebugConsoleSystem();

            document.getElementById('saveGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Game`;
            document.getElementById('loadGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Load Game`;
            document.getElementById('buildVersionDisplay').textContent = `FortHex Build ${BUILD_VERSION}`;
            
            loadSettings(); 
            loadColorPreferences(); 

            // Sync UI checkboxes safely to match the loaded settings
            const elAnim = document.getElementById('settingAnimations');
            if (elAnim) elAnim.checked = gameSettings.animationsEnabled;
            
            const elFancy = document.getElementById('settingFancyVisuals');
            if (elFancy) elFancy.checked = gameSettings.fancyVisualsEnabled;
            
            const elPass = document.getElementById('settingPassTurnConfirmation');
            if (elPass) elPass.checked = gameSettings.passTurnConfirmationEnabled;
            
            const elTool = document.getElementById('settingTooltips');
            if (elTool) elTool.checked = gameSettings.tooltipsEnabled;

            const elFog = document.getElementById('settingFogOfWar');
            if (elFog) elFog.checked = gameSettings.fogOfWarEnabled;

            const elBlur = document.getElementById('settingPassDeviceBlur');
            if (elBlur) {
                elBlur.checked = gameSettings.passDeviceBlurEnabled;
                elBlur.disabled = !gameSettings.fogOfWarEnabled;
            }

            // --- Connection Status Indicator ---
            const connectionIcon = document.getElementById('connectionStatusIcon');

            function updateConnectionStatus() {
                if (navigator.onLine) {
                    connectionIcon.classList.remove('status-offline');
                    connectionIcon.classList.add('status-online');
                } else {
                    connectionIcon.classList.remove('status-online');
                    connectionIcon.classList.add('status-offline');
                }
            }

            window.addEventListener('online', updateConnectionStatus);
            window.addEventListener('offline', updateConnectionStatus);

            // Set initial state on load
            updateConnectionStatus();

            // --- Main Menu System Listeners ---
            document.getElementById('gameIconLink').addEventListener('click', (event) => {
                event.preventDefault(); 
                document.getElementById('customConfirmMessage').textContent = 'Are you sure you want to restart? Any unsaved progress will be lost.';
                currentConfirmAction = () => {
                    location.reload();
                };
                if (ui.customConfirmModal) {
                    ui.customConfirmModal.style.display = 'flex';
                    setTimeout(() => ui.customConfirmModal.classList.add('modal-visible'), 10);
                }
            });

            document.getElementById('gameMenuTrigger').addEventListener('click', () => {
                clearSelectionAndDebugState(); // Clear state when opening menu
                const modal = document.getElementById('gameMenuModal');
                document.getElementById('mainMenuContent').style.display = 'block';
                document.getElementById('singleplayerMenuContent').style.display = 'none';
                document.getElementById('multiplayerMenuContent').style.display = 'none';
                modal.style.display = 'flex';
                setTimeout(() => modal.classList.add('modal-visible'), 10);
            });

            const mainMenuContent = document.getElementById('mainMenuContent');
            const spMenuContent = document.getElementById('singleplayerMenuContent');
            const mpMenuContent = document.getElementById('multiplayerMenuContent');

            document.getElementById('singleplayerButton').addEventListener('click', () => {
                mainMenuContent.style.display = 'none';
                spMenuContent.style.display = 'block';
            });

            document.getElementById('multiplayerButton').addEventListener('click', () => {
                mainMenuContent.style.display = 'none';
                mpMenuContent.style.display = 'block';
            });

            document.getElementById('playAsBlueButton').addEventListener('click', () => startSingleplayerGame(1));
            document.getElementById('playAsRedButton').addEventListener('click', () => startSingleplayerGame(2));
            document.getElementById('trainingModeButton').addEventListener('click', startTrainingMode);

            document.getElementById('localMultiplayerButton').addEventListener('click', () => {
                // First, completely exit the map maker mode, which restores the UI.
                exitMapMakerMode(); 
                
                // Then, hide the menu modal.
                hideAllModals();
                
                gameState.gameMode = 'local';
                gameState.playerSide = null;

                // --- FIX: Reset Map Dimensions for Standard Play ---
                gameState.gridRadius = 3;
                gameState.renderScale = 1.0;
                gameState.renderOffset = { x: 0, y: 0 };
                // ---------------------------------------------------

                // Finally, initialize the new game grid.
                initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3); 
                
                // The initializeGrid function calls updateTurnDisplay, which will now
                // correctly set the canvas border for Player 1.
                showInstruction("New Local Multiplayer game started.", 3000);
            });

            document.getElementById('backToMainMenuButtonSP').addEventListener('click', () => {
                spMenuContent.style.display = 'none';
                mainMenuContent.style.display = 'block';
            });
            document.getElementById('backToMainMenuButtonMP').addEventListener('click', () => {
                mpMenuContent.style.display = 'none';
                mainMenuContent.style.display = 'block';
            });

            document.getElementById('gameMenuModal').addEventListener('click', (e) => {
                if (e.target.id === 'gameMenuModal') {
                    const modal = e.target;
                    modal.classList.remove('modal-visible');
                    setTimeout(() => modal.style.display = 'none', 300);
                }
            });

            document.getElementById('mainMenuCloseButton').addEventListener('click', () => {
                const modal = document.getElementById('gameMenuModal');
                if (modal) {
                    modal.classList.remove('modal-visible');
                    setTimeout(() => modal.style.display = 'none', 300);
                }
            });

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

            // --- Changelog Modal Listeners ---
            const changelogButton = document.getElementById('changelogButton');
            const changelogModal = document.getElementById('changelogModal');
            const changelogBackButton = document.getElementById('changelogBackButton');

            changelogButton.addEventListener('click', () => {
                if (gameMenuModal) {
                    gameMenuModal.classList.remove('modal-visible');
                    setTimeout(() => { gameMenuModal.style.display = 'none'; }, 300);
                }
                if (changelogModal) {
                    setTimeout(() => {
                        changelogModal.style.display = 'flex';
                        setTimeout(() => changelogModal.classList.add('modal-visible'), 10);
                    }, 350);
                }
            });

            changelogBackButton.addEventListener('click', () => {
                if (changelogModal) {
                    changelogModal.classList.remove('modal-visible');
                    setTimeout(() => { changelogModal.style.display = 'none'; }, 300);
                }
                if (gameMenuModal) {
                     setTimeout(() => {
                        gameMenuModal.style.display = 'flex';
                        setTimeout(() => gameMenuModal.classList.add('modal-visible'), 10);
                    }, 350);
                }
            });

            changelogModal.addEventListener('click', (e) => {
                if (e.target.id === 'changelogModal') {
                    hideAllModals(); // Close all modals and return to the game
                }
            });

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
            animationsCheckbox.checked = gameSettings.animationsEnabled;
            passTurnCheckbox.checked = gameSettings.passTurnConfirmationEnabled;
            fancyVisualsCheckbox.checked = gameSettings.fancyVisualsEnabled;
            tooltipsCheckbox.checked = gameSettings.tooltipsEnabled;
            fogOfWarCheckbox.checked = gameSettings.fogOfWarEnabled; 
            passDeviceBlurCheckbox.checked = gameSettings.passDeviceBlurEnabled;
            applyUiScale(); 

            animationsCheckbox.addEventListener('change', (e) => {
                gameSettings.animationsEnabled = e.target.checked;
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
                    gameSettings.fogOfWarEnabled = e.target.checked;

                    if (passDeviceBlurCheckbox) {
                        passDeviceBlurCheckbox.disabled = !gameSettings.fogOfWarEnabled;
                        if (!gameSettings.fogOfWarEnabled) {
                            gameSettings.passDeviceBlurEnabled = false;
                            passDeviceBlurCheckbox.checked = false;
                        }
                    }

                    saveSettings();
                    gameState.visionDirty = true; 
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


            const customConfirmModalOverlay = document.getElementById('customConfirmModal');
            customConfirmModalOverlay.addEventListener('click', (event) => {
                if (event.target === customConfirmModalOverlay) {
                    if (ui.customConfirmModal) {
                        ui.customConfirmModal.classList.remove('modal-visible');
                        setTimeout(() => ui.customConfirmModal.style.display = 'none', 300);
                        currentConfirmAction = null; 
                    }
                }
            });

            const loadGameModalOverlay = document.getElementById('loadGameModal');
            loadGameModalOverlay.addEventListener('click', (event) => {
                if (event.target === loadGameModalOverlay) {
                    hideLoadGameModal();
                }
            });

            document.getElementById('loadGameModalCloseButton').addEventListener('click', hideLoadGameModal);

            document.getElementById('loadFromAutosaveButton').addEventListener('click', () => {
                // Must match the key loadAutoSave() will actually read, or the button
                // reports "no autosave" for singleplayer / map-maker saves that do exist.
                const activeAutosaveKey = gameState.mapMakerMode
                    ? MAP_MAKER_AUTOSAVE_KEY
                    : (gameState.gameMode === 'singleplayer' ? 'forthexSaveGame_sp' : 'forthexSaveGame');

                if (localStorage.getItem(activeAutosaveKey)) {
                    loadAutoSave();
                    hideLoadGameModal();
                } else {
                    showInstruction("No autosave found.", 2000);
                }
            });

            document.getElementById('loadFromFileButton').addEventListener('click', () => {
                document.getElementById('fileLoaderInput').click();
            });

            document.getElementById('fileLoaderInput').addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = function(e) {
                    console.group("[FileLoad] Loading external file...");
                    try {
                        let data = JSON.parse(e.target.result);

                        try {
                            data = attemptLegacyConversion(data);
                        } catch (convError) {
                            console.warn("Conversion Error:", convError);
                            showInstruction("File too old.", 3000);
                            console.groupEnd();
                            return;
                        }

                        switch(fileLoadContext) {
                            case 'game_save':
                                const radiusToLoad = data.gridRadius || 3;
                                resizeMapGrid(radiusToLoad);
                                
                                // Protect Scale
                                const correctScale = gameState.renderScale;
                                const correctOffset = gameState.renderOffset;

                                gameState = data;
                                
                                // Restore Scale
                                gameState.renderScale = correctScale;
                                gameState.renderOffset = correctOffset;

                                rehydrateGameState();
                                
                                if (gameState.gameMode === 'arcade') {
                                    ui.endTurnButton.classList.add('arcade-timer-active');
                                } else {
                                    ui.endTurnButton.classList.remove('arcade-timer-active');
                                    ui.endTurnButton.style.background = '';
                                }

                                fullGameRedraw();
                                hideLoadGameModal();
                                showInstruction("Game loaded from file!", 2000);
                                break;
                            
                            case 'edit_map':
                                if (loadMapFromDataObject(data)) {
                                    hideLoadGameModal();
                                }
                                break;

                            case 'play_map':
                                exitMapMakerMode();
                                hideAllModals();

                                let loadedRadius = data.radius || 3;
                                resizeMapGrid(loadedRadius);

                                const correctedUnits = data.units.map(unit => ({
                                    ...unit,
                                    typeName: unit.typeName 
                                }));
                                const tileMap = new Map(data.tiles);

                                initializeGrid(tileMap, correctedUnits);

                                gameState.baseCampPositions = JSON.parse(JSON.stringify(data.baseCampPositions));
                                if (gameState.flags) {
                                    gameState.flags.p1_flag.homePosition = gameState.baseCampPositions.player1;
                                    gameState.flags.p2_flag.homePosition = gameState.baseCampPositions.player2;
                                }

                                showInstruction(`Custom map '${file.name}' loaded.`, 4000);
                                break;
                        }
                    } catch (error) {
                        console.error("File Load Error:", error);
                        showInstruction("Error: Invalid file.", 3000);
                    }
                    console.groupEnd();
                };
                reader.readAsText(file);
                event.target.value = null; 
            });

const respawnChoicesDiv = document.getElementById('respawnChoices');
            if (respawnChoicesDiv) {
                respawnChoicesDiv.addEventListener('click', (event) => {
                    // FIX: Don't trigger respawn logic if in swap mode
                    const content = document.getElementById('respawnModalContent');
                    if (content.classList.contains('swap-mode')) return; 

                    const button = event.target.closest('.respawn-button');
                    if (button) {
                        const unitTypeName = button.dataset.unitType;
                        const unitType = UNIT_TYPES[unitTypeName];
                        
                        if (unitType) {
                            const spawnSuccess = spawnUnit(gameState.currentPlayer, unitType);

                            if (spawnSuccess) {
                                const queueKey = `player${gameState.currentPlayer}`;
                                gameState.respawnQueue[queueKey].shift(); 
                                updateRespawnQueueDisplay(); 
                                const queue = gameState.respawnQueue[queueKey];
                                const nextInQueue = queue.length > 0 ? queue[0] : null;

                                if (nextInQueue && nextInQueue.turnsRemaining <= 0) {
                                    showRespawnModal(gameState.currentPlayer);
                                } else {
                                    hideRespawnModal();
                                }
                            } else {
                                showInstruction("Could not spawn unit, base is blocked!", 3000);
                                hideRespawnModal();
                            }
                        }
                    }
                });
            }

            gameState.gridRadius = 3; // Use the default value directly
            initializeGrid();
            // This is the important call to our new function
            updateCssVariables(); 
            populateColorPickers();
            gameLoop();
            showInstruction("Project Hexblade Loaded. Player 1's Turn.", 3000);

            // --- Color Picker Drawer Logic ---
            const colorPickerDrawer = document.getElementById('colorPickerDrawer');
            const drawerHandle = document.getElementById('drawerHandle');
            const drawerTabs = document.getElementById('drawerTabs');
            const tabButtons = document.querySelectorAll('.drawer-tab-button');
            const drawerIcon = drawerHandle.querySelector('svg');
            const tabContent = document.getElementById('drawerTabContent');

            // This function now only CREATES the 5 circles once.
            function populateColorPickers() {
                const container = document.getElementById('color-options');
                if (!container) return;

                container.innerHTML = ''; // Clear any existing circles

                for (let i = 0; i < COLOR_THEMES.length; i++) {
                    const circle = document.createElement('div');
                    circle.className = 'color-option-circle';
                    circle.dataset.themeIndex = i;
                    // Player dataset is now set dynamically when tabs are switched
                    container.appendChild(circle);
                }

                // Set the initial colors and active state to Player 1's palette
                updateColorPickerCircles('player1');
            }

            // This function UPDATES the colors and active state of the 5 circles
            function updateColorPickerCircles(playerKey) {
                const container = document.getElementById('color-options');
                if (!container) return;
                const circles = container.querySelectorAll('.color-option-circle');
                const activeThemeIndex = gameState.playerColorSelections[playerKey];

                circles.forEach((circle, index) => {
                    const theme = COLOR_THEMES[index];
                    circle.style.backgroundColor = theme[playerKey].primary;
                    circle.dataset.player = playerKey.slice(-1); // Set player to '1' or '2'
                    
                    // Update which circle is highlighted as active
                    circle.classList.toggle('active', index === activeThemeIndex);
                });
            }

            // Helper function to update the drawer's border/icon colors based on the active tab
            function updateDrawerColors() {
                const activeTab = document.querySelector('.drawer-tab-button.active');
                if (!activeTab) return;

                const activePlayerKey = activeTab.dataset.tab === 'p1' ? 'player1' : 'player2';
                
                if (colorPickerDrawer.classList.contains('drawer-open')) {
                    colorPickerDrawer.style.borderColor = TEAM_COLORS[activePlayerKey].primary;
                    drawerHandle.style.borderColor = TEAM_COLORS[activePlayerKey].primary;
                    drawerIcon.style.stroke = TEAM_COLORS[activePlayerKey].accent;
                } else {
                    colorPickerDrawer.style.borderColor = '#F0F0F0';
                    drawerHandle.style.borderColor = '#F0F0F0';
                    drawerIcon.style.stroke = '#F0F0F0';
                }
            }

            // Event handler for clicking a color circle
            function handleColorSelection(event) {
                const circle = event.target.closest('.color-option-circle');
                if (!circle) return;

                const player = circle.dataset.player; // '1' or '2'
                const themeIndex = parseInt(circle.dataset.themeIndex, 10);
                const playerKey = `player${player}`;
                const otherPlayerKey = player === '1' ? 'player2' : 'player1';

                // --- Start the transition ---
                gameState.colorTransition.active = true;
                gameState.colorTransition.startTime = Date.now();
                
                // Store the 'from' and 'to' color objects for BOTH players
                gameState.colorTransition.from.player1 = { ...TEAM_COLORS.player1 };
                gameState.colorTransition.from.player2 = { ...TEAM_COLORS.player2 };
                gameState.colorTransition.to[playerKey] = { ...COLOR_THEMES[themeIndex][playerKey] };
                gameState.colorTransition.to[otherPlayerKey] = { ...TEAM_COLORS[otherPlayerKey] }; // The other player's color doesn't change

                // 1. Update the live TEAM_COLORS object for ONLY the selected player
                TEAM_COLORS[playerKey] = { ...COLOR_THEMES[themeIndex][playerKey] };
                gameState.playerColorSelections[playerKey] = themeIndex; // Remember this selection

                // 2. Update the active circle visuals
                const container = circle.parentElement;
                container.querySelectorAll('.color-option-circle').forEach(c => c.classList.remove('active'));
                circle.classList.add('active');

                // 3. Update all DOM UI elements instantly
                updateCssVariables();
                updateTurnDisplay();
                updateDrawerColors();
                saveColorPreferences();
            }

            // Open/Close the drawer
            drawerHandle.addEventListener('click', () => {
                colorPickerDrawer.classList.toggle('drawer-open');
                updateDrawerColors();
            });

            // Switch between P1 and P2 tabs
            drawerTabs.addEventListener('click', (e) => {
                const clickedButton = e.target.closest('.drawer-tab-button');
                if (!clickedButton) return;
                
                const targetTabId = clickedButton.dataset.tab;
                const playerKey = targetTabId === 'p1' ? 'player1' : 'player2';

                // Update button active state
                tabButtons.forEach(button => {
                    button.classList.toggle('active', button.dataset.tab === targetTabId);
                });

                // Update the circle colors and then the drawer border
                updateColorPickerCircles(playerKey);
                updateDrawerColors();
            });

            // Attach the click listener for selecting a color
            if (tabContent) {
                tabContent.addEventListener('click', handleColorSelection);
            }

            // Close drawer if clicking outside
            document.addEventListener('click', (e) => {
                if (colorPickerDrawer.classList.contains('drawer-open') && !colorPickerDrawer.contains(e.target)) {
                    colorPickerDrawer.classList.remove('drawer-open');
                    updateDrawerColors(); // Reset colors when closing
                }
            });

            // Prevent outside-click from firing on the handle itself
            drawerHandle.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // --- Scroll Fade Logic for Action Log ---
            const actionLogContent = document.getElementById('actionLogContent');
            const actionLogWrapper = document.getElementById('actionLogWrapper');
            if(actionLogContent && actionLogWrapper) {
                actionLogContent.addEventListener('scroll', () => {
                    if (actionLogContent.scrollTop > 0) {
                        actionLogWrapper.classList.add('is-scrolled');
                    } else {
                        actionLogWrapper.classList.remove('is-scrolled');
                    }
                });
            }

            // --- End of Color Picker Drawer Logic ---

// Tab Switching Logic
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', () => {
                // Toggle Buttons
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Toggle Views
                document.querySelectorAll('.tab-view').forEach(v => {
                    v.classList.remove('active');
                    v.style.display = 'none';
                });
                
                const tabName = btn.dataset.tab; // 'recruit' or 'promote'
                const targetView = document.getElementById(tabName === 'recruit' ? 'tabViewRecruit' : 'tabViewPromote');
                targetView.classList.add('active');
                targetView.style.display = tabName === 'recruit' ? 'block' : 'flex'; // Promote uses flex
            });
        });

document.querySelectorAll('.swap-choice').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const typeName = e.target.dataset.type;
        const newType = UNIT_TYPES[typeName];
        if (gameState.selectedUnit) {
            performSwap(gameState.selectedUnit, newType);
            // Restore UI
            document.getElementById('swapSelectionPanel').style.display = 'none';
            document.getElementById('actionsPanel').style.display = 'flex';
            ui.endTurnButton.disabled = false; // Allow end turn now
        }
    });
});



        }

//  AI TRAINING SIMULATOR FUNCTIONS

function abortTrainingMode() {
    if (!gameState.isTrainingMode) return;
    
    console.log("--- TRAINING SIMULATION ABORTED BY USER ---");
    gameState.isTrainingMode = false;
    gameState.gameOver = true; // Kills the execution loop
    document.getElementById('trainingBanner').style.display = 'none';
    
    const blocker = document.getElementById('trainingInteractionBlocker');
    if (blocker) blocker.style.display = 'none';

    showInstruction("Training Aborted. Brain Saved.", 3000);
    if (typeof saveAIBrain === 'function') saveAIBrain();
    
    // --- PROPER SETTINGS RESTORATION & DOM SYNC ---
    if (gameState.preTrainingSettings) {
        // Restore Backend Logic
        gameSettings.animationsEnabled = gameState.preTrainingSettings.animations;
        gameSettings.fancyVisualsEnabled = gameState.preTrainingSettings.fancy;
        gameSettings.passTurnConfirmationEnabled = gameState.preTrainingSettings.passTurn;
        gameSettings.tooltipsEnabled = gameState.preTrainingSettings.tooltips;

        // Restore Frontend HTML Checkboxes to match
        const chkAnim = document.getElementById('settingAnimations');
        const chkFancy = document.getElementById('settingFancyVisuals');
        const chkPass = document.getElementById('settingPassTurnConfirmation');
        const chkTooltips = document.getElementById('settingTooltips');
        
        if (chkAnim) chkAnim.checked = gameSettings.animationsEnabled;
        if (chkFancy) chkFancy.checked = gameSettings.fancyVisualsEnabled;
        if (chkPass) chkPass.checked = gameSettings.passTurnConfirmationEnabled;
        if (chkTooltips) chkTooltips.checked = gameSettings.tooltipsEnabled;
    } else {
        loadSettings(); // Fallback if data is missing
    }
    
    // Full Board Sanitization
    setTimeout(() => { 
        gameState.gameMode = 'local';
        gameState.playerSide = null;
        gameState.gameOver = false;
        
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

    while (gameState.isTrainingMode) {
        // Run 5 turns instantly without letting the browser breathe
        for (let i = 0; i < 5; i++) {
            if (!gameState.isTrainingMode) break;

            if (gameState.gameOver) {
                gameState.gameOver = false;
                startNewTrainingMatch();
            } else {
                await executeAITurn();
            }
        }

        epochCounter += 5;
        
        // Only update text nodes to avoid destroying the button
        if (banner && gameState.isTrainingMode && aiPopulation) {
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
    
    gameState.isTrainingMode = true;
    gameState.gameMode = 'singleplayer';
    gameState.playerSide = null; // Setting to null means BOTH players are AI

    // --- PROPER SETTINGS BACKUP & OVERRIDE ---
    // 1. Backup all configurable settings
    gameState.preTrainingSettings = {
        animations: gameSettings.animationsEnabled,
        fancy: gameSettings.fancyVisualsEnabled,
        passTurn: gameSettings.passTurnConfirmationEnabled,
        tooltips: gameSettings.tooltipsEnabled
    };
    
    // 2. Override internal game logic for max performance
    gameSettings.animationsEnabled = false;
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

    gameState.gridRadius = 3;
    gameState.renderScale = 1.0;
    gameState.renderOffset = { x: 0, y: 0 };
    startNewTrainingMatch(); // picks the first tournament pairing and initializes the grid
    
    console.log("--- TRAINING SIMULATION STARTED ---");
    
    runTrainingHyperLoop();
}