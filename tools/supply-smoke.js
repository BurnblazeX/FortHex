// FortHex - Reach and Rations  (Track C, C2 supply overhaul)
//
//   node tools/supply-smoke.js
//   node tools/supply-smoke.js --verbose
//
// Supply used to be ONE number doing two jobs badly: a pool of points that every line
// permanently reserved a slice of. It is now two things that do not touch.
//
//   REACH    a SHARED budget for supply line, measured in edge cost. Every line
//            reserves part of it for as long as it exists, so what is left is how much
//            more line the player can afford. Falls as you fortify, rises as forts are
//            released. This half is the ORIGINAL mechanic, renamed and otherwise
//            untouched - C2 briefly replaced it with a per-line ceiling and that was
//            reverted (Burn, 2026-09-09).
//   RATIONS  a consumable, spent one per unit healed per turn, refilled only by a turn
//            in which nothing was spent, cut to zero by a stolen flag, and at zero it
//            severs every line the player has.
//
// Neither half is visible to the rest of the harness. move-parity records supply cost
// but not what is DONE with it, and shield-smoke deliberately runs on a board where the
// pool never empties. So the interesting cases are here, and two of them exist only to
// stop this file passing vacuously:
//
//   REACH IS TESTED AS A BUDGET, not merely as a ceiling. "One line under 15 is
//   granted" passes on a per-line model too. What separates them is that laying a line
//   SPENDS the budget and releasing the fort HANDS IT BACK.
//
//   REGENERATION IS TESTED AGAINST A SPENDING TURN. "+1 on a rest turn" passes on a
//   build that regenerates unconditionally, so every rest case is paired with a turn
//   that spent something and must not regenerate.
//
// Exit code 0 = pass.

const vm = require('vm');
const { ReadBundle } = require('../host/server-bundle.js');

const verbose = process.argv.includes('--verbose');
const failures = [];

function Check(label, condition, detail) {
    if (condition) {
        if (verbose) console.log('  ok   ' + label);
    } else {
        failures.push(label);
        console.error('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
    }
}

const HELPERS = `
function P1(typeId) { return engine.state.units.find(u => u.player === 1 && u.typeId === typeId); }
function StandOn(unit, tileKey) { unit.position = FineKeyOfTile(tileKey); }
function OnOwnBase(unit) { StandOn(unit, GetBaseCamp(unit.player)[0]); }
function Untouched(unit) { unit.lastAttackedByHostileOnTurn = -10; }
function Tick() { engine.state.currentPlayer = 1; ApplyStartOfTurnHealing(); }
function Rations(p) { return RationsFor(p || 1); }

// Fortify by placing on a tile centre - the position carries the fact since the
// board-space cutover - then recompute the network the way a real action would.
function Fortify(unit, tileKey) {
    StandOn(unit, tileKey);
    const tile = engine.state.tiles.get(tileKey);
    if (tile) tile.fortifiedByPlayer = unit.player;
    recalculatePlayerSupplyNetwork(unit.player);
}

// Tiles at a given hex distance from this player's first base tile, nearest first, so
// a scenario can ask for "somewhere far enough that the line is long" without hard
// coding a coordinate that a map edit would invalidate.
function TilesByDistanceFromBase(player) {
    const base = GetBaseCamp(player)[0];
    const [bq, br] = base.split(',').map(Number);
    const out = [];
    engine.state.tiles.forEach((tile, key) => {
        if (key === base) return;
        if (!tile.type.canFortify) return;
        const [q, r] = key.split(',').map(Number);
        const dist = (Math.abs(q - bq) + Math.abs(r - br) + Math.abs(q + r - bq - br)) / 2;
        out.push({ key: key, dist: dist });
    });
    out.sort((a, b) => a.dist - b.dist);
    return out.map(t => t.key);
}
`;

function Fresh() {
    const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise };
    vm.createContext(ctx);
    vm.runInContext(ReadBundle(), ctx);
    vm.runInContext('globalThis.engine = CreateEngineInstance();'
        + ' engine.settings.fogOfWarEnabled = false;'
        + ' engine.settings.animationsEnabled = false;'
        + " const m = FindSelectableMap('Standard');"
        + ' SetGridMode(m.radius); InitializeGridDimensions(m.radius);'
        + ' InitializeGrid(m.tiles, m.units, null);', ctx);
    vm.runInContext(HELPERS, ctx);
    return ctx;
}

const Run = (ctx, src) => vm.runInContext(src, ctx);

