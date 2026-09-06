import { useEffect, useState, useSyncExternalStore } from 'react';
import { MenuButton } from '../components/MenuButton.jsx';
import { SignalBars } from '../components/SignalBars.jsx';
import {
    Subscribe, GetSnapshot, GetTransport, ConnectToLobby, Disconnect, ClearError,
} from '../net-store.js';

// The room browser. A modal panel over the menu, in the same white-bordered language
// as the rest of the screens.
//
// Each row is: name | occupancy | privacy | build | connection.
// The build column matters more than it looks — two players on different builds can
// disagree about the rules, and this is the only place that is visible before the
// mismatch turns into a desync mid-match.
export function LobbyScreen({ onBack, onCreate }) {
    const net = useSyncExternalStore(Subscribe, GetSnapshot);
    const [pendingRoom, setPendingRoom] = useState(null);  // a locked room awaiting a code
    const [code, setCode] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    // The spin is time-based rather than tied to the reply. A LAN round trip is a few
    // milliseconds, so a spinner that stopped when the list arrived would flicker and
    // read as nothing having happened.
    const Refresh = () => {
        const transport = GetTransport();
        if (!transport) return;
        transport.ListRooms();
        setRefreshing(true);
        setTimeout(() => setRefreshing(false), 600);
    };

    useEffect(() => {
        ConnectToLobby();
    }, []);

    // Poll the listing while the browser is open. A push would be tidier, but rooms
    // appear and fill on other people's schedules and a five-second refresh is both
    // cheap and honest about how stale the view can be.
    useEffect(() => {
        if (net.status !== 'online') return undefined;
        const timer = setInterval(() => {
            const transport = GetTransport();
            if (transport) transport.ListRooms();
        }, 5000);
        return () => clearInterval(timer);
    }, [net.status]);

    const Join = (room) => {
        ClearError();
        if (room.locked) { setPendingRoom(room); setCode(''); return; }
        GetTransport().JoinRoom({ roomId: room.id });
    };

    const SubmitCode = () => {
        if (!pendingRoom) return;
        GetTransport().JoinRoom({ roomId: pendingRoom.id, code: code.trim().toUpperCase() });
    };

    return (
        <div className="fh-menu__panel">
            <h2 className="fh-menu__title">Online</h2>

            <div className="fh-modal">
                <div className="fh-modal__head">
                    <span>Rooms</span>

                    {/* The list also polls every five seconds, but a poll is a promise
                        about the future — this is for the moment you want to know NOW,
                        having just told a friend to make a room. */}
                    <button
                        type="button"
                        className={'fh-refresh' + (refreshing ? ' fh-refresh--spinning' : '')}
                        onClick={Refresh}
                        disabled={net.status !== 'online'}
                        title="Refresh room list"
                        aria-label="Refresh room list"
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                            <path
                                d="M20 11A8 8 0 1 0 18.3 16"
                                fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                            />
                            <path d="M20 5.5V11h-5.5" fill="none" stroke="currentColor" strokeWidth="2.4"
                                  strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>

                    <span className="fh-modal__status">
                        {net.status === 'connecting' && 'Connecting…'}
                        {net.status === 'online' && net.rooms.length + ' available'}
                        {net.status === 'offline' && 'Not connected'}
                        {net.status === 'error' && 'Unavailable'}
                    </span>
                </div>

                <div className="fh-modal__body">
                    {net.status === 'error' && (
                        <p className="fh-lobby__empty">
                            Could not reach the server. It may simply be switched off.
                        </p>
                    )}

                    {net.status === 'connecting' && <p className="fh-lobby__empty">Connecting…</p>}

                    {net.status === 'online' && net.rooms.length === 0 && (
                        <p className="fh-lobby__empty">No rooms yet. Create one.</p>
                    )}

                    {net.status === 'online' && net.rooms.map(room => {
                        const full = room.players >= room.capacity;
                        const playing = room.state === 'in-progress';
                        const closed = full || playing;

                        return (
                            <button
                                key={room.id}
                                type="button"
                                className={'fh-room' + (closed ? ' fh-room--closed' : '')}
                                disabled={closed}
                                onClick={() => Join(room)}
                                title={playing ? 'This match is already under way' : undefined}
                            >
                                <span className="fh-room__name">{room.name}</span>
                                <span className="fh-room__count">{room.players}/{room.capacity}</span>
                                <span className="fh-room__privacy">
                                    {room.locked ? 'Private' : 'Public'}
                                </span>
                                <span className="fh-room__version">{room.hostVersion || 'unknown'}</span>
                                <SignalBars level={room.quality} />
                            </button>
                        );
                    })}
                </div>

                {/* A locked room asks for its code in place rather than on another
                    screen — the list is the context for what you are unlocking. */}
                {pendingRoom && (
                    <div className="fh-modal__foot fh-modal__foot--stack">
                        <label className="fh-profile__label" htmlFor="fhRoomCode">
                            Code for “{pendingRoom.name}”
                        </label>
                        <div className="fh-lobby__coderow">
                            <input
                                id="fhRoomCode"
                                className="fh-profile__input fh-lobby__code"
                                value={code}
                                maxLength={12}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="ABC123"
                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                onKeyDown={(e) => { if (e.key === 'Enter') SubmitCode(); }}
                                autoFocus
                            />
                            <MenuButton onClick={SubmitCode} disabled={!code.trim()}>Join</MenuButton>
                            <MenuButton variant="cancel" onClick={() => setPendingRoom(null)}>Cancel</MenuButton>
                        </div>
                    </div>
                )}

                {net.error && <p className="fh-lobby__error">{net.error}</p>}
            </div>

            <div className="fh-menu__row" style={{ marginTop: '18px' }}>
                <MenuButton disabled={net.status !== 'online'} onClick={() => { ClearError(); onCreate(); }}>
                    Create Room
                </MenuButton>
                <MenuButton variant="cancel" onClick={() => { Disconnect(); onBack(); }}>Back</MenuButton>
            </div>
        </div>
    );
}
