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
                    data = LoadThroughTestament(data);
                } catch (convError) {
                    console.warn("Conversion Error:", convError);
                    showInstruction("File too old.", 3000);
                    console.groupEnd();
                    return;
                }

                // A4 §9: what a file opens into is decided by what is actually in
                // it, never by its extension. The three contexts below are user
                // INTENT (resume / edit / play), so content can't replace them —
                // but it does catch the one mismatch that used to produce a broken
                // half-loaded match: a map file opened through "Load Game".
                const content = DescribeContent(data);
                if (fileLoadContext === 'game_save' && content.opensAs === 'map') {
                    console.warn('[Testament] this file is a map, not a saved match');
                    showInstruction("That's a map, not a saved game. Opening the Map Maker.", 3000);
                    if (loadMapFromDataObject(data)) hideLoadGameModal();
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
                        MaybePromptForSide();
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

// === Testament load-time side selection (A4) ===
//
// The roadmap asks A4 for a load-time decision UI covering saves whose state is
// ambiguous once loaded. The ambiguity that actually exists is which side the human
// takes: a save records a playerSide, but nothing says the player still wants it,
// and a match can legitimately be resumed from either chair.
//
// Local pass-device play never needs asking — both sides are one person at one
// device, and the save simply resumes on whoever was to move. Singleplayer always
// asks. Online multiplayer is offered the same choice (Burn's call); that mode
// arrives with Track B, and this handles it the moment it does.
//
// Vanilla DOM, matching every other modal here. The roadmap names this screen for
// Track B's React adoption and Candidates F1's migration — it is deliberately not
// built in React now, because React is not in the project yet.
function MaybePromptForSide(onDone) {
    const mode = engine.state.gameMode;
    const finish = () => { if (typeof onDone === 'function') onDone(); };

    if (mode !== 'singleplayer' && mode !== 'online') {
        finish();
        return;
    }

    const overlay = document.getElementById('sideSelectModalOverlay');
    const summary = document.getElementById('sideSelectSummary');
    const p1 = document.getElementById('sideSelectP1');
    const p2 = document.getElementById('sideSelectP2');
    if (!overlay || !p1 || !p2) { finish(); return; }

    const savedSide = engine.state.playerSide;
    const toMove = engine.state.currentPlayer;

    if (summary) {
        let text = 'Saved on turn ' + engine.state.globalTurnNumber +
                   ', with Player ' + toMove + ' to move.';
        if (savedSide) text += ' You were playing Player ' + savedSide + '.';
        if (mode === 'singleplayer') text += ' The other side will be played by the AI.';
        summary.textContent = text;
    }

    // Mark the side the file recorded, so keeping it is the obvious default.
    [[p1, 1], [p2, 2]].forEach(([button, side]) => {
        button.textContent = 'Player ' + side + (side === savedSide ? ' (as saved)' : '');
    });

    // Replace rather than add: this modal can open once per load, and stale
    // listeners from a previous load would fire again on the next one.
    const choose = (side) => {
        // Fade out the way every other modal does, but apply the choice straight
        // away — the player shouldn't wait 300ms for the board to react.
        overlay.classList.remove('modal-visible');
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
        ApplyChosenSide(side);
        finish();
    };
    p1.onclick = () => choose(1);
    p2.onclick = () => choose(2);

    // .modal-overlay is display:none AND opacity:0/visibility:hidden (modals.css),
    // so setting display alone shows nothing — the overlay is there and invisible.
    // Every modal in the app sets display first and adds .modal-visible on a later
    // frame, which is also what makes the fade transition run at all.
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('modal-visible'), 10);
}

