        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');

        const ui = {
            turnDisplay: document.getElementById('turnDisplay'),
            globalTurnCounterDisplay: document.getElementById('globalTurnCounterDisplay'),
            selectedUnitInfoContainer: document.getElementById('selectedUnitInfoContainer'),
            unitName: document.getElementById('unitName'),
            unitHP: document.getElementById('unitHP'),
            unitMaxHP: document.getElementById('unitMaxHP'),
            unitMovement: document.getElementById('unitMovement'),
            unitPosition: document.getElementById('unitPosition'),
            unitStatus: document.getElementById('unitStatus'),
            actionsPanel: document.getElementById('actionsPanel'),
            fortifyUnfortifyButton: document.getElementById('fortifyUnfortifyButton'),
            buildBridgeButton: document.getElementById('buildBridgeButton'),
            attackButton: document.getElementById('attackButton'),
            endTurnButton: document.getElementById('endTurnButton'),
            downloadButton: document.getElementById('downloadButton'),
            tutorialButton: document.getElementById('tutorialButton'), 
            messageBox: document.getElementById('messageBox'),
            victoryMessage: document.getElementById('victoryMessage'),
            customConfirmModal: document.getElementById('customConfirmModal'),
            customConfirmOkButton: document.getElementById('customConfirmOkButton'),
            customConfirmCancelButton: document.getElementById('customConfirmCancelButton'),
            tutorialModalOverlay: document.getElementById('tutorialModalOverlay'), 
            tutorialCloseButton: document.getElementById('tutorialCloseButton'), 
            tutorialSectionHeaders: document.querySelectorAll('.tutorial-section-header'), 
            actionInfoContainer: document.getElementById('actionInfoContainer'),
            actionLogContent: document.getElementById('actionLogContent'),
        };

        // Hex Color to RGBA
        function hexToRgba(hex, alpha = 1) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        // Helper to darken/lighten hex color for shadows
        function adjustBrightness(hex, percent) {
            const num = parseInt(hex.replace('#', ''), 16);
            const amt = Math.round(2.55 * percent);
            const R = (num >> 16) + amt;
            const G = (num >> 8 & 0x00FF) + amt;
            const B = (num & 0x0000FF) + amt;
            return '#' + (
                0x1000000 +
                (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
                (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
                (B < 255 ? (B < 1 ? 0 : B) : 255)
            ).toString(16).slice(1);
        }

        // Linearly interpolates between two hex colors
        function lerpColor(colorA, colorB, amount) {
            const ah = parseInt(colorA.replace(/#/g, ''), 16);
            const ar = ah >> 16, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
            const bh = parseInt(colorB.replace(/#/g, ''), 16);
            const br = bh >> 16, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
            const rr = ar + amount * (br - ar);
            const rg = ag + amount * (bg - ag);
            const rb = ab + amount * (bb - ab);
            const newHex = ((1 << 24) + (Math.round(rr) << 16) + (Math.round(rg) << 8) + Math.round(rb)).toString(16).slice(1);
            return `#${newHex}`;
        }

        function padZero(num) {
            return String(num).padStart(2, '0');
        }

        function isLand(tileType) {
            return tileType === TILE_TYPES.PLAINS || tileType === TILE_TYPES.FOREST || tileType === TILE_TYPES.MOUNTAIN;
        }

        // Function to set CSS Variables from the TEAM_COLORS object
        function updateCssVariables() {
            const root = document.documentElement;
            root.style.setProperty('--p1-color-secondary', TEAM_COLORS.player1.secondary);
            root.style.setProperty('--p2-color-secondary', TEAM_COLORS.player2.secondary);
        }

        function updateTurnDisplay() {
            // This function is now ONLY responsible for text updates.
            // The canvas outline color is handled in the gameLoop.
            if (gameState.mapMakerMode) {
                // If we enter map maker mode, we still want to hide the turn text.
                // The gameLoop will handle hiding the border.
                return;
            }

            if (ui.turnDisplay) {
                ui.turnDisplay.textContent = `Player ${gameState.currentPlayer}'s Turn`;
            }
        }

        function updateGlobalTurnDisplay() {
            if (ui.globalTurnCounterDisplay) {
                ui.globalTurnCounterDisplay.textContent = `Turn: ${gameState.globalTurnNumber}`;
            }
        }

        function updateActionButtonState(button, baseText, cancelText, isSelecting, canPerformCondition, additionalDisabledCondition = false) {
            button.textContent = isSelecting ? cancelText : baseText;
            button.classList.toggle('selecting', isSelecting);
            if (isSelecting) {
                button.disabled = false;
            } else {
                button.disabled = !canPerformCondition || additionalDisabledCondition;
            }
        }

        function updateSelectedUnitInfoPanel() {
    if (gameState.mapMakerMode) return;
    
    const { selectedUnit, currentActionState } = gameState;

    if (currentActionState !== ACTION_STATES.SELECTING_ATTACK_TARGET) {
        gameState.debugAttackRangeHighlights = [];
    }
    
    if (selectedUnit && !gameState.isDragging) {
        // Show Card Panel, Hide Logs
        ui.selectedUnitInfoContainer.style.display = 'flex';
        ui.actionInfoContainer.style.display = 'none';
        
        renderUnitCard(selectedUnit);

        const canPerformMajorAction = !selectedUnit.hasPerformedMajorAction;
        const canAttack = selectedUnit.currentMove >= ATTACK_COST && !selectedUnit.hasPerformedMajorAction;

        // --- Fortify / Unfortify Button Logic ---
        if (selectedUnit.stats.defense > 0) {
            const isSelectingFortify = currentActionState === ACTION_STATES.SELECTING_FORTIFY_TILE;
            const isSelectingUnfortify = currentActionState === ACTION_STATES.SELECTING_UNFORTIFY_EDGE;
            const canAffordFortify = selectedUnit.currentMove >= FORTIFY_UNFORTIFY_COST;
            
            let fortifyDisabledCondition = false;
            if (selectedUnit.isFortified) { 
                if (!isSelectingUnfortify) {
                   fortifyDisabledCondition = getPotentialUnfortifyTargets(selectedUnit).length === 0;
                }
                updateActionButtonState(ui.fortifyUnfortifyButton, "Unfortify", "Cancel Unfortify", isSelectingUnfortify, canPerformMajorAction && canAffordFortify, fortifyDisabledCondition);
            } else { 
                if (!isSelectingFortify) {
                    const edgeCoords = parseEdgeKey(selectedUnit.position);
                    if (edgeCoords && edgeCoords.length === 2 && !isNaN(edgeCoords[0].q)) {
                        const tile1Key = getTileKey(edgeCoords[0].q, edgeCoords[0].r);
                        const tile2Key = getTileKey(edgeCoords[1].q, edgeCoords[1].r);
                        const tile1 = gameState.tiles.get(tile1Key);
                        const tile2 = gameState.tiles.get(tile2Key);

                        const enemyPlayer = selectedUnit.player === 1 ? 2 : 1;
                        const enemyBaseData = gameState.baseCampPositions[`player${enemyPlayer}`];
                        const enemyBaseTileKeys = new Set();
                        if (Array.isArray(enemyBaseData)) {
                            enemyBaseData.forEach(k => enemyBaseTileKeys.add(k));
                        } else if (typeof enemyBaseData === 'string') {
                            const [h1, h2] = parseEdgeKey(enemyBaseData);
                            if (!isNaN(h1.q)) enemyBaseTileKeys.add(getTileKey(h1.q, h1.r));
                            if (!isNaN(h2.q)) enemyBaseTileKeys.add(getTileKey(h2.q, h2.r));
                        }

                        const canFortifyTile1 = tile1 && tile1.type.canFortify && tile1.fortifiedByPlayer === null && !enemyBaseTileKeys.has(tile1Key);
                        const canFortifyTile2 = tile2 && tile2.type.canFortify && tile2.fortifiedByPlayer === null && !enemyBaseTileKeys.has(tile2Key);
                        fortifyDisabledCondition = !(canFortifyTile1 || canFortifyTile2) || selectedUnit.positionType === 'center';
                    } else {
                        fortifyDisabledCondition = true;
                    }
                }
                updateActionButtonState(ui.fortifyUnfortifyButton, "Fortify", "Cancel Fortify", isSelectingFortify, canPerformMajorAction && canAffordFortify, fortifyDisabledCondition);
            }
        } else {
            // Unit lacks defense stat, persistently disable the button
            updateActionButtonState(ui.fortifyUnfortifyButton, "Fortify", "Cancel", false, false, true);
        }

        // --- Build Bridge Button Logic ---
        if (selectedUnit.type.canBuildBridge) {
            const isSelectingBridge = currentActionState === ACTION_STATES.SELECTING_BRIDGE_EDGE;
            let bridgeDisabledCondition = selectedUnit.isFortified;
            if (!isSelectingBridge && !bridgeDisabledCondition) {
                bridgeDisabledCondition = getPotentialBridgeTargets(selectedUnit).length === 0;
            }
            const canAffordBridge = selectedUnit.currentMove >= BUILD_BRIDGE_COST;
            updateActionButtonState(ui.buildBridgeButton, "Build Bridge", "Cancel Bridge", isSelectingBridge, canPerformMajorAction && canAffordBridge, bridgeDisabledCondition);
        } else {
            // Unit cannot build bridges, persistently disable the button
            updateActionButtonState(ui.buildBridgeButton, "Build Bridge", "Cancel", false, false, true);
        }

        // --- Attack Button Logic ---
        if (selectedUnit.type.attackType) {
            const isSelectingAttack = currentActionState === ACTION_STATES.SELECTING_ATTACK_TARGET;
            let attackDisabledCondition = false;
            if (!isSelectingAttack) {
                if (selectedUnit.type.attackType === 'melee') {
                    attackDisabledCondition = getValidMeleeAttackTargets(selectedUnit).length === 0;
                } else if (selectedUnit.type.attackType === 'ranged') {
                    attackDisabledCondition = getValidArcherAttackTargets(selectedUnit).length === 0;
                }
            }
            updateActionButtonState(ui.attackButton, "Attack", "Cancel Attack", isSelectingAttack, canAttack, attackDisabledCondition);
        } else {
            // Unit cannot attack, persistently disable the button
            updateActionButtonState(ui.attackButton, "Attack", "Cancel", false, false, true);
        }

    } else if (!gameState.isDragging) {
        // Hide Card Panel, Show Logs
        ui.selectedUnitInfoContainer.style.display = 'none';
        ui.actionInfoContainer.style.display = 'block';
        
        resetActionSelectionStates();
        
        // Force reset and disable all buttons instead of hiding them
        ui.fortifyUnfortifyButton.textContent = "Fortify"; 
        ui.fortifyUnfortifyButton.classList.remove('selecting'); 
        ui.fortifyUnfortifyButton.disabled = true;

        ui.buildBridgeButton.textContent = "Build Bridge"; 
        ui.buildBridgeButton.classList.remove('selecting'); 
        ui.buildBridgeButton.disabled = true;

        ui.attackButton.textContent = "Attack"; 
        ui.attackButton.classList.remove('selecting'); 
        ui.attackButton.disabled = true;
    }
}

        function showRespawnModal(player) {
            const overlay = document.getElementById('respawnModalOverlay');
            if (!overlay) return;

            const content = document.getElementById('respawnModalContent');
            
            // --- AUTO-REPAIR HTML ---
            if (!document.getElementById('tabViewRecruit')) {
                content.style.cssText = "max-width: 950px; min-height: 450px; display: flex; flex-direction: column;";
                content.innerHTML = `
                    <div id="respawnTabs" style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 2px solid #4a6075; padding-bottom: 0;">
                        <button class="tab-button active" data-tab="recruit">Reinforce</button>
                        <button class="tab-button" data-tab="promote">Promote</button>
                    </div>
                    
                    <div id="tabViewRecruit" class="tab-view">
                        <p style="margin-bottom: 15px;">Choose a unit to deploy at your base.</p>
                        <div id="respawnChoices" style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; width: 100%;"></div>
                    </div>
                    
                    <div id="tabViewPromote" class="tab-view" style="display: none; width: 100%;">
                        <p id="promoteInstructionText" style="margin-bottom: 15px;">Select a unit to upgrade.</p>
                        <div id="promoteUnitList" style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; width: 100%;"></div>
                        
                        <div id="promoteStatSelection" style="display: none; flex-direction: column; align-items: center; width: 100%;">
                            <div style="display: flex; align-items: center; justify-content: center; width: 100%; position: relative; margin-bottom: 15px;">
                                <button id="promoteBackBtn" class="action-button action-button-cancel" style="padding: 5px 15px; margin: 0; position: absolute; left: 0;">&lt; Back</button>
                                <p style="color: #FFC020; font-size: 1.1em; font-weight: bold; margin: 0;">Click a pulsing pip to upgrade a stat:</p>
                            </div>
                            <div id="promoteCardContainer" style="transform: scale(1.15); margin: 25px 0;"></div>
                        </div>
                    </div>
                `;
                
                document.querySelectorAll('.tab-button').forEach(btn => {
                    btn.addEventListener('click', () => {
                        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        document.querySelectorAll('.tab-view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });
                        
                        const tabName = btn.dataset.tab;
                        const targetView = document.getElementById(tabName === 'recruit' ? 'tabViewRecruit' : 'tabViewPromote');
                        targetView.classList.add('active');
                        
                        // Safety reset: Always show the list when clicking the Promote tab
                        if (tabName === 'promote') {
                            document.getElementById('promoteInstructionText').style.display = 'block';
                            document.getElementById('promoteUnitList').style.display = 'flex';
                            document.getElementById('promoteStatSelection').style.display = 'none';
                        }
                        
                        targetView.style.display = 'flex';
                    });
                });
            }

            // 1. Reset State & Styling
            // FORCE width update even if HTML existed
            content.style.maxWidth = "950px"; 
            
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });
            const recruitTabBtn = document.querySelector('.tab-button[data-tab="recruit"]');
            if (recruitTabBtn) recruitTabBtn.classList.add('active');
            const recruitView = document.getElementById('tabViewRecruit');
            if (recruitView) { recruitView.classList.add('active'); recruitView.style.display = 'flex'; }
            
            const promoteList = document.getElementById('promoteUnitList');
            const promoteStatSel = document.getElementById('promoteStatSelection');
            if (promoteList) promoteList.style.display = 'flex';
            if (promoteStatSel) promoteStatSel.style.display = 'none';
            content.className = `modal-content modal-p${player}`;

            const armySize = gameState.units.filter(u => u.player === player).length;
            const maxUnits = getMaxUnitsForCurrentMap();
            const counts = gameState.unitCounts[`player${player}`];

            // 2. Populate Recruit Tab
            const recruitContainer = document.getElementById('respawnChoices');
            recruitContainer.innerHTML = '';
            
            const recruitOrder = ['MELEE', 'ARCHER', 'PIKEMAN', 'HORSEMAN'];
            
            recruitOrder.forEach(typeKey => {
                const unitCap = UNIT_CAPS[UNIT_TYPES[typeKey].name];
                const currentCount = counts[UNIT_TYPES[typeKey].name];
                const isCapped = currentCount >= unitCap;
                const isArmyFull = armySize >= maxUnits;
                
                if (isCapped || isArmyFull) {
                    recruitContainer.appendChild(createCardBackDOM());
                } else {
                    const dummyUnit = createUnit(player, typeKey, null); 
                    const card = createUnitCardDOM(dummyUnit, () => {
                        handleRecruitClick(player, typeKey);
                    });
                    recruitContainer.appendChild(card);
                }
            });

            // 3. Populate Promote Tab
            const promoteContainer = document.getElementById('promoteUnitList');
            promoteContainer.innerHTML = '';
            
            const aliveUnits = gameState.units.filter(u => u.player === player);
            const classOrder = ['Melee', 'Archer', 'Pikeman', 'Horseman'];
            
            // Strictly enforce the Melee -> Archer -> Pike -> Horse order
            classOrder.forEach(className => {
                // Find all alive units of this class that are NOT max level
                const eligibleUnits = aliveUnits.filter(u => u.type.name === className && u.level < 3);
                
                if (eligibleUnits.length > 0) {
                    // Render all eligible units of this class
                    eligibleUnits.forEach(unit => {
                        const card = createUnitCardDOM(unit, () => {
                            showPromoteSelection(unit);
                        });
                        promoteContainer.appendChild(card);
                    });
                } else {
                    // If no eligible units exist for this class, render the Card Back!
                    promoteContainer.appendChild(createCardBackDOM());
                }
            });

            overlay.style.display = 'flex';
            setTimeout(() => overlay.classList.add('modal-visible'), 10);
        }
        
        function hideRespawnModal() {
            const overlay = document.getElementById('respawnModalOverlay');
            const content = document.getElementById('respawnModalContent');
            if (!overlay) return;
            
            overlay.classList.remove('modal-visible');
            setTimeout(() => {
                overlay.style.display = 'none';
                if (content) content.classList.remove('swap-mode'); // Clean up custom swap class
            }, 300);
        }

        function updateRespawnQueueDisplay() {
            const container = document.getElementById('reinforcementsContainer');
            const listEl = document.getElementById('reinforcementsList');

            if (!container || !listEl) return;

            // --- FIX: Hide completely in Arcade Mode ---
            if (gameState.gameMode === 'arcade') {
                container.style.display = 'none';
                return;
            }

            listEl.innerHTML = ''; 

            const p1Queue = gameState.respawnQueue.player1.map(item => ({ ...item, player: 1 }));
            const p2Queue = gameState.respawnQueue.player2.map(item => ({ ...item, player: 2 }));
            const combinedQueue = [...p1Queue, ...p2Queue];

            if (combinedQueue.length > 0) {
                container.style.display = 'block';
                combinedQueue.forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = `log-entry respawn-item log-p${item.player}`;
                    
                    const unitInfo = `
                        <div class="respawn-unit-info">
                            <span class="respawn-unit-symbol">${item.unitType.symbol}</span>
                            <span>${item.unitType.name}</span>
                        </div>`;
                    const timerInfo = `<div class="respawn-timer">${item.turnsRemaining} Turns</div>`;
                    
                    itemDiv.innerHTML = unitInfo + timerInfo;
                    listEl.appendChild(itemDiv);
                });
            } else {
                container.style.display = 'none';
            }
        }

        function showInstruction(message, duration = 3000) {
            ui.messageBox.textContent = message.replace(/<br>/g, ' '); 
            ui.messageBox.style.display = 'block';
            if (ui.messageBox.timeoutId) clearTimeout(ui.messageBox.timeoutId);
            ui.messageBox.timeoutId = setTimeout(() => { ui.messageBox.style.display = 'none'; }, duration);
        }

        function logAction(message, player, duration = 3000) {
            showInstruction(message, duration);
            gameState.actionLog.push({ message: message, player: player });
            if (gameState.actionLog.length > 25) {
                gameState.actionLog.shift();
            }
            updateActionLogDisplay();
        }
        
        function getActionIcon(message) {
            let iconSvg = '';
            const iconColor = '#bdc3c7';

            if (message.includes('hits') || message.includes('takes') || message.includes('targets bridge') || message.includes('retaliates')) {
                iconSvg = `<svg class="log-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.2 3.8-3.5 3.5 4.3 4.3 3.5-3.5-4.3-4.3z"/><path d="m4.1 19.9 4.4-4.4"/><path d="M16 16h3v3"/><path d="M10.1 5.5 3 12.6l-1.4 1.4 4.2 4.2 1.4-1.4 7.1-7.1"/><path d="M12.6 3 3 12.6l4.2 4.2 9.6-9.6L12.6 3z"/></svg>`;
            } else if (message.includes('fortified')) {
                iconSvg = `<svg class="log-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;
            } else if (message.includes('unfortified')) {
                iconSvg = `<svg class="log-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
            } else if (message.includes('healed') || message.includes('gained a shield')) {
                iconSvg = `<svg class="log-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>`;
            } else if (message.includes('destroyed')) {
                 iconSvg = `<svg class="log-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><path d="M8 20v2h8v-2"></path><path d="m12.5 17.5-1-1-1 1"></path><path d="M16 20a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2"></path><path d="M16 20a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2"></path><path d="M15 2h-1.5a1.5 1.5 0 0 0 0 3h1.5a1.5 1.5 0 0 0 0-3Z"></path><path d="M9 2H7.5a1.5 1.5 0 0 0 0 3H9a1.5 1.5 0 0 0 0-3Z"></path></svg>`;
            } else if (message.includes('built bridge')) {
                iconSvg = `<svg class="log-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8v8m20-8v8M8 4v2m8-2v2M4 12h16"/><path d="M8 10v4m8-4v4"/></svg>`;
            } else {
                iconSvg = `<svg class="log-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>`;
            }
            return `<div class="log-icon">${iconSvg}</div>`;
        }

        function updateActionLogDisplay() {
            if (!ui.actionLogContent) return;

            ui.actionLogContent.innerHTML = '';
            
            for (let i = gameState.actionLog.length - 1; i >= 0; i--) {
                const logObject = gameState.actionLog[i];

                const originalMessage = logObject.message;
                const activePlayer = logObject.player;

                let formattedMessage = originalMessage.replace(/<br>/g, ' ');

                formattedMessage = formattedMessage.replace(/(P1)/g, '<strong class="p1-log">$1</strong>');
                formattedMessage = formattedMessage.replace(/(P2)/g, '<strong class="p2-log">$1</strong>');
                formattedMessage = formattedMessage.replace(/(\d+)\s(damage|HP)/g, '<strong class="damage-text">$1</strong> $2');
                formattedMessage = formattedMessage.replace(/(healed\s\d+\sHP)/g, '<span class="heal-text">$1</span>');
                formattedMessage = formattedMessage.replace(/(gained a shield)/g, '<span class="shield-text">$1</span>');
                formattedMessage = formattedMessage.replace(/(Advantage!)/g, '<strong class="advantage-text">$1</strong>');
                formattedMessage = formattedMessage.replace(/(Disadvantage!)/g, '<strong class="disadvantage-text">$1</strong>');
                formattedMessage = formattedMessage.replace(/(Spear Wall|Cavalry Screen|Combined arms|Damage split)/g, '<strong class="keyword-text">$1</strong>');

                const logEntry = document.createElement('div');
                logEntry.className = `log-entry log-p${activePlayer}`; 
                logEntry.innerHTML = getActionIcon(originalMessage) + `<div class="log-message">${formattedMessage}</div>`;

                ui.actionLogContent.appendChild(logEntry);
            }
        }

        function updateSupplyPointsDisplay() {
            const container = document.getElementById('supplyPointsContainer');
            if (!container) return;

            // Rebuild the inner HTML to switch between "Supply" and "Health" labels
            // while keeping the IDs (p1Supply, p2Supply) for the color system to target.
            if (gameState.gameMode === 'arcade') {
        // Calculate Total HP for Arcade Mode
                const p1HP = gameState.units.filter(u => u.player === 1).reduce((sum, u) => sum + u.hp, 0);
                const p2HP = gameState.units.filter(u => u.player === 2).reduce((sum, u) => sum + u.hp, 0);
        
                container.innerHTML = `
                    <span>P1 Health: <span id="p1Supply">${p1HP}</span></span> | 
                    <span>P2 Health: <span id="p2Supply">${p2HP}</span></span>
                `;
            } else {
                // Standard Mode uses Supply Points
                container.innerHTML = `
                    <span>P1 Supply: <span id="p1Supply">${gameState.supplyPoints.player1}</span></span> | 
                    <span>P2 Supply: <span id="p2Supply">${gameState.supplyPoints.player2}</span></span>
                `;
            }
        }

        function updateSupplyPointsBasedOnFlagStatus(playerNum) {
            const playerFlag = gameState.flags[`p${playerNum}_flag`];
            const playerSupplyKey = `player${playerNum}`;

            if (playerFlag && playerFlag.status === 'carried') {
                // Flag is stolen, set supply to 0.
                gameState.supplyPoints[playerSupplyKey] = 0;
            } else {
                // Flag is at base, restore to max.
                gameState.supplyPoints[playerSupplyKey] = 10;
            }
            updateSupplyPointsDisplay();
        }

        function showSwapClassModal(unit) {
    const overlay = document.getElementById('respawnModalOverlay');
    const content = document.getElementById('respawnModalContent');
    if (!overlay || !content) return;

    content.classList.add('swap-mode');

    // 1. Completely rebuild the HTML specifically for Swapping, bypassing the tab system
    content.innerHTML = `
        <h3 style="font-family: 'Geostar', cursive; font-size: 1.8em; color: #FFC020; margin-bottom: 10px;">Swap Unit</h3>
        <p style="margin-bottom: 20px;">Select new class for ${unit.type.name}</p>
        <div id="respawnChoices" style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">
            <button class="respawn-button" data-unit-type="MELEE" title="Melee"></button>
            <button class="respawn-button" data-unit-type="ARCHER" title="Archer"></button>
            <button class="respawn-button" data-unit-type="PIKEMAN" title="Pikeman"></button>
            <button class="respawn-button" data-unit-type="HORSEMAN" title="Horseman"></button>
        </div>
    `;

    // 2. Setup the buttons
    const buttons = content.querySelectorAll('.respawn-button');
    buttons.forEach(btn => {
        const typeName = btn.dataset.unitType; 
        const type = UNIT_TYPES[typeName];

        // Inject the PNG image instead of the old SVG
        btn.innerHTML = `<img src="assets/units/${type.name}.png" alt="${type.name}" style="width: 40px; height: 40px; object-fit: contain;">`;

        let isValid = true;

        // Cannot swap into the same class
        if (type.name === unit.type.name) isValid = false;
        
        // Cannot swap a fortified unit into a class with 0 or less defense (like Horseman)
        if (unit.isFortified && type.defense <= 0) isValid = false;

        btn.disabled = !isValid;
        
        // Handle the swap click
        btn.onclick = (e) => {
            e.stopPropagation(); // Prevent bubbling
            performSwap(unit, type); // Now correctly calls this from core.js
            hideRespawnModal();
        };
    });

    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('modal-visible'), 10);
}

        

        function hideAllModals() {
            document.querySelectorAll('.modal-overlay').forEach(modal => {
                modal.classList.remove('modal-visible');
                setTimeout(() => modal.style.display = 'none', 300);
            });
        }

        function showNewMapModal() {
            const modal = document.getElementById('newMapModal');
            if (modal) {
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('modal-visible'), 10);
            }
        }

        function hideNewMapModal() {
            const modal = document.getElementById('newMapModal');
            if (modal) {
                modal.classList.remove('modal-visible');
                setTimeout(() => {
                    modal.style.display = 'none';
                    // After the modal is hidden, reset it to the default view
                    showDefaultNewMapView(); // This will reset width to 400px
                }, 300); 
            }
        }

        function showSelectMapView() {
            const modalContent = document.querySelector('#newMapModal .modal-content');
            if (!modalContent) return;

            // --- FIX: Tighter width (was 700px) ---
            modalContent.style.maxWidth = '600px'; 
            // -------------------------------------

            modalContent.querySelector('h3').style.display = 'none';
            document.getElementById('newMapOptionsContainer').style.display = 'none';

            let selectMapView = document.getElementById('selectMapView');
            if (!selectMapView) {
                selectMapView = document.createElement('div');
                selectMapView.id = 'selectMapView';

        const title = document.createElement('h3');
        title.textContent = 'Select Map';
        title.style.cssText = "font-family: 'Geostar', cursive; font-size: 1.8em; color: #FFC020; margin-bottom: 25px;";
        
        const presetContainer = document.createElement('div');
        // Flex row, centered, wrapping allowed but shouldn't happen with this width
        presetContainer.style.cssText = "display: flex; flex-direction: row; gap: 10px; margin-bottom: 25px; justify-content: center; flex-wrap: wrap;";

        const createPresetCard = (mapData) => {
            const wrapper = document.createElement('div');
            // Reduced padding slightly inside the card
            wrapper.style.cssText = "cursor: pointer; border: 2px solid #4a6075; border-radius: 8px; padding: 8px; transition: border-color 0.2s; display: flex; flex-direction: column; align-items: center; gap: 5px; background-color: var(--bg-color); min-width: 150px;";
            wrapper.onclick = () => {
                hideAllModals();
                loadPresetMap(mapData);
            };
            wrapper.onmouseover = () => { wrapper.style.borderColor = '#FFC020'; };
            wrapper.onmouseout = () => { wrapper.style.borderColor = '#4a6075'; };

            const canvas = document.createElement('canvas');
            canvas.width = 140;
            canvas.height = 120;
            
            const label = document.createElement('span');
            label.textContent = mapData.name;
            label.style.fontWeight = 'bold';
            label.style.color = '#F0F0F0';
            
            wrapper.appendChild(canvas);
            wrapper.appendChild(label);
            
            renderMapPreview(canvas, mapData);
            
            return wrapper;
        };

        presetContainer.appendChild(createPresetCard(PRESET_MAP_2)); // Alpha Grounds
        presetContainer.appendChild(createPresetCard(PRESET_MAP_1)); // River Fork
        presetContainer.appendChild(createPresetCard(PRESET_MAP_3)); // Volcano Island

        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'modal-buttons';
        // --- FIX: Center align buttons and reduce gap ---
        buttonsContainer.style.justifyContent = 'center'; 
        buttonsContainer.style.gap = '20px';
        // ------------------------------------------------

        const backButton = document.createElement('button');
        backButton.className = 'action-button action-button-cancel';
        backButton.textContent = 'Back';
        backButton.addEventListener('click', showDefaultNewMapView);

        const loadMapButton = document.createElement('button');
        loadMapButton.className = 'action-button';
        loadMapButton.textContent = 'Load Map File';
        loadMapButton.addEventListener('click', () => {
            fileLoadContext = 'play_map';
            document.getElementById('fileLoaderInput').accept = ".fhmap";
            document.getElementById('fileLoaderInput').click();
        });

        buttonsContainer.appendChild(backButton);
        buttonsContainer.appendChild(loadMapButton);
        
                selectMapView.appendChild(title);
                selectMapView.appendChild(presetContainer);
                selectMapView.appendChild(buttonsContainer);
                modalContent.appendChild(selectMapView);
            }
            selectMapView.style.display = 'block';
        }

        function renderMapPreview(canvas, mapData) {
            const ctx = canvas.getContext('2d');
    
        
            const radius = mapData.radius || 3;
            const size = radius === 4 ? 6 : 8; 
    
            const width = canvas.width;
            const height = canvas.height;
            ctx.clearRect(0, 0, width, height);

            
            const p1BaseTiles = new Set();
            const p2BaseTiles = new Set();

            const addBaseTiles = (baseData, set) => {
                if (!baseData) return;
                if (Array.isArray(baseData)) {
                    baseData.forEach(k => set.add(k));
                } else if (typeof baseData === 'string') {
                    const [h1, h2] = parseEdgeKey(baseData);
                    if (!isNaN(h1.q)) set.add(getTileKey(h1.q, h1.r));
                    if (!isNaN(h2.q)) set.add(getTileKey(h2.q, h2.r));
                }
            };

            addBaseTiles(mapData.baseCampPositions.player1, p1BaseTiles);
            addBaseTiles(mapData.baseCampPositions.player2, p2BaseTiles);
    

            mapData.tiles.forEach((tileType, key) => {
                const [q, r] = key.split(',').map(Number);
        
                const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r) + width / 2;
                const y = size * (3 / 2 * r) + height / 2;
        
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 180 * (60 * i - 30);
            const vx = x + size * Math.cos(angle);
            const vy = y + size * Math.sin(angle);
            if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        
        let fillColor;
        if (p1BaseTiles.has(key)) {
            fillColor = TEAM_COLORS.player1.primary;
        } else if (p2BaseTiles.has(key)) {
            fillColor = TEAM_COLORS.player2.primary;
        } else {
             // Handle object format (Expansive map JSON) or direct type
            const type = tileType.name ? tileType.name.toUpperCase() : (tileType.type ? tileType.type.name.toUpperCase() : 'PLAINS');
            
                    switch (type) {
                        case 'MOUNTAIN': fillColor = '#808080'; break;
                        case 'FOREST': fillColor = '#208020'; break;
                        case 'WATER': fillColor = '#80C0E0'; break;
                        default: fillColor = '#90E090'; break;
                    }
                }
                ctx.fillStyle = fillColor;
                ctx.fill();
            });
        }

        function loadPresetMap(mapData) {
            console.group("--- LOADING PRESET MAP: " + mapData.name + " ---");
    
            try {
                exitMapMakerMode();
                hideAllModals();

                // Resize grid logic
                if (mapData.radius) {
                    resizeMapGrid(mapData.radius);
                } else {
                    resizeMapGrid(3);
                }   

                initializeGrid(mapData.tiles, mapData.units);
        
                gameState.baseCampPositions = JSON.parse(JSON.stringify(mapData.baseCampPositions));
        
                if (gameState.flags && mapData.baseCampPositions.player1) {
                    gameState.flags.p1_flag.homePosition = gameState.baseCampPositions.player1;
                    gameState.flags.p2_flag.homePosition = gameState.baseCampPositions.player2;
                }

                showInstruction(`Preset map '${mapData.name}' loaded. Player 1's turn.`, 4000);
            } catch (error) {
                console.error("[CRITICAL FAILURE] loadPresetMap crashed:", error);
                alert("Error loading preset map. Check console.");
            }
            console.groupEnd();
        }

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

        function clearDebugPath() { 
            gameState.potentialDebugPathToDraw = null;
            gameState.debugPathHoverStartTime = null;
            gameState.debugPathToDraw = null; 
            gameState.debugPathAnimationStartTime = null;
            gameState.debugPathPauseStartTime = null; 
            gameState.lastDebugPathKey = null;
        }

        function resetActionSelectionStates() {
            gameState.currentActionState = gameState.selectedUnit ? ACTION_STATES.UNIT_SELECTED : ACTION_STATES.IDLE;
            
            gameState.validFortifyTargetTileKeys = [];
            gameState.validUnfortifyTargetEdgeKeys = [];
            gameState.validBridgeTargetEdgeKeys = [];
            gameState.validMeleeAttackTargets = [];
            gameState.validArcherAttackTargets = [];
            gameState.debugAttackRangeHighlights = [];
            
            clearDebugPath();
        }

        function clearSelectionAndDebugState() {
            gameState.selectedUnit = null;
            gameState.debugSelectedBasePlayer = null;
            gameState.hoveredUnitId = null;
            gameState.currentReachableMoves.clear();
            
            // Clear Action States
            resetActionSelectionStates();
            
            // Reset UI
            updateSelectedUnitInfoPanel();
            
            // Force a cursor reset
            canvas.style.cursor = 'default';
        }

        function showLoadGameModal() {
            const modal = document.getElementById('loadGameModal');
            if (!modal) return;

            // Dynamically set the text content of the buttons based on the current mode.
            const autosaveBtn = document.getElementById('loadFromAutosaveButton');
            const fileBtn = document.getElementById('loadFromFileButton');
            const fileInput = document.getElementById('fileLoaderInput');
    
            if (gameState.mapMakerMode) {
                autosaveBtn.textContent = "Load Autosave Map";
                fileBtn.textContent = "Load Map File";
                // Accept only .fhmap files
                fileInput.accept = ".fhmap";
            } else {
                autosaveBtn.textContent = "Load Autosave";
                fileBtn.textContent = "Load Save File";
                // Accept game saves (and json as a fallback)
                fileInput.accept = ".fhsave, .json";
            }

            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('modal-visible'), 10);
        }

        function hideLoadGameModal() {
            const modal = document.getElementById('loadGameModal');
            if (modal) {
                modal.classList.remove('modal-visible');
            setTimeout(() => modal.style.display = 'none', 300);
            }
        }

        function handleRecruitClick(player, typeKey) {
            const unitType = UNIT_TYPES[typeKey];
            if (unitType) {
                const spawnSuccess = spawnUnit(player, unitType);
                if (spawnSuccess) {
                    consumeRespawnCharge(player);
                    hideRespawnModal();
                } else {
                    showInstruction("Base is blocked!", 2000);
                }
            }
        }

        function showPromoteSelection(unit) {
    // Safely Switch view
    const instructionText = document.getElementById('promoteInstructionText');
    if (instructionText) instructionText.style.display = 'none';
    
    document.getElementById('promoteUnitList').style.display = 'none';
    document.getElementById('promoteStatSelection').style.display = 'flex';
    
    // Render the Card (Passing TRUE to enable Upgrade Mode pips)
    const container = document.getElementById('promoteCardContainer');
    container.innerHTML = `
        <div class="unit-card" style="margin: 0 auto; cursor: default; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            ${getUnitCardHTML(unit, true)}
        </div>
    `;
    
    // Attach Listeners DIRECTLY to the pulsing pips!
    container.querySelectorAll('.pip-upgrade-target').forEach(pip => {
        pip.addEventListener('click', (e) => {
            const stat = e.target.dataset.upgradeStat;
            const success = applyUnitUpgrade(unit, stat);
            if (success) {
                consumeRespawnCharge(unit.player);
                hideRespawnModal();
            }
        });
    });
    
    // Back Button
    document.getElementById('promoteBackBtn').onclick = () => {
        if (instructionText) instructionText.style.display = 'block';
        document.getElementById('promoteUnitList').style.display = 'flex'; 
        document.getElementById('promoteStatSelection').style.display = 'none';
    };
}
        
        function consumeRespawnCharge(player) {
            const queueKey = `player${player}`;
            gameState.respawnQueue[queueKey].shift(); // Remove used charge
            updateRespawnQueueDisplay(); 
            
            // Check if NEXT charge is also ready (Rare, but possible)
            const queue = gameState.respawnQueue[queueKey];
            if (queue.length > 0 && queue[0].turnsRemaining <= 0) {
                // Re-open for next charge? Maybe wait a beat.
                setTimeout(() => showRespawnModal(player), 500);
            }
        }

        // --- DEBUG CONSOLE SYSTEM ---
        function setupDebugConsoleSystem() {
            // Hook into console.log/error/warn
            const previousLog = console.log;
            const previousError = console.error;
            const previousWarn = console.warn || console.log;

            function appendToVisualConsole(args, type) {
                const consoleContent = document.getElementById('debugConsoleContent');
                if (!consoleContent) return;

                const msg = args.map(arg => {
                    if (typeof arg === 'object') {
                        try { return JSON.stringify(arg); } 
                        catch(e) { return '[Obj]'; }
                    }
                    return String(arg);
                }).join(' ');

                const line = document.createElement('div');
                line.className = `console-${type}`;
                line.textContent = `> ${msg}`;
                consoleContent.appendChild(line);
                consoleContent.scrollTop = consoleContent.scrollHeight;
            }

            console.log = function(...args) {
                previousLog.apply(console, args);
                appendToVisualConsole(args, 'log');
            };

            console.error = function(...args) {
                previousError.apply(console, args);
                appendToVisualConsole(args, 'error');
            };

            console.warn = function(...args) {
                previousWarn.apply(console, args);
                appendToVisualConsole(args, 'warn');
            };

            // Initialize Dragging
            makeElementDraggable(document.getElementById("debugConsoleModal"));
            
            // Close Button Logic
            document.getElementById('debugConsoleCloseBtn').addEventListener('click', () => {
                document.getElementById('debugConsoleModal').style.display = 'none';
            });

            // Alt + C Toggle
            document.addEventListener('keydown', (e) => {
                if (e.altKey && (e.key === 'c' || e.key === 'C')) {
                    if (gameSettings.debugModeEnabled) {
                        const modal = document.getElementById('debugConsoleModal');
                        if (modal.style.display === 'none' || modal.style.display === '') {
                            modal.style.display = 'flex';
                        } else {
                            modal.style.display = 'none';
                        }
                    }
                }
            });
        }

        function makeElementDraggable(elmnt) {
            let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
            const header = document.getElementById(elmnt.id + "Header");
            
            if (header) {
                header.onmousedown = dragMouseDown;
            } else {
                elmnt.onmousedown = dragMouseDown;
            }

            function dragMouseDown(e) {
                e = e || window.event;
                e.preventDefault();
                pos3 = e.clientX;
                pos4 = e.clientY;
                document.onmouseup = closeDragElement;
                document.onmousemove = elementDrag;
            }

            function elementDrag(e) {
                e = e || window.event;
                e.preventDefault();
                pos1 = pos3 - e.clientX;
                pos2 = pos4 - e.clientY;
                pos3 = e.clientX;
                pos4 = e.clientY;
                elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
                elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
                // Reset right to auto so left positioning takes precedence after move
                elmnt.style.right = 'auto'; 
            }

            function closeDragElement() {
                document.onmouseup = null;
                document.onmousemove = null;
            }
        }

