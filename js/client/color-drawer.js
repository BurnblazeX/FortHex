// === Colour picker drawer wiring (moved from main.js — A1 step 12) ===
//
// The team-colour drawer and the action log's scroll fade. populateColorPickers
// and friends are the copies from js/client/ui.js - the old window.onload had its own
// nested duplicates of all four, which shadowed nothing but meant two
// implementations drifting apart. Only ui.js's survive.

function WireColorDrawer() {
    // --- Color Picker Drawer Logic ---
    const colorPickerDrawer = document.getElementById('colorPickerDrawer');
    const drawerHandle = document.getElementById('drawerHandle');
    const drawerTabs = document.getElementById('drawerTabs');
    const tabButtons = document.querySelectorAll('.drawer-tab-button');
    const drawerIcon = drawerHandle.querySelector('svg');
    const tabContent = document.getElementById('drawerTabContent');

    // populateColorPickers / updateColorPickerCircles / updateDrawerColors /
    // handleColorSelection all live in js/client/ui.js - this used to carry its own
    // byte-identical copies of the four.

    // Open/Close the drawer
    drawerHandle.addEventListener('click', () => {
        colorPickerDrawer.classList.toggle('drawer-open');
        updateDrawerColors();
    });

    // Switch between P1 and P2 tabs
    drawerTabs.addEventListener('click', (e) => {
        const clickedButton = e.target.closest('.drawer-tab-button');
        if (!clickedButton) return;

        const targetTabId = clickedButton.dataset.tab;
        const playerKey = targetTabId === 'p1' ? 'player1' : 'player2';

        // Update button active state
        tabButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.tab === targetTabId);
        });

        // Update the circle colors and then the drawer border
        updateColorPickerCircles(playerKey);
        updateDrawerColors();
    });

    // Attach the click listener for selecting a color
    if (tabContent) {
        tabContent.addEventListener('click', handleColorSelection);
    }

    // Close drawer if clicking outside
    document.addEventListener('click', (e) => {
        if (colorPickerDrawer.classList.contains('drawer-open') && !colorPickerDrawer.contains(e.target)) {
            colorPickerDrawer.classList.remove('drawer-open');
            updateDrawerColors(); // Reset colors when closing
        }
    });

    // Prevent outside-click from firing on the handle itself
    drawerHandle.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // --- Scroll Fade Logic for Action Log ---
    const actionLogContent = document.getElementById('actionLogContent');
    const actionLogWrapper = document.getElementById('actionLogWrapper');
    if(actionLogContent && actionLogWrapper) {
        actionLogContent.addEventListener('scroll', () => {
            if (actionLogContent.scrollTop > 0) {
                actionLogWrapper.classList.add('is-scrolled');
            } else {
                actionLogWrapper.classList.remove('is-scrolled');
            }
        });
    }

    // --- End of Color Picker Drawer Logic ---
}
