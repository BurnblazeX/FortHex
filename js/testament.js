// === Testament — versioned save/map schema and migration chain (A4) ===
//
// Replaces attemptLegacyConversion (js/client/save.js), which tried to patch every
// broken shape B20 through B29 in one reactive pass with no idea which version it
// was looking at. This is the same job done as an ordered chain: detect the version,
// then apply one small step per real schema boundary until the data is current.
//
// WHY THIS FILE SITS IN /js RATHER THAN client/ OR server/:
// it is genuinely needed by both sides, same category as config-data.js and
// grid-math.js. ResolveDisconnectOutcome (js/server/session.js, A3's hook) calls
// BuildSaveObject directly, in-process - a client-only Testament would have forced
// that hook to become a request-and-wait instead of a function call. js/client/save.js
// owns the other edge: disk writes, localStorage, file dialogs. Nothing here touches
// the DOM or a filesystem.
//
// ONE SCHEMA FOR BOTH FILE KINDS. A .fhmap is a .fh save with sections missing
// (match history, sometimes unit placements) - not a separate document type. Same
// chain, same version sequence. What a loaded file opens into is decided by which
// sections survive migration, never by the file extension (see DescribeContent).
//
// POLICY: warn, never refuse. An unrecognised shape, or a known shape with a field
// missing, produces a warning and a best-effort load. Only data so corrupt that no
// sensible partial state exists is worth failing outright, and that is a high bar.
//
// POLICY: no backporting. A migration reshapes data between adjacent schema
// versions. It never re-judges a gameplay decision that was legal under the rules
// of the build that wrote it. Old saves are not wrong for being old.

// Bumped whenever a new migration step is appended. 8 = B30, the Track A reshape;
// 9 = A5, the optional local player profile a save carries when the device that
// wrote it has one.
//
// EXPECTED NEXT BUMP: Track C (fine grid migration), now a v9->v10 step since A5
// took v8->v9. Burn's flag, recorded here because this line is where whoever
// does it will start.
//
// It is NOT the fineGrid index that forces it - that stays derived, rebuilt by
// buildFineGridIndex() at load, which is why the lean schema drops it. What
// changes is how a POSITION is spelled, and positions are saved in four places:
//
//   unit.position / unit.positionType   a unit can sit on a vertex, so both the
//                                       value and the 'edge'|'center' enum change
//   unit.supplyLine.path                an array of edge keys
//   baseCampPositions / flags.homePosition
//   matchHistory payloads               MOVE.from/to, FORTIFY.tile, ATTACK.targetEdge
//
// The last one is the awkward one and is worth deciding deliberately rather than
// discovering: a v8 save's ledger records positions in the old spelling. Either
// the v8->v9 step rewrites historical entries (which brushes against the
// no-backporting rule, though arguably it is re-spelling rather than re-judging),
// or the ledger keeps mixed representations and every reader handles both.
// A6's archive and D3's Gospel corpus both read that ledger - see the A4 handoff.
const CURRENT_SCHEMA_VERSION = 9;

// The verified mapping from beta number to schema version. Built by diffing the ten
// real fixture files (B20-B29), NOT from the guide's provisional table - which was
// wrong in three places: B23 is its own boundary rather than sharing B20-B25, B24
// and B25 pair together, and B26 and B27 are separate steps rather than one bucket.
//
//   v1  B20 B21 B22   baseline; no gameMode; units duplicated inside every edge
//   v2  B23           +gameMode +playerSide; unit.isDying appears
//   v3  B24 B25       +activeAnimations; unit.isDying gone again
//   v4  B26           +playerActionTaken; unit +turnsFortified +fortifyCooldown
//   v5  B27           +playerColorSelections +colorTransition; type loses colours
//   v6  B28           +renderScale/Offset, mapMaker*, baseCampPositions, arcade*
//   v7  B29           edges shed their unit copies; stats/upgrades/typeId model;
//                     matchHistory and unitIdCounter appear; tile visibility
//   v8  B30           Track A's engine.state reshape, and the lean schema
//   v9  B30           A5's optional profile - the one boundary in this table
//                     that adds nothing mandatory; see MigrateAddProfile
const BETA_SCHEMA_VERSIONS = {
    B20: 1, B21: 1, B22: 1,
    B23: 2,
    B24: 3, B25: 3,
    B26: 4,
    B27: 5,
    B28: 6,
    B29: 7,
    B30: 9,
};

// --- warnings ---------------------------------------------------------------
// Collected rather than thrown, because the policy is best-effort loading. The
// caller decides whether to surface these; nothing here aborts on one.

function MakeMigrationReport(fromVersion) {
    return { fromVersion, toVersion: fromVersion, steps: [], warnings: [], corrections: [] };
}

function Warn(report, message) {
    report.warnings.push(message);
    console.warn('[Testament] ' + message);
}

// --- version detection ------------------------------------------------------

// The label first, the shape only when there is no label to read.
//
// All ten archived fixtures carry a saveVersion, including the B20 one - so the
// shape path below is built but is NOT exercised by any real file. It exists
// because genuinely unlabelled pre-patch B20 saves are believed to exist in the
// wild; treat it as untested until one turns up.
function DetectVersion(data) {
    if (!data || typeof data !== 'object') return null;

    // The current format states its own schema version outright. Everything B20-B29
    // only carries a build label, which has to be mapped; anything older than that
    // carries nothing and has to be recognised by shape.
    if (Number.isInteger(data.schemaVersion)) return data.schemaVersion;

    const labelled = ParseVersionLabel(data.saveVersion);
    if (labelled !== null) return labelled;

    return InferVersionFromShape(data);
}

// Labels are "B26" up to B26 and "B27//3", "B28//3d", "B29//4" after - a beta
// number plus a sub-revision suffix that carries no schema meaning. Take the number.
function ParseVersionLabel(label) {
    if (typeof label !== 'string') return null;

    const match = label.match(/^B(\d+)/i);
    if (!match) return null;

    const beta = 'B' + match[1];
    if (BETA_SCHEMA_VERSIONS[beta] !== undefined) return BETA_SCHEMA_VERSIONS[beta];

    // A build newer than this table knows about. Assume current rather than
    // refusing - a file from a future build is not a file we can improve by
    // rejecting it, and the audit still runs.
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > 30) return CURRENT_SCHEMA_VERSION;
    return null;
}