function showDefaultNewMapView() {
    const modalContent = document.querySelector('#newMapModal .modal-content');
    if (!modalContent) return;
    
    // Reset modal width to default
    modalContent.style.maxWidth = '400px';

    const selectMapView = document.getElementById('selectMapView');
    if (selectMapView) {
        selectMapView.style.display = 'none';
    }

    modalContent.querySelector('h3').style.display = 'block';
    document.getElementById('newMapOptionsContainer').style.display = 'flex';
}

function getUnitCardHTML(unit, isUpgradeMode = false) {
    const genPips = (upgrades, statName) => {
        let html = '';
        for(let i = 0; i < 3; i++) {
            let cls = '';
            let extra = '';
            
            if (i < upgrades) {
                // Already upgraded pips
                cls = (i === 0) ? 'pip-filled' : 'pip-penalty';
            } else if (isUpgradeMode && i === upgrades && upgrades < 3) {
                // The NEXT available upgrade pip (Interactive)
                cls = (i === 0) ? 'pip-filled pip-upgrade-target' : 'pip-penalty pip-upgrade-target';
                extra = `data-upgrade-stat="${statName}" title="Upgrade ${statName}"`;
            }
            
            html += `<div class="${cls}" ${extra}></div>`;
        }
        return html;
    };

    const atkUp = unit.upgrades.damage || 0;
    const defUp = unit.upgrades.defense || 0;
    const spdUp = unit.upgrades.speed || 0;
    const hpUp = unit.upgrades.health || 0;

    const teamPrimary = unit.player === 1 ? TEAM_COLORS.player1.primary : TEAM_COLORS.player2.primary;
    const teamAccent = unit.player === 1 ? TEAM_COLORS.player1.accent : TEAM_COLORS.player2.accent;
    const borderColor = unit.level > 0 ? PALETTE.YELLOW_GOLD : '#FFF';
    
    const levelText = unit.level > 0 ? `+${unit.level}` : '0';
    const levelBg = unit.level > 0 ? PALETTE.YELLOW_GOLD : '#F0F0F0'; 
    const levelTextColor = '#000'; 

    return `
        <div class="card-name-bar" style="background-color: ${teamAccent}; border-color: ${teamPrimary};">${unit.type.name}</div>
        <div class="card-level-circle" style="background-color: ${levelBg}; border-color: ${borderColor}; color: ${levelTextColor};">${levelText}</div>
        
        <div class="card-portrait-wrapper">
            <div class="card-portrait-circle" style="background-color: ${teamPrimary}; border-color: ${borderColor};">
                <img src="assets/units/${unit.type.name}.png" alt="${unit.type.name}">
            </div>
        </div>

        <img src="assets/icons/Attack.png" class="card-icon c-ic-atk" alt="Atk">
        <div class="card-val c-val-atk">${unit.stats.damage}</div>
        <div class="card-pips-row c-pips-atk">${genPips(atkUp, 'damage')}</div>

        <img src="assets/icons/Defense.png" class="card-icon c-ic-def" alt="Def">
        <div class="card-val c-val-def">${unit.stats.defense}</div>
        <div class="card-pips-row c-pips-def">${genPips(defUp, 'defense')}</div>

        <img src="assets/icons/Speed.png" class="card-icon c-ic-spd" alt="Spd">
        <div class="card-val c-val-spd">${unit.stats.speed}</div>
        <div class="card-pips-row c-pips-spd">${genPips(spdUp, 'speed')}</div>

        <div class="card-pips-col">${genPips(hpUp, 'health')}</div>
        <img src="assets/icons/Health.png" class="card-icon c-ic-hp" alt="HP">
        <div class="card-val c-val-hp">${unit.stats.maxHp}</div>
    `;
}

function renderUnitCard(unit) {
    if (!unit) return;
    const container = document.getElementById('unitCard');
    if (!container) return;

    // Direct injection, no canvas needed!
    container.innerHTML = getUnitCardHTML(unit);
}

function createUnitCardDOM(unit, onClick = null) {
    const card = document.createElement('div');
    card.className = 'unit-card interactive';
    
    if (onClick) {
        card.onclick = () => {
            if (card.parentElement) {
                card.parentElement.querySelectorAll('.unit-card').forEach(c => c.classList.remove('selected'));
            }
            card.classList.add('selected');
            onClick();
        };
    }

    // Direct injection, no canvas needed!
    card.innerHTML = getUnitCardHTML(unit);

    return card;
}

function createCardBackDOM() {
    const div = document.createElement('div');
    div.className = 'card-back';
    return div;
}