// === Respawn and swap modal wiring (moved from main.js — A1 step 12) ===
//
// Respawn choices, the arcade class-swap choices, and the info-panel tabs.
// These call the client wrappers (spawnUnit, performSwap), never the engine
// directly - the wrappers are what drain the event queue.

function WireRespawnChoices() {

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
                                const spawnSuccess = spawnUnit(engine.state.currentPlayer, unitType);

                                if (spawnSuccess) {
                                    const queueKey = `player${engine.state.currentPlayer}`;
                                    engine.state.respawnQueue[queueKey].shift(); 
                                    updateRespawnQueueDisplay(); 
                                    const queue = engine.state.respawnQueue[queueKey];
                                    const nextInQueue = queue.length > 0 ? queue[0] : null;

                                    if (nextInQueue && nextInQueue.turnsRemaining <= 0) {
                                        showRespawnModal(engine.state.currentPlayer);
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
}

function WireTabsAndSwapChoices() {
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