// Distinguishing marks, newest first, so the most specific test wins. Each is a
// field that appeared at exactly one boundary and never went away again.
function InferVersionFromShape(data) {
    const units = Array.isArray(data.units) ? data.units : [];
    const sample = units[0] || {};
    const edges = NormalizeEntries(data.edges);
    const firstEdge = edges.length ? edges[0][1] : null;

    // The lean shape: tiles name their type instead of copying it, and carry no
    // coordinates because the key already holds them.
    const firstTile = NormalizeEntries(data.tiles)[0];
    if (firstTile && firstTile[1] && firstTile[1].typeId !== undefined) {
        // A9-shaped file that happens to name its author. The absence of a profile
        // proves nothing - it is the normal state - so an unlabelled lean file with
        // no profile is reported as v8 and migrates through a no-op step to v9.
        // This is the one boundary in the table with no reliable distinguishing
        // mark, and the reason that is acceptable is in MigrateAddProfile.
        return (data.profile && typeof data.profile === 'object') ? 9 : 8;
    }

    if (sample.stats !== undefined || data.matchHistory !== undefined) return 7;
    if (data.baseCampPositions !== undefined || data.mapMakerBrush !== undefined) return 6;
    if (data.playerColorSelections !== undefined) return 5;
    if (data.playerActionTaken !== undefined || sample.fortifyCooldown !== undefined) return 4;
    if (data.activeAnimations !== undefined) return 3;
    if (data.gameMode !== undefined) return 2;

    // v1's signature: no gameMode at all, and every edge carries its own copy of
    // the units standing on it. Nothing later does both.
    if (firstEdge && Array.isArray(firstEdge.units)) return 1;

    return null;
}

// tiles/edges are stored as [key, value] pairs, but old files and JSON round-trips
// have both produced plain objects. One helper so no migration has to care which.
function NormalizeEntries(collection) {
    if (Array.isArray(collection)) return collection;
    // A live engine holds tiles/edges as Maps; a file holds them as pair arrays.
    if (collection instanceof Map) return Array.from(collection.entries());
    if (collection && typeof collection === 'object') return Object.entries(collection);
    return [];
}

// --- the chain --------------------------------------------------------------

const MIGRATIONS = [
    { from: 1, to: 2, Migrate: MigrateAddGameMode },
    { from: 2, to: 3, Migrate: MigrateDropIsDying },
    { from: 3, to: 4, Migrate: MigrateAddFortifyCounters },
    { from: 4, to: 5, Migrate: MigrateAddColorSelections },
    { from: 5, to: 6, Migrate: MigrateAddMapMakerEra },
    { from: 6, to: 7, Migrate: MigrateToStatsModel },
    { from: 7, to: 8, Migrate: MigrateToEngineState },
    { from: 8, to: 9, Migrate: MigrateAddProfile },
];

// The runner. Detect, then step forward one schema version at a time, auditing
// after every step rather than once at the end - the historical bugs the audit
// catches are not known to be scoped to a single boundary, so a bug introduced
// partway through the range has to be caught wherever it first shows up.
function MigrateSave(rawData) {
    let version = DetectVersion(rawData);
    const report = MakeMigrationReport(version);

    if (version === null) {
        Warn(report, 'unrecognised file shape - loading as if it were current, best effort');
        version = CURRENT_SCHEMA_VERSION;
        report.fromVersion = null;
    }

    let data = rawData;

    while (version < CURRENT_SCHEMA_VERSION) {
        const step = MIGRATIONS.find(m => m.from === version);
        if (!step) {
            Warn(report, 'no migration path from schema version ' + version + ' - stopping here');
            break;
        }

        data = step.Migrate(data, report);
        data = AuditForKnownBugs(data, report);
        report.steps.push(step.from + '->' + step.to);
        version = step.to;
    }

    report.toVersion = version;
    data.schemaVersion = version;
    return { data, report };
}

// --- migration steps --------------------------------------------------------
// Each step does only what its own boundary introduced. Anything a later step
// needs is that step's problem; anything an earlier one already handled is not
// re-done here.

// v1 -> v2 (B22 -> B23). gameMode and playerSide appear. Everything before this
// was local play by definition - there was no other mode to be in.
function MigrateAddGameMode(data) {
    const out = { ...data };
    if (out.gameMode === undefined) out.gameMode = 'local';
    if (out.playerSide === undefined) out.playerSide = null;
    return out;
}

// v2 -> v3 (B23 -> B24). isDying was a one-beta experiment: present on B23 units,
// gone by B24. Drop it rather than carry a field nothing has read since.
function MigrateDropIsDying(data) {
    const out = { ...data };
    out.units = MapUnits(out, unit => {
        const u = { ...unit };
        delete u.isDying;
        return u;
    });
    return out;
}

// v3 -> v4 (B25 -> B26). Fortification gained a duration and a cooldown, and the
// engine started tracking whether each player had acted this turn.
function MigrateAddFortifyCounters(data) {
    const out = { ...data };
    out.units = MapUnits(out, unit => ({
        ...unit,
        turnsFortified: unit.turnsFortified !== undefined ? unit.turnsFortified : 0,
        fortifyCooldown: unit.fortifyCooldown !== undefined ? unit.fortifyCooldown : 0,
    }));
    if (out.playerActionTaken === undefined) {
        out.playerActionTaken = { player1: false, player2: false };
    }
    return out;
}

// v4 -> v5 (B26 -> B27). Team colours became a per-player selection, so the unit
// type stopped carrying baked-in colour fields.
function MigrateAddColorSelections(data) {
    const out = { ...data };
    if (out.playerColorSelections === undefined) {
        out.playerColorSelections = { player1: 2, player2: 2 };
    }
    out.units = MapUnits(out, unit => {
        if (!unit.type) return unit;
        const type = { ...unit.type };
        delete type.color;
        delete type.enemyColor;
        return { ...unit, type };
    });
    return out;
}

