// === Pixel/Screen-Space Coordinate Conversion (client-only, A1 step 6) ===
//
// These read canvas.width/canvas.height and gameState.renderScale/renderOffset
// directly — genuinely screen-space concerns with no meaning outside a browser
// tab, so they can never live in js/server/. Moved verbatim from core.js.
//
// The rest of the old js/core.js folded in here when the /js root was cleaned up:
// calculateBaseCentroid, getUnitScreenPosition, findClosestEdgeToPoint and the
// distSq/pointDistance/distToSegmentSquared/lerp helpers. Every one of them is
// pixel-space or feeds something that is, and every consumer is client-side.
//
// ai.js still calls calculateBaseCentroid and getUnitScreenPosition for actual
// decision logic rather than drawing, which is why ai.js can't move to
// js/server/ yet. That rewrite is Track C's, not A1's: the roadmap lists
// `AI scoreMove` among the systems Track C migrates onto the fine grid, and
// re-deriving the AI's distance thresholds before the movement model and cost
// rebalance land would just mean tuning them twice.

function axialToPixel(q, r) {
    const rawX = HEX_SIZE * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
    const rawY = HEX_SIZE * (3 / 2 * r);
    const x = (rawX * gameState.renderScale) + gameState.renderOffset.x + canvas.width / 2;
    const y = (rawY * gameState.renderScale) + gameState.renderOffset.y + canvas.height / 2;
    return { x, y };
}

function pixelToAxial(x, y) {
    const adjX = (x - canvas.width / 2 - gameState.renderOffset.x) / gameState.renderScale;
    const adjY = (y - canvas.height / 2 - gameState.renderOffset.y) / gameState.renderScale;
    const q_calc = (Math.sqrt(3) / 3 * adjX - 1 / 3 * adjY) / HEX_SIZE;
    const r_calc = (2 / 3 * adjY) / HEX_SIZE;
    return roundAxial({ q: q_calc, r: r_calc });
}

function getEdgeMidpoint(q1, r1, q2, r2) {
    const p1 = axialToPixel(q1, r1); const p2 = axialToPixel(q2, r2);
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

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
