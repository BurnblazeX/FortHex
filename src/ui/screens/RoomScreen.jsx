import { useEffect, useState, useSyncExternalStore } from 'react';
import { MenuButton } from '../components/MenuButton.jsx';
import { Subscribe, GetSnapshot, GetTransport, ClearError, LeaveRoom } from '../net-store.js';
import { GetLocalProfile } from '../bridge.js';

// Two screens in one file because they are two states of the same thing: the room you
// are about to make, and the room you are sitting in waiting for someone to arrive.

// "Blaze's Room" — built from the local profile rather than a generic placeholder, so
// the suggested name is recognisably the player's before they have typed anything.
function DefaultRoomName() {
    const profile = GetLocalProfile();
    const who = (profile && profile.name && profile.name.trim()) ? profile.name.trim() : 'Player';
    return who + "'s Room";
}

export function CreateRoomScreen({ onBack }) {
    const net = useSyncExternalStore(Subscribe, GetSnapshot);
    const suggested = DefaultRoomName();
    const [name, setName] = useState('');
    const [isPrivate, setIsPrivate] = useState(false);
    const [fog, setFog] = useState(false);

    // Creating is one-shot. Without this a second click before the host answers sends
    // a second create-room and comes back "you are already in a room" — which is what
    // the double-click looked like when navigation was still broken.
    const [submitting, setSubmitting] = useState(false);

    const Create = () => {
        if (submitting) return;
        setSubmitting(true);
        ClearError();
        // Left empty means "use the suggestion", not "call it Untitled" — the
        // placeholder is a real default, not just grey text.
        GetTransport().CreateRoom({
            name: name.trim() || suggested,
            visibility: isPrivate ? 'private' : 'public',
            settings: { fogOfWarEnabled: fog },
        });
    };

    // A refusal is the signal the attempt is over, so the button becomes usable again.
    useEffect(() => { if (net.error) setSubmitting(false); }, [net.error]);

    return (
        <div className="fh-menu__panel">
            <h2 className="fh-menu__title">Create Room</h2>

            <div className="fh-modal fh-modal--narrow">
                <div className="fh-modal__body fh-modal__body--form">
                    <label className="fh-profile__label" htmlFor="fhRoomName">Room name</label>
                    <input
                        id="fhRoomName"
                        className="fh-profile__input"
                        maxLength={40}
                        autoComplete="off"
                        placeholder={suggested}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus
                    />

                    <label className="fh-profile__consent">
                        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                        <span>Private — needs a code to join</span>
                    </label>

                    <label className="fh-profile__consent">
                        <input type="checkbox" checked={fog} onChange={(e) => setFog(e.target.checked)} />
                        <span>Fog of war</span>
                    </label>

                    {/* Worth saying plainly: fog is fixed for the whole match once it
                        starts, because the server filters what it sends per player and
                        cannot un-send what a client already knows. */}
                    <p className="fh-lobby__note">
                        Fog of war is decided now and cannot be changed once the match starts.
                    </p>
                </div>
            </div>

            {net.error && <p className="fh-lobby__error">{net.error}</p>}

            <div className="fh-menu__row" style={{ marginTop: '18px' }}>
                <MenuButton onClick={Create} disabled={submitting || net.status !== 'online'}>
                    {submitting ? 'Creating…' : 'Create'}
                </MenuButton>
                <MenuButton variant="cancel" onClick={onBack}>Back</MenuButton>
            </div>
        </div>
    );
}

export function RoomScreen() {
    const net = useSyncExternalStore(Subscribe, GetSnapshot);
    const room = net.room;

    if (!room) return null;

    const filled = room.seats.filter(seat => seat.filled).length;
    const canStart = room.isHost && filled === room.seats.length;

    // Just clear the room. MenuApp watches for that and moves to the room list —
    // navigating from here as well is what produced the blank screen, because the two
    // fought over where you should be.
    const Leave = () => LeaveRoom();

    // Two seats, so "take the other one" and "swap with whoever is there" are the same
    // server operation.
    const Pick = () => { ClearError(); GetTransport().SwapSeats(); };

    return (
        <div className="fh-menu__panel">
            <h2 className="fh-menu__title">{room.name}</h2>

            <div className="fh-modal fh-modal--narrow">
                <div className="fh-modal__head">
                    <span>{room.visibility === 'private' ? 'Private' : 'Public'}</span>
                    <span className="fh-modal__status">{filled}/{room.seats.length}</span>
                </div>

                <div className="fh-modal__body fh-modal__body--form">
                    {/* The seats ARE the side picker. The host clicks the one they are
                        not in to move there, and if someone is already sitting in it the
                        two swap — which is the same operation, so it does not need its
                        own button. Locked once the match runs: seats are the identity
                        the engine has been handed. */}
                    {room.seats.map(seat => {
                        const canPick = room.isHost && !seat.you && room.state === 'waiting';
                        const Tag = canPick ? 'button' : 'div';

                        return (
                            <Tag
                                key={seat.seat}
                                type={canPick ? 'button' : undefined}
                                onClick={canPick ? Pick : undefined}
                                title={canPick
                                    ? (seat.filled ? 'Swap sides' : 'Take this side')
                                    : undefined}
                                className={'fh-seat'
                                    + (seat.filled ? ' fh-seat--filled' : '')
                                    + (canPick ? ' fh-seat--pickable' : '')}
                            >
                                <span className={'fh-seat__pip fh-seat__pip--p' + seat.seat} />
                                <span className="fh-seat__label">
                                    {seat.seat === 1 ? 'Blue (P1)' : 'Red (P2)'}
                                </span>
                                <span className="fh-seat__who">
                                    {seat.you ? 'You' : (seat.filled ? 'Ready' : 'Waiting…')}
                                </span>
                            </Tag>
                        );
                    })}

                    {/* The join code is shown to people already inside the room — it is
                        how they invite the other player. It is never in the public
                        listing, which is the distinction that keeps a private room
                        private while still being visible. */}
                    <div className="fh-lobby__code-share">
                        <span className="fh-profile__label" style={{ margin: 0 }}>Invite code</span>
                        <code className="fh-lobby__codevalue">{room.joinCode}</code>
                    </div>

                    {room.fogOfWar && <p className="fh-lobby__note">Fog of war is on for this match.</p>}
                </div>
            </div>

            {net.error && <p className="fh-lobby__error">{net.error}</p>}

            <div className="fh-menu__row" style={{ marginTop: '18px' }}>
                {room.isHost && (
                    <MenuButton
                        onClick={() => { ClearError(); GetTransport().StartMatch(); }}
                        disabled={!canStart}
                        title={canStart ? undefined : 'Both seats have to be filled'}
                    >
                        Start Match
                    </MenuButton>
                )}
                <MenuButton variant="cancel" onClick={Leave}>Leave</MenuButton>
            </div>

            <p className="fh-menu__note">
                {room.isHost
                    ? 'Click the other side to switch. Blue moves first.'
                    : 'Waiting for the host to start the match.'}
            </p>
        </div>
    );
}
