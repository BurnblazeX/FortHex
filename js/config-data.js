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
            Melee: 2,
            Archer: 2,
            Pikeman: 2,
            Horseman: 2,
        };
        const FORTIFICATION_DAMAGE = 1;
        const BRIDGE_MAX_HP = 5;
        const PROJECTILE_SPEED_PIXELS_PER_MS = 0.8;
        const UNIT_ON_EDGE_OFFSET = HEX_SIZE * 0.3;
        const ATTACK_COST = 1;
        const FORTIFY_UNFORTIFY_COST = 1;
        const BUILD_BRIDGE_COST = 1;
        const MAX_MOVEMENT_COST = 3;
        const SHIELD_COLOR = '#30C4C4';

        // Visual/Interaction Constants
        const UNIT_DRAW_SIZE_ON_EDGE = HEX_SIZE * 0.25;
        const FORTIFIED_UNIT_DRAW_SIZE = UNIT_DRAW_SIZE_ON_EDGE * 1.25;
        const HIGHLIGHT_CLICK_RADIUS = HEX_SIZE * 0.35;
        const UNIT_CLICK_RADIUS = HEX_SIZE * 0.3;
        const BRIDGE_CLICK_TOLERANCE = HEX_SIZE * 0.15;
        const DRAG_SCALE_FACTOR = 1.2;
        const DRAGGED_DISTANCE_THRESHOLD = 5;
        const PULSE_DURATION_MS = 2000;
        const DOUBLE_TAP_THRESHOLD_MS = 200; // Time in ms for a double tap
        const DOUBLE_TAP_MAX_DISTANCE = 30;  // Max distance in pixels between taps
        const COLOR_TRANSITION_DURATION_MS = 400;
        const PATH_DRAW_ANIMATION_DURATION_MS = 750;
        const PATH_DRAW_PAUSE_DURATION_MS = 500;
        const PATH_DRAW_HOVER_DELAY_MS = 1000;

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
        // Visibility: 3=High (All), 2=Medium (Blocked Opposite), 1=Low (Melee/Adjacent Only), 0=None
        const TILE_TYPES = {
            PLAINS:   { name: 'Plains',   color: '#90EE90', baseMoveCost: 1, canFortify: true, visibility: 3 },
            FOREST:   { name: 'Forest',   color: '#228B22', baseMoveCost: 2, canFortify: true, visibility: 1 },
            WATER:    { name: 'Water',    color: '#87CEEB', baseMoveCost: Infinity, crossable: false, canFortify: false, visibility: 3 },
            MOUNTAIN: { name: 'Mountain', color: '#808080', baseMoveCost: 3, canFortify: false, blocksLOS: true, visibility: 0 }
        };

        // Unit Definitions (Templates)
        const UNIT_TYPES = {
            MELEE:    { typeName: 'MELEE',    name: 'Melee',    hp: 12, speed: 4, damage: 3, defense: 1, symbol: 'M', canBuildBridge: true,  attackType: 'melee', canMoveAfterAttack: false, strengths: ['Archer'],   weaknesses: ['Horseman'] },
            ARCHER:   { typeName: 'ARCHER',   name: 'Archer',   hp: 10, speed: 3, damage: 2, defense: 1, symbol: 'A', canBuildBridge: false, attackType: 'ranged', canMoveAfterAttack: false, strengths: ['Pikeman'],  weaknesses: ['Melee'] },
            PIKEMAN:  { typeName: 'PIKEMAN',  name: 'Pikeman',  hp: 13, speed: 3, damage: 3, defense: 2, symbol: 'P', canBuildBridge: false, attackType: 'melee', canMoveAfterAttack: false, strengths: ['Horseman'], weaknesses: ['Archer'] },
            HORSEMAN: { typeName: 'HORSEMAN', name: 'Horseman', hp: 11, speed: 5, damage: 3, defense: 0, symbol: 'H', canBuildBridge: false, attackType: 'melee', canMoveAfterAttack: true,  strengths: ['Melee'],    weaknesses: ['Pikeman'] }
        };

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
                { player: 1, typeName: 'MELEE', position: '1,1_2,0' }, { player: 1, typeName: 'ARCHER', position: '0,2_1,1' },
                { player: 1, typeName: 'HORSEMAN', position: '0,2_0,3' }, { player: 1, typeName: 'PIKEMAN', position: '2,0_3,0' },
                { player: 2, typeName: 'ARCHER', position: '-1,-1_0,-2' }, { player: 2, typeName: 'MELEE', position: '-2,0_-1,-1' },
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
                { player: 1, typeName: 'MELEE', position: '0,-1_1,-1' }, { player: 1, typeName: 'ARCHER', position: '-1,0_0,-1' },
                { player: 2, typeName: 'MELEE', position: '-1,1_0,1' }, { player: 2, typeName: 'ARCHER', position: '0,1_1,0' }
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
                { player: 1, typeName: 'MELEE', position: '3,-1_3,0' },
                { player: 1, typeName: 'MELEE', position: '2,1_3,0' },
                { player: 1, typeName: 'ARCHER', position: '3,0_4,-1' },
                { player: 1, typeName: 'ARCHER', position: '3,0_3,1' },
                { player: 2, typeName: 'PIKEMAN', position: '-4,0_-3,0' },
                { player: 2, typeName: 'HORSEMAN', position: '-3,0_-2,0' },
                { player: 2, typeName: 'ARCHER', position: '-3,-1_-3,0' },
                { player: 2, typeName: 'ARCHER', position: '-4,1_-3,0' },
                { player: 2, typeName: 'MELEE', position: '-3,0_-2,-1' },
                { player: 2, typeName: 'MELEE', position: '-3,0_-3,1' }
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