function ApplyChosenSide(side) {
    engine.state.playerSide = side;

    // The action log is rebuilt per viewer (js/testament.js): under fog it shows
    // that player's own actions and what happened to their own units, so choosing
    // a side changes what the log should say.
    engine.state.actionLog = RebuildActionLog(engine.state.matchHistory, {
        units: engine.state.units,
        forPlayer: side,
        fogOfWarEnabled: engine.settings.fogOfWarEnabled,
    });
    updateActionLogDisplay();

    engine.visionDirty = true;
    gameState.needsRedraw = true;
    fullGameRedraw();

    showInstruction('Continuing as Player ' + side + '.', 2500);

    // Same shape as starting a singleplayer match as P2 (game-flow.js): if it is
    // not the human's turn, the AI owes the first move, and the end-turn button
    // stays disabled until it has taken it.
    if (engine.state.gameMode === 'singleplayer' && engine.state.currentPlayer !== side) {
        if (ui.endTurnButton) ui.endTurnButton.disabled = true;
        setTimeout(() => { executeAITurn(); }, 1500);
    }
}

// === A5: profile setup + consent =============================================
//
// The first-Online-entry screen. Collects a display name and a single blanket
// agreement (guide §6.1 — one toggle covering both match archiving and balance
// telemetry, not separate consent for each), then creates the profile with that
// consent already attached rather than creating an unconsented one and setting
// the flag afterwards.
//
// Gating is the standard pattern: the checkbox sits below a scrollable document,
// and Continue is disabled until it is checked. No scroll-tracking enforcement —
// the checkbox being at the bottom of something that has to be scrolled is the
// enforcement, and the stricter version was deliberately left unbuilt (§6.2).
//
// Vanilla DOM, same as every modal in this file and the same deliberately
// unpolished treatment A4 gave the side-selection screen. Roadmap B1 rebuilds it
// in React with the preset-pfp picker.
//
// Calls back with the profile on accept and with null on decline. Declining
// creates NOTHING — not a consent:false profile — so a player who says no is in
// exactly the state they were in before they clicked.
function PromptForProfileSetup(onDone) {
    const finish = (profile) => { if (typeof onDone === 'function') onDone(profile); };

    // Already has one: this screen is first-entry only, so there is nothing to ask.
    const existing = GetProfile();
    if (existing) { finish(existing); return; }

    const overlay = document.getElementById('profileSetupModalOverlay');
    const nameInput = document.getElementById('profileNameInput');
    const checkbox = document.getElementById('profileConsentCheckbox');
    const accept = document.getElementById('profileSetupAccept');
    const cancel = document.getElementById('profileSetupCancel');

    // No markup is a bug, not a reason to silently create an unconsented profile.
    if (!overlay || !nameInput || !checkbox || !accept || !cancel) {
        console.error('[Profile] Setup modal markup missing — refusing to create a profile.');
        finish(null);
        return;
    }

    // Fresh every time: this can open again after a decline, and a stale checkbox
    // would mean the second visit starts pre-agreed.
    nameInput.value = '';
    checkbox.checked = false;
    accept.disabled = true;

    const close = () => {
        overlay.classList.remove('modal-visible');
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    };

    // Replace rather than add, for the same reason MaybePromptForSide does: this
    // screen can open more than once and stale listeners would fire again.
    checkbox.onchange = () => { accept.disabled = !checkbox.checked; };

    accept.onclick = () => {
        // Belt and braces. The button is disabled without the checkbox, but the
        // rule that matters — no profile without consent — is enforced here, where
        // the write actually happens, not only by a disabled attribute.
        if (!checkbox.checked) return;

        close();
        const profile = GetOrCreateProfile(nameInput.value, true);
        showInstruction('Profile created for ' + profile.name + '.', 2500);
        finish(profile);
    };

    cancel.onclick = () => { close(); finish(null); };

    // Clicking the backdrop is a decline, matching how every other dismissible
    // modal here treats it.
    overlay.onclick = (e) => { if (e.target === overlay) { close(); finish(null); } };

    // .modal-overlay is display:none AND opacity:0/visibility:hidden (modals.css),
    // so setting display alone shows nothing. Display first, .modal-visible on a
    // later frame — the A4 browser pass found this the hard way.
    overlay.style.display = 'flex';
    setTimeout(() => {
        overlay.classList.add('modal-visible');
        nameInput.focus();
    }, 10);
}
