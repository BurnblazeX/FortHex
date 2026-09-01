// === Toolbar and map button wiring (moved from main.js — A1 step 12) ===
//
// The action panel buttons, End Turn, the new/custom/select map buttons, the
// custom-confirm OK/Cancel pair, and Save/Load. Registered at script scope
// (not inside window.onload) exactly as before, so listener timing is unchanged.

function WireToolbar() {


            ui.fortifyUnfortifyButton.addEventListener('click', handleFortifyUnfortifyButtonClick);
            ui.buildBridgeButton.addEventListener('click', handleBuildBridgeAction);
            ui.attackButton.addEventListener('click', handleAttackAction);








    ui.endTurnButton.addEventListener('click', () => {
        if (engine.state.mapMakerMode) {
            // --- Clear Map Functionality ---
            document.getElementById('customConfirmMessage').textContent = 'Are you sure you want to clear the entire map? This cannot be undone.';
            currentConfirmAction = clearMapForMaker;

            if (ui.customConfirmModal) {
                ui.customConfirmModal.style.display = 'flex';
                setTimeout(() => ui.customConfirmModal.classList.add('modal-visible'), 10);
            }
        } else {
            // --- Original End Turn Functionality ---
            const playerHasActed = engine.state.playerActionTaken[`player${engine.state.currentPlayer}`];

            if (playerHasActed || !gameSettings.passTurnConfirmationEnabled || engine.state.gameOver) {
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

        if (engine.state.mapMakerMode) {
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

        if (engine.state.mapMakerMode || engine.state.gameMode === 'singleplayer') {
            generateButton.disabled = true;
        } else {
            generateButton.disabled = false;
        }

        if (engine.state.mapMakerMode) {
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
        if (engine.state.mapMakerMode) {
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
        fileLoadContext = engine.state.mapMakerMode ? 'edit_map' : 'game_save';
        showLoadGameModal();
    });
}