// v5 -> v6 (B27 -> B28). The map-maker era: base camps became addressable data
// rather than something inferred, and arcade mode arrived.
//
// baseCampPositions is derived from the flags' home positions, which have been in
// every save since B20 - that is where a base camp already lived, unnamed.
function MigrateAddMapMakerEra(data) {
    const out = { ...data };

    if (out.baseCampPositions === undefined) {
        out.baseCampPositions = {
            player1: out.flags && out.flags.p1_flag ? out.flags.p1_flag.homePosition : null,
            player2: out.flags && out.flags.p2_flag ? out.flags.p2_flag.homePosition : null,
        };
    }
    if (out.mapMakerMode === undefined) out.mapMakerMode = false;
    if (out.arcadeTotalTurns === undefined) out.arcadeTotalTurns = 0;

    return out;
}

// v6 -> v7 (B28 -> B29). The largest boundary in the whole range, larger than B28:
//
//   - edges stop carrying their own copy of the units standing on them. That copy
//     was always redundant with the top-level units array, and the current loader
//     rebuilds edge.units as a derived getter anyway (rehydrateGameState step 6).
//   - units move to the typeId + stats model: baseMove becomes speed,
//     fortificationBonus becomes defense, and the whole embedded type object stops
//     being authoritative (it is a getter over UNIT_TYPES at load).
//   - upgrades/level/spearWalled/ambushed/mountainAttritionTurns arrive.
//   - matchHistory appears for the first time. NOTE FOR A6: no save older than B29
//     has any match history at all, so nothing before B29 can ever be archived
//     retroactively - that data was never written.
//   - tiles gain isBaseCampTile and a per-type visibility value.
function MigrateToStatsModel(data, report) {
    const out = { ...data };

    // Units, first: the tile pass below wants base-camp positions already resolved.
    out.units = MapUnits(out, unit => ConvertUnitToStatsModel(unit, report));

    out.edges = NormalizeEntries(out.edges).map(([key, edge]) => {
        const e = { ...edge };
        delete e.units;
        return [key, e];
    });

    const baseCampTiles = CollectBaseCampTiles(out);

    out.tiles = NormalizeEntries(out.tiles).map(([key, tile]) => {
        const t = { ...tile };
        if (t.isBaseCampTile === undefined) t.isBaseCampTile = baseCampTiles.has(key);
        if (t.fortifiedByPlayer === undefined) t.fortifiedByPlayer = null;
        return [key, t];
    });

    if (out.matchHistory === undefined) out.matchHistory = [];
    if (out.unitIdCounter === undefined) {
        out.unitIdCounter = Array.isArray(out.units) ? out.units.length : 0;
    }

    return out;
}

// The old shape described a unit's stats through its embedded type object; the new
// one keeps them on the unit so upgrades can move them independently of the type.
function ConvertUnitToStatsModel(unit, report) {
    const u = { ...unit };
    const oldType = unit.type || {};

    // typeName is what a map file's skeletal unit records instead of a type object.
    const typeId = String(
        u.typeId || u.typeName || oldType.typeName || oldType.name || 'MELEE'
    ).toUpperCase();
    u.typeId = typeId;
    delete u.typeName;

    if (!u.stats) {
        // The saved type object first, then the live template. The template is the
        // real source of base stats either way - a map file's unit has no type
        // object at all, and an old save's is a stale copy of this same constant.
        const template = (typeof UNIT_TYPES !== 'undefined' && UNIT_TYPES[typeId]) || {};
        const pick = (...candidates) => candidates.find(v => v !== undefined);

        const maxHp = pick(u.maxHp, oldType.hp, template.hp);
        const hp = pick(u.hp, maxHp);

        u.stats = {
            hp: pick(hp, 0),
            maxHp: pick(maxHp, 0),
            // baseMove/attack/fortificationBonus were the old names for these.
            speed: pick(oldType.speed, oldType.baseMove, template.speed),
            damage: pick(oldType.damage, oldType.attack, template.damage),
            defense: pick(oldType.defense, oldType.fortificationBonus, template.defense),
            range: pick(oldType.attackType, template.attackType) === 'ranged' ? 2 : 1,
        };

        if (u.stats.speed === undefined || u.stats.damage === undefined) {
            Warn(report, 'unit ' + u.id + ' (' + typeId + ') had no usable stats; defaults applied');
        }
    }

    if (u.level === undefined) u.level = 0;
    if (!u.upgrades) u.upgrades = { health: 0, speed: 0, damage: 0, defense: 0 };
    if (u.spearWalled === undefined) u.spearWalled = false;
    if (u.ambushed === undefined) u.ambushed = false;
    if (u.mountainAttritionTurns === undefined) u.mountainAttritionTurns = 0;
    if (u.turnsFortifiedAtBase === undefined) u.turnsFortifiedAtBase = 0;

    return u;
}

// v7 -> v8 (B29 -> B30). Track A's reshape, and the point at which the schema gets
// lean. Everything upstream is allowed to stay fat; only this output has to be
// small, because only this output is what a current build writes.
//
// What comes out is deliberately NOT engine.state - it is the portable, JSON-safe
// shape both sides agree on. ExpandSaveObject turns it back into something the
// engine and client can be loaded from.
function MigrateToEngineState(data, report) {
    return BuildLeanSave(data, report);
}

// v8 -> v9 (B30 -> B30). A5's local player profile.
//
// This step is a genuine no-op, and that is the correct implementation rather
// than a placeholder. Every boundary above this one ADDED something a save must
// carry; v9 adds something a save carries only when the device that wrote it has
// a profile at all - which most devices never do, because a profile is created
// lazily on first entry into Online multiplayer and nowhere else.
//
// So there is nothing to fill in. A v8 file has no profile because no profile
// existed when it was written; a v9 file from a device with no profile has none
// for exactly the same reason. Inventing an empty one here would be the opposite
// of what A5 asked for - the field being ABSENT is the majority case and the
// meaningful one, not a gap to paper over.
//
// The consequence worth knowing about is in InferVersionFromShape: because the
// only thing v9 adds is optional, a v9 save without a profile is shape-identical
// to a v8 one and there is no distinguishing mark to test for. Misdetecting one
// as the other is harmless precisely because this step does nothing.
function MigrateAddProfile(data) {
    return data;
}

