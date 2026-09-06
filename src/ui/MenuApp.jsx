import { useEffect, useState, useSyncExternalStore } from 'react';
import { Subscribe, GetSnapshot, GoTo, HideMenu } from './menu-store.js';
import { Subscribe as SubscribeNet, GetSnapshot as GetNet, LeaveRoomIfAny } from './net-store.js';
import { StartMatch, Instruct, RefreshStatusCorner } from './bridge.js';

import { RootScreen } from './screens/RootScreen.jsx';
import { PlayScreen } from './screens/PlayScreen.jsx';
import { SideSelectScreen } from './screens/SideSelectScreen.jsx';
import { MapSelectScreen } from './screens/MapSelectScreen.jsx';
import { MultiplayerScreen } from './screens/MultiplayerScreen.jsx';
import { ProfileSetupScreen } from './screens/ProfileSetupScreen.jsx';
import { CreditsScreen } from './screens/CreditsScreen.jsx';
import { LobbyScreen } from './screens/LobbyScreen.jsx';
import { CreateRoomScreen, RoomScreen } from './screens/RoomScreen.jsx';

// Where each screen's Back goes. A flat map rather than a history stack because the
// menu is a fixed tree — every screen has exactly one parent, and a stack would let
// Back land somewhere different depending on how the player arrived.
const PARENT = {
    play: 'root',
    'sp-side': 'play',
    'sp-map': 'sp-side',
    multiplayer: 'play',
    profile: 'multiplayer',
    credits: 'root',
    lobby: 'multiplayer',
    'create-room': 'lobby',
    room: 'lobby',
};

export function MenuApp() {
    const { visible, screen } = useSyncExternalStore(Subscribe, GetSnapshot);

    const net = useSyncExternalStore(SubscribeNet, GetNet);

    // Carried between sp-side and sp-map. Local state, not the store: nothing
    // outside React needs it, and it should reset when the menu closes.
    const [playerSide, setPlayerSide] = useState(1);

    // Being in a room decides which screen you are on, and that decision lives HERE
    // rather than in the screens themselves — this component is always mounted, and
    // the screens are not. Putting it in LobbyScreen meant creating a room navigated
    // nowhere (LobbyScreen was unmounted at the time), Back re-mounted it and only
    // then jumped, and Leave landed on a room screen with no room left to draw.
    // Opening or closing the menu swaps what the status corner shows.
    useEffect(() => { RefreshStatusCorner(); }, [visible]);

    useEffect(() => {
        if (!visible) return;
        if (net.room && (screen === 'lobby' || screen === 'create-room')) GoTo('room');
        else if (!net.room && screen === 'room') GoTo('lobby');
    }, [visible, net.room, screen]);

    if (!visible) return null;

    const Back = () => GoTo(PARENT[screen] || 'root');

    const Launch = (map) => {
        LeaveRoomIfAny();
        HideMenu();
        StartMatch({ mode: 'singleplayer', playerSide, map });
    };

    // A5 left this a dead-end because the flow below it did not exist yet. It does
    // now: a fresh profile goes straight to the room browser.
    const ProfileDone = () => GoTo('lobby');

    let content;
    switch (screen) {
        case 'play':
            content = <PlayScreen onGoTo={GoTo} onBack={Back} onClose={HideMenu} />;
            break;
        case 'sp-side':
            content = (
                <SideSelectScreen
                    onPick={(side) => { setPlayerSide(side); GoTo('sp-map'); }}
                    onBack={Back}
                />
            );
            break;
        case 'sp-map':
            content = <MapSelectScreen playerSide={playerSide} onPick={Launch} onBack={Back} />;
            break;
        case 'multiplayer':
            content = <MultiplayerScreen onGoTo={GoTo} onBack={Back} onClose={HideMenu} />;
            break;
        case 'profile':
            content = <ProfileSetupScreen onDone={ProfileDone} onBack={Back} />;
            break;
        case 'credits':
            content = <CreditsScreen onBack={Back} />;
            break;
        case 'lobby':
            content = (
                <LobbyScreen onBack={Back} onCreate={() => GoTo('create-room')} />
            );
            break;
        case 'create-room':
            content = <CreateRoomScreen onBack={() => GoTo('lobby')} />;
            break;
        case 'room':
            content = <RoomScreen />;
            break;
        default:
            content = <RootScreen onGoTo={GoTo} onClose={HideMenu} />;
    }

    return <div className="fh-menu">{content}</div>;
}