// --- 1. the pool starts full and is a consumable, not a derived number --------
{
    const ctx = Fresh();
    Check('a match starts on a full ration pool',
        Run(ctx, 'Rations(1)') === Run(ctx, 'STARTING_RATIONS'),
        'started on ' + Run(ctx, 'Rations(1)'));

    // The two halves are independent, and this is the pair of assertions that says so.
    // Reach pays for geometry, rations pay for healing; fortifying must move the first
    // and not the second. If one number were still doing both jobs, one of these fails.
    const before = Run(ctx, 'Rations(1)');
    const reachBefore = Run(ctx, 'ReachFor(1)');
    // The FURTHEST fortifiable tile, not the nearest: a fort beside base is supplied by
    // a line of length zero, so it would spend no reach and the assertion below would
    // measure nothing.
    Run(ctx, 'const spots = TilesByDistanceFromBase(1).filter(k => {'
        + ' const t = engine.state.tiles.get(k);'
        + ' return t && !t.isBaseCampTile && t.fortifiedByPlayer === null; });'
        + ' Fortify(P1("PIKEMAN"), spots[spots.length - 1]);');
    Check('fortifying costs no rations - rations do not pay for geometry',
        Run(ctx, 'Rations(1)') === before,
        'pool went ' + before + ' -> ' + Run(ctx, 'Rations(1)'));
    Check('but it DOES cost reach, which is the half that does',
        Run(ctx, 'ReachFor(1)') < reachBefore,
        'reach went ' + reachBefore + ' -> ' + Run(ctx, 'ReachFor(1)'));
    Check('and the fort really did get a line, so the case is not vacuous',
        Run(ctx, 'isUnitSupplied(P1("PIKEMAN"))') === true);
}

// --- 2. reach is a SHARED budget that falls and rises ------------------------
{
    const ctx = Fresh();
    const full = Run(ctx, 'ReachFor(1)');
    Check('a match starts on a full reach budget', full === Run(ctx, 'MAX_SUPPLY_REACH'),
        'started on ' + full);

    // One distant fort, so its line reserves something worth measuring.
    const first = Run(ctx, `
        var far = TilesByDistanceFromBase(1).filter(k => {
            const t = engine.state.tiles.get(k);
            return t && !t.isBaseCampTile && t.fortifiedByPlayer === null;
        });
        globalThis.spotA = far[far.length - 1];
        Fortify(P1("PIKEMAN"), spotA);
        JSON.stringify({ cost: P1("PIKEMAN").supplyLine ? P1("PIKEMAN").supplyLine.cost : null,
                         reach: ReachFor(1) });
    `);
    const a = JSON.parse(first);
    if (verbose) console.log('       first fort: ' + first);

    Check('the fort got a line', a.cost !== null);
    Check('and laying it SPENT reach equal to the line cost',
        a.reach === full - Math.round(a.cost),
        'reach ' + full + ' -> ' + a.reach + ' for a line costing ' + a.cost);

    // A second fort, placed as far from the FIRST as the board allows so the two routes
    // do not overlap. That distinction matters: overlapping lines share roads and the
    // second one is charged only for what the first did not already pay for, which is
    // correct budget behaviour but would make this case pass with a zero charge.
    const second = Run(ctx, `
        var far = TilesByDistanceFromBase(1).filter(k => {
            const t = engine.state.tiles.get(k);
            return t && !t.isBaseCampTile && t.fortifiedByPlayer === null && k !== spotA;
        });
        // Chosen by TRYING them: the second fort has to sit somewhere its line costs
        // something and shares no road with the first, and no coordinate rule reliably
        // produces that on every board. Tried furthest-from-base first, because a fort
        // beside base is supplied by a line of length zero.
        globalThis.spotB = null;
        for (var i = far.length - 1; i >= 0; i--) {
            Fortify(P1("ARCHER"), far[i]);
            var lineB = P1("ARCHER").supplyLine;
            var lineA = P1("PIKEMAN").supplyLine;
            if (lineB && lineB.cost > 0 && lineA
                && !lineB.path.some(e => lineA.path.includes(e))) {
                globalThis.spotB = far[i];
                break;
            }
            engine.state.tiles.get(far[i]).fortifiedByPlayer = null;
        }
        JSON.stringify({ supplied: !!P1("ARCHER").supplyLine, reach: ReachFor(1),
                         shared: P1("ARCHER").supplyLine
                             ? P1("ARCHER").supplyLine.path.filter(e =>
                                 P1("PIKEMAN").supplyLine && P1("PIKEMAN").supplyLine.path.includes(e)).length
                             : null });
    `);
    const b = JSON.parse(second);
    if (verbose) console.log('       second fort: ' + second);

    // The scenario itself is asserted, because "no such spot existed" would otherwise
    // sail through as a vacuous pass.
    Check('a second fort on a non-overlapping route was found',
        Run(ctx, 'spotB') !== null, 'no disjoint second route exists on this board');

    Check('a second line on a separate route COSTS reach from the same budget',
        b.supplied && b.reach < a.reach,
        'supplied=' + b.supplied + ', reach ' + a.reach + ' -> ' + b.reach
        + ', shared roads ' + b.shared);
    Check('and shares no road with the first, so the charge is its own',
        b.shared === 0, 'shared ' + b.shared + ' road(s)');

    // The half a per-line ceiling cannot produce: giving the ground back returns the
    // budget. Every fort is released, so the answer is the full pool rather than some
    // partial number that a stuck accumulator could also produce.
    const released = Run(ctx, `
        engine.state.tiles.forEach(t => { if (t.fortifiedByPlayer === 1) t.fortifiedByPlayer = null; });
        var loose = [...engine.state.edges.keys()][0];
        engine.state.units.forEach(u => {
            if (u.player === 1 && u.isFortified) { u.position = FineKeyOfEdge(loose); u.supplyLine = null; }
        });
        recalculatePlayerSupplyNetwork(1);
        ReachFor(1);
    `);
    Check('releasing every fort returns the budget to full', released === full,
        'reach is ' + released + ', full is ' + full);

    const overLong = Run(ctx, `
        engine.state.units.filter(u => u.player === 1 && u.supplyLine)
            .some(u => u.supplyLine.cost > MAX_SUPPLY_REACH)
    `);
    Check('no granted line exceeds the whole budget', overLong === false);
}