// --- the lean current schema ------------------------------------------------
//
// Measured against the real B29 fixture rather than reasoned about abstractly.
// Four categories of waste, all confirmed by reading the load path:
//
//   1. Units duplicated inside every edge. edge.units is a derived getter
//      (rehydrateGameState step 6) - the saved copies are never read.
//   2. Embedded type objects on every unit and every tile, repeating a
//      config-data.js constant verbatim. unit.type is likewise a getter over
//      UNIT_TYPES[typeId]; the saved object is never read either.
//   3. unit.hp / unit.maxHp, which are getters over unit.stats. Saving all three
//      means saving the same two numbers twice.
//   4. Coordinates that are already in the key. A tile keyed "-2,1" does not need
//      q:-2, r:1 beside it; an edge keyed "0,1_1,0" does not need four.
//
// Plus every client-only field that leaked into the format and has no business in
// a save at all: animations, visual effects, drag and hover state, redraw flags,
// the map-maker brush, cached vision, the fine grid.

// Fields the engine owns and a save must carry. Mirrors ENGINE_SAVE_FIELDS in
// js/client/save.js, plus pendingVictory (see below).
// actionLog is deliberately absent: it is a rolling UI window rebuilt from
// matchHistory at load, not something the file needs to carry.
const SAVE_ENGINE_FIELDS = [
    'gameMode', 'playerSide', 'gridRadius', 'playerColorSelections',
    'currentPlayer', 'globalTurnNumber', 'matchHistory',
    'unitIdCounter', 'flags', 'respawnQueue', 'unitCounts', 'supplyPoints',
    'baseCampPositions', 'gameOver', 'arcadeTotalTurns', 'isTrainingMode',
    'mapMakerMode', 'playerActionTaken',

    // A5. Who wrote the file: { id, name }, or absent. Read off the engine
    // INSTANCE rather than engine.state in BuildSaveObject (see below) - it is
    // metadata about the device, not a fact about the board. Listed here so the
    // migration chain carries it through untouched rather than dropping it.
    'profile',
];

// Everything worth keeping about a unit. type/hp/maxHp are absent on purpose:
// all three are getters restored at load, so saving them stores the same facts
// twice and lets the copies drift apart.
const SAVE_UNIT_FIELDS = [
    'id', 'player', 'typeId', 'stats', 'currentMove', 'positionType', 'position',
    'isFortified', 'fortifiedTileKey', 'hasPerformedMajorAction', 'isCarryingFlag',
    'turnsFortifiedAtBase', 'turnsFortified', 'fortifyCooldown', 'canHeal',
    'supplyLine', 'lastAttackedByHostileOnTurn', 'spearWalled', 'ambushed',
    'level', 'upgrades', 'mountainAttritionTurns',
];

// A default is the most rebuildable value there is, so it isn't written. Measured
// before this: a unit cost 530 bytes and 60% of that was fields saying nothing had
// happened to it - `spearWalled: false`, `turnsFortified: 0`, and a 45-byte
// all-zero upgrades object, on every unit of every save.
//
// Only fields with a genuinely universal default belong here. id/player/typeId/
// stats/currentMove/position have no default and are always written; canHeal
// defaults TRUE, so `false` is the meaningful case and is the one that gets stored.
const UNIT_FIELD_DEFAULTS = {
    isFortified: false,
    fortifiedTileKey: null,
    hasPerformedMajorAction: false,
    isCarryingFlag: false,
    turnsFortifiedAtBase: 0,
    turnsFortified: 0,
    fortifyCooldown: 0,
    canHeal: true,
    supplyLine: null,
    lastAttackedByHostileOnTurn: 0,
    spearWalled: false,
    ambushed: false,
    level: 0,
    mountainAttritionTurns: 0,
};

const NO_UPGRADES = { health: 0, speed: 0, damage: 0, defense: 0 };

function IsUnupgraded(upgrades) {
    if (!upgrades) return true;
    return Object.keys(NO_UPGRADES).every(k => !upgrades[k]);
}

function LeanUnit(unit) {
    const out = {};

    SAVE_UNIT_FIELDS.forEach(field => {
        const value = unit[field];
        if (value === undefined) return;

        if (field === 'upgrades') {
            if (!IsUnupgraded(value)) out.upgrades = value;
            return;
        }
        // Object.prototype.hasOwnProperty, not `in`, so a field whose default is
        // literally `undefined` could never be silently swallowed.
        if (Object.prototype.hasOwnProperty.call(UNIT_FIELD_DEFAULTS, field)
            && value === UNIT_FIELD_DEFAULTS[field]) {
            return;
        }
        out[field] = value;
    });

    return out;
}

// The exact inverse: anything absent was absent because it held its default.
function ExpandUnit(unit) {
    const out = { ...unit };
    Object.keys(UNIT_FIELD_DEFAULTS).forEach(field => {
        if (out[field] === undefined) out[field] = UNIT_FIELD_DEFAULTS[field];
    });
    if (!out.upgrades) out.upgrades = { ...NO_UPGRADES };
    return out;
}

// Client-owned, but genuinely part of the match rather than of how it looks. The
// arcade turn clock is the whole list today: everything else the client holds
// (animations, effects, drag/hover, render scale, the map-maker brush) is either
// recomputed at load or purely presentational, and is dropped on purpose.
const SAVE_CLIENT_FIELDS = ['arcadeTurnTimer'];

// How much of a pre-B29 file's action log to carry, since those files have no
// ledger to rebuild one from.
const LEGACY_LOG_TAIL = 10;

