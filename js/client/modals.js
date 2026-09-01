// === Modal wiring (moved from main.js — A1 step 12) ===
//
// Tutorial, changelog, custom-confirm, and load-game modals, plus the file
// loader. The game_save branch of the file loader routes through
// ApplyLoadedState() so a loaded file lands on both sides of the client/server
// split rather than only on the client's gameState.

function WireTutorialModal() {
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
}

function WireChangelogModal() {
    // --- Changelog Modal Listeners ---
    // gameMenuModal was declared over in the settings region back when all of
    // this shared one window.onload scope.
    const gameMenuModal = document.getElementById('gameMenuModal');
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
}

function WireLoadAndConfirmModals() {
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
        const activeAutosaveKey = engine.state.mapMakerMode
            ? MAP_MAKER_AUTOSAVE_KEY
            : (engine.state.gameMode === 'singleplayer' ? 'forthexSaveGame_sp' : 'forthexSaveGame');

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

                        ApplyLoadedState(data);

                        // Restore Scale
                        gameState.renderScale = correctScale;
                        gameState.renderOffset = correctOffset;

                        rehydrateGameState();

                        if (engine.state.gameMode === 'arcade') {
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

                        engine.state.baseCampPositions = JSON.parse(JSON.stringify(data.baseCampPositions));
                        if (engine.state.flags) {
                            engine.state.flags.p1_flag.homePosition = engine.state.baseCampPositions.player1;
                            engine.state.flags.p2_flag.homePosition = engine.state.baseCampPositions.player2;
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
}
