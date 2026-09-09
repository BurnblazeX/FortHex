// FortHex - the Shield rework  (Track C, C2)
//
//   node tools/shield-smoke.js
//   node tools/shield-smoke.js --verbose
//
// Shield used to be a single point of overheal: `hp === maxHp + 1`, granted at the
// top of the healing ladder. It is now a ONE-HIT SPONGE - it absorbs one instance of
// damage in full, whatever the amount, and is then gone - and it is granted to a
// fortified unit that has gone a turn untouched and is EITHER supplied and whole OR
// cut off entirely.
//
// Nothing in the existing harness sees any of that. move-parity asks about movement,
// victory-smoke about the end of a match, and testament-fixtures about what survives a
// save. The rework is a damage rule and a grant rule, so it needs a file that hits
// units and then advances turns.
//
// Two things are worth stating about what is asserted here, because both are easy to
// write a passing-but-empty test around:
//
//   THE SPONGE IS TESTED WITH A BIG HIT. A 1-damage hit cannot tell "absorbed in full"
//   apart from "cost the unit its overheal point", which is precisely the old
//   behaviour. Every absorb below is of damage larger than 1.
//
//   THE GRANT IS TESTED AGAINST ITS OWN NEGATIVE. "A supplied full-health unit gains a
//   shield" passes just as well on a build that hands shields to everybody, so each
//   grant case is paired with the case that must NOT be granted.
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

// A Standard board with fog off, one engine per scenario so nothing leaks between them.
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

// Fortifying properly means spending MP and passing every legality check, none of which
// this file is about. Placing the unit on a hexCenter IS fortifying as far as the rules
// are concerned - the position carries the fact since the board-space cutover - so these
// helpers say so directly and keep the scenarios readable.
const HELPERS = `
function P1(typeId) { return engine.state.units.find(u => u.player === 1 && u.typeId === typeId); }

function StandOn(unit, tileKey) { unit.position = FineKeyOfTile(tileKey); }

function OnOwnBase(unit) { StandOn(unit, GetBaseCamp(unit.player)[0]); }

// A tile far from either base, so nothing accidentally supplies the unit standing on it.
function FarTile(player) {
    const bases = new Set([...GetBaseCamp(1), ...GetBaseCamp(2)]);
    for (const key of engine.state.tiles.keys()) {
        if (!bases.has(key)) return key;
    }
    return null;
}

// Long enough ago that the "not hit for a turn" gate is open.
function Untouched(unit) { unit.lastAttackedByHostileOnTurn = -10; }
function JustHit(unit) { unit.lastAttackedByHostileOnTurn = engine.state.globalTurnNumber; }

function Tick() { engine.state.currentPlayer = 1; ApplyStartOfTurnHealing(); }
`;

// --- 1. the sponge -----------------------------------------------------------
{
    const ctx = Fresh();
    Run(ctx, 'globalThis.u = P1("PIKEMAN"); u.hasShield = true; u.hp = u.maxHp;');

    const before = Run(ctx, 'u.hp');
    const dealt = Run(ctx, 'ApplyDamageToUnit(u, 4)');

    Check('a shielded unit takes NO damage from a 4-point hit',
        Run(ctx, 'u.hp') === before,
        'hp went ' + before + ' -> ' + Run(ctx, 'u.hp'));
    Check('the absorbed hit reports 0 damage dealt', dealt === 0, 'reported ' + dealt);
    Check('absorbing spends the shield', Run(ctx, 'u.hasShield') === false);

    const second = Run(ctx, 'ApplyDamageToUnit(u, 4)');
    Check('the NEXT hit lands in full', second === 4 && Run(ctx, 'u.hp') === before - 4,
        'dealt ' + second + ', hp now ' + Run(ctx, 'u.hp'));

    // The degeneracy guard for the whole section: if damage were broken outright,
    // every assertion above would still pass.
    const fresh = Run(ctx, 'const v = P1("ARCHER"); ApplyDamageToUnit(v, 3); v.maxHp - v.hp');
    Check('an unshielded unit loses exactly the damage dealt', fresh === 3, 'lost ' + fresh);
}

// --- 2. supplied and whole gains a shield, and does not overheal --------------
{
    const ctx = Fresh();
    Run(ctx, 'globalThis.u = P1("PIKEMAN"); OnOwnBase(u); u.hp = u.maxHp; Untouched(u);');

    Check('the scenario is actually supplied', Run(ctx, 'isUnitSupplied(u)') === true);

    Run(ctx, 'Tick();');
    Check('a supplied unit at full health gains a shield', Run(ctx, 'u.hasShield') === true);
    Check('and gains no HP doing it - nothing overheals now',
        Run(ctx, 'u.hp === u.maxHp') === true, 'hp is ' + Run(ctx, 'u.hp'));

    // The negative. Same unit, same tile, hit this turn.
    Run(ctx, 'u.hasShield = false; JustHit(u); Tick();');
    Check('a unit hit this turn gains NO shield', Run(ctx, 'u.hasShield') === false);
}