function BuildLeanSave(data, report) {
    const out = { schemaVersion: CURRENT_SCHEMA_VERSION };

    SAVE_ENGINE_FIELDS.forEach(field => {
        if (data[field] !== undefined) out[field] = data[field];
    });
    SAVE_CLIENT_FIELDS.forEach(field => {
        if (data[field] !== undefined) out[field] = data[field];
    });

    if (out.gameMode === undefined) out.gameMode = 'local';
    if (out.isTrainingMode === undefined) out.isTrainingMode = false;
    if (out.mapMakerMode === undefined) out.mapMakerMode = false;
    // A map file spells it `radius`; a save spells it `gridRadius`. Same number.
    if (out.gridRadius === undefined && data.radius !== undefined) out.gridRadius = data.radius;
    if (out.gridRadius === undefined) out.gridRadius = InferGridRadius(data, report);

    out.units = MapUnits(data, unit => LeanUnit(unit));
    out.tiles = NormalizeEntries(data.tiles).map(([key, tile]) => [key, LeanTile(tile)]);

    // The edge SET is not saved at all - it is a pure function of the tile set
    // (match-setup.js builds it from getNeighbors), so RebuildEdges regenerates it
    // at load exactly the way a new match does. What survives is only the handful
    // of edges carrying state a rebuild could not know about: bridges.
    //
    // Measured before this change: 90 edges cost 1495 bytes of an 8.5K save, and in
    // nine of the ten archived fixtures every one of those entries was `{}` - 17% of
    // the file spent recording nothing.
    out.bridges = {};
    NormalizeEntries(data.edges).forEach(([key, edge]) => {
        if (edge && edge.bridge) {
            out.bridges[key] = { bridgeHp: edge.bridgeHp !== undefined ? edge.bridgeHp : null };
        }
    });

    // actionLog is not saved either - it is a rolling 25-entry UI window (ui.js
    // trims it), never match truth, and RebuildActionLog reconstructs it from
    // matchHistory, which IS the record.
    //
    // The one exception: nothing before B29 has a matchHistory at all, so for those
    // files there is no ledger to rebuild from and dropping the log would discard
    // the only history they carry. Keep the tail in that case. Same principle
    // either way - rebuild what can be rebuilt, keep only what cannot.
    const hasLedger = Array.isArray(data.matchHistory) && data.matchHistory.length > 0;
    if (!hasLedger && Array.isArray(data.actionLog) && data.actionLog.length > 0) {
        out.actionLog = data.actionLog.slice(-LEGACY_LOG_TAIL);
    }

    // Burn's call (A4 §7.1): persist the verdict rather than inherit A2's known gap,
    // where "a match saved after victory loses the verdict". One nullable field now
    // is cheaper than a schema bump later.
    out.pendingVictory = data.pendingVictory !== undefined ? data.pendingVictory : null;

    return out;
}

// The tile's type is a name, not a copy of the type. q/r come back from the key.
function LeanTile(tile) {
    const t = {
        typeId: String(TileTypeName(tile) || 'PLAINS').toUpperCase(),
    };
    if (tile.fortifiedByPlayer !== undefined && tile.fortifiedByPlayer !== null) {
        t.fortifiedByPlayer = tile.fortifiedByPlayer;
    }
    if (tile.isBaseCampTile) t.isBaseCampTile = true;
    return t;
}

// Only what isn't reconstructible. Coordinates come from the key, isPathway has
// been true for every edge in every fixture, and the unit list is a getter.
function LeanEdge(edge) {
    const e = {};
    if (edge.bridge) {
        e.bridge = true;
        e.bridgeHp = edge.bridgeHp !== undefined ? edge.bridgeHp : null;
    }
    if (edge.isPathway === false) e.isPathway = false;
    return e;
}

// --- serializing a live match ----------------------------------------------
//
// THE canonical path from a running engine instance to a save-shaped object.
// Deliberately one function with two callers (A4 §8): the manual save flow in
// js/client/save.js, and ResolveDisconnectOutcome in js/server/session.js. Two
// serialization paths for one nominal format would defeat having one versioned
// schema in the first place.
//
// Takes the instance rather than reaching for a global, so it works for any
// engine - including a second concurrent match, per A1's instance-scoped design.
//
// Built on the same lean shaping the migration chain's last step produces, so a
// freshly saved match and a migrated B20 file come out in exactly one format.
// The portable-serialization discipline (Maps to pair arrays, no live references)
// is BuildResyncSnapshot's, generalised - it solved this once for A3 already.
function BuildSaveObject(engineInstance, extras) {
    const state = engineInstance.state;
    const report = MakeMigrationReport(CURRENT_SCHEMA_VERSION);

    const flat = {};
    SAVE_ENGINE_FIELDS.forEach(field => {
        if (state[field] !== undefined) flat[field] = state[field];
    });

    // The narrow set of client-owned values that are genuinely match state rather
    // than presentation. Passed in rather than reached for, because the engine has
    // no client to ask and this module has no globals.
    if (extras) {
        SAVE_CLIENT_FIELDS.forEach(field => {
            if (extras[field] !== undefined) flat[field] = extras[field];
        });
    }

    flat.units = state.units;
    flat.tiles = state.tiles;
    flat.edges = state.edges;

    // Unlike a resync snapshot this is NOT fog-filtered. A save is the
    // authoritative record of the match, not one player's view of it.
    flat.pendingVictory = engineInstance.pendingVictory !== undefined
        ? engineInstance.pendingVictory
        : null;

    // A5. Who wrote this file, when the device that wrote it has a profile.
    //
    // Read off the engine INSTANCE, not engine.state and not a global: this
    // module is DOM-free and runs inside a bare Worker with no localStorage,
    // which is what tools/worker-smoke.js actively asserts. The composition root
    // (js/main.js) hands the engine the profile as plain data, and
    // js/client/profile.js keeps it current if one is created mid-session. So the
    // engine never learns how a profile is stored - only what its id and name are.
    //
    // ONE call site, deliberately, exactly as A4 built the rest of this function:
    // both a manual save and ResolveDisconnectOutcome come through here, and
    // neither has to remember to attach anything.
    //
    // Absent, not null, when there is no profile. That is what makes a save from
    // the majority case - a device that has never gone online - byte-identical to
    // one written before this track existed.
    if (engineInstance.localProfile && engineInstance.localProfile.id) {
        flat.profile = {
            id: String(engineInstance.localProfile.id),
            name: String(engineInstance.localProfile.name || ""),
        };
    }

    const save = BuildLeanSave(flat, report);
    save.savedAt = Date.now();
    return { save, report };
}

