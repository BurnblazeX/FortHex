        function drawHexFill(q, r, tileType) {
            const { x, y } = axialToPixel(q, r);
            const currentHexSize = HEX_SIZE * gameState.renderScale; // SCALED SIZE

            // If we are in map maker mode, force fancy visuals to be off for this draw call.
            const useFancyVisuals = gameSettings.fancyVisualsEnabled && !gameState.mapMakerMode;

            if (useFancyVisuals) {
                // --- FANCY VISUALS ON ---
                if (tileType === TILE_TYPES.MOUNTAIN) {
                    const mountainColors = [
                        '#808080', '#707070', '#606060', '#707070', '#808080', '#A0A0A0'
                    ];
                    const vertices = [];
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.PI / 180 * (60 * i - 30);
                        vertices.push({ x: x + currentHexSize * Math.cos(angle), y: y + currentHexSize * Math.sin(angle) });
                    }
                    for (let i = 0; i < 6; i++) {
                        const v1 = vertices[i];
                        const v2 = vertices[(i + 1) % 6];
                        ctx.beginPath();
                        ctx.moveTo(x, y);
                        ctx.lineTo(v1.x, v1.y);
                        ctx.lineTo(v2.x, v2.y);
                        ctx.closePath();
                        ctx.fillStyle = mountainColors[i];
                        ctx.fill();
                    }
                } else if (tileType === TILE_TYPES.FOREST) {
                    const forestEdgeColors = [
                        '#209020', '#207020', '#206020', '#207020', '#209020', '#209F20'
                    ];
                    const baseVertices = [];
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.PI / 180 * (60 * i - 30);
                        baseVertices.push({ x: x + currentHexSize * Math.cos(angle), y: y + currentHexSize * Math.sin(angle) });
                    }
                    for (let i = 0; i < 6; i++) {
                        const v1 = baseVertices[i];
                        const v2 = baseVertices[(i + 1) % 6];
                        ctx.beginPath();
                        ctx.moveTo(x, y);
                        ctx.lineTo(v1.x, v1.y);
                        ctx.lineTo(v2.x, v2.y);
                        ctx.closePath();
                        ctx.fillStyle = forestEdgeColors[i];
                        ctx.fill();
                    }
                    const topHexSize = currentHexSize * 0.75;
                    const topHexColor = '#208020';
                    ctx.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.PI / 180 * (60 * i - 30);
                        const vx = x + topHexSize * Math.cos(angle);
                        const vy = y + topHexSize * Math.sin(angle);
                        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                    }
                    ctx.closePath();
                    ctx.fillStyle = topHexColor;
                    ctx.fill();
                } else if (tileType === TILE_TYPES.WATER) {
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.rotate(-60 * Math.PI / 180);
                    ctx.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.PI / 180 * (60 * i - 30);
                        const vx = currentHexSize * Math.cos(angle);
                        const vy = currentHexSize * Math.sin(angle);
                        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                    }
                    ctx.closePath();
                    ctx.clip();
                    const stripeColors = ['#60B0CF', '#6AC0D4', '#75D0DA', '#80E0E0'];
                    const stripeCount = 4;
                    const hexTotalWidth = currentHexSize * Math.sqrt(3);
                    const stripeWidth = hexTotalWidth / stripeCount;
                    const startX = -(hexTotalWidth / 2);
                    for (let i = 0; i < stripeCount; i++) {
                        ctx.fillStyle = stripeColors[i];
                        const stripeX = startX + (i * stripeWidth);
                        ctx.fillRect(stripeX, -currentHexSize, stripeWidth + 1, currentHexSize * 2);
                    }
                    ctx.restore();
                } else if (tileType === TILE_TYPES.PLAINS) {
                    // --- Logic for concentric Plains hexagons ---
                    const plainsColors = ['#70E070', '#7AE07A', '#85E085', '#90E090']; 
                    const plainsSizeMultipliers = [1.0, 0.75, 0.50, 0.25]; 

                    for (let i = 0; i < plainsSizeMultipliers.length; i++) {
                        const currentSize = currentHexSize * plainsSizeMultipliers[i];
                        ctx.fillStyle = plainsColors[i];
                        
                        ctx.beginPath();
                        for (let j = 0; j < 6; j++) {
                            const angle = Math.PI / 180 * (60 * j - 30);
                            const vx = x + currentSize * Math.cos(angle);
                            const vy = y + currentSize * Math.sin(angle);
                            if (j === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                        }
                        ctx.closePath();
                        ctx.fill();
                    }

                } else { 
                    ctx.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.PI / 180 * (60 * i - 30);
                        const vx = x + currentHexSize * Math.cos(angle); 
                        const vy = y + currentHexSize * Math.sin(angle);
                        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                    }
                    ctx.closePath(); 
                    ctx.fillStyle = tileType.color;
                    ctx.fill();
                }
            } else {
                // --- FANCY VISUALS OFF (SIMPLE SOLID COLORS) ---
                let fallbackColor;
                switch (tileType) {
                    case TILE_TYPES.MOUNTAIN: fallbackColor = '#808080'; break;
                    case TILE_TYPES.FOREST: fallbackColor = '#208020'; break;
                    case TILE_TYPES.WATER: fallbackColor = '#80C0E0'; break;
                    case TILE_TYPES.PLAINS: fallbackColor = '#90E090'; break;
                    default: fallbackColor = tileType.color;
                }
                
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const angle = Math.PI / 180 * (60 * i - 30);
                    const vx = x + currentHexSize * Math.cos(angle); 
                    const vy = y + currentHexSize * Math.sin(angle);
                    if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                }
                ctx.closePath(); 
                ctx.fillStyle = fallbackColor;
                ctx.fill();
            }
        }

        function drawHexEdgesAndBoundaries() {
            const edgeLineWidth = 2;
            const currentHexSize = HEX_SIZE * gameState.renderScale; // SCALED SIZE

            // Logic: Fancy visuals are active if the Setting is ON AND we are NOT in the Map Editor.
            // This allows them to show up during "Test Map" (since mapMakerMode is false then), but not during editing.
            const useFancyVisuals = gameSettings.fancyVisualsEnabled && !gameState.mapMakerMode;

            gameState.edges.forEach(edge => {
                const tileA = gameState.tiles.get(getTileKey(edge.q1, edge.r1));
                const tileB = gameState.tiles.get(getTileKey(edge.q2, edge.r2));
                if (!tileA || !tileB) return;
                const typeA = tileA.type; const typeB = tileB.type; let edgeStrokeColor;
                
                const landEdgeColor = '#A05030'; 
                const beachEdgeColor = '#F0E090'; 
                const swampEdgeColor = '#80D040'; 
                const cliffEdgeColor = '#D0D0C0'; 
                const waterEdgeColor = '#4080C0';

                if (isLand(typeA) && isLand(typeB)) {
                    edgeStrokeColor = landEdgeColor;
                }
                else if ((isLand(typeA) && typeB === TILE_TYPES.WATER) || (typeA === TILE_TYPES.WATER && isLand(typeB))) {
                    // Logic for distinct Coastlines
                    if (useFancyVisuals) {
                        const landTileType = isLand(typeA) ? typeA : typeB;
                        
                        if (landTileType === TILE_TYPES.FOREST) {
                            edgeStrokeColor = swampEdgeColor;
                        } else if (landTileType === TILE_TYPES.MOUNTAIN) {
                            edgeStrokeColor = cliffEdgeColor;
                        } else {
                            edgeStrokeColor = beachEdgeColor; // Plains remain standard beach
                        }
                    } else {
                        // Fallback for Simple visuals OR Map Maker Mode
                        edgeStrokeColor = beachEdgeColor;
                    }
                }
                else if (typeA === TILE_TYPES.WATER && typeB === TILE_TYPES.WATER) edgeStrokeColor = waterEdgeColor;
                else edgeStrokeColor = '#1a252f';

                const p1_center = axialToPixel(edge.q1, edge.r1); const p2_center = axialToPixel(edge.q2, edge.r2);
                const edgeMidX = (p1_center.x + p2_center.x) / 2; const edgeMidY = (p1_center.y + p2_center.y) / 2;
                const dx_centers = p2_center.x - p1_center.x; const dy_centers = p2_center.y - p1_center.y;
                let perp_dx = -dy_centers; let perp_dy = dx_centers;
                const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);
                if (len_perp_vec === 0) return;
                
                // Apply SCALED size here
                perp_dx = (perp_dx / len_perp_vec) * (currentHexSize / 2); 
                perp_dy = (perp_dy / len_perp_vec) * (currentHexSize / 2);
                
                ctx.beginPath(); ctx.moveTo(edgeMidX + perp_dx, edgeMidY + perp_dy); ctx.lineTo(edgeMidX - perp_dx, edgeMidY - perp_dy);
                ctx.strokeStyle = edgeStrokeColor; ctx.lineWidth = edgeLineWidth; ctx.stroke();
            });

             const boundaryEdgeColor = '#000000';
             gameState.tiles.forEach(tile => {
                 const {q, r} = tile; const {x: centerX, y: centerY} = axialToPixel(q,r);
                 for (let directionIndex = 0; directionIndex < 6; directionIndex++) {
                     const neighborDir = AXIAL_DIRECTIONS[directionIndex];
                     const neighborQ = q + neighborDir.q; const neighborR = r + neighborDir.r;
                     if (!gameState.tiles.has(getTileKey(neighborQ, neighborR))) {
                         const edgeIndexOfCurrentHex = MAP_DIRECTION_TO_EDGE_INDEX[directionIndex];
                         const v1_idx = edgeIndexOfCurrentHex; const v2_idx = (edgeIndexOfCurrentHex + 1) % 6;
                         const vert1_angle = Math.PI / 180 * (60 * v1_idx - 30);
                         
                         // Apply SCALED size for boundary vertices
                         const edge_v1_x = centerX + currentHexSize * Math.cos(vert1_angle); 
                         const edge_v1_y = centerY + currentHexSize * Math.sin(vert1_angle);
                         
                         const vert2_angle = Math.PI / 180 * (60 * v2_idx - 30);
                         const edge_v2_x = centerX + currentHexSize * Math.cos(vert2_angle); 
                         const edge_v2_y = centerY + currentHexSize * Math.sin(vert2_angle);
                         
                         ctx.beginPath(); ctx.moveTo(edge_v1_x, edge_v1_y); ctx.lineTo(edge_v2_x, edge_v2_y);
                         ctx.strokeStyle = boundaryEdgeColor; ctx.lineWidth = edgeLineWidth; ctx.stroke();
                     }
                 }
             });
        }

        function drawUnitHealthBar(ctx, unitX, unitY, ringOuterRadius, ringThickness, currentHp, maxHp) {
            if (maxHp <= 0) return;
            
            const displayHpPercentage = Math.max(0, Math.min(1, currentHp / maxHp)); 
            const isShielded = currentHp > maxHp;

            const startAngle = -Math.PI / 2; 
            const fullAngle = 2 * Math.PI;
            const healthRingCenterlineRadius = ringOuterRadius - (ringThickness / 2);
            
            const originalLineWidth = ctx.lineWidth; 
            const originalLineCap = ctx.lineCap;
            ctx.lineWidth = ringThickness; 
            ctx.lineCap = 'butt';

            if (displayHpPercentage < 1) {
                ctx.beginPath(); 
                ctx.strokeStyle = '#4A4A4A'; 
                const healthEndAngle = startAngle + displayHpPercentage * fullAngle;
                ctx.arc(unitX, unitY, healthRingCenterlineRadius, healthEndAngle, startAngle + fullAngle, false);
                ctx.stroke();
            }

            if (displayHpPercentage > 0) {
                ctx.beginPath(); 
                ctx.strokeStyle = isShielded ? SHIELD_COLOR : '#32CD32'; 
                const currentHealthEndAngle = startAngle + displayHpPercentage * fullAngle;
                ctx.arc(unitX, unitY, healthRingCenterlineRadius, startAngle, currentHealthEndAngle, false);
                ctx.stroke();
            }
            
            ctx.lineWidth = originalLineWidth; 
            ctx.lineCap = originalLineCap;
        }

        function drawFortificationOutlines() {
            const currentHexSize = HEX_SIZE * gameState.renderScale; 
            const fortifiedTilesP1 = new Set();
            const fortifiedTilesP2 = new Set();

            gameState.tiles.forEach((tile, key) => {
                if (tile.fortifiedByPlayer === 1) fortifiedTilesP1.add(key);
                else if (tile.fortifiedByPlayer === 2) fortifiedTilesP2.add(key);
            });

            // --- Handle Base Camp Tiles (Array or String) ---
            const addBaseTiles = (baseData, set) => {
                if (Array.isArray(baseData)) {
                    baseData.forEach(key => set.add(key));
                } else if (baseData) {
                    const [h1, h2] = parseEdgeKey(baseData);
                    if (!isNaN(h1.q)) set.add(getTileKey(h1.q, h1.r));
                    if (!isNaN(h2.q)) set.add(getTileKey(h2.q, h2.r));
                }
            };
            addBaseTiles(gameState.baseCampPositions.player1, fortifiedTilesP1);
            addBaseTiles(gameState.baseCampPositions.player2, fortifiedTilesP2);

            const drawBordersForPlayer = (tileSet, color) => {
                tileSet.forEach(tileKey => {
                    const tile = gameState.tiles.get(tileKey);
                    if (!tile) return;

                    const { x: centerX, y: centerY } = axialToPixel(tile.q, tile.r);

                    for (let i = 0; i < 6; i++) {
                        const neighborDir = AXIAL_DIRECTIONS[i];
                        const neighborQ = tile.q + neighborDir.q;
                        const neighborR = tile.r + neighborDir.r;
                        const neighborKey = getTileKey(neighborQ, neighborR);

                        // Only draw edge if neighbor is NOT in the same set (internal edges hidden)
                        if (!tileSet.has(neighborKey)) {
                             const v1_idx = MAP_DIRECTION_TO_EDGE_INDEX[i];
                             const v2_idx = (v1_idx + 1) % 6;
                             
                             const vert1_angle = Math.PI / 180 * (60 * v1_idx - 30);
                             const edge_v1_x = centerX + currentHexSize * Math.cos(vert1_angle);
                             const edge_v1_y = centerY + currentHexSize * Math.sin(vert1_angle);

                             const vert2_angle = Math.PI / 180 * (60 * v2_idx - 30);
                             const edge_v2_x = centerX + currentHexSize * Math.cos(vert2_angle);
                             const edge_v2_y = centerY + currentHexSize * Math.sin(vert2_angle);
                             
                             ctx.beginPath();
                             ctx.moveTo(edge_v1_x, edge_v1_y);
                             ctx.lineTo(edge_v2_x, edge_v2_y);
                             ctx.strokeStyle = color;
                             ctx.lineWidth = 5;
                             ctx.stroke();
                        }
                    }
                });
            };

            drawBordersForPlayer(fortifiedTilesP1, currentDrawingColors.player1.primary);
            drawBordersForPlayer(fortifiedTilesP2, currentDrawingColors.player2.primary);
        }

        function drawContestedEdgeIndicator() {
            const CONTESTED_EDGE_COLOR = '#C440C4';
            const currentHexSize = HEX_SIZE * gameState.renderScale; // SCALED SIZE

            gameState.edges.forEach(edge => {
                if (edge.units.length < 2) return;

                const playerOnEdge = edge.units[0].player;
                const allUnitsSamePlayer = edge.units.every(u => u.player === playerOnEdge);
                if (!allUnitsSamePlayer) return;

                const hasArcher = edge.units.some(u => u.type.name === 'Archer');
                const hasMelee = edge.units.some(u => u.type.name === 'Melee');
                
                if (!hasArcher || !hasMelee) return;

                const opponentPlayer = playerOnEdge === 1 ? 2 : 1;
                const tile1 = gameState.tiles.get(getTileKey(edge.q1, edge.r1));
                const tile2 = gameState.tiles.get(getTileKey(edge.q2, edge.r2));
                const isContested = (tile1 && tile1.fortifiedByPlayer === opponentPlayer) || 
                                  (tile2 && tile2.fortifiedByPlayer === opponentPlayer);

                if (isContested) {
                    const p1_center = axialToPixel(edge.q1, edge.r1);
                    const p2_center = axialToPixel(edge.q2, edge.r2);
                    const edgeMidX = (p1_center.x + p2_center.x) / 2;
                    const edgeMidY = (p1_center.y + p2_center.y) / 2;

                    let perp_dx = -(p2_center.y - p1_center.y);
                    let perp_dy = p2_center.x - p1_center.x;
                    const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);

                    if (len_perp_vec > 0) {
                        const scale = currentHexSize / 2;
                        perp_dx = (perp_dx / len_perp_vec) * scale;
                        perp_dy = (perp_dy / len_perp_vec) * scale;
                        
                        const startX = edgeMidX + perp_dx;
                        const startY = edgeMidY + perp_dy;
                        const endX = edgeMidX - perp_dx;
                        const endY = edgeMidY - perp_dy;

                        ctx.beginPath();
                        ctx.moveTo(startX, startY);
                        ctx.lineTo(endX, endY);
                        ctx.strokeStyle = CONTESTED_EDGE_COLOR;
                        ctx.lineWidth = 5;
                        ctx.stroke();
                    }
                }
            });
        }

        function drawPulsatingBridgeHighlights() {
            if (gameState.currentActionState !== ACTION_STATES.SELECTING_BRIDGE_EDGE) return;
            if (!gameState.validBridgeTargetEdgeKeys || gameState.validBridgeTargetEdgeKeys.length === 0) return;

            // Calculate pulsating opacity using a sine wave
            const currentTime = Date.now();
            const pulseDuration = 1750; 
            const progress = (currentTime % pulseDuration) / pulseDuration; // 0.0 to 1.0
            const sinValue = (Math.sin(progress * 2 * Math.PI) + 1) / 2; // 0.0 to 1.0, smoothly oscillating

            const minOpacity = 0.33;
            const maxOpacity = 0.66;
            const opacity = minOpacity + sinValue * (maxOpacity - minOpacity);

            ctx.save();
            ctx.globalAlpha = opacity; // Apply the translucency to the entire drawing operation

            gameState.validBridgeTargetEdgeKeys.forEach(edgeKey => {
                const edge = gameState.edges.get(edgeKey);
                if (edge) {
                    // Call with simpleRender = true to hide the planks
                    drawBridge(edge, undefined, undefined, undefined, true);
                }
            });

            ctx.restore(); // Restore globalAlpha to 1.0
        }

        function drawActionSelectionHighlights(targetKeys, type) {
            if (!targetKeys || targetKeys.length === 0) return;
            const currentHexSize = HEX_SIZE * gameState.renderScale; // SCALED SIZE
            let fillColor, strokeColor;
            switch(type) {
                case 'fortify':
                    fillColor = 'rgba(255, 255, 0, 0.3)'; strokeColor = '#FFD700';
                    targetKeys.forEach(tileKey => {
                        const tile = gameState.tiles.get(tileKey);
                        if (tile) {
                           const { x, y } = axialToPixel(tile.q, tile.r); ctx.beginPath();
                           for (let i = 0; i < 6; i++) {
                               const angle = Math.PI / 180 * (60 * i - 30);
                               const vx = x + currentHexSize * Math.cos(angle); const vy = y + currentHexSize * Math.sin(angle);
                               if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                           }
                           ctx.closePath(); ctx.fillStyle = fillColor; ctx.fill();
                           ctx.strokeStyle = strokeColor; ctx.lineWidth = 3; ctx.stroke();
                        }
                    });
                    break;
                case 'unfortify':
                    fillColor = 'rgba(0, 150, 255, 0.4)';
                    strokeColor = '#007ACC';
                    targetKeys.forEach(edgeKey => {
                        const edge = gameState.edges.get(edgeKey);
                        if (edge) {
                            const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                            ctx.beginPath(); ctx.arc(mid.x, mid.y, currentHexSize * 0.25, 0, 2 * Math.PI);
                            ctx.fillStyle = fillColor; ctx.fill();
                            ctx.strokeStyle = strokeColor; ctx.lineWidth = 2; ctx.stroke();
                        }
                    });
                    break;
                
                case 'bridge': // Adding case for bridge highlights if needed, generally covered by pulsating bridge
                     break;
            }
        }

        function drawBridge(edge, color = '#8B4513', outlineColor = null, outlineWidth = 0, simpleRender = false) {
            const p1_center = axialToPixel(edge.q1, edge.r1);
            const p2_center = axialToPixel(edge.q2, edge.r2);
            const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
            const angle = Math.atan2(p2_center.y - p1_center.y, p2_center.x - p1_center.x);
    
            const currentHexSize = HEX_SIZE * gameState.renderScale; // SCALED SIZE

            // The main bridge body dimensions
            const bridgeLength = currentHexSize * 0.9; 
            const bridgeThickness = currentHexSize * 0.15;

            ctx.save();
            ctx.translate(mid.x, mid.y);
            ctx.rotate(angle + Math.PI / 2); // Rotate to align with the edge itself

            // --- Draw the main bridge body (darker brown) ---
            ctx.fillStyle = color; 
            ctx.fillRect(-bridgeLength / 2, -bridgeThickness / 2, bridgeLength, bridgeThickness);
    
            // --- Conditionally draw the 4 perpendicular planks ---
            if (!simpleRender) {
                const plankColor = '#A0522D'; 
                const plankLength = bridgeThickness * 1.2; 
                const plankWidth = 5 * gameState.renderScale; // Scale the plank width too
                const gap = bridgeLength / 4.5; 

                ctx.fillStyle = plankColor;
                ctx.fillRect(-gap * 1.5 - (plankWidth / 2), -plankLength / 2, plankWidth, plankLength);
                ctx.fillRect(-gap * 0.5 - (plankWidth / 2), -plankLength / 2, plankWidth, plankLength);
                ctx.fillRect(gap * 0.5 - (plankWidth / 2), -plankLength / 2, plankWidth, plankLength);
                ctx.fillRect(gap * 1.5 - (plankWidth / 2), -plankLength / 2, plankWidth, plankLength);
            }

            if (outlineColor && outlineWidth > 0) {
                ctx.strokeStyle = outlineColor;
                ctx.lineWidth = outlineWidth;
                ctx.strokeRect(-bridgeLength / 2, -bridgeThickness / 2, bridgeLength, bridgeThickness);
            }

            ctx.restore();
        }

        function drawBridgeAttackHighlightsOnly(targetsToHighlight) {
            if (!targetsToHighlight || targetsToHighlight.length === 0) return;
            targetsToHighlight.forEach(targetInfo => {
                if (targetInfo.isBridgeTarget && targetInfo.edgeKey) {
                    const edge = gameState.edges.get(targetInfo.edgeKey);
                    if (edge && edge.bridge) drawBridge(edge, 'rgba(139, 69, 19, 0.5)', 'rgba(255, 0, 0, 0.9)', 3);
                }
            });
        }

        function drawFlags() {
            if (gameState.gameMode === 'arcade') return;
    
            const FLAG_SCALE_FACTOR = 0.21; 

            const renderFlagAt = (player, x, y) => {
                const teamColor = currentDrawingColors[`player${player}`].secondary;
                const flagIconColor = '#F0F0F0'; 
                const flagPoleColor = '#2c3e50';
        
                // Calculate size based on the multiplier and current zoom level
                const circleRadius = (HEX_SIZE * gameState.renderScale) * FLAG_SCALE_FACTOR;
                const flagSize = circleRadius * 1.2; 

        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.arc(0, 0, circleRadius, 0, 2 * Math.PI);
        ctx.fillStyle = teamColor; 
        ctx.fill();
        ctx.strokeStyle = '#1a252f';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-3, flagSize * 0.5);
        ctx.lineTo(-3, -flagSize * 0.5);
        ctx.strokeStyle = flagPoleColor;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-2, -flagSize * 0.5);
        ctx.lineTo(flagSize * 0.45, -flagSize * 0.3);
        ctx.lineTo(-2, -flagSize * 0);
        ctx.closePath();
        ctx.fillStyle = flagIconColor; 
        ctx.fill(); 
        ctx.restore();
    };

    // 1. GAMEPLAY MODE (Uses gameState.flags)
    if (!gameState.mapMakerMode && gameState.flags) {
        Object.values(gameState.flags).forEach(flag => {
            if (flag.status === 'at_base' && flag.homePosition) {
                if (Array.isArray(flag.homePosition)) {
                    // Expansive Mode (Tile Array)
                    const pos = calculateBaseCentroid(flag.homePosition);
                    if (pos) renderFlagAt(flag.player, pos.x, pos.y);
                } else {
                    // Standard Mode (Edge String)
                    const edge = gameState.edges.get(flag.homePosition);
                    if (edge) {
                        const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                        renderFlagAt(flag.player, mid.x, mid.y);
                    }
                }
            }
        });
    }
    // 2. MAP MAKER MODE (Expansive Preview)
    else if (gameState.mapMakerMode && gameState.gridRadius === 4) {
        for(let p = 1; p <= 2; p++) {
            const base = gameState.baseCampPositions[`player${p}`];
            if (Array.isArray(base) && base.length === 3) {
                const pos = calculateBaseCentroid(base);
                if (pos) renderFlagAt(p, pos.x, pos.y);
            }
        }
    }
            // 3. MAP MAKER MODE (Standard Preview)
            else if (gameState.mapMakerMode && gameState.gridRadius === 3) {
                if (gameState.flags) {
                    Object.values(gameState.flags).forEach(flag => {
                        const edge = gameState.edges.get(flag.homePosition);
                        if (edge) {
                            const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                            renderFlagAt(flag.player, mid.x, mid.y);
                        }
                    });
                }
            }
        }

        function drawUnitAttackHighlightsOnly(targetsToHighlight) {
    if (!targetsToHighlight || targetsToHighlight.length === 0) return;

    // --- FIX: Apply renderScale to the highlight radius and offset ---
    const unitSizeToHighlight = (HEX_SIZE * 0.3) * gameState.renderScale;
    const scaledOffset = UNIT_ON_EDGE_OFFSET * gameState.renderScale;

    targetsToHighlight.forEach(targetInfo => {
        if (!targetInfo.isBridgeTarget && targetInfo.unit) {
            const targetUnit = targetInfo.unit; 
            let unitX, unitY;
            
            if (targetUnit.isFortified && targetUnit.positionType === 'center' && targetInfo.tileKeyForTarget) {
                const tile = gameState.tiles.get(targetInfo.tileKeyForTarget);
                if (tile) { 
                    const centerPixel = axialToPixel(tile.q, tile.r); 
                    unitX = centerPixel.x; 
                    unitY = centerPixel.y; 
                } else return;
            } else if (targetInfo.edgeKey) {
                const edge = gameState.edges.get(targetInfo.edgeKey); 
                if (!edge) return;
                
                const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2); 
                unitX = mid.x; 
                unitY = mid.y;
                
                const edgeUnitsOnly = edge.units.filter(u => u.positionType === 'edge');
                const unitIndexOnEdge = edgeUnitsOnly.findIndex(u => u.id === targetUnit.id);
                
                if (edgeUnitsOnly.length > 1 && unitIndexOnEdge !== -1) {
                    const offsetSign = (unitIndexOnEdge % 2 === 0) ? -1 : 1;
                    const p1 = axialToPixel(edge.q1, edge.r1); 
                    const p2 = axialToPixel(edge.q2, edge.r2);
                    let dx = p2.x - p1.x, dy = p2.y - p1.y; 
                    const len = Math.sqrt(dx*dx + dy*dy) || 1;
                    let perpX = -dy / len, perpY = dx / len;
                    
                    // --- FIX: Use the scaled offset here ---
                    unitX += perpX * scaledOffset * offsetSign * (0.5);
                    unitY += perpY * scaledOffset * offsetSign * (0.5);
                }
            } else return;
            
            ctx.beginPath(); 
            ctx.arc(unitX, unitY, unitSizeToHighlight, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)'; 
            ctx.lineWidth = 3; 
            ctx.stroke();
        }
    });
}

