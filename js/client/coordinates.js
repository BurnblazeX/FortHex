// === Pixel/Screen-Space Coordinate Conversion (client-only, A1 step 6) ===
//
// These read canvas.width/canvas.height and gameState.renderScale/renderOffset
// directly — genuinely screen-space concerns with no meaning outside a browser
// tab, so they can never live in js/server/. Moved verbatim from core.js.
//
// calculateBaseCentroid and getUnitScreenPosition are NOT here yet, even
// though they're the same kind of pixel-space function — ai.js's getBaseCenter
// still calls calculateBaseCentroid for actual AI decision logic (not just
// rendering), and getUnitScreenPosition feeds ai.js's scoreMove/scoreAttack
// distance math the same way. Moving just the file location wouldn't fix
// anything; the AI needs to be rewritten to reason in hex/axial distance
// instead. That's A1 step 10 ("fix ai.js's pixel-space distance logic"),
// explicitly ordered after this step — deferred, not forgotten.

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