// --- 3. healing costs a ration, per unit, per turn ---------------------------
{
    const ctx = Fresh();
    Run(ctx, 'globalThis.a = P1("PIKEMAN"); globalThis.b = P1("ARCHER");'
        + ' OnOwnBase(a); StandOn(b, GetBaseCamp(1)[1] || GetBaseCamp(1)[0]);'
        + ' a.hp = a.maxHp - 1; b.hp = b.maxHp - 1; Untouched(a); Untouched(b);');

    const before = Run(ctx, 'Rations(1)');
    Run(ctx, 'Tick();');

    const healed = Run(ctx, '(a.hp === a.maxHp ? 1 : 0) + (b.hp === b.maxHp ? 1 : 0)');
    Check('two units healing the same turn spend two rations',
        healed === 2 && Run(ctx, 'Rations(1)') === before - 2,
        'healed ' + healed + ', pool ' + before + ' -> ' + Run(ctx, 'Rations(1)'));
}

// --- 4. regeneration, and its negative ---------------------------------------
{
    const ctx = Fresh();
    Run(ctx, 'globalThis.u = P1("PIKEMAN"); OnOwnBase(u); Untouched(u);'
        + ' u.hp = u.maxHp; SetRations(1, 4);');

    Run(ctx, 'Tick();');
    Check('a turn that heals nobody regenerates 1', Run(ctx, 'Rations(1)') === 5,
        'pool is ' + Run(ctx, 'Rations(1)'));

    // The negative: hurt the unit so the same turn spends instead.
    Run(ctx, 'u.hp = u.maxHp - 1; SetRations(1, 4); Tick();');
    Check('a turn that heals somebody does NOT also regenerate',
        Run(ctx, 'Rations(1)') === 3, 'pool is ' + Run(ctx, 'Rations(1)'));

    Run(ctx, 'u.hp = u.maxHp; SetRations(1, STARTING_RATIONS); Tick();');
    Check('regeneration cannot bank above the starting pool',
        Run(ctx, 'Rations(1)') === Run(ctx, 'STARTING_RATIONS'),
        'pool is ' + Run(ctx, 'Rations(1)'));

    // A stolen flag blocks it outright.
    Run(ctx, "SetRations(1, 4); engine.state.flags.p1_flag.status = 'carried'; Tick();");
    Check('a stolen flag blocks regeneration', Run(ctx, 'Rations(1)') === 4,
        'pool is ' + Run(ctx, 'Rations(1)'));
}

