        // === Math and Grid ===
        












// ========================

        function calculateBaseCentroid(baseTileKeys) {
            if (!Array.isArray(baseTileKeys) || baseTileKeys.length !== 3) return null;

            let sumX = 0, sumY = 0;
            const tiles = baseTileKeys.map(k => {
                const [q, r] = k.split(',').map(Number);
                const pos = axialToPixel(q, r);
                sumX += pos.x;
                sumY += pos.y;
                return { q, r };
            });

            // Check topology: Do they form a tight triangle?
            // A touches B, B touches C, C touches A
            const [t1, t2, t3] = tiles;
            const d12 = axialDistance(t1.q, t1.r, t2.q, t2.r);
            const d23 = axialDistance(t2.q, t2.r, t3.q, t3.r);
            const d31 = axialDistance(t3.q, t3.r, t1.q, t1.r);

            if (d12 === 1 && d23 === 1 && d31 === 1) {
                // Triangle: Use true geometric centroid
                return { x: sumX / 3, y: sumY / 3 };
            } else {
                // Line or 'L': Find the center tile (the one connected to the other two)
                let centerTileIndex = 0;
                if (d12 === 1 && d31 === 1) centerTileIndex = 0;      // 1 connects to 2 and 3
                else if (d12 === 1 && d23 === 1) centerTileIndex = 1; // 2 connects to 1 and 3
                else centerTileIndex = 2;                             // 3 connects to 1 and 2
        
                const [q, r] = baseTileKeys[centerTileIndex].split(',').map(Number);
                return axialToPixel(q, r);
            }
        }


        function distSq(p1, p2) { return (p1.x - p2.x)**2 + (p1.y - p2.y)**2; }

        function pointDistance(p1, p2) { return Math.sqrt(distSq(p1,p2)); }
        
        function distToSegmentSquared(p, v, w) {
            const l2 = distSq(v, w); if (l2 === 0) return distSq(p, v);
            let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
            return distSq(p, projection);
        }

        function lerp(start, end, amount) {
            return start + (end - start) * amount;
        }

        // === Queries and LoS ===











        

        function findClosestEdgeToPoint(x, y) {
            let closestEdgeKey = null;
            let minDistanceSq = Infinity;

            for (const [edgeKey, edge] of engine.state.edges.entries()) {
                const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                const dSq = distSq({x, y}, mid);
                if (dSq < minDistanceSq) {
                    minDistanceSq = dSq;
                    closestEdgeKey = edgeKey;
                }
            }
            return { key: closestEdgeKey, distance: Math.sqrt(minDistanceSq) };
        }


        function getUnitScreenPosition(unit) {
            if (!unit) return null;
            let unitX, unitY;

            if (unit.isFortified) {
                const tile = engine.state.tiles.get(unit.position);
                if (tile) {
                    const center = axialToPixel(tile.q, tile.r);
                    unitX = center.x;
                    unitY = center.y;
                }
            } else {
                const edge = engine.state.edges.get(unit.position);
                if (edge) {
                    const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                    unitX = mid.x;
                    unitY = mid.y;
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
                return { x: unitX, y: unitY };
            }
            return null;
        }

        // === Unit and State ===









        function handleForcedSwap() {
            if (engine.state.gameMode !== 'arcade') return;
    
            const myUnits = engine.state.units.filter(u => u.player === engine.state.currentPlayer);
            if (myUnits.length === 0) { proceedToEndTurn(); return; }
    
            const victim = myUnits[Math.floor(Math.random() * myUnits.length)];
            const allTypes = Object.values(UNIT_TYPES);
            const validTypes = allTypes.filter(t => {
            if (t.name === victim.type.name) return false;
            if (victim.isFortified && t.defense <= 0) return false;
            return true;
        });
    
            const newType = validTypes[Math.floor(Math.random() * validTypes.length)];
    
            hideRespawnModal(); 
            performSwap(victim, newType);
            proceedToEndTurn();
        }

        function getUnitSnapshot(unit) {
            if (!unit) return null;
            return {
                id: unit.id,
                hp: unit.hp, // Getter accesses unit.stats.hp
                mp: Number(unit.currentMove.toFixed(2)), // Clean float precision
                pos: unit.position,
                isFortified: unit.isFortified
            };
        }