// --- 3. supplied and hurt heals, and does not also get a shield ---------------
{
    const ctx = Fresh();
    Run(ctx, 'globalThis.u = P1("PIKEMAN"); OnOwnBase(u); u.hp = u.maxHp - 2; Untouched(u);');
    Run(ctx, 'Tick();');

    Check('a supplied hurt unit heals 1', Run(ctx, 'u.hp === u.maxHp - 1') === true,
        'hp is ' + Run(ctx, 'u.hp'));
    Check('and does NOT bank a shield in the same tick', Run(ctx, 'u.hasShield') === false);

    // Asserted on the PREDICATE as well as on the tick. ApplyStartOfTurnHealing returns
    // early after healing, so it would refuse this unit a shield even if the rule itself
    // had been relaxed - which makes the tick alone a test of the control flow rather
    // than of the rule. Confirmed by break-testing: widening CanUnitGainShield to
    // `isUnitSupplied(unit) -> true` left the tick assertions above entirely green.
    Check('a supplied unit BELOW full health does not qualify for a shield',
        Run(ctx, 'CanUnitGainShield(u)') === false);
    Check('and the same unit at full health does',
        Run(ctx, 'u.hp = u.maxHp; CanUnitGainShield(u)') === true);
    Run(ctx, 'u.hp = u.maxHp - 1;');

    // Reaching full health is the healing tick; the shield is the one after it.
    Run(ctx, 'Tick();');
    Check('the tick that fills it up spends itself healing',
        Run(ctx, 'u.hp === u.maxHp && !u.hasShield') === true);
    Run(ctx, 'Tick();');
    Check('the following tick grants the shield', Run(ctx, 'u.hasShield') === true);
}

// --- 4. cut off: a buffer INSTEAD of recovery --------------------------------
{
    const ctx = Fresh();
    Run(ctx, 'globalThis.u = P1("PIKEMAN"); StandOn(u, FarTile(1)); u.supplyLine = null;'
        + ' u.hp = u.maxHp - 2; Untouched(u);');

    Check('the scenario is actually unsupplied', Run(ctx, 'isUnitSupplied(u)') === false);

    const hpBefore = Run(ctx, 'u.hp');
    Run(ctx, 'Tick();');

    Check('an unsupplied unit gains a shield at ANY health', Run(ctx, 'u.hasShield') === true);
    Check('and heals nothing - the buffer replaces the recovery',
        Run(ctx, 'u.hp') === hpBefore, 'hp went ' + hpBefore + ' -> ' + Run(ctx, 'u.hp'));
}

// --- 4b. a stolen flag stops the healing, not the shield ---------------------
//
// The old pass returned outright when the flag was gone, so nobody healed and nobody
// was shielded. That was right while shield WAS the top rung of the healing ladder and
// wrong the moment it stopped being one: a stolen flag zeroes the supply pool, and
// being cut off is the exact case the shield's second branch exists for. Blocking both
// would make losing the flag the one form of being cut off that pays nothing.
{
    const ctx = Fresh();
    Run(ctx, 'globalThis.u = P1("PIKEMAN"); OnOwnBase(u); u.hp = u.maxHp - 2; Untouched(u);'
        + " engine.state.flags.p1_flag.status = 'carried';");

    // The line itself is intact - the unit is standing on its own base. It is the FLAG
    // that stops it drawing on supply, which is the distinction being tested.
    Check('the line is intact; only the flag is gone',
        Run(ctx, 'isUnitSupplied(u)') === true && Run(ctx, 'CanUnitDrawOnSupply(u)') === false);

    const hpBefore = Run(ctx, 'u.hp');
    Run(ctx, 'Tick();');

    Check('a unit with its flag stolen does not heal', Run(ctx, 'u.hp') === hpBefore,
        'hp went ' + hpBefore + ' -> ' + Run(ctx, 'u.hp'));
    Check('but DOES gain a shield, at any health', Run(ctx, 'u.hasShield') === true);

    // The negative: put the flag back and the same unit heals instead.
    Run(ctx, "u.hasShield = false; engine.state.flags.p1_flag.status = 'home'; Tick();");
    Check('flag home again, and it heals rather than shields',
        Run(ctx, 'u.hp') === hpBefore + 1 && Run(ctx, 'u.hasShield') === false,
        'hp ' + Run(ctx, 'u.hp') + ', shield ' + Run(ctx, 'u.hasShield'));
}

// --- 5. the mountain-peak archer gets neither --------------------------------
{
    const ctx = Fresh();
    Run(ctx, 'globalThis.u = P1("ARCHER"); globalThis.peak = FarTile(1);'
        + ' engine.state.tiles.get(peak).type = TILE_TYPES.MOUNTAIN;'
        + ' StandOn(u, peak); u.supplyLine = null; u.hp = u.maxHp - 1; Untouched(u);');

    Check('the scenario really is an archer on a peak',
        Run(ctx, 'isUnitOnMountainPeak(u)') === true);

    Run(ctx, 'Tick();');
    Check('a mountain-fortified archer gains no shield', Run(ctx, 'u.hasShield') === false);
    Check('and still gets no healing either', Run(ctx, 'u.hp === u.maxHp - 1') === true);

    // The negative that proves it is the PEAK doing it: the same archer, cut off,
    // anywhere else on the board.
    Run(ctx, 'engine.state.tiles.get(peak).type = TILE_TYPES.PLAINS; Tick();');
    Check('the same archer off the peak DOES gain one', Run(ctx, 'u.hasShield') === true);
}

// --- 6. a shield survives a save ---------------------------------------------
//
// hasShield is a stored fact, not a derived one - nothing on the board can rebuild
// "this unit sat untouched long enough". If it did not round-trip, a shield would be
// silently cashed in by saving.
{
    const ctx = Fresh();
    Run(ctx, 'globalThis.u = P1("PIKEMAN"); u.hasShield = true;'
        + ' globalThis.blob = JSON.stringify(BuildSaveObject(engine).save);');

    const written = Run(ctx, 'JSON.parse(blob).units.filter(x => x.hasShield).length');
    Check('the save records the shielded unit', written === 1, 'wrote ' + written + ' of them');

    const others = Run(ctx, 'JSON.parse(blob).units.filter(x => "hasShield" in x).length');
    Check('and does not write the field on the seven units without one',
        others === 1, 'field present on ' + others + ' units');
}

if (failures.length) {
    console.error('\nFAIL - ' + failures.length + ' problem(s)');
    process.exit(1);
}
console.log('shield-smoke: PASS');
