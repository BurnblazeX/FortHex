        // --- Game Configuration & Constants ---
        // Shared between client and server: both sides need the identical values here.
        // See FortHex_A1_Server_Core_Guide.md §4.0.
        const BUILD_VERSION = "InDev B30";
        const HEX_SIZE = 70;
        const CANVAS_WIDTH_NORMAL = (2 * 3 + 1.5) * (HEX_SIZE * Math.sqrt(3));
        const CANVAS_HEIGHT_NORMAL = (2 * 3 + 1) * (HEX_SIZE * 2 * 0.75) + HEX_SIZE;

        // Gameplay Constants
        const RESPAWN_TURN_TIMER = 10;
        const MAX_BASE_CAMP_TURNS = 5;
        const MAP_SIZE_UNIT_LIMITS = {
            2: 2, // Compact (Arcade)
            3: 4, // Normal
            4: 6  // Expansive
        };
        const UNIT_CAPS = {
            Swordsman: 2,
            Archer: 2,
            Pikeman: 2,
            Horseman: 2,
        };
        const FORTIFICATION_DAMAGE = 1;

        // What crossing a hexPath next to an ENEMY fortification adds to its MP cost.
        //
        // Raised 1 -> 2 (Burn, 2026-09-09). At +1 against C1's rescaled pools it had
        // quietly stopped mattering: a Horseman with 6 MP crossing plains at 1 paid 2
        // instead of 1 and still had four moves left, so a fortification slowed nobody
        // and only the ZoC damage was doing any work.
        //
        // Note this interacts with MAX_MOVEMENT_COST below. The penalty is added before
        // the clamp, so on the hardest terrain it is still partly or wholly absorbed -
        // mountain-to-mountain is 5 already and 5+2 clamps back to 5. That is the same
        // shape the +1 had; it bites hardest on the cheap ground where a unit would
        // otherwise stroll past.
        //
        // ENEMY fortifications only, and always has been. A friendly fortification has
        // never charged its own side anything - see getEdgeCost, which compares against
        // enemyPlayer.
        const FORTIFICATION_MOVE_PENALTY = 2;
        const BRIDGE_MAX_HP = 5;
        const PROJECTILE_SPEED_PIXELS_PER_MS = 0.8;
        const UNIT_ON_EDGE_OFFSET = HEX_SIZE * 0.3;
        const ATTACK_COST = 1;
        const FORTIFY_UNFORTIFY_COST = 1;
        const BUILD_BRIDGE_COST = 1;
        // The ceiling on a single hexPath's cost, fortification penalty included.
        //
        // Rescaled 3 -> 5 by the same rule as the unit pools, (x * 2) - 1, so the
        // clamp keeps the shape it always had rather than becoming a new balance
        // decision smuggled in alongside one. What that shape IS: the +1 penalty
        // for crossing next to an enemy fortification gets absorbed on the very
        // hardest terrain and bites everywhere else. Today mountain costs 3 and
        // 3+1 clamps back to 3; now mountain-to-mountain costs 5 and 5+1 clamps
        // back to 5. Same behaviour, rescaled.
        //
        // Leaving this at 3 would have silently discarded the entire rebalance
        // above forest - every cost of 3, 4 or 5 would have come out as 3.
        const MAX_MOVEMENT_COST = 5;

        // === SUPPLY: REACH AND RATIONS ==========================================
        //
        // Two separate things, and they used to be one. Until C2 a player had a single
        // pool of "supply points" that every line permanently reserved a slice of, so
        // one long line starved the rest and the number on screen answered neither
        // question a player actually has: how far can I stretch, and how long can I
        // keep healing. It is split in two.

        // REACH - the SHARED line budget, and the mechanic the old "supply points"
        // number was measuring all along. Every line reserves part of it for as long as
        // the line exists, so what is left is how much more line the player can afford;
        // it falls as you fortify and rises as forts are released.
        //
        // Measured in the SAME edge cost movement is measured in, so it moves whenever
        // the cost table moves. Rescaled 10 -> 15 with C1, because supply cost is summed
        // from getEdgeCost and C1's heavier terrain made every line more expensive while
        // a limit left at 10 quietly shortened every network on the board.
        //
        // IT IS A BUDGET, NOT A PER-LINE CEILING (Burn, 2026-09-09). C2 briefly made it
        // the latter, on the reasoning that a shared pool makes forts compete for a
        // resource at a distance. They do, and that is the mechanic: extending your
        // network is meant to cost you something everywhere else, or there is no
        // decision in where you fortify. Only C2's consumable half was wanted, and that
        // is what STARTING_RATIONS below is.
        //
        // A single global number, not a per-board one: reach is about how far a network
        // stretches from base, a property of the mechanic, not of how much board there
        // is to cross - unlike the movement pools, which are per-board precisely because
        // they ARE measured against board width.
        const MAX_SUPPLY_REACH = 15;

        // RATIONS - the consumable. Spent on HEALING, never on geometry.
        //
        // 10 is the old pool's starting value, kept deliberately: it was chosen as a
        // number of points and is now a number of heals, and re-picking it in the same
        // change that redefines it would leave nothing to compare against.
        const STARTING_RATIONS = 10;

        // One ration per unit healed, per turn. Two units healing the same turn is 2.
        const RATION_COST_PER_HEAL = 1;

        // Refilled only by RESTING - a turn in which the player spent nothing at all.
        // Spending and regenerating are mutually exclusive rather than concurrent, so a
        // player who heals every turn never recovers.
        const RATION_REGEN_PER_REST_TURN = 1;
        const SHIELD_COLOR = '#30C4C4';

        // Visual/Interaction Constants
        const UNIT_DRAW_SIZE_ON_EDGE = HEX_SIZE * 0.25;
        const FORTIFIED_UNIT_DRAW_SIZE = UNIT_DRAW_SIZE_ON_EDGE * 1.25;
        const HIGHLIGHT_CLICK_RADIUS = HEX_SIZE * 0.35;
        const UNIT_CLICK_RADIUS = HEX_SIZE * 0.3;
        const BRIDGE_CLICK_TOLERANCE = HEX_SIZE * 0.15;
        const DRAG_SCALE_FACTOR = 1.2;
        const DRAGGED_DISTANCE_THRESHOLD = 5;

        // A press SELECTS. A press held this long PICKS UP.
        //
        // Dragging used to begin the instant a finger or button went down on a unit,
        // which made "look at this unit" and "move this unit" the same gesture told
        // apart only by what happened next - and on touch it meant the board could not
        // be panned with a finger that started on a unit.
        //
        // 1.5s is Burn's number and it is deliberately slow: the movement animation
        // that is coming needs picking a unit up to be an unambiguous act, not
        // something a scroll can trigger by accident.
        const UNIT_DRAG_HOLD_MS = 500;

        // How far the pointer may wander during those 1.5s before the hold is abandoned.
        // Larger than DRAGGED_DISTANCE_THRESHOLD on purpose: that one asks "did this
        // turn out to be a drag rather than a click" after the fact, while this one has
        // to tolerate the ordinary unsteadiness of a finger held still on glass.
        const UNIT_DRAG_HOLD_SLOP = 12;
        const PULSE_DURATION_MS = 2000;
        const DOUBLE_TAP_THRESHOLD_MS = 200; // Time in ms for a double tap
        const DOUBLE_TAP_MAX_DISTANCE = 30;  // Max distance in pixels between taps
        const COLOR_TRANSITION_DURATION_MS = 400;
        const PATH_DRAW_ANIMATION_DURATION_MS = 750;
        const PATH_DRAW_PAUSE_DURATION_MS = 500;
        const PATH_DRAW_HOVER_DELAY_MS = 750;

        // Arcade Mode Constants
        const ARCADE_TURN_TIME_SEC = 30;
        const ARCADE_MAX_TURNS = 10;
        const ARCADE_UNIT_CAP = 2;

        // Map Generation Constants (Updated for Radius 3)
        const MAX_MOUNTAIN_TILES_TOTAL = 8;
        const MAX_WATER_TILES_TOTAL = 12;
        const MAX_FOREST_TILES_TOTAL = 12;
        const MAX_PLAINS_TILES_TOTAL = 18;

        const MAX_MOUNTAIN_TILES_PER_CLUSTER = 3; // Kept the same for cluster density

        const MOUNTAIN_SPAWN_CHANCE = 0.35;
        const WATER_SPAWN_CHANCE = 0.25;
        const FOREST_SPAWN_CHANCE = 0.5;

        const MIN_WATER_TILES_SOFT = 4;
        const MIN_FOREST_TILES_SOFT = 6;
        const MIN_PLAINS_TILES_SOFT = 12;
        const MIN_CENTRAL_PLAINS_SOFT = 3;

        // Action State Constants
        const ACTION_STATES = {
            IDLE: 'idle',
            UNIT_SELECTED: 'unit_selected',
            SELECTING_FORTIFY_TILE: 'selecting_fortify_tile',
            SELECTING_UNFORTIFY_EDGE: 'selecting_unfortify_edge',
            SELECTING_BRIDGE_EDGE: 'selecting_bridge_edge',
            SELECTING_ATTACK_TARGET: 'selecting_attack_target',
        };

        // Tile Definitions
        // Visibility: 3=High (All), 2=Medium (Blocked Opposite), 1=Low (Swordsman/Adjacent Only), 0=None
        // moveWeight is Track C's replacement for the hardcoded terrain cascade in
        // getEdgeCost. One number per terrain - "what it costs to leave or enter
        // this tile" - and the edge cost is a function of the pair. See
        // EDGE_COST_MODEL below for why that is a table's worth of information in
        // a single field, and what adding a new terrain now costs.
        //
        // baseMoveCost is kept because Testament's era-7 fallback still writes it
        // onto reconstructed tiles. Nothing reads it for movement any more.
        const TILE_TYPES = {
            PLAINS:   { name: 'Plains',   color: '#90EE90', baseMoveCost: 1, moveWeight: 1, canFortify: true, visibility: 3 },
            FOREST:   { name: 'Forest',   color: '#228B22', baseMoveCost: 2, moveWeight: 3, canFortify: true, visibility: 1 },
            WATER:    { name: 'Water',    color: '#87CEEB', baseMoveCost: Infinity, moveWeight: 5, crossable: false, canFortify: false, visibility: 3 },
            MOUNTAIN: { name: 'Mountain', color: '#808080', baseMoveCost: 3, moveWeight: 5, canFortify: false, blocksLOS: true, visibility: 0 }
        };

        // How the two tiles an edge borders combine into a movement cost.
        //
        // C1, LANDED. The cost of crossing a hexPath is the MEAN of the two
        // hexCenters it sits between - literally what it costs to leave one tile
        // plus what it costs to enter the other. With weights 1/3/5/5 that gives
        // the whole of the roadmap's cost matrix:
        //
        //     P+P=1  P+F=2  P+M=3  F+F=3  F+M=4  M+M=5  W+P=3  W+F=4  W+M=5
        //
        // Every weight is odd, so any pair sums even and halves to an integer.
        // Water/water stays impassable without a bridge and is handled before
        // this is ever called.
        //
        // BEFORE C1 this was Math.max with weights 1/2/3/3, which charged the
        // harder of the two terrains and could not tell a plains-to-mountain
        // crossing from a mountain-to-mountain one. Both cost 3; they now cost 3
        // and 5.
        //
        // Adding a terrain costs ONE number here, not a new row and column.
        const EDGE_COST_MODEL = {
            combine: (a, b) => (a + b) / 2,
        };

        // A bridge replaces the terrain underneath it for movement purposes, so it
        // is a flat cost rather than a weight. Was an unnamed literal 1 inside
        // getEdgeCost.
        const BRIDGE_MOVE_COST = 1;

        // Unit Definitions (Templates)
        // MOVEMENT POOLS, rescaled by C1 as (previous * 2) - 1: Horseman 5->9,
        // Swordsman 4->7, Archer and Pikeman 3->5.
        //
        // The odd-number rescale is the point. Doubling alone would leave every
        // pool and every cost divisible by the same factor, so nothing would move
        // relative to anything else and the finer terrain costs would buy nothing.
        const UNIT_TYPES = {
            SWORDSMAN:    { typeName: 'SWORDSMAN',    name: 'Swordsman',    hp: 12, speed: 7, damage: 3, defense: 1, symbol: 'M', canBuildBridge: true,  attackType: 'melee', canMoveAfterAttack: false, strengths: ['Archer'],   weaknesses: ['Horseman'] },
            ARCHER:   { typeName: 'ARCHER',   name: 'Archer',   hp: 10, speed: 5, damage: 2, defense: 1, symbol: 'A', canBuildBridge: false, attackType: 'ranged', canMoveAfterAttack: false, strengths: ['Pikeman'],  weaknesses: ['Swordsman'] },
            PIKEMAN:  { typeName: 'PIKEMAN',  name: 'Pikeman',  hp: 13, speed: 5, damage: 3, defense: 2, symbol: 'P', canBuildBridge: false, attackType: 'melee', canMoveAfterAttack: false, strengths: ['Horseman'], weaknesses: ['Archer'] },
            HORSEMAN: { typeName: 'HORSEMAN', name: 'Horseman', hp: 11, speed: 9, damage: 3, defense: 0, symbol: 'H', canBuildBridge: false, attackType: 'melee', canMoveAfterAttack: true,  strengths: ['Swordsman'],    weaknesses: ['Pikeman'] }
        };

        // MOVEMENT POOLS ARE A MATCH SETTING, chosen once when the match is made and
        // fixed for its whole length - the same shape as fogOfWarEnabled, and for the
        // same reason: it is a property of the match, not of a device.
        //
        // A pool is only meaningful next to the distance it has to cover, and the three
        // board sizes differ by a factor of two in width, so no single set of numbers
        // is right for all of them: a horseman with 9 MP on the Compact board crosses
        // it and comes back. FASTER is therefore RECOMMENDED FOR EXPANSIVE and little
        // else - but recommended, not enforced. Players are allowed a sprinting game on
        // a small board if that is the game they want.
        //
        // Absolute values, not adjustments off UNIT_TYPES. An adjustment table reads as
        // "the real numbers are somewhere else, minus something", and every reader then
        // has to do arithmetic to answer "what does a pikeman actually get". These are
        // the numbers.
        const UNIT_SPEED_PRESETS = {
            normal: { label: 'Normal', HORSEMAN: 6, SWORDSMAN: 5, ARCHER: 4, PIKEMAN: 4 },
            faster: { label: 'Faster', HORSEMAN: 9, SWORDSMAN: 7, ARCHER: 5, PIKEMAN: 5 },
        };

        const DEFAULT_UNIT_SPEED_PRESET = 'normal';

        // What the board suggests when nobody has chosen. A RECOMMENDATION the UI shows
        // and the engine falls back to - never a rule that overrides an explicit pick,
        // which is why the setting defaults to null ("auto") rather than to a preset
        // name: an online match assigns the host's choice before the board is built,
        // and a default written at board-build time would silently overwrite it.
        function RecommendedUnitSpeedPreset(gridRadius) {
            return gridRadius >= 4 ? 'faster' : 'normal';
        }

        // The speed a freshly built unit of this type gets under this preset.
        //
        // Read at unit CREATION and written into unit.stats.speed, so everything
        // downstream - the turn reset, the stat card, speed upgrades, the paired health
        // penalty - reads one already-correct number and needs to know nothing about
        // presets. It also means a saved match carries its own pools and does not
        // silently rebalance itself when this table changes.
        //
        // Floored at 1: a pool of 0 is a unit that can never move again, and no table
        // edit should be able to produce one by accident.
        function SpeedForPreset(typeKey, presetName) {
            const preset = UNIT_SPEED_PRESETS[presetName] || UNIT_SPEED_PRESETS[DEFAULT_UNIT_SPEED_PRESET];
            const value = preset[typeKey];
            if (Number.isFinite(value)) return Math.max(1, value);

            // A unit type the preset table has never heard of - a new class added to
            // UNIT_TYPES and not here. Its own template speed is a better answer than
            // zero, and tools/move-rules-smoke.js fails on the omission separately.
            const template = UNIT_TYPES[typeKey];
            if (!template) return 0;
            return Math.max(1, template.speed !== undefined ? template.speed : (template.baseMove || 0));
        }

        // --- VETERAN SYSTEM CONSTANTS ---
        const UPGRADE_CONSTANTS = {
        MAX_LEVEL: 3,
            // Defines which stat is penalized when the key stat is boosted heavily
            PAIRS: {
                health: 'speed',
                speed: 'health',
                damage: 'defense',
                defense: 'damage'
            },
            // Defines how much a stat increases per point
            BOOST_VALUES: {
                health: 2, // +2 HP per point
                // Kept at +1 (2026-09-08). C1 briefly made it +2 to hold its worth
                // against pools that had roughly doubled, but the pools came back down
                // when Normal became a preset, and +2 on a 4 MP archer is a 50% jump
                // from a single upgrade point. The health/speed PAIRS penalty reads this
                // same table, so the paired cost follows automatically.
                speed: 1,  // +1 Move per point
                damage: 1, // +1 Dmg per point
                defense: 1 // +1 Def per point
            }
        };

        // Hex Grid Directions (Axial Coordinates)
        const AXIAL_DIRECTIONS = [ { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 } ];
        const MAP_DIRECTION_TO_EDGE_INDEX = [0, 5, 4, 3, 2, 1];

        const PRESET_MAP_1 = {
            name: "River Fork",
            radius: 3,
            tiles: new Map([
                ['-3,0', TILE_TYPES.FOREST], ['-3,1', TILE_TYPES.FOREST], ['-3,2', TILE_TYPES.MOUNTAIN], ['-3,3', TILE_TYPES.WATER],
                ['-2,-1', TILE_TYPES.PLAINS], ['-2,0', TILE_TYPES.PLAINS], ['-2,1', TILE_TYPES.FOREST], ['-2,2', TILE_TYPES.WATER], ['-2,3', TILE_TYPES.MOUNTAIN],
                ['-1,-2', TILE_TYPES.PLAINS], ['-1,-1', TILE_TYPES.PLAINS], ['-1,0', TILE_TYPES.FOREST], ['-1,1', TILE_TYPES.PLAINS], ['-1,2', TILE_TYPES.WATER], ['-1,3', TILE_TYPES.FOREST],
                ['0,-3', TILE_TYPES.FOREST], ['0,-2', TILE_TYPES.PLAINS], ['0,-1', TILE_TYPES.WATER], ['0,0', TILE_TYPES.WATER], ['0,1', TILE_TYPES.WATER], ['0,2', TILE_TYPES.PLAINS], ['0,3', TILE_TYPES.FOREST],
                ['1,-3', TILE_TYPES.FOREST], ['1,-2', TILE_TYPES.WATER], ['1,-1', TILE_TYPES.PLAINS], ['1,0', TILE_TYPES.FOREST], ['1,1', TILE_TYPES.PLAINS], ['1,2', TILE_TYPES.PLAINS],
                ['2,-3', TILE_TYPES.MOUNTAIN], ['2,-2', TILE_TYPES.WATER], ['2,-1', TILE_TYPES.FOREST], ['2,0', TILE_TYPES.PLAINS], ['2,1', TILE_TYPES.PLAINS],
                ['3,-3', TILE_TYPES.WATER], ['3,-2', TILE_TYPES.MOUNTAIN], ['3,-1', TILE_TYPES.FOREST], ['3,0', TILE_TYPES.FOREST]
            ]),
            units: [
                { player: 1, typeName: 'SWORDSMAN', position: '1,1_2,0' }, { player: 1, typeName: 'ARCHER', position: '0,2_1,1' },
                { player: 1, typeName: 'HORSEMAN', position: '0,2_0,3' }, { player: 1, typeName: 'PIKEMAN', position: '2,0_3,0' },
                { player: 2, typeName: 'ARCHER', position: '-1,-1_0,-2' }, { player: 2, typeName: 'SWORDSMAN', position: '-2,0_-1,-1' },
                { player: 2, typeName: 'HORSEMAN', position: '0,-3_0,-2' }, { player: 2, typeName: 'PIKEMAN', position: '-3,0_-2,0' }
            ],
            baseCampPositions: { player1: '1,2_2,1', player2: '-2,-1_-1,-2' }
        };

        const PRESET_MAP_2 = {
            name: "Alpha Grounds",
            radius: 2,
            tiles: new Map([
                ['-2,0', TILE_TYPES.WATER], ['-2,1', TILE_TYPES.FOREST], ['-2,2', TILE_TYPES.MOUNTAIN],
                ['-1,-1', TILE_TYPES.WATER], ['-1,0', TILE_TYPES.PLAINS], ['-1,1', TILE_TYPES.FOREST], ['-1,2', TILE_TYPES.WATER],
                ['0,-2', TILE_TYPES.WATER], ['0,-1', TILE_TYPES.PLAINS], ['0,0', TILE_TYPES.PLAINS], ['0,1', TILE_TYPES.PLAINS], ['0,2', TILE_TYPES.FOREST],
                ['1,-2', TILE_TYPES.FOREST], ['1,-1', TILE_TYPES.FOREST], ['1,0', TILE_TYPES.PLAINS], ['1,1', TILE_TYPES.FOREST],
                ['2,-2', TILE_TYPES.MOUNTAIN], ['2,-1', TILE_TYPES.WATER], ['2,0', TILE_TYPES.FOREST]
            ]),
            units: [
                { player: 1, typeName: 'SWORDSMAN', position: '0,-1_1,-1' }, { player: 1, typeName: 'ARCHER', position: '-1,0_0,-1' },
                { player: 2, typeName: 'SWORDSMAN', position: '-1,1_0,1' }, { player: 2, typeName: 'ARCHER', position: '0,1_1,0' }
            ],
            baseCampPositions: { player1: null, player2: null }
        };

        const PRESET_MAP_3 = {
            name: "Volcano Island",
            radius: 4,
            tiles: new Map([
                ['-4,0', TILE_TYPES.PLAINS], ['-4,1', TILE_TYPES.PLAINS],
                ['-4,2', TILE_TYPES.WATER], ['-4,3', TILE_TYPES.WATER], ['-4,4', TILE_TYPES.WATER],
                ['-3,-1', TILE_TYPES.PLAINS], ['-3,0', TILE_TYPES.PLAINS],
                ['-3,1', TILE_TYPES.FOREST], ['-3,2', TILE_TYPES.PLAINS], ['-3,3', TILE_TYPES.FOREST], ['-3,4', TILE_TYPES.WATER],
                ['-2,-2', TILE_TYPES.WATER], ['-2,-1', TILE_TYPES.FOREST], ['-2,0', TILE_TYPES.PLAINS],
                ['-2,1', TILE_TYPES.FOREST], ['-2,2', TILE_TYPES.FOREST], ['-2,3', TILE_TYPES.PLAINS], ['-2,4', TILE_TYPES.WATER],
                ['-1,-3', TILE_TYPES.WATER], ['-1,-2', TILE_TYPES.PLAINS], ['-1,-1', TILE_TYPES.FOREST],
                ['-1,0', TILE_TYPES.PLAINS], ['-1,1', TILE_TYPES.PLAINS], ['-1,2', TILE_TYPES.FOREST],
                ['-1,3', TILE_TYPES.PLAINS], ['-1,4', TILE_TYPES.WATER],
                ['0,-4', TILE_TYPES.WATER], ['0,-3', TILE_TYPES.FOREST], ['0,-2', TILE_TYPES.FOREST],
                ['0,-1', TILE_TYPES.PLAINS], ['0,0', TILE_TYPES.MOUNTAIN], ['0,1', TILE_TYPES.PLAINS],
                ['0,2', TILE_TYPES.FOREST], ['0,3', TILE_TYPES.FOREST], ['0,4', TILE_TYPES.WATER],
                ['1,-4', TILE_TYPES.WATER], ['1,-3', TILE_TYPES.PLAINS], ['1,-2', TILE_TYPES.FOREST],
                ['1,-1', TILE_TYPES.PLAINS], ['1,0', TILE_TYPES.PLAINS], ['1,1', TILE_TYPES.FOREST],
                ['1,2', TILE_TYPES.PLAINS], ['1,3', TILE_TYPES.WATER],
                ['2,-4', TILE_TYPES.WATER], ['2,-3', TILE_TYPES.PLAINS], ['2,-2', TILE_TYPES.FOREST],
                ['2,-1', TILE_TYPES.FOREST], ['2,0', TILE_TYPES.PLAINS], ['2,1', TILE_TYPES.FOREST], ['2,2', TILE_TYPES.WATER],
                ['3,-4', TILE_TYPES.WATER], ['3,-3', TILE_TYPES.FOREST], ['3,-2', TILE_TYPES.PLAINS],
                ['3,-1', TILE_TYPES.FOREST], ['3,0', TILE_TYPES.PLAINS], ['3,1', TILE_TYPES.PLAINS],
                ['4,-4', TILE_TYPES.WATER], ['4,-3', TILE_TYPES.WATER], ['4,-2', TILE_TYPES.WATER],
                ['4,-1', TILE_TYPES.PLAINS], ['4,0', TILE_TYPES.PLAINS]
            ]),
            units: [
                { player: 1, typeName: 'HORSEMAN', position: '2,0_3,0' },
                { player: 1, typeName: 'PIKEMAN', position: '3,0_4,0' },
                { player: 1, typeName: 'SWORDSMAN', position: '3,-1_3,0' },
                { player: 1, typeName: 'SWORDSMAN', position: '2,1_3,0' },
                { player: 1, typeName: 'ARCHER', position: '3,0_4,-1' },
                { player: 1, typeName: 'ARCHER', position: '3,0_3,1' },
                { player: 2, typeName: 'PIKEMAN', position: '-4,0_-3,0' },
                { player: 2, typeName: 'HORSEMAN', position: '-3,0_-2,0' },
                { player: 2, typeName: 'ARCHER', position: '-3,-1_-3,0' },
                { player: 2, typeName: 'ARCHER', position: '-4,1_-3,0' },
                { player: 2, typeName: 'SWORDSMAN', position: '-3,0_-2,-1' },
                { player: 2, typeName: 'SWORDSMAN', position: '-3,0_-3,1' }
            ],
            baseCampPositions: {
                player1: ['4,-1', '4,0', '3,1'],
                player2: ['-3,-1', '-4,0', '-4,1']
            }
        };

        const DEFAULT_MAP_LAYOUT_RADIUS_3 = new Map([
            // q=-3
            ['-3,0', TILE_TYPES.WATER], ['-3,1', TILE_TYPES.WATER], ['-3,2', TILE_TYPES.MOUNTAIN], ['-3,3', TILE_TYPES.MOUNTAIN],
            // q=-2
            ['-2,-1', TILE_TYPES.PLAINS], ['-2,0', TILE_TYPES.PLAINS], ['-2,1', TILE_TYPES.FOREST], ['-2,2', TILE_TYPES.FOREST], ['-2,3', TILE_TYPES.MOUNTAIN],
            // q=-1
            ['-1,-2', TILE_TYPES.PLAINS], ['-1,-1', TILE_TYPES.PLAINS], ['-1,0', TILE_TYPES.PLAINS], ['-1,1', TILE_TYPES.PLAINS], ['-1,2', TILE_TYPES.FOREST], ['-1,3', TILE_TYPES.WATER],
            // q=0
            ['0,-3', TILE_TYPES.WATER], ['0,-2', TILE_TYPES.PLAINS], ['0,-1', TILE_TYPES.PLAINS], ['0,0', TILE_TYPES.FOREST], ['0,1', TILE_TYPES.PLAINS], ['0,2', TILE_TYPES.PLAINS], ['0,3', TILE_TYPES.WATER],
            // q=1
            ['1,-3', TILE_TYPES.WATER], ['1,-2', TILE_TYPES.FOREST], ['1,-1', TILE_TYPES.PLAINS], ['1,0', TILE_TYPES.PLAINS], ['1,1', TILE_TYPES.PLAINS], ['1,2', TILE_TYPES.PLAINS],
            // q=2
            ['2,-3', TILE_TYPES.MOUNTAIN], ['2,-2', TILE_TYPES.FOREST], ['2,-1', TILE_TYPES.FOREST], ['2,0', TILE_TYPES.PLAINS], ['2,1', TILE_TYPES.PLAINS],
            // q=3
            ['3,-3', TILE_TYPES.MOUNTAIN], ['3,-2', TILE_TYPES.MOUNTAIN], ['3,-1', TILE_TYPES.WATER], ['3,0', TILE_TYPES.WATER]
        ]);

        const BASE_CAMP_DEFAULTS = {
            2: { // Compact
                player1: { tiles: ['2,0'], edge: null }, // No flag edge for now
                player2: { tiles: ['-2,0'], edge: null }
            },
            3: { // Normal (Current)
                player1: { tiles: ['-2,-1', '-1,-2'], edge: '-2,-1_-1,-2' },
                player2: { tiles: ['1,2', '2,1'], edge: '1,2_2,1' }
            },
            4: { // Expansive
                player1: { tiles: ['-3,-1', '-2,-2', '-1,-3'], edge: null }, // No flag edge for now
                player2: { tiles: ['1,3', '2,2', '3,1'], edge: null }
            }
        };

        const DEFAULT_FLAG_HOME_POSITIONS = {
            player1: '-2,-1_-1,-2', // Hardcoded equivalent of getEdgeKey(-2, -1, -1, -2)
            player2: '1,2_2,1'      // Hardcoded equivalent of getEdgeKey(1, 2, 2, 1)
        };
