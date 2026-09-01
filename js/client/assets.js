// --- HIGH-RES & LOW-RES ASSET PRELOADER ---
// Client-only: `Image()` requires `document` and throws in a Worker.
const IMAGE_ASSETS = {
    units: { // High-Res (For Cards & Modals)
        MELEE: new Image(),
        ARCHER: new Image(),
        PIKEMAN: new Image(),
        HORSEMAN: new Image()
    },
    map_units: { // Low-Res (For Canvas Board Tokens)
        MELEE: new Image(),
        ARCHER: new Image(),
        PIKEMAN: new Image(),
        HORSEMAN: new Image()
    },
    icons: {
        attack: new Image(),
        defense: new Image(),
        speed: new Image(),
        health: new Image()
    }
};

// Trigger High-Res loads
IMAGE_ASSETS.units.MELEE.src = 'assets/units/Melee.png';
IMAGE_ASSETS.units.ARCHER.src = 'assets/units/Archer.png';
IMAGE_ASSETS.units.PIKEMAN.src = 'assets/units/Pikeman.png';
IMAGE_ASSETS.units.HORSEMAN.src = 'assets/units/Horseman.png';

// Trigger Low-Res loads (using your new naming convention)
IMAGE_ASSETS.map_units.MELEE.src = 'assets/units/Melee_unit.png';
IMAGE_ASSETS.map_units.ARCHER.src = 'assets/units/Archer_unit.png';
IMAGE_ASSETS.map_units.PIKEMAN.src = 'assets/units/Pikeman_unit.png';
IMAGE_ASSETS.map_units.HORSEMAN.src = 'assets/units/Horseman_unit.png';

// Trigger icon loads
IMAGE_ASSETS.icons.attack.src = 'assets/icons/attack.png';
IMAGE_ASSETS.icons.defense.src = 'assets/icons/defense.png';
IMAGE_ASSETS.icons.speed.src = 'assets/icons/speed.png';
IMAGE_ASSETS.icons.health.src = 'assets/icons/health.png';