// --- expanding back out -----------------------------------------------------
//
// The inverse of BuildLeanSave: restore what was dropped because it was
// derivable. Everything here is reconstruction, never invention - if a value
// cannot be rebuilt from what was saved plus config-data.js, it should not have
// been dropped in the first place.
// `options` steers the action-log rebuild only: { forPlayer, fogOfWarEnabled }.
// forPlayer defaults to whoever is to move, which is right for local play and for
// resuming a match; singleplayer overrides it once the player has picked a side.
function ExpandSaveObject(lean, options) {
    const opts = options || {};
    const out = { ...lean };

    out.tiles = NormalizeEntries(lean.tiles).map(([key, tile]) => {
        const [q, r] = key.split(',').map(Number);
        return [key, {
            q, r,
            // TileTypeName, not tile.typeId directly: if the chain stopped short of
            // the lean shape (warn-don't-refuse leaves a half-migrated file), the
            // tile still describes its type the old way, and reading only typeId
            // would silently turn the whole board into Plains.
            type: LookupTileType(TileTypeName(tile)),
            fortifiedByPlayer: tile.fortifiedByPlayer !== undefined ? tile.fortifiedByPlayer : null,
            isBaseCampTile: !!tile.isBaseCampTile,
        }];
    });

    // A file written by this schema carries no edge list, only bridges. One written
    // by an older schema still has its edges; use them rather than regenerating, so
    // a historical board is never silently reshaped by current geometry rules.
    out.edges = NormalizeEntries(lean.edges).length
        ? NormalizeEntries(lean.edges).map(([key, edge]) => [key, ExpandEdge(key, edge)])
        : RebuildEdges(out.tiles, lean.bridges);

    // unit.type/hp/maxHp are reattached as getters by rehydrateGameState. What has
    // to be restored here is every field omitted for holding its default.
    out.units = MapUnits(lean, unit => ExpandUnit(unit));

    // A tail carried through from a pre-ledger file wins; otherwise rebuild.
    out.actionLog = Array.isArray(lean.actionLog) && lean.actionLog.length
        ? lean.actionLog
        : RebuildActionLog(lean.matchHistory, {
            units: out.units,
            forPlayer: opts.forPlayer !== undefined ? opts.forPlayer : lean.currentPlayer,
            fogOfWarEnabled: !!opts.fogOfWarEnabled,
        });

    return out;
}

// Coordinates always come back from the key, never from stored fields.
function ExpandEdge(key, edge) {
    const [a, b] = key.split('_');
    const [q1, r1] = a.split(',').map(Number);
    const [q2, r2] = b.split(',').map(Number);
    return {
        q1, r1, q2, r2,
        bridge: !!(edge && edge.bridge),
        bridgeHp: edge && edge.bridgeHp !== undefined ? edge.bridgeHp : null,
        isPathway: !edge || edge.isPathway !== false,
    };
}

// Regenerate the whole edge set from the tiles, exactly the way match-setup.js
// does when a match starts: every pair of adjacent tiles that both exist gets an
// edge. Deterministic and order-independent, because each edge's coordinates are
// read back out of its own key rather than from whichever tile reached it first.
//
// `bridges` is the sparse overlay of the only per-edge state a rebuild can't know.
function RebuildEdges(tileEntries, bridges) {
    const tileKeys = new Set(NormalizeEntries(tileEntries).map(([key]) => key));
    const overlay = bridges || {};
    const seen = new Set();
    const edges = [];

    NormalizeEntries(tileEntries).forEach(([, tile]) => {
        getNeighbors(tile.q, tile.r).forEach(n => {
            if (!tileKeys.has(getTileKey(n.q, n.r))) return;

            const key = getEdgeKey(tile.q, tile.r, n.q, n.r);
            if (seen.has(key)) return;
            seen.add(key);

            edges.push([key, ExpandEdge(key, {
                bridge: !!overlay[key],
                bridgeHp: overlay[key] ? overlay[key].bridgeHp : null,
            })]);
        });
    });

    return edges;
}

// TILE_TYPES is keyed by uppercase name and lives in config-data.js, which both
// sides load before this file. Fall back to Plains rather than failing a load.
function LookupTileType(typeId) {
    const key = String(typeId || 'PLAINS').toUpperCase();
    if (typeof TILE_TYPES !== 'undefined' && TILE_TYPES[key]) return TILE_TYPES[key];
    return { name: 'Plains', baseMoveCost: 1, canFortify: true };
}

function TileTypeName(tile) {
    if (!tile) return 'PLAINS';
    if (typeof tile.typeId === 'string') return tile.typeId;
    if (typeof tile.type === 'string') return tile.type;
    if (tile.type && tile.type.name) return tile.type.name;
    return 'PLAINS';
}

// --- rebuilding the action log ----------------------------------------------
//
// The action log is not saved. It is a rolling 25-entry UI window (ui.js trims it
// on every push), never match truth — matchHistory is the record, and the log is a
// rendering of it. So it gets rebuilt from the ledger at load instead of stored.
//
// WHAT THIS CANNOT REBUILD, and why. Some messages the live game prints have no
// ledger entry behind them, so a rebuilt log is slightly sparser than the original:
//
//   - supply line established / severed        never a ledger type
//   - siege status                             never a ledger type
//   - bridge destruction                       A2's known ledger gap
//   - flag returned to base                    A2's known ledger gap
//   - unit death as its own line               A2's known gap (inferable from ATTACK.isKill)
//
// That is cosmetic — the log is chrome — but closing those gaps is A6's ledger work
// and would make this reconstruction complete. Flagged rather than papered over.
const REBUILT_LOG_LIMIT = 25;

function RebuildActionLog(matchHistory, options) {
    const opts = options || {};
    const entries = Array.isArray(matchHistory) ? matchHistory : [];
    const nameOf = (id) => UnitDisplayName(id, opts.units);
    const log = [];
    let lastTurnKey = null;

    entries.forEach(entry => {
        if (!entry || !VisibleInRebuiltLog(entry, opts)) return;

        // Turn changes were their own log line; the ledger records turn+player on
        // every entry, so the boundary is where that pair changes.
        const turnKey = entry.turn + ':' + entry.player;
        if (turnKey !== lastTurnKey) {
            if (lastTurnKey !== null) {
                log.push({ message: "Player " + entry.player + "'s Turn Begins", player: entry.player });
            }
            lastTurnKey = turnKey;
        }

        DescribeLedgerEntry(entry, nameOf, opts).forEach(message => {
            log.push({ message, player: entry.player });
        });
    });

    return log.slice(-(opts.limit || REBUILT_LOG_LIMIT));
}

