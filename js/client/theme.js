// --- COLOR SYSTEM 1.0 (Quantized) ---
// Client-only: cosmetic, the server has no rules-relevant need to know theme colors.
const PALETTE = {
    // Grayscale / Slate
    SLATE_DARK:     '#304050', // Main BG, Input BG
    SLATE_LIGHT:    '#304860', // Panel BG, Button BG
    SLATE_BLUE:     '#486078', // Borders
    GREY_SILVER:    '#C0C0C8', // Disabled Text
    GREY_MID:       '#505858', // Disabled Elements
    WHITE_OFF:      '#F0F0F0', // Main Text
    BLACK_INK:      '#182830', // Outlines (Quantized from #1a252f)

    // Player Colors
    BLUE_SKY:       '#60B0E0', // P1 Primary
    BLUE_VIVID:     '#3090D0', // Action Blue
    RED_VERMILION:  '#E04030', // P2 Primary, Cancel, Offline

    // Functional
    GREEN_EMERALD:  '#20B060', // Confirm, Success
    GREEN_VIBRANT:  '#30D070', // Online Status
    YELLOW_GOLD:    '#FFC020', // Warnings, Highlights (255 Exception)
    CYAN_DEEP:      '#30C0C0', // Shield, Special

    // Map Terrain (Quantized)
    MAP_FOREST:     '#208820', // Quantized from #228B22
    MAP_WATER:      '#88D0E8', // Quantized from #87CEEB
    MAP_PLAINS:     '#90F090', // Quantized from #90EE90
    MAP_MOUNTAIN:   '#808080', // Quantized from #808080
    MAP_BRIDGE:     '#884810', // Quantized from #8B4513
};

const THEME = {
    // UI
    APP_BG:         PALETTE.SLATE_DARK,
    PANEL_BG:       PALETTE.SLATE_LIGHT,
    TEXT_MAIN:      PALETTE.WHITE_OFF,
    TEXT_MUTED:     PALETTE.GREY_SILVER,
    BORDER_MAIN:    PALETTE.SLATE_BLUE,

    // Actions
    BTN_ACTION:     PALETTE.BLUE_VIVID,
    BTN_CONFIRM:    PALETTE.GREEN_EMERALD,
    BTN_CANCEL:     PALETTE.RED_VERMILION,

    // Gameplay Helpers
    OUTLINE_ENTITY: PALETTE.BLACK_INK,
    STATUS_HEALTH:  PALETTE.GREEN_VIBRANT,
    STATUS_SHIELD:  PALETTE.CYAN_DEEP,

    // Terrain
    TILE_PLAINS:    PALETTE.MAP_PLAINS,
    TILE_FOREST:    PALETTE.MAP_FOREST,
    TILE_WATER:     PALETTE.MAP_WATER,
    TILE_MOUNTAIN:  PALETTE.MAP_MOUNTAIN,
    STRUCT_BRIDGE:  PALETTE.MAP_BRIDGE
};

// All available color themes
const COLOR_THEMES = [
    { // Theme 1
        player1: { primary: '#4060E0', secondary: '#60D0F0', accent: '#40B0FF' },
        player2: { primary: '#E06040', secondary: '#FF7040', accent: '#FF8060' }
    },
    { // Theme 2
        player1: { primary: '#4050D0', secondary: '#60C0E8', accent: '#50A0FF' },
        player2: { primary: '#D05040', secondary: '#F86040', accent: '#FF7070' }
    },
    { // Theme 3 (Default)
        player1: { primary: '#4040C0', secondary: '#60B0E0', accent: '#6090FF' },
        player2: { primary: '#C04040', secondary: '#F05040', accent: '#FF6080' }
    },
    { // Theme 4
        player1: { primary: '#4030B0', secondary: '#60A0D8', accent: '#7080FF' },
        player2: { primary: '#B03040', secondary: '#E84040', accent: '#FF5090' }
    },
    { // Theme 5
        player1: { primary: '#4020A0', secondary: '#6090D0', accent: '#8070FF' },
        player2: { primary: '#A02040', secondary: '#E03040', accent: '#E03040' }
    }
];

//Team Color Definitions
const TEAM_COLORS = {
    player1: { ...COLOR_THEMES[2].player1 },
    player2: { ...COLOR_THEMES[2].player2 }
};