// --- 5. an intercepted line still drains -------------------------------------
//
// The ration is spent - stolen - and the unit at the far end heals nothing. Without
// this, interception is a free block; with it, it is an attack on the economy.
{
    const ctx = Fresh();
    const set = Run(ctx, `
        var far = TilesByDistanceFromBase(1).filter(k => {
            const t = engine.state.tiles.get(k);
            return t && !t.isBaseCampTile && t.fortifiedByPlayer === null;
        });
        Fortify(P1("PIKEMAN"), far[far.length - 1]);
        const line = P1("PIKEMAN").supplyLine;
        if (!line || !line.path.length) 'no-line';
        else {
            // Stand an enemy on the line itself.
            const enemy = engine.state.units.find(u => u.player === 2 && !u.isFortified);
            enemy.position = FineKeyOfEdge(line.path[0]);
            'ok';
        }
    `);
    Check('the interception scenario built', set === 'ok', 'got ' + set);

    Run(ctx, 'globalThis.u = P1("PIKEMAN"); u.hp = u.maxHp - 1; Untouched(u);');
    Check('an intercepted unit reads as unsupplied',
        Run(ctx, 'isUnitSupplied(u)') === false && Run(ctx, 'IsSupplyLineIntercepted(u)') === true);

    const before = Run(ctx, 'Rations(1)');
    const hpBefore = Run(ctx, 'u.hp');
    Run(ctx, 'Tick();');

    Check('the ration is spent anyway', Run(ctx, 'Rations(1)') === before - 1,
        'pool ' + before + ' -> ' + Run(ctx, 'Rations(1)'));
    Check('and the unit heals nothing', Run(ctx, 'u.hp') === hpBefore);
}

// --- 6. at zero, healing stops and every line is cut -------------------------
{
    const ctx = Fresh();
    Run(ctx, `
        var far = TilesByDistanceFromBase(1).filter(k => {
            const t = engine.state.tiles.get(k);
            return t && !t.isBaseCampTile && t.fortifiedByPlayer === null;
        });
        Fortify(P1("PIKEMAN"), far[far.length - 1]);
        globalThis.u = P1("PIKEMAN");
        u.hp = u.maxHp - 3;
        Untouched(u);
        SetRations(1, 1);
    `);

    Check('the unit is supplied going in', Run(ctx, '!!u.supplyLine') === true);

    Run(ctx, 'Tick();');
    Check('the last ration is spent healing', Run(ctx, 'Rations(1)') === 0
        && Run(ctx, 'u.hp') === Run(ctx, 'u.maxHp - 2'),
        'pool ' + Run(ctx, 'Rations(1)') + ', hp ' + Run(ctx, 'u.hp'));
    Check('and hitting zero severs the line', Run(ctx, '!!u.supplyLine') === false);

    // The line must stay cut - a recalculation triggered by any ordinary move must not
    // quietly hand it back while the larder is still empty.
    Run(ctx, 'recalculatePlayerSupplyNetwork(1);');
    Check('a starving player cannot be re-granted a line', Run(ctx, '!!u.supplyLine') === false);

    // And it comes back once the player has rested above zero.
    Run(ctx, 'u.hp = u.maxHp; Tick(); recalculatePlayerSupplyNetwork(1);');
    Check('resting back above zero restores the network',
        Run(ctx, 'Rations(1)') === 1 && Run(ctx, '!!u.supplyLine') === true,
        'pool ' + Run(ctx, 'Rations(1)') + ', line ' + Run(ctx, '!!u.supplyLine'));
}

// --- 7. the pool survives a save ---------------------------------------------
//
// Stored, not derived - a deliberate exception to Testament's "anything rebuildable
// gets rebuilt". Nothing on the board can recompute what was eaten.
{
    const ctx = Fresh();
    Run(ctx, 'SetRations(1, 6); SetRations(2, 3); SetReach(1, 11); SetReach(2, 2);'
        + ' globalThis.blob = JSON.stringify(BuildSaveObject(engine).save);');
    const saved = JSON.parse(Run(ctx, 'JSON.stringify(JSON.parse(blob).rations)'));
    Check('the save records both ration pools verbatim',
        saved && saved.player1 === 6 && saved.player2 === 3,
        'saved ' + JSON.stringify(saved));

    // Reach is DERIVED - the first recalculation after load overwrites it - but it is
    // saved anyway so the panel is right before that happens rather than briefly
    // claiming a full budget the player does not have.
    const savedReach = JSON.parse(Run(ctx, 'JSON.stringify(JSON.parse(blob).reach)'));
    Check('and carries reach too, so a load has something to show',
        savedReach && savedReach.player1 === 11 && savedReach.player2 === 2,
        'saved ' + JSON.stringify(savedReach));
}

if (failures.length) {
    console.error('\nFAIL - ' + failures.length + ' problem(s)');
    process.exit(1);
}
console.log('supply-smoke: PASS');