// Under fog, a player's log should show what that player could actually have seen:
// their own actions, and anything that happened to their own units. Vision at the
// time of each event is NOT recoverable — the board it was computed from is gone —
// so ownership is the honest approximation rather than a real replay of sight.
function VisibleInRebuiltLog(entry, opts) {
    if (!opts.fogOfWarEnabled) return true;
    if (opts.forPlayer === undefined || opts.forPlayer === null) return true;
    if (entry.player === opts.forPlayer) return true;

    return ReferencedUnitIds(entry).some(id =>
        UnitOwner(id, opts.units) === opts.forPlayer);
}

function ReferencedUnitIds(entry) {
    const ids = [];
    const payload = entry.payload || {};
    if (entry.actorId) ids.push(entry.actorId);
    if (payload.targetId) ids.push(payload.targetId);
    if (payload.unitState && payload.unitState.id) ids.push(payload.unitState.id);
    if (payload.targetState && payload.targetState.id) ids.push(payload.targetState.id);
    (payload.hits || []).forEach(h => { if (h && h.unitId) ids.push(h.unitId); });
    (payload.events || []).forEach(e => { if (e && e.unitId) ids.push(e.unitId); });
    return ids;
}

// Returns zero or more lines, because one ledger entry can describe several things
// happening at once (a fortify blast hits everyone adjacent).
function DescribeLedgerEntry(entry, nameOf, opts) {
    const p = entry.payload || {};
    const actor = nameOf(entry.actorId);

    switch (entry.type) {
        case 'MOVE':
            return [actor + ' moved.' + (p.unitState ? ' MP: ' + p.unitState.mp : '')];

        case 'ATTACK':
            return [DescribeAttack(entry, nameOf, opts)];

        case 'FORTIFY':
            return [actor + ' fortified on tile ' + p.tile + '...'];

        case 'UNFORTIFY':
            return [actor + ' unfortified.'];

        case 'BUILD_BRIDGE':
            return [actor + ' built bridge on ' + p.targetEdge + '...'];

        case 'CLASS_SWAP':
            return ['P' + entry.player + ' ' + p.fromType + ' became a ' + p.toType + '.'];

        case 'UNIT_UPGRADE':
            return [actor + ' upgraded ' + p.stat + '.'];

        case 'UNIT_SPAWN':
            return ['P' + entry.player + ' deployed a ' + p.typeName + '.'];

        case 'FLAG_TAKEN':
            return ["P" + p.victimPlayer + "'s flag is stolen! All healing is disabled."];

        case 'VICTORY':
            return [p.victoryText || 'The match is over.'];

        case 'MOVEMENT_ZOC_HIT':
            return ['P' + entry.player + ' ' + actor + ' takes ZoC.'];

        case 'FORTIFY_ZOC_BLAST':
            return (p.hits || []).map(h =>
                'P' + UnitOwner(h.unitId, opts.units) + ' ' + nameOf(h.unitId) +
                ' takes ZoC' + (h.damage !== undefined ? ' for ' + h.damage : '') + '.');

        case 'TURN_START_ZOC':
            return DescribeEventList(p.events, nameOf, opts, 'takes start-of-turn ZoC');

        case 'TURN_START_MOUNTAIN_ATTRITION':
            return DescribeEventList(p.events, nameOf, opts, 'takes mountain attrition');

        case 'TURN_START_HEAL':
            return DescribeEventList(p.events, nameOf, opts, 'healed');

        // A3's session entries. Worth showing: a disconnect is exactly the kind of
        // thing a player scrolling back would want explained.
        case 'PLAYER_DISCONNECTED':
            return ['Player ' + entry.player + ' disconnected.'];
        case 'PLAYER_RECONNECTED':
            return ['Player ' + entry.player + ' reconnected.'];
        case 'DISCONNECT_TIMEOUT':
            return ['Player ' + entry.player + ' did not return.'];
        case 'DISCONNECT_RESOLVED':
            return ['Match resolved: ' + p.choice + '.'];

        default:
            // A ledger type this build doesn't know how to phrase. Silence is right:
            // an unexplained line in the log is worse than a missing one.
            return [];
    }
}

function DescribeAttack(entry, nameOf, opts) {
    const p = entry.payload || {};
    const mods = p.modifiers || [];

    let line = '';
    if (mods.includes('ADVANTAGE')) line += 'Advantage!<br>';
    else if (mods.includes('DISADVANTAGE')) line += 'Disadvantage!<br>';

    if (p.targetType === 'BRIDGE') {
        return line + 'P' + entry.player + ' ' + nameOf(entry.actorId) +
               ' hits a bridge for ' + p.damageDealt + '.';
    }

    const targetOwner = UnitOwner(p.targetId, opts.units);
    const targetHp = p.targetState ? p.targetState.hp : undefined;
    const maxHp = UnitMaxHp(p.targetId, opts.units);

    line += 'P' + entry.player + ' ' + nameOf(entry.actorId) +
            ' hits P' + targetOwner + ' ' + nameOf(p.targetId) +
            ' for ' + p.damageDealt + '.';
    if (targetHp !== undefined) {
        line += '<br>HP: ' + targetHp + (maxHp !== undefined ? '/' + maxHp : '');
    }
    if (p.isKill) line += '<br>Destroyed!';
    return line;
}

function DescribeEventList(events, nameOf, opts, verb) {
    return (events || []).map(e => {
        if (!e || !e.unitId) return null;
        const hp = e.hp !== undefined ? e.hp : (e.newHp !== undefined ? e.newHp : undefined);
        return 'P' + UnitOwner(e.unitId, opts.units) + ' ' + nameOf(e.unitId) + ' ' + verb +
               (hp !== undefined ? '. HP: ' + hp : '.');
    }).filter(Boolean);
}