// --- TINTED IMAGE CACHE ---
// Prevents the canvas from running expensive tint operations every frame.
const TINTED_IMAGE_CACHE = {};

function getTintedImage(img, color) {
    if (!img || !img.complete || img.naturalWidth === 0) return img;
    
    // Create a unique key (e.g., "assets/units/Melee_unit.png_#FFC020")
    const cacheKey = img.src + '_' + color;
    if (TINTED_IMAGE_CACHE[cacheKey]) return TINTED_IMAGE_CACHE[cacheKey];

    // Create a temporary, invisible off-screen canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.naturalWidth;
    tempCanvas.height = img.naturalHeight;
    const tCtx = tempCanvas.getContext('2d');
    
    // Draw original image
    tCtx.drawImage(img, 0, 0);
    
    // 'source-in' tells the canvas to ONLY paint where pixels already exist!
    tCtx.globalCompositeOperation = 'source-in';
    tCtx.fillStyle = color;
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Save to cache and return
    TINTED_IMAGE_CACHE[cacheKey] = tempCanvas;
    return tempCanvas;
}

const UNIT_IMAGE_CONFIG = {
    MELEE:    { widthScale: 0.75, heightScale: 0.75, offsetX: 0, offsetY: 0 },
    ARCHER:   { widthScale: 0.75, heightScale: 0.75, offsetX: 0, offsetY: 0 },
    PIKEMAN:  { widthScale: 0.75, heightScale: 0.7, offsetX: 0, offsetY: 0 },
    HORSEMAN: { widthScale: 0.66, heightScale: 0.66, offsetX: 0, offsetY: 0 }, 
    DEFAULT:  { widthScale: 0.75, heightScale: 0.75, offsetX: 0, offsetY: 0 }
};

