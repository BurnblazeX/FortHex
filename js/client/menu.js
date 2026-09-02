// === Main menu wiring (moved from main.js — A1 step 12) ===
//
// Menu/modal navigation listeners, lifted out of the old window.onload so
// js/main.js can be the composition root the guide's §4 describes rather than
// a 1200-line bootstrap. Each function here registers one screen's listeners
// and is called once, in order, from js/main.js.

function WireConnectionStatus() {
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
}

function WireMainMenu() {
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

        engine.state.gameMode = 'local';
        engine.state.playerSide = null;

        // --- FIX: Reset Map Dimensions for Standard Play ---
        engine.state.gridRadius = 3;
        gameState.renderScale = 1.0;
        gameState.renderOffset = { x: 0, y: 0 };
        // ---------------------------------------------------

        // Finally, initialize the new game grid.
        initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3); 

        // The initializeGrid function calls updateTurnDisplay, which will now
        // correctly set the canvas border for Player 1.
        showInstruction("New Local Multiplayer game started.", 3000);
    });

    // --- A5: the real profile-creation trigger --------------------------
    //
    // Menu > Multiplayer > Online is the moment the roadmap names for lazy
    // profile creation, and this is that click. It was a disabled
    // "Online (Coming Soon)" button with no listener at all before A5.
    //
    // What happens AFTER the profile exists — matchmaking, negotiation, the
    // actual connection — is Track B, and is deliberately not stubbed out here.
    // The handler dead-ends in a message saying so. Track B replaces that one
    // branch and leaves the profile step alone.
    document.getElementById('onlineMultiplayerButton').addEventListener('click', () => {
        PromptForProfileSetup((profile) => {
            // Declined, or dismissed. No profile was created; stay where they were.
            if (!profile) return;

            // The engine already has it: js/client/profile.js updates
            // engine.localProfile on every write, so BuildSaveObject can attach it
            // and connect/disconnect messages can carry a real durable id from here
            // on. Nothing to wire at this call site.

            showInstruction("Online play isn't available yet — coming in a future build.", 4000);
        });
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
}