// Unit ids encode their own owner and type in every era's format
// ("u_p1_MELEE_t1_1", "unit_1_melee_1788353096603_bb04"), which matters because a
// unit referenced by an old ledger entry may be dead and absent from `units`.
function UnitOwner(unitId, units) {
    const found = (units || []).find(u => u.id === unitId);
    if (found) return found.player;

    const match = String(unitId || '').match(/^u_p(\d)_|^unit_(\d)_/);
    return match ? Number(match[1] || match[2]) : null;
}

function UnitDisplayName(unitId, units) {
    const found = (units || []).find(u => u.id === unitId);
    const typeId = found ? found.typeId : ParseTypeFromUnitId(unitId);
    if (!typeId) return 'Unit';

    const template = (typeof UNIT_TYPES !== 'undefined' && UNIT_TYPES[typeId]) || null;
    if (template) return template.name;
    return typeId.charAt(0) + typeId.slice(1).toLowerCase();
}

function UnitMaxHp(unitId, units) {
    const found = (units || []).find(u => u.id === unitId);
    if (found && found.stats) return found.stats.maxHp;
    const typeId = ParseTypeFromUnitId(unitId);
    const template = (typeof UNIT_TYPES !== 'undefined' && UNIT_TYPES[typeId]) || null;
    return template ? template.hp : undefined;
}

function ParseTypeFromUnitId(unitId) {
    const match = String(unitId || '').match(/^u_p\d_([A-Z]+)_|^unit_\d_([a-z]+)_/);
    if (!match) return null;
    return String(match[1] || match[2]).toUpperCase();
}

// --- integrity audit --------------------------------------------------------
//
// Distinct from migration, and distinct from "no backporting". This catches data
// that is structurally valid but factually WRONG because a historical bug wrote
// it that way - not old gameplay decisions, which are none of our business.
//
// Runs after every migration step (see MigrateSave). The known bugs are not
// scoped to a single beta, so auditing once at the end could miss one that a
// later step reshapes into something that looks fine.
function AuditForKnownBugs(data, report) {
    const out = { ...data };
    out.tiles = AuditBaseCampTerrain(out, report);
    return out.tiles === data.tiles ? data : out;
}

// Base camps could historically be written onto non-Plains terrain. Deliberately
// not special-cased to the base-camp flag alone: the camp is identified from
// whichever source the file actually has (the explicit flag, baseCampPositions, or
// the flags' home positions), so a file from any era gets the same check.
function AuditBaseCampTerrain(data, report) {
    const entries = NormalizeEntries(data.tiles);
    if (entries.length === 0) return data.tiles;

    const baseCampTiles = CollectBaseCampTiles(data);
    if (baseCampTiles.size === 0) return data.tiles;

    return entries.map(([key, tile]) => {
        if (!baseCampTiles.has(key)) return [key, tile];

        const name = String(TileTypeName(tile)).toUpperCase();
        if (name === 'PLAINS') return [key, tile];

        report.corrections.push('base camp tile ' + key + ' had terrain ' + name + ' - corrected to PLAINS');
        Warn(report, 'base camp tile ' + key + ' was ' + name + ', not Plains - corrected');

        const fixed = { ...tile };
        if (fixed.typeId !== undefined) fixed.typeId = 'PLAINS';
        fixed.type = LookupTileType('PLAINS');
        return [key, fixed];
    });
}

// A base camp is an EDGE ("-2,-1_-1,-2"); the two tiles it separates are the camp
// tiles. Read from whichever of the three sources this file's era provides.
function CollectBaseCampTiles(data) {
    const tiles = new Set();

    const addFromEdgeKey = (edgeKey) => {
        if (typeof edgeKey !== 'string' || !edgeKey.includes('_')) return;
        edgeKey.split('_').forEach(part => tiles.add(part));
    };

    if (data.baseCampPositions) {
        addFromEdgeKey(data.baseCampPositions.player1);
        addFromEdgeKey(data.baseCampPositions.player2);
    }
    if (data.flags) {
        Object.values(data.flags).forEach(flag => {
            if (flag) addFromEdgeKey(flag.homePosition);
        });
    }
    NormalizeEntries(data.tiles).forEach(([key, tile]) => {
        if (tile && tile.isBaseCampTile) tiles.add(key);
    });

    return tiles;
}

// --- content-based routing --------------------------------------------------
//
// What a file opens into is decided by what survived migration, never by whether
// it was named .fh or .fhmap. A map file legitimately lacks the sections a match
// needs; that is not an error, it is the whole difference between the two.
function DescribeContent(data) {
    const units = Array.isArray(data.units) ? data.units : [];
    const hasBoard = NormalizeEntries(data.tiles).length > 0;
    const hasHistory = Array.isArray(data.matchHistory) && data.matchHistory.length > 0;

    // What a map file (createMapDataObject, js/client/save.js) actually omits:
    // flags, supplyPoints, currentPlayer — everything describing a match in progress
    // rather than a board.
    //
    // Deliberately NOT keyed on edges: the lean schema regenerates those from the
    // tiles, so their absence says nothing about what kind of file this is. And NOT
    // on turn number either — a match saved on turn 1 is still a match.
    const hasMatchState = data.currentPlayer !== undefined && !!data.flags;

    return {
        hasBoard,
        hasUnits: units.length > 0,
        hasHistory,
        opensAs: hasBoard && hasMatchState ? 'match' : 'map',
    };
}

// --- shared helpers ---------------------------------------------------------

function MapUnits(data, transform) {
    if (!Array.isArray(data.units)) return [];
    return data.units.map(transform);
}

function PickFields(source, fields) {
    const out = {};
    fields.forEach(field => {
        if (source[field] !== undefined) out[field] = source[field];
    });
    return out;
}

// Old files without a radius: take the furthest tile from the origin.
function InferGridRadius(data, report) {
    let maxDist = 0;
    NormalizeEntries(data.tiles).forEach(([key]) => {
        const [q, r] = key.split(',').map(Number);
        if (!Number.isFinite(q) || !Number.isFinite(r)) return;
        maxDist = Math.max(maxDist, Math.abs(q), Math.abs(r), Math.abs(-q - r));
    });
    if (maxDist === 0) {
        Warn(report, 'could not infer grid radius from tiles; defaulting to 3');
        return 3;
    }
    return maxDist;
}