function drawUnitSymbol(ctx, unit, x, y, radius, symbolColor) {
    const typeKey = unit.typeId || unit.type.name.toUpperCase();
    
    // Uses the low-res map assets
    const img = IMAGE_ASSETS.map_units[typeKey]; 

    const config = UNIT_IMAGE_CONFIG[typeKey] || UNIT_IMAGE_CONFIG.DEFAULT;

    const baseDiameter = radius * 2;
    const finalWidth = baseDiameter * config.widthScale;
    const finalHeight = baseDiameter * config.heightScale;

    if (img && img.complete && img.naturalHeight !== 0) {
        ctx.save();
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // --- VISUAL FEEDBACK: Shadows & Glows ---
        if (symbolColor === PALETTE.YELLOW_GOLD) {
            ctx.shadowColor = PALETTE.YELLOW_GOLD;
            ctx.shadowBlur = 12;
        } 


        // --- APPLY THE TINT ---
        let imageToDraw = img;
        // If the color isn't standard white, grab the tinted version from our cache!
        if (symbolColor === PALETTE.YELLOW_GOLD || symbolColor === PALETTE.BLACK_INK || symbolColor === '#000') {
            imageToDraw = getTintedImage(img, symbolColor);
        }

        const drawX = (x - finalWidth / 2) + config.offsetX;
        const drawY = (y - finalHeight / 2) + config.offsetY;

        ctx.drawImage(imageToDraw, drawX, drawY, finalWidth, finalHeight);
        
        ctx.restore();
    } else {
        const symbolDisplaySize = Math.max(1, radius);
        ctx.fillStyle = symbolColor || '#FFF';
        ctx.font = `bold ${symbolDisplaySize * 1.5}px 'Exo 2'`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(unit.type.symbol, x, y);
    }
}

        function drawSingleUnit(ctx, unit, x, y, radius, overrideSymbolColor = null, isPalette = false) {

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = unit.player === 1 ? currentDrawingColors.player1.primary : currentDrawingColors.player2.primary;
            ctx.fill();

            if (!isPalette && unit.maxHp > 0) { // Only draw health bar if not in palette
                const healthBarVisualThickness = radius * 0.3;
                drawUnitHealthBar(ctx, x, y, radius, healthBarVisualThickness, unit.hp, unit.maxHp);
            }
            
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            
            let mainBorderColor;
            let mainBorderWidth = 3;

            // In palette mode, don't show selection/hover/flag highlights
            if (isPalette) {
                 mainBorderColor = '#000';
                 mainBorderWidth = 1.5;
            } else {
                if (unit.isCarryingFlag) {
                    const enemyPlayer = unit.player === 1 ? 2 : 1;
                    mainBorderColor = currentDrawingColors[`player${enemyPlayer}`].primary;
                } else if (gameState.selectedUnit && gameState.selectedUnit.id === unit.id) {
                    mainBorderColor = '#FFD700';
                } else if (gameState.hoveredUnitId === unit.id && unit.player === gameState.currentPlayer) {
                    mainBorderColor = '#ADD8E6'; 
                    mainBorderWidth = 2.5;
                } else {
                    mainBorderColor = unit.isFortified ? '#FFF' : '#000';
                    mainBorderWidth = unit.isFortified ? 2 : 1.5;
                }
            }
            
            ctx.strokeStyle = mainBorderColor;
            ctx.lineWidth = mainBorderWidth;
            ctx.stroke();

            let symbolColor = overrideSymbolColor;
            
            if (!symbolColor) {
                // Gold priority for Veterans, otherwise standard White
                if (unit.level > 0 && !isPalette) {
                    symbolColor = PALETTE.YELLOW_GOLD;
                } else {
                    symbolColor = PALETTE.WHITE_OFF;
                }
            }

            const radiusForSymbol = isPalette ? radius : (radius - (radius * 0.3));
            drawUnitSymbol(ctx, unit, x, y, radiusForSymbol, symbolColor);
        }

        function drawUnits() {
            const isEffectivelyDragging = gameState.isDragging && !gameState.mapMakerMode;
            const animatedUnitIds = new Set(gameState.activeAnimations.map(a => (a.unit || a.attacker).id));
            const offsetDistance = UNIT_ON_EDGE_OFFSET * gameState.renderScale;

            gameState.edges.forEach((edge) => {
                const edgeUnitsOnly = edge.units.filter(u => u.positionType === 'edge' && (!isEffectivelyDragging || u.id !== gameState.draggingUnit.id));
                if (edgeUnitsOnly.length > 0) {
                    const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                    const p1_hex_center = axialToPixel(edge.q1, edge.r1); const p2_hex_center = axialToPixel(edge.q2, edge.r2);
                    let dx_centers = p2_hex_center.x - p1_hex_center.x; let dy_centers = p2_hex_center.y - p1_hex_center.y;
                    const len_centers = Math.sqrt(dx_centers*dx_centers + dy_centers*dy_centers) || 1;
                    let perpX = -dy_centers / len_centers; let perpY = dx_centers / len_centers;
                    
                    edgeUnitsOnly.forEach((unit, index) => {
                        if (animatedUnitIds.has(unit.id)) return;
                        let unitX = mid.x, unitY = mid.y;
                        if (edgeUnitsOnly.length > 1) {
                            const offsetSign = (index % 2 === 0) ? -1 : 1;
                            unitX += perpX * offsetDistance * offsetSign * (0.5); 
                            unitY += perpY * offsetDistance * offsetSign * (0.5);
                        }
                        drawSingleUnit(ctx, unit, unitX, unitY, UNIT_DRAW_SIZE_ON_EDGE * gameState.renderScale);
                    });
                }
            });

            gameState.units.forEach(unit => {
                if (animatedUnitIds.has(unit.id)) return;
                if (unit.isFortified && unit.positionType === 'center' && (!isEffectivelyDragging || unit.id !== gameState.draggingUnit.id)) {
                    const tile = gameState.tiles.get(unit.position);
                    if (tile) {
                        const {x, y} = axialToPixel(tile.q, tile.r);
                        
                        // --- VISUAL FIX: Alternate Opacity if covering Flag ---
                        let alpha = 1.0;
                        if (gameState.flags && gameState.gridRadius === 4) {
                            const myFlag = gameState.flags[`p${unit.player}_flag`];
                            // Check if flag is at base and base is defined as an array (Expansive)
                            if (myFlag && myFlag.status === 'at_base' && Array.isArray(myFlag.homePosition)) {
                                const flagPos = calculateBaseCentroid(myFlag.homePosition);
                                // Check if unit center is on top of the flag center
                                if (flagPos && distSq({x, y}, flagPos) < 1) {
                                    const time = Date.now();
                                    // Pulse opacity full range 0.0 to 1.0
                                    alpha = (Math.sin(time / 500) + 1) / 2; 
                                }
                            }
                        }
                        
                        ctx.save();
                        ctx.globalAlpha = alpha;
                        drawSingleUnit(ctx, unit, x, y, FORTIFIED_UNIT_DRAW_SIZE * gameState.renderScale);
                        ctx.restore();
                    }
                }
            });

            if (isEffectivelyDragging && gameState.draggingUnit) {
                const unit = gameState.draggingUnit;
                const unitX = gameState.dragUnitRenderX;
                const unitY = gameState.dragUnitRenderY;
                const baseRadius = unit.isFortified ? FORTIFIED_UNIT_DRAW_SIZE : UNIT_DRAW_SIZE_ON_EDGE;
                const fullRadius = (baseRadius * gameState.renderScale) * DRAG_SCALE_FACTOR;

                if (gameSettings.fancyVisualsEnabled) {
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                    ctx.shadowBlur = 25;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    const shadowCasterRadius = fullRadius * 0.8;
                    ctx.beginPath();
                    ctx.arc(unitX, unitY, shadowCasterRadius, 0, 2 * Math.PI);
                    ctx.fillStyle = '#000';
                    ctx.fill();
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                }
                drawSingleUnit(ctx, unit, unitX, unitY, fullRadius);
            }
        }

        function drawMovementHighlights() {
            const unitForHighlights = gameState.isDragging ? gameState.draggingUnit : gameState.selectedUnit;
            const isActionSelectionActive = gameState.currentActionState !== ACTION_STATES.IDLE && 
                                    gameState.currentActionState !== ACTION_STATES.UNIT_SELECTED;

            if (!unitForHighlights || unitForHighlights.isFortified || (!gameState.isDragging && isActionSelectionActive)) {
                return;
            }
    
            if (gameState.gameMode === 'singleplayer' && unitForHighlights.player !== gameState.playerSide) {
                return;
            }
            
            if (!gameState.isDragging) {
                if (unitForHighlights.currentMove < 1) return;
                if (unitForHighlights.hasPerformedMajorAction && !unitForHighlights.type.canMoveAfterAttack) {
                    return;
                }
            }

            const highlightRadius = (HEX_SIZE * 0.2) * gameState.renderScale; // SCALED SIZE

            gameState.currentReachableMoves.forEach((data, edgeKey) => {
                if (!gameState.isDragging && edgeKey === unitForHighlights.position) return;
                const edge = gameState.edges.get(edgeKey);
                if (edge) {
                    const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                    ctx.beginPath(); ctx.arc(mid.x, mid.y, highlightRadius, 0, 2 * Math.PI);
                    ctx.fillStyle = 'rgba(0, 255, 0, 0.4)'; ctx.fill();
                    ctx.strokeStyle = 'rgba(0, 100, 0, 0.6)'; ctx.lineWidth = 2; ctx.stroke();
                }
            });
        }

        function drawDebugPath() {
            const currentTime = Date.now();

            if (gameState.potentialDebugPathToDraw && gameState.debugPathHoverStartTime !== null) {
                if (currentTime - gameState.debugPathHoverStartTime >= PATH_DRAW_HOVER_DELAY_MS) {
                    if (gameState.debugPathToDraw !== gameState.potentialDebugPathToDraw) {
                        gameState.debugPathToDraw = gameState.potentialDebugPathToDraw;
                        gameState.debugPathAnimationStartTime = currentTime; 
                        gameState.debugPathPauseStartTime = null;
                        gameState.lastDebugPathKey = gameState.debugPathToDraw ? gameState.debugPathToDraw.join('-') : null;
                    }
                }
            } else if (!gameState.potentialDebugPathToDraw && gameState.debugPathToDraw !== null) {
                gameState.debugPathToDraw = null;
                gameState.debugPathAnimationStartTime = null;
                gameState.debugPathPauseStartTime = null;
                gameState.lastDebugPathKey = null;
            }

            const pathEdgeKeysArray = gameState.debugPathToDraw;
            if (!pathEdgeKeysArray || pathEdgeKeysArray.length < 2) {
                return; 
            }
            
            let progress = 0;
            if (gameState.debugPathPauseStartTime !== null) { 
                if (currentTime - gameState.debugPathPauseStartTime >= PATH_DRAW_PAUSE_DURATION_MS) {
                    gameState.debugPathAnimationStartTime = currentTime; 
                    gameState.debugPathPauseStartTime = null;
                    progress = 0; 
                } else {
                    progress = 1.0; 
                }
            } else if (gameState.debugPathAnimationStartTime !== null) { 
                const elapsedTime = currentTime - gameState.debugPathAnimationStartTime;
                progress = elapsedTime / PATH_DRAW_ANIMATION_DURATION_MS;

                if (progress >= 1.0) {
                    progress = 1.0;
                    if (gameState.lastDebugPathKey === pathEdgeKeysArray.join('-')) {
                        gameState.debugPathPauseStartTime = currentTime; 
                    }
                }
            } else {
                return; 
            }
            
            progress = Math.min(1, progress); 


            ctx.save();
            ctx.strokeStyle = '#E6C410'; 
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const points = pathEdgeKeysArray.map(edgeKey => {
                const edge = gameState.edges.get(edgeKey);
                if (!edge) return null;
                return getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
            }).filter(p => p !== null);

            if (points.length < 2) { ctx.restore(); return; }

            let totalPathLength = 0;
            for (let i = 0; i < points.length - 1; i++) {
                totalPathLength += pointDistance(points[i], points[i+1]);
            }
            if (totalPathLength === 0) { ctx.restore(); return; }

            const drawableLength = totalPathLength * progress;
            let lengthDrawn = 0;

            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);

            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i+1];
                const segmentLength = pointDistance(p1, p2);

                if (lengthDrawn + segmentLength <= drawableLength) {
                    ctx.lineTo(p2.x, p2.y);
                    lengthDrawn += segmentLength;
                } else {
                    const remainingLengthToDraw = drawableLength - lengthDrawn;
                    if (remainingLengthToDraw > 0 && segmentLength > 0) {
                        const fraction = remainingLengthToDraw / segmentLength;
                        const endX = p1.x + (p2.x - p1.x) * fraction;
                        const endY = p1.y + (p2.y - p1.y) * fraction;
                        ctx.lineTo(endX, endY);
                    }
                    break; 
                }
            }
            ctx.stroke();
            ctx.restore();
        }

        function drawDebugAttackRangeHighlights() {
            const currentHexSize = HEX_SIZE * gameState.renderScale;
            const currentTime = Date.now();

    // --- 1. DEBUG MODE: Show Theoretical Range (RED - Constant) ---
    if (gameSettings.debugModeEnabled && gameState.selectedUnit) {
        const unit = gameState.selectedUnit;
        let theoreticalEdges = new Set();
        let theoreticalTiles = new Set();

        if (unit.type.attackType === 'melee') {
            // Melee Edges
            const edges = getPotentialMeleeAttackEdges(unit);
            edges.forEach(e => theoreticalEdges.add(e));

            // Melee Tiles (Adjacent Centers) - ONLY if on Edge
            if (unit.positionType === 'edge') {
                const [h1, h2] = parseEdgeKey(unit.position);
                if (!isNaN(h1.q)) theoreticalTiles.add(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) theoreticalTiles.add(getTileKey(h2.q, h2.r));
            } 
        } 
        else if (unit.type.name === 'Archer') {
            const visibilityData = getVisibleKeysFromUnit(unit);
            
            // Archer Edges: Filter Visible edges based on Range Rules
            visibilityData.edges.forEach(e => {
                let isAttackable = true;
                
                // Restriction A: Edge Archer
                if (unit.positionType === 'edge') {
                    const [h1, h2] = parseEdgeKey(unit.position);
                    const inA = !isNaN(h1.q) && isEdgePartOfTile(h1.q, h1.r, e);
                    const inB = !isNaN(h2.q) && isEdgePartOfTile(h2.q, h2.r, e);
                    if (!inA && !inB) isAttackable = false;
                }

                // Restriction B: Fortified Archer (Low Visibility)
                if (unit.positionType === 'center' && unit.isFortified) {
                    const sourceTile = gameState.tiles.get(unit.position);
                    if (sourceTile && getTileVisibility(sourceTile) <= 1) {
                        if (!isEdgePartOfTile(sourceTile.q, sourceTile.r, e)) {
                            isAttackable = false;
                        }
                    }
                }
                
                if (isAttackable) theoreticalEdges.add(e);
            });

            // Archer Tiles: Can only attack visible tiles with Visibility > 1
            visibilityData.tiles.forEach(tKey => {
                const t = gameState.tiles.get(tKey);
                if (t && getTileVisibility(t) > 1) {
                    theoreticalTiles.add(tKey);
                }
            });
        }

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(255, 50, 50, 0.8)`; // Constant Red, high opacity
        ctx.fillStyle = `rgba(255, 50, 50, 0.3)`;   // Semi-transparent Red for tiles

        // Draw Edges
        theoreticalEdges.forEach(edgeKey => {
            const edge = gameState.edges.get(edgeKey);
            if (!edge) return;

            const p1_center = axialToPixel(edge.q1, edge.r1);
            const p2_center = axialToPixel(edge.q2, edge.r2);
            
            const edgeMidX = (p1_center.x + p2_center.x) / 2;
            const edgeMidY = (p1_center.y + p2_center.y) / 2;

            let perp_dx = -(p2_center.y - p1_center.y);
            let perp_dy = p2_center.x - p1_center.x;
            const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);

            if (len_perp_vec > 0) {
                const scale = (currentHexSize / 2) * 0.9;
                const dx = (perp_dx / len_perp_vec) * scale;
                const dy = (perp_dy / len_perp_vec) * scale;

                ctx.beginPath();
                ctx.moveTo(edgeMidX + dx, edgeMidY + dy);
                ctx.lineTo(edgeMidX - dx, edgeMidY - dy);
                ctx.stroke();
            }
        });

        // Draw Tile Centers (Targetable Forts)
        theoreticalTiles.forEach(tileKey => {
            const tile = gameState.tiles.get(tileKey);
            if (tile) {
                const { x, y } = axialToPixel(tile.q, tile.r);
                
                ctx.beginPath();
                const radius = currentHexSize * 0.4;
                for (let i = 0; i < 6; i++) {
                    const angle = Math.PI / 180 * (60 * i - 30);
                    const vx = x + radius * Math.cos(angle);
                    const vy = y + radius * Math.sin(angle);
                    if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
        });

        ctx.restore();
    }

    // --- 2. GAMEPLAY MODE: Show Valid Targets (ORANGE) ---
    if (gameState.currentActionState === ACTION_STATES.SELECTING_ATTACK_TARGET && gameState.debugAttackRangeHighlights.length > 0) {
        const pulseProgress = (currentTime % PULSE_DURATION_MS) / PULSE_DURATION_MS; 
        const opacity = 0.5 + 0.4 * (Math.sin(pulseProgress * 2 * Math.PI) + 1) / 2;
        
        ctx.save();
        ctx.strokeStyle = `rgba(255, 140, 0, ${opacity})`; 
        ctx.lineWidth = 5; 

        gameState.debugAttackRangeHighlights.forEach(edgeKey => {
            const edge = gameState.edges.get(edgeKey);
            if (!edge) return;

            const p1_center = axialToPixel(edge.q1, edge.r1);
            const p2_center = axialToPixel(edge.q2, edge.r2);

            const edgeMidX = (p1_center.x + p2_center.x) / 2;
            const edgeMidY = (p1_center.y + p2_center.y) / 2;

            let perp_dx = -(p2_center.y - p1_center.y);
            let perp_dy = p2_center.x - p1_center.x;
            const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);

                    if (len_perp_vec > 0) {
                        const scale = (currentHexSize / 2) * 0.95; 
                        const dx = (perp_dx / len_perp_vec) * scale;
                        const dy = (perp_dy / len_perp_vec) * scale;

                        ctx.beginPath();
                        ctx.moveTo(edgeMidX + dx, edgeMidY + dy);
                        ctx.lineTo(edgeMidX - dx, edgeMidY - dy);
                        ctx.stroke();
                    }
                });
                ctx.restore();
            }
        }

        function drawDebugVisibilityHighlights() {
            if (!gameSettings.debugModeEnabled) return;

            let visibilityData = null;

            // Prioritize Unit selection, then Base selection
            if (gameState.selectedUnit) {
                visibilityData = getVisibleKeysFromUnit(gameState.selectedUnit);
        } else if (gameState.debugSelectedBasePlayer) {
                visibilityData = getBaseVisibility(gameState.debugSelectedBasePlayer);
            }

            if (!visibilityData) return;

            const visibleEdges = visibilityData.edges;
            const visibleTiles = visibilityData.tiles;

            // Calculate pulsing alpha
            const currentTime = Date.now();
            const pulseDuration = 1000;
            const alpha = 0.3 + 0.4 * (Math.sin(currentTime / pulseDuration * 2 * Math.PI) + 1) / 2; 

            const currentHexSize = HEX_SIZE * gameState.renderScale;

            ctx.save();
            // Use slightly different color for Base vs Unit to distinguish
            if (gameState.debugSelectedBasePlayer && !gameState.selectedUnit) {
                ctx.strokeStyle = `rgba(0, 255, 255, ${alpha + 0.3})`; // Cyan for Base
                ctx.fillStyle = `rgba(0, 255, 255, ${alpha})`;
            } else {
                ctx.strokeStyle = `rgba(255, 255, 0, ${alpha + 0.3})`; // Yellow for Unit
                ctx.fillStyle = `rgba(255, 255, 0, ${alpha})`;
            }
            ctx.lineWidth = 5;

            // 1. Draw Visible Tile Centers
            visibleTiles.forEach(tileKey => {
                const tile = gameState.tiles.get(tileKey);
                if (tile) {
                    const { x, y } = axialToPixel(tile.q, tile.r);
                    ctx.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.PI / 180 * (60 * i - 30);
                        const vx = x + currentHexSize * 0.6 * Math.cos(angle); 
                        const vy = y + currentHexSize * 0.6 * Math.sin(angle);
                        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                    }
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }
            });

            // 2. Draw Visible Edges
            visibleEdges.forEach(edgeKey => {
                const edge = gameState.edges.get(edgeKey);
                if (edge) {
                    const p1_center = axialToPixel(edge.q1, edge.r1);
                    const p2_center = axialToPixel(edge.q2, edge.r2);
            
                    const edgeMidX = (p1_center.x + p2_center.x) / 2;
                    const edgeMidY = (p1_center.y + p2_center.y) / 2;

                    let perp_dx = -(p2_center.y - p1_center.y);
                    let perp_dy = p2_center.x - p1_center.x;
                    const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);

                    if (len_perp_vec > 0) {
                        const scale = (currentHexSize / 2) * 0.8;
                        const dx = (perp_dx / len_perp_vec) * scale;
                        const dy = (perp_dy / len_perp_vec) * scale;

                        ctx.beginPath();
                        ctx.moveTo(edgeMidX + dx, edgeMidY + dy);
                        ctx.lineTo(edgeMidX - dx, edgeMidY - dy);
                        ctx.stroke();
                    }
                }
            });

            ctx.restore();
        }

        function triggerDamageVisual(targetUnit, attackStatus = 'normal') {
            // Get the unit's screen position and size for the effect
            let targetX, targetY, targetRadius;
            if (targetUnit.isFortified) {
                const tile = gameState.tiles.get(targetUnit.position);
                if (tile) {
                    const center = axialToPixel(tile.q, tile.r);
                    targetX = center.x;
                    targetY = center.y;
                    targetRadius = FORTIFIED_UNIT_DRAW_SIZE;
                }
            } else {
                const edge = gameState.edges.get(targetUnit.position);
                if (edge) {
                    const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                    targetX = mid.x;
                    targetY = mid.y;
                    targetRadius = UNIT_DRAW_SIZE_ON_EDGE;
                    // Adjust for stacked units
                    const unitsOnEdge = edge.units.filter(u => u.positionType === 'edge');
                    const unitIndex = unitsOnEdge.findIndex(u => u.id === targetUnit.id);
                    if(unitsOnEdge.length > 1 && unitIndex !== -1) {
                        const offsetSign = (unitIndex % 2 === 0) ? -1 : 1;
                        const p1 = axialToPixel(edge.q1, edge.r1); const p2 = axialToPixel(edge.q2, edge.r2);
                        let dx = p2.x - p1.x, dy = p2.y - p1.y; const len = Math.sqrt(dx*dx + dy*dy) || 1;
                        let perpX = -dy / len, perpY = dx / len;
                        targetX += perpX * UNIT_ON_EDGE_OFFSET * offsetSign * (0.5);
                        targetY += perpY * UNIT_ON_EDGE_OFFSET * offsetSign * (0.5);
                    }
                }
            }

    if (targetX !== undefined) {
        // --- DAMAGE RING LOGIC (Unchanged) ---
        const baseEffect = {
            type: 'damage_ring',
            x: targetX, y: targetY,
            unitRadius: targetRadius,
            startTime: Date.now(),
            duration: 500
        };

        if (attackStatus === 'disadvantage') {
            baseEffect.subType = 'disadvantage';
            gameState.visualEffects.push(baseEffect);
        } else if (attackStatus === 'advantage') {
            const effect1 = { ...baseEffect, subType: 'advantage' };
            const effect2 = { ...baseEffect, subType: 'advantage', startTime: Date.now() + 250 };
            gameState.visualEffects.push(effect1, effect2);
        } else {
            baseEffect.subType = 'normal';
            gameState.visualEffects.push(baseEffect);
        }

        // --- UPDATED UNIT FLASH LOGIC ---
        const flashEffect = {
            type: 'unit_flash',
            targetUnitId: targetUnit.id,
            startTime: Date.now(),
            flashCount: 1,
            color: 'rgba(255, 0, 0, 0.5)', // Default fallback
            duration: 300,
        };

                if (attackStatus === 'advantage') {
                    flashEffect.flashCount = 2;
                    flashEffect.duration = 600;
                    // Note: We will fix these hardcoded RGBAs in the full cleanup pass, 
                    // as hexToRgba requires the hex string.
                } else if (attackStatus === 'disadvantage') {
                    flashEffect.color = 'rgba(255, 165, 0, 0.5)';
                } else if (attackStatus === 'upgrade') {
                    // --- Gold Flash for Level Up ---
                    // using PALETTE.YELLOW_GOLD (#FFC020)
                    // hexToRgba is a helper function defined earlier in your code
                    flashEffect.color = hexToRgba(PALETTE.YELLOW_GOLD, 0.6); 
                    flashEffect.duration = 800;
                    flashEffect.flashCount = 2;
                }
        
                gameState.visualEffects.push(flashEffect);
            }
        }

        function drawVisualEffects() {
            if (gameState.visualEffects.length === 0) return;

            const currentTime = Date.now();
            const effectsToRemove = [];
    
            ctx.save();
            gameState.visualEffects.forEach((effect, index) => {
                const elapsedTime = currentTime - effect.startTime;
                const progress = elapsedTime / effect.duration;

        if (progress >= 1) {
            effectsToRemove.push(index);
            if (effect.onComplete) {
                effect.onComplete();
            }
            return;
        }

        if (effect.type === 'damage_ring') {
            const startRadius = effect.unitRadius;
            const endRadius = startRadius * 1.8;
            
            const currentRadius = startRadius + (endRadius - startRadius) * progress;
            const opacity = 1.0 - progress;

            ctx.beginPath();
            ctx.arc(effect.x, effect.y, currentRadius, 0, 2 * Math.PI);

            let ringColor = `rgba(255, 50, 50, ${opacity})`;
            if (effect.subType === 'disadvantage') {
                ringColor = `rgba(255, 165, 0, ${opacity})`;
            }
            
            ctx.strokeStyle = ringColor;
            ctx.lineWidth = 3 + (4 * (1 - progress));
            ctx.stroke();
        } else if (effect.type === 'shield_ring') {
            const startRadius = effect.unitRadius;
            const endRadius = startRadius * 2.0;
            
            const currentRadius = startRadius + (endRadius - startRadius) * progress;
            const opacity = 1.0 - progress;

            ctx.beginPath();
            ctx.arc(effect.x, effect.y, currentRadius, 0, 2 * Math.PI);
            ctx.strokeStyle = `rgba(48, 196, 196, ${opacity})`; 
            ctx.lineWidth = 4 + (3 * (1 - progress));
            ctx.stroke();
        } else if (effect.type === 'unit_flash') {
            const unit = gameState.units.find(u => u.id === effect.targetUnitId);
            if (!unit) return;

            let isVisible = false;
            if (effect.flashCount === 2) {
                isVisible = (progress >= 0 && progress < 0.15) || (progress >= 0.25 && progress < 0.40);
            } else {
                isVisible = (progress >= 0 && progress < 0.40);
            }

            if (isVisible) {
                let unitX, unitY, unitRadius;
                if (unit.isFortified) {
                    const tile = gameState.tiles.get(unit.position);
                    if (tile) {
                        const center = axialToPixel(tile.q, tile.r);
                        unitX = center.x;
                        unitY = center.y;
                        unitRadius = FORTIFIED_UNIT_DRAW_SIZE;
                    }
                } else {
                    const edge = gameState.edges.get(unit.position);
                    if (edge) {
                        const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                        unitX = mid.x;
                        unitY = mid.y;
                        unitRadius = UNIT_DRAW_SIZE_ON_EDGE;
                        const unitsOnEdge = edge.units.filter(u => u.positionType === 'edge');
                        const unitIndex = unitsOnEdge.findIndex(u => u.id === unit.id);
                        if (unitsOnEdge.length > 1 && unitIndex !== -1) {
                            const offsetSign = (unitIndex % 2 === 0) ? -1 : 1;
                            const p1 = axialToPixel(edge.q1, edge.r1);
                            const p2 = axialToPixel(edge.q2, edge.r2);
                            let dx = p2.x - p1.x, dy = p2.y - p1.y;
                            const len = Math.sqrt(dx * dx + dy * dy) || 1;
                            let perpX = -dy / len, perpY = dx / len;
                            unitX += perpX * UNIT_ON_EDGE_OFFSET * offsetSign * 0.5;
                            unitY += perpY * UNIT_ON_EDGE_OFFSET * offsetSign * 0.5;
                        }
                    }
                }
                
                if (unitX !== undefined) {
                    ctx.fillStyle = effect.color;
                    ctx.beginPath();
                    ctx.arc(unitX, unitY, unitRadius, 0, 2 * Math.PI);
                    ctx.fill();
                }
            }
        } else if (effect.type === 'flag_capture_burst') {
            const easedProgress = 1 - Math.pow(1 - progress, 3); // A strong ease-out for the expansion

            // The maximum length the line will grow to, using your adjusted factor.
            const maxLineLength = HEX_SIZE * 0.4; 
            
            // The line's length at the current moment in the animation.
            const currentLineLength = maxLineLength * easedProgress;

            // Overall effect opacity (fades out the whole effect over time).
            const globalOpacity = 1.0 - progress;

            const baseColor = effect.player === 1 ? currentDrawingColors.player1.accent : currentDrawingColors.player2.accent;
            
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i; 
                
                // --- Anchor the start and only animate the end ---

                // The START of the line is now FIXED at the unit's border.
                const startRadius = UNIT_DRAW_SIZE_ON_EDGE * 1.1;
                const startX = effect.x + Math.cos(angle) * startRadius;
                const startY = effect.y + Math.sin(angle) * startRadius;
                
                // The END of the line moves outwards from the start point.
                const endX = startX + Math.cos(angle) * currentLineLength;
                const endY = startY + Math.sin(angle) * currentLineLength;

                        // The gradient should fade from opaque at the base to transparent at the tip.
                        const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
                        gradient.addColorStop(0, hexToRgba(baseColor, globalOpacity));
                        gradient.addColorStop(1, hexToRgba(baseColor, 0));

                        ctx.strokeStyle = gradient;

                        ctx.beginPath();
                        ctx.moveTo(startX, startY);
                        ctx.lineTo(endX, endY);
                        ctx.stroke();
                    }
                }
            });
            ctx.restore();

            for (let i = effectsToRemove.length - 1; i >= 0; i--) {
                gameState.visualEffects.splice(effectsToRemove[i], 1);
            }
        }

        function animateUnitAlongPath(unit, path, duration) {
            const animation = {
                unit: unit,
                path: path,
                startTime: Date.now(),
                duration: duration,
                isFinished: false,
                onComplete: null,
            };

        // The unit is now "in animation" and not on any specific edge or tile.
            unit.positionType = 'animating';
    
            gameState.activeAnimations.push(animation);
            return animation;
        }

        function drawAnimations() {
            if (gameState.activeAnimations.length === 0) return; 
    
            const stillAnimating = [];
            const currentTime = Date.now();

            gameState.activeAnimations.forEach(anim => {
                const elapsedTime = currentTime - anim.startTime;
                let progress = elapsedTime / anim.duration;

                if (progress >= 1) {
                    if (anim.onComplete) anim.onComplete();
                    return;
                }

        const unitToAnimate = anim.unit || anim.attacker;
        
        if (anim.type === 'attack_lunge' || anim.type === 'attack_projectile') {
            const startPos = getUnitScreenPosition(unitToAnimate);
            if (!startPos) { stillAnimating.push(anim); return; }
            
            // --- FIX: Scale the unit size for attack animations ---
            const baseSize = unitToAnimate.isFortified ? FORTIFIED_UNIT_DRAW_SIZE : UNIT_DRAW_SIZE_ON_EDGE;
            const drawRadius = baseSize * gameState.renderScale;

            if (anim.type === 'attack_lunge') {
                const targetPos = getUnitScreenPosition(anim.target);
                if (!targetPos) { stillAnimating.push(anim); return; }
                let currentPos = { x: startPos.x, y: startPos.y };
                const lungeDistanceFactor = 0.5; const windupDistanceFactor = -0.2;
                if (progress < 0.25) {
                    const phaseProgress = progress / 0.25;
                    currentPos.x = lerp(startPos.x, targetPos.x, phaseProgress * windupDistanceFactor);
                    currentPos.y = lerp(startPos.y, targetPos.y, phaseProgress * windupDistanceFactor);
                } else if (progress < 0.5) {
                    const phaseProgress = (progress - 0.25) / 0.25;
                    const windupX = lerp(startPos.x, targetPos.x, windupDistanceFactor); const windupY = lerp(startPos.y, targetPos.y, windupDistanceFactor);
                    const peakX = lerp(startPos.x, targetPos.x, lungeDistanceFactor); const peakY = lerp(startPos.y, targetPos.y, lungeDistanceFactor);
                    currentPos.x = lerp(windupX, peakX, phaseProgress); currentPos.y = lerp(windupY, peakY, phaseProgress);
                } else {
                    const phaseProgress = (progress - 0.5) / 0.5;
                    const peakX = lerp(startPos.x, targetPos.x, lungeDistanceFactor); const peakY = lerp(startPos.y, targetPos.y, lungeDistanceFactor);
                    currentPos.x = lerp(peakX, startPos.x, phaseProgress); currentPos.y = lerp(peakY, startPos.y, phaseProgress);
                }
                drawSingleUnit(ctx, unitToAnimate, currentPos.x, currentPos.y, drawRadius);
            } else { 
                const totalPreShotDuration = anim.preShotDuration.draw + anim.preShotDuration.hold;
                if (elapsedTime < totalPreShotDuration) {
                    const recoilFactor = -0.1; const someTargetPos = getUnitScreenPosition(anim.targets[0]);
                    if (!someTargetPos) { stillAnimating.push(anim); return; }
                    const recoilX = lerp(startPos.x, someTargetPos.x, recoilFactor); const recoilY = lerp(startPos.y, someTargetPos.y, recoilFactor);
                    if (elapsedTime < anim.preShotDuration.draw) {
                        const phaseProgress = elapsedTime / anim.preShotDuration.draw;
                        const currentX = lerp(startPos.x, recoilX, phaseProgress); const currentY = lerp(startPos.y, recoilY, phaseProgress);
                        drawSingleUnit(ctx, unitToAnimate, currentX, currentY, drawRadius);
                    } else {
                        drawSingleUnit(ctx, unitToAnimate, recoilX, recoilY, drawRadius);
                    }
                } else {
                    drawSingleUnit(ctx, unitToAnimate, startPos.x, startPos.y, drawRadius);
                    const travelElapsedTime = elapsedTime - totalPreShotDuration; const travelProgress = travelElapsedTime / anim.travelDuration;
                    anim.targets.forEach(targetUnit => {
                        const targetPos = getUnitScreenPosition(targetUnit); if (!targetPos) return;
                        const projectileX = lerp(startPos.x, targetPos.x, travelProgress); const projectileY = lerp(startPos.y, targetPos.y, travelProgress);
                        ctx.beginPath(); ctx.moveTo(projectileX, projectileY);
                        const dx = targetPos.x - startPos.x; const dy = targetPos.y - startPos.y;
                        const len = Math.sqrt(dx*dx + dy*dy) || 1;
                        const tailX = projectileX - (dx/len) * 15; const tailY = projectileY - (dy/len) * 15;
                        ctx.lineTo(tailX, tailY);
                        ctx.strokeStyle = '#90A0A0'; ctx.lineWidth = 3; ctx.stroke();
                    });
                }
            }
        } else if (anim.type === 'fortify' || anim.type === 'unfortify') {
             const startPos = getUnitScreenPosition(unitToAnimate);
             if (!startPos && anim.type === 'fortify') { stillAnimating.push(anim); return; }
             
             // --- FIX: Scale the unit size during fortify animation ---
             const fortifyDrawRadius = FORTIFIED_UNIT_DRAW_SIZE * gameState.renderScale;

            if (anim.type === 'fortify') {
                 const [q, r] = anim.targetTileKey.split(',').map(Number);
                 const endPos = axialToPixel(q, r);
                 const travelPhaseDuration = 0.4; 
                 if (progress < travelPhaseDuration) {
                     let travelProgress = progress / travelPhaseDuration;
                     const easedTravelProgress = 1 - Math.pow(1 - travelProgress, 3);
                     const currentX = lerp(startPos.x, endPos.x, easedTravelProgress);
                     const currentY = lerp(startPos.y, endPos.y, easedTravelProgress);
                     drawSingleUnit(ctx, anim.unit, currentX, currentY, fortifyDrawRadius);
                 } 
                 else {
                     drawSingleUnit(ctx, anim.unit, endPos.x, endPos.y, fortifyDrawRadius, null);
                     let ringPhaseProgress = (progress - travelPhaseDuration) / (1 - travelPhaseDuration);
                     const easedRingProgress = Math.pow(ringPhaseProgress, 2);
                     const ringOpacity = easedRingProgress;
                     const ringColor = anim.unit.player === 1 ? `rgba(91, 148, 255, ${ringOpacity})` : `rgba(255, 99, 132, ${ringOpacity})`;
                     
                     // --- FIX: Scale the expanding hex ring ---
                     const currentHexSize = HEX_SIZE * gameState.renderScale * easedRingProgress;
                     
                     ctx.strokeStyle = ringColor;
                     ctx.lineWidth = 4;
                     ctx.beginPath();
                     for (let i = 0; i < 6; i++) {
                         const angle = Math.PI / 180 * (60 * i - 30);
                         const vx = endPos.x + currentHexSize * Math.cos(angle);
                         const vy = endPos.y + currentHexSize * Math.sin(angle);
                         if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                     }
                     ctx.closePath();
                     ctx.stroke();
                 }
            } else { // unfortify
                 const collapsePhaseDuration = 0.5;
                 const [q, r] = anim.startTileKey.split(',').map(Number);
                 const unfortifyStartPos = axialToPixel(q, r);
                if (progress < collapsePhaseDuration) {
                    drawSingleUnit(ctx, anim.unit, unfortifyStartPos.x, unfortifyStartPos.y, fortifyDrawRadius, null);
                    let phaseProgress = progress / collapsePhaseDuration;
                    const easedProgress = Math.pow(phaseProgress, 2);
                    const ringOpacity = 1.0 - easedProgress;
                    const ringColor = anim.unit.player === 1 ? `rgba(91, 148, 255, ${ringOpacity})` : `rgba(255, 99, 132, ${ringOpacity})`;
                    
                    // --- FIX: Scale the collapsing hex ring ---
                    const currentHexSize = HEX_SIZE * gameState.renderScale * (1.0 - easedProgress);
                    
                    ctx.strokeStyle = ringColor;
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.PI / 180 * (60 * i - 30);
                        const vx = unfortifyStartPos.x + currentHexSize * Math.cos(angle);
                        const vy = unfortifyStartPos.y + currentHexSize * Math.sin(angle);
                        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                    }
                    ctx.closePath();
                    ctx.stroke();
                } else {
                    const [endH1, endH2] = parseEdgeKey(anim.targetEdgeKey);
                    const endPos = getEdgeMidpoint(endH1.q, endH1.r, endH2.q, endH2.r);
                    let phaseProgress = (progress - collapsePhaseDuration) / (1 - collapsePhaseDuration);
                    const easedProgress = 1 - Math.pow(1 - phaseProgress, 3);
                    const currentX = lerp(unfortifyStartPos.x, endPos.x, easedProgress);
                    const currentY = lerp(unfortifyStartPos.y, endPos.y, easedProgress);
                    
                    // --- FIX: Scale the unit size for edge movement ---
                    const edgeDrawRadius = UNIT_DRAW_SIZE_ON_EDGE * gameState.renderScale;
                    drawSingleUnit(ctx, anim.unit, currentX, currentY, edgeDrawRadius, '#FFF');
                }
            }
        } else if (anim.type === 'build_bridge') {
            const builder = anim.unit;
            const startPos = getUnitScreenPosition(builder);
            const targetEdge = gameState.edges.get(anim.targetEdgeKey);

            if (!startPos || !targetEdge) { stillAnimating.push(anim); return; }

            const targetEdgePos = getEdgeMidpoint(targetEdge.q1, targetEdge.r1, targetEdge.q2, targetEdge.r2);
            
            const buildPos = {
                x: lerp(startPos.x, targetEdgePos.x, 0.4), 
                y: lerp(startPos.y, targetEdgePos.y, 0.4)
            };

            let currentPos = { x: 0, y: 0 };
            
            if (progress < 0.25) {
                const phaseProgress = progress / 0.25;
                currentPos.x = lerp(startPos.x, buildPos.x, phaseProgress);
                currentPos.y = lerp(startPos.y, buildPos.y, phaseProgress);
                ctx.globalAlpha = phaseProgress;
                drawBridge(targetEdge, '#8B4513'); 
                ctx.globalAlpha = 1.0;
            }
            else if (progress < 0.5) {
                const phaseProgress = (progress - 0.25) / 0.25;
                currentPos.x = lerp(buildPos.x, startPos.x, phaseProgress);
                currentPos.y = lerp(buildPos.y, startPos.y, phaseProgress);
                drawBridge(targetEdge, '#8B4513');
            }
            else if (progress < 0.75) {
                const phaseProgress = (progress - 0.5) / 0.25;
                currentPos.x = lerp(startPos.x, buildPos.x, phaseProgress);
                currentPos.y = lerp(startPos.y, buildPos.y, phaseProgress);
                drawBridge(targetEdge, '#8B4513');
                ctx.globalAlpha = phaseProgress;
                drawBridge(targetEdge, 'transparent'); 
                ctx.globalAlpha = 1.0;
            }
            else {
                const phaseProgress = (progress - 0.75) / 0.25;
                currentPos.x = lerp(buildPos.x, startPos.x, phaseProgress);
                currentPos.y = lerp(buildPos.y, startPos.y, phaseProgress);
                drawBridge(targetEdge); 
            }
            
                    // --- FIX: Scale the builder unit size ---
                    const unitSize = UNIT_DRAW_SIZE_ON_EDGE * gameState.renderScale;
                    drawSingleUnit(ctx, builder, currentPos.x, currentPos.y, unitSize);
                }
        
                stillAnimating.push(anim);
            });

            gameState.activeAnimations = stillAnimating;
        }

        let lastFrameTime = Date.now();

        function hasIdleAnimations() {
            // No supply lines or flags in arcade/map maker mode
            if (gameState.gameMode === 'arcade' || gameState.mapMakerMode) return false;
            
            return gameState.units.some(u => {
                if (!u.isFortified) return false;
                
                // 1. Check for Active Supply Lines
                if (u.supplyLine && u.supplyLine.path && u.supplyLine.path.length > 0) return true;
                
                // 2. Check for Unit Covering the Flag (Expansive Map Pulse Effect)
                if (gameState.flags && gameState.gridRadius === 4) {
                    const myFlag = gameState.flags[`p${u.player}_flag`];
                    if (myFlag && myFlag.status === 'at_base' && Array.isArray(myFlag.homePosition)) {
                        const tile = gameState.tiles.get(u.position);
                        if (tile) {
                            const {x, y} = axialToPixel(tile.q, tile.r);
                            const flagPos = calculateBaseCentroid(myFlag.homePosition);
                            if (flagPos && distSq({x, y}, flagPos) < 1) return true;
                        }
                    }
                }
                
                return false;
            });
        }

        function gameLoop() {

            // 1. DELTA TIME CALCULATION 
            const currentTime = Date.now();
            const deltaTime = (currentTime - lastFrameTime) / 1000;
            lastFrameTime = currentTime;

            // 2. ARCADE LOGIC 
            if (gameState.gameMode === 'arcade' && !gameState.gameOver && !gameState.mapMakerMode) {
                const waitingForStart = gameState.globalTurnNumber === 1 && gameState.currentPlayer === 1 && !gameState.arcadeGameStartedInteraction;

                if (gameState.activeAnimations.length === 0 && !waitingForStart) { 
                    gameState.arcadeTurnTimer -= deltaTime; 
            
                    if (gameState.arcadeTurnTimer <= 0) {
                        gameState.arcadeTurnTimer = 0;
                        if (gameState.globalTurnNumber >= 2 && gameState.swapState !== 'complete') {
                            handleForcedSwap();
                        } else {
                            proceedToEndTurn();
                        }
                    }
                }
                const pct = Math.max(0, (gameState.arcadeTurnTimer / ARCADE_TURN_TIME_SEC) * 100);
                const activeColor = '#E04030'; 
                const emptyColor = '#C03020';
                ui.endTurnButton.style.background = `linear-gradient(to right, ${activeColor} ${pct}%, ${emptyColor} ${pct}%)`;
                ui.endTurnButton.textContent = `End Turn (${Math.ceil(gameState.arcadeTurnTimer)}s)`;
                
                // Force redraw if in the swap phase so the border pulsates smoothly
                if (gameState.swapState === 'selecting_unit') {
                    gameState.needsRedraw = true;
                }
            }

            // 3. PERFORMANCE: DIRTY FLAG RENDERING
            let needsDraw = gameState.needsRedraw ||
                gameState.activeAnimations.length > 0 ||
                gameState.visualEffects.length > 0 ||            
                gameState.potentialDebugPathToDraw !== null ||   
                gameState.debugPathToDraw !== null ||            
                gameState.colorTransition.active ||
                gameState.isDragging ||
                (gameState.currentActionState === ACTION_STATES.SELECTING_BRIDGE_EDGE) ||
                (gameState.currentActionState === ACTION_STATES.SELECTING_ATTACK_TARGET && gameState.debugAttackRangeHighlights.length > 0) ||
                (gameSettings.debugModeEnabled && (gameState.selectedUnit || gameState.debugSelectedBasePlayer));

            // 4. THROTTLED IDLE ANIMATIONS (30 FPS)
            if (!needsDraw && hasIdleAnimations()) {
                if (!gameState.lastIdleDrawTime) gameState.lastIdleDrawTime = 0;
                if (currentTime - gameState.lastIdleDrawTime > 33) {
                    needsDraw = true;
                    gameState.lastIdleDrawTime = currentTime;
                }
            }

            // 5. ABORT IF IDLE
            if (!needsDraw) {
                requestAnimationFrame(gameLoop);
                return;
            }
            gameState.needsRedraw = false; // Reset the flag for the next frame

            // ==========================================
            // 6. MAIN RENDER EXECUTION
            // ==========================================
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (gameState.colorTransition.active) {
                const elapsedTime = Date.now() - gameState.colorTransition.startTime;
                const progress = Math.min(elapsedTime / COLOR_TRANSITION_DURATION_MS, 1);
                currentDrawingColors.player1.primary = lerpColor(gameState.colorTransition.from.player1.primary, gameState.colorTransition.to.player1.primary, progress);
                currentDrawingColors.player2.primary = lerpColor(gameState.colorTransition.from.player2.primary, gameState.colorTransition.to.player2.primary, progress);
                currentDrawingColors.player1.secondary = lerpColor(gameState.colorTransition.from.player1.secondary, gameState.colorTransition.to.player1.secondary, progress); 
                currentDrawingColors.player2.secondary = lerpColor(gameState.colorTransition.from.player2.secondary, gameState.colorTransition.to.player2.secondary, progress); 
                currentDrawingColors.player1.accent = lerpColor(gameState.colorTransition.from.player1.accent, gameState.colorTransition.to.player1.accent, progress);
                currentDrawingColors.player2.accent = lerpColor(gameState.colorTransition.from.player2.accent, gameState.colorTransition.to.player2.accent, progress);
                if (progress >= 1) gameState.colorTransition.active = false;
                updateCssVariables(currentDrawingColors);
            } else {
                currentDrawingColors.player1.primary = TEAM_COLORS.player1.primary;
                currentDrawingColors.player2.primary = TEAM_COLORS.player2.primary;
                currentDrawingColors.player1.secondary = TEAM_COLORS.player1.secondary;
                currentDrawingColors.player2.secondary = TEAM_COLORS.player2.secondary;
                currentDrawingColors.player1.accent = TEAM_COLORS.player1.accent;
                currentDrawingColors.player2.accent = TEAM_COLORS.player2.accent;
            }

            if (gameState.mapMakerMode) {
                canvas.style.transition = 'outline-color 0.4s ease-in-out';
                canvas.style.outlineColor = '#F0F0F0';
            } else if (gameState.gameOver) {
                canvas.style.transition = 'outline-color 0.4s ease-in-out';
                canvas.style.outlineColor = 'transparent';
            } else if (gameState.gameMode === 'arcade' && gameState.swapState === 'selecting_unit') {
                canvas.style.transition = 'none'; 
                const playerColor = TEAM_COLORS[`player${gameState.currentPlayer}`].secondary;
                const alertColor = '#FFC020'; 
                const pulse = (Math.sin(currentTime / 200) + 1) / 2; 
                canvas.style.outlineColor = lerpColor(playerColor, alertColor, pulse);
            } else {
                canvas.style.transition = 'outline-color 0.4s ease-in-out';
                canvas.style.outlineColor = gameState.currentPlayer === 1 ? TEAM_COLORS.player1.secondary : TEAM_COLORS.player2.secondary;
            }

            gameState.tiles.forEach(tile => drawHexFill(tile.q, tile.r, tile.type));
            drawHexEdgesAndBoundaries();
            drawFortificationOutlines();
            drawContestedEdgeIndicator();
            drawPulsatingBridgeHighlights();
            drawFlags();
            drawBridges();
            drawSupplyLines();
            drawDebugVisibilityHighlights(); 
            drawDebugAttackRangeHighlights(); 

            if (!gameState.isDragging) {
                switch(gameState.currentActionState) {
                    case ACTION_STATES.SELECTING_FORTIFY_TILE:
                        drawActionSelectionHighlights(gameState.validFortifyTargetTileKeys, 'fortify');
                        break;
                    case ACTION_STATES.SELECTING_UNFORTIFY_EDGE:
                        drawActionSelectionHighlights(gameState.validUnfortifyTargetEdgeKeys, 'unfortify');
                        break;
                    case ACTION_STATES.SELECTING_BRIDGE_EDGE:
                        drawActionSelectionHighlights(gameState.validBridgeTargetEdgeKeys, 'bridge');
                        break;
                    case ACTION_STATES.SELECTING_ATTACK_TARGET:
                        const currentAttackTargets = gameState.selectedUnit?.type.attackType === 'melee' 
                            ? gameState.validMeleeAttackTargets 
                            : gameState.validArcherAttackTargets;
                        drawBridgeAttackHighlightsOnly(currentAttackTargets); 
                        break;
                }
                drawMapMakerHighlights();
            }
            
            drawDebugPath();
            drawAnimations();
            drawMovementHighlights();
            drawUnits();
            drawVisualEffects();

            if (!gameState.isDragging && gameState.currentActionState === ACTION_STATES.SELECTING_ATTACK_TARGET) {
                 const currentAttackTargets = gameState.selectedUnit?.type.attackType === 'melee'
                    ? gameState.validMeleeAttackTargets 
                    : gameState.validArcherAttackTargets;
                 drawUnitAttackHighlightsOnly(currentAttackTargets); 
            }
            
            requestAnimationFrame(gameLoop);
        }
        
        function fullGameRedraw() {
            // This function re-initializes the game's UI and re-renders the canvas from the current gameState.
            
            // --- FIX: Use FIXED canvas dimensions ---
            canvas.width = CANVAS_WIDTH_NORMAL;
            canvas.height = CANVAS_HEIGHT_NORMAL;
            document.querySelectorAll('.ui-panel').forEach(panel => { panel.style.minHeight = canvas.height + 'px'; });
            // ----------------------------------------

            // Reset any non-persistent state properties that might affect drawing
            gameState.isDragging = false;
            gameState.draggingUnit = null;
            gameState.hoveredUnitId = null;

            // Update all UI panels with current data
            updateTurnDisplay();
            updateGlobalTurnDisplay();
            updateSupplyPointsDisplay();
            updateRespawnQueueDisplay();
            updateActionLogDisplay();
            updateSelectedUnitInfoPanel();

            if (gameState.gameOver) {
                ui.endTurnButton.disabled = true;
                ui.actionsPanel.style.display = 'none';
                ui.victoryMessage.textContent = "Game Over (Loaded)";
                ui.victoryMessage.style.display = 'block';
            } else {
                ui.victoryMessage.style.display = 'none';
                ui.endTurnButton.disabled = false;
            }
            gameState.needsRedraw = true;
            // A single call to gameLoop will trigger a full redraw of the canvas
            requestAnimationFrame(gameLoop);
        }

        function drawBridges() { 
    gameState.edges.forEach(edge => { if (edge.bridge) drawBridge(edge); }); 
}

function drawSupplyLines() {
    if (gameState.gameMode === 'arcade') return;
    const currentTime = Date.now();
    const currentHexSize = HEX_SIZE * gameState.renderScale;
    
    gameState.units.forEach(unit => {
        if (unit.isFortified && unit.supplyLine && unit.supplyLine.path) {
            const path = unit.supplyLine.path;
            if (path.length === 0) return;

            const isIntercepted = path.some(edgeKey => {
            const edge = gameState.edges.get(edgeKey);
            if (!edge) return false;
            return edge.units.some(u => u.player !== unit.player && (!gameState.isDragging || u.id !== gameState.draggingUnit.id));
        });

            let lineColor, lineWidth, isDashed;
            if (isIntercepted) {
                lineColor = '#F0A010'; 
                lineWidth = 4;
                isDashed = true;
            } else {
                lineColor = unit.player === 1 ? hexToRgba(currentDrawingColors.player1.accent, 0.8) : hexToRgba(currentDrawingColors.player2.accent, 0.8);
                const pulse = (Math.sin(currentTime / 300) + 1) / 2; 
                lineWidth = 2 + pulse * 3; 
                isDashed = false;
            }

            ctx.save();
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            if (isDashed) {
                ctx.setLineDash([15, 10]);
            }

            path.forEach(edgeKey => {
                const edge = gameState.edges.get(edgeKey);
                if(edge) {
                    const p1_center = axialToPixel(edge.q1, edge.r1);
                    const p2_center = axialToPixel(edge.q2, edge.r2);
                    const edgeMidX = (p1_center.x + p2_center.x) / 2;
                    const edgeMidY = (p1_center.y + p2_center.y) / 2;
                    
                    let perp_dx = -(p2_center.y - p1_center.y);
                    let perp_dy = p2_center.x - p1_center.x;
                    const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);
                    
                    if (len_perp_vec > 0) {
                        const scale = currentHexSize / 2;
                        perp_dx = (perp_dx / len_perp_vec) * scale;
                        perp_dy = (perp_dy / len_perp_vec) * scale;

                        ctx.beginPath();
                        ctx.moveTo(edgeMidX + perp_dx, edgeMidY + perp_dy);
                        ctx.lineTo(edgeMidX - perp_dx, edgeMidY - perp_dy);
                        ctx.stroke();
                    }
                }
            });
            
            ctx.restore();
        }
    });
}

function drawMapMakerHighlights() {
    if (!gameState.mapMakerMode) return;
    
    const brush = gameState.mapMakerBrush;
    if (brush.type === 'base_camp' && gameState.gridRadius === 4) {
        const player = brush.player;
        const currentBase = gameState.baseCampPositions[`player${player}`];
        
        if (Array.isArray(currentBase) && currentBase.length > 0 && currentBase.length < 3) {
            const validNeighbors = new Set();
            const enemyPlayer = player === 1 ? 2 : 1;
            const enemyBaseData = gameState.baseCampPositions[`player${enemyPlayer}`];
            const enemyBaseSet = new Set(Array.isArray(enemyBaseData) ? enemyBaseData : []);

            currentBase.forEach(key => {
                const [q,r] = key.split(',').map(Number);
                getNeighbors(q,r).forEach(n => {
                    const nKey = getTileKey(n.q, n.r);
                    if (gameState.tiles.has(nKey) && !currentBase.includes(nKey) && !enemyBaseSet.has(nKey)) {
                        const testSet = [...currentBase, nKey];
                        if (isSetContiguous(testSet)) {
                            validNeighbors.add(nKey);
                        }
                    }
                });
            });
            drawActionSelectionHighlights(Array.from(validNeighbors), 'fortify');
        }
    }
}

