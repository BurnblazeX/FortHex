import { useEffect, useState, useSyncExternalStore } from 'react';
import { MenuButton } from '../components/MenuButton.jsx';
import { Subscribe, GetSnapshot, GetTransport, ClearError, LeaveRoom, EnsureDirectProbe } from '../net-store.js';
import { GetLocalProfile, GetMaps, ReadMapFile, ReadSaveFile } from '../bridge.js';

// Two screens in one file because they are two states of the same thing: the room you
// are about to make, and the room you are sitting in waiting for someone to arrive.

// Radius is the honest number and means nothing to a player. These are the words the
// map maker's own size control uses.
function MapSizeLabel(radius) {
    if (radius === 2) return 'Compact';
    if (radius === 4) return 'Expansive';
    return 'Normal';
}

// "Blaze's Room" - built from the local profile rather than a generic placeholder, so
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

    // Where the match will actually run. The player is only asked this when HOSTING,
    // because that is the only point at which the difference affects them - joining
    // tries direct first and falls back to the server without ever mentioning it.
    const [hosting, setHosting] = useState('server');

    // Asked on arrival rather than when the option is clicked, so the answer is
    // already there when the player reads the choice. It takes a second or two and
    // opening this screen is the earliest moment we know it will be wanted.
    useEffect(() => { EnsureDirectProbe(); }, []);

    const probe = net.direct;
    const probing = !probe || probe.verdict === 'probing';
    const canHostDirect = !!(probe && probe.ok);

    // A network that cannot do this must not leave the option selected - the player
    // may have picked it before the probe came back.
    useEffect(() => {
        if (!probing && !canHostDirect && hosting === 'direct') setHosting('server');
    }, [probing, canHostDirect, hosting]);

    // The map. A preset is remembered by NAME, because the other side already has
    // every preset and posting a board it could look up is waste. A map loaded from a
    // file has no name anyone else knows, so that one is carried whole.
    const maps = GetMaps();
    const [mapName, setMapName] = useState(maps[0].name);
    const [customMap, setCustomMap] = useState(null);
    const [mapError, setMapError] = useState(null);

    // A saved match to resume. Mutually exclusive with a map by nature rather than by
    // rule: a save already contains its board, so a map chosen alongside one is stale
    // UI state and the worker ignores it.
    const [resumeSave, setResumeSave] = useState(null);
    const [resumeInfo, setResumeInfo] = useState(null);
    const [busy, setBusy] = useState(false);

    const PickPreset = (name) => {
        setCustomMap(null);
        setMapError(null);
        setMapName(name);
        // Choosing a map is how you say you are no longer resuming.
        setResumeSave(null);
        setResumeInfo(null);
    };

    const PickFile = async (event) => {
        const file = event.target.files && event.target.files[0];
        // Cleared so choosing the same file twice in a row still fires a change.
        event.target.value = '';
        if (!file) return;

        setMapError(null);
        const result = await ReadMapFile(file);
        if (!result.ok) { setMapError(result.error); return; }

        setCustomMap(result.map);
        setMapName(result.map.name);
        setResumeSave(null);
        setResumeInfo(null);
    };

    // Reading a save can put a modal on screen (the modernisation question), so this
    // is the one control here that can take a while and be interrupted.
    const PickSave = async (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;

        setMapError(null);
        setBusy(true);
        const result = await ReadSaveFile(file);
        setBusy(false);

        if (!result.ok) { setMapError(result.error); return; }

        setResumeSave(result.save);
        setResumeInfo(result.summary);
        setCustomMap(null);
    };

    const ClearResume = () => {
        setResumeSave(null);
        setResumeInfo(null);
        setMapError(null);
    };

    // Creating is one-shot. Without this a second click before the host answers sends
    // a second create-room and comes back "you are already in a room" - which is what
    // the double-click looked like when navigation was still broken.
    const [submitting, setSubmitting] = useState(false);

    const Create = () => {
        if (submitting) return;
        setSubmitting(true);
        ClearError();
        // Left empty means "use the suggestion", not "call it Untitled" - the
        // placeholder is a real default, not just grey text.
        GetTransport().CreateRoom({
            name: name.trim() || suggested,
            visibility: isPrivate ? 'private' : 'public',
            hosting,
            settings: {
                fogOfWarEnabled: fog,
                mapName: (customMap || resumeSave) ? null : mapName,
                customMap: resumeSave ? null : customMap,
                resumeSave,
            },
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
                        <span>Private - needs a code to join</span>
                    </label>

                    <label className="fh-profile__consent">
                        <input type="checkbox" checked={fog} onChange={(e) => setFog(e.target.checked)} />
                        <span>Fog of war</span>
                    </label>

                    {/* The map. A plain select rather than the card grid the
                        singleplayer flow uses: that screen exists to show you the board
                        before you commit, and this one is a form with six other
                        controls on it. The preview belongs on the room screen, where
                        there is room for it and both players can see it. */}
                    <div className="fh-room__map">
                        <label className="fh-profile__label" htmlFor="fhRoomMap">Map</label>

                        <select
                            id="fhRoomMap"
                            className="fh-room__mapselect"
                            value={customMap ? '__custom' : mapName}
                            onChange={(e) => PickPreset(e.target.value)}
                        >
                            {maps.map(map => (
                                <option key={map.name} value={map.name}>
                                    {map.name + ' (' + MapSizeLabel(map.radius) + ')'}
                                </option>
                            ))}
                            {/* Only listed once one is loaded. An option that cannot be
                                chosen from the list would be a dead entry. */}
                            {customMap && (
                                <option value="__custom">
                                    {customMap.name + ' (' + MapSizeLabel(customMap.radius) + ', from file)'}
                                </option>
                            )}
                        </select>

                        <label className="fh-room__mapfile">
                            <input type="file" accept=".fhmap,.json,application/json" onChange={PickFile} />
                            <span>Load map file</span>
                        </label>

                        {/* The other way to decide a board: don't pick one, bring a match
                            that already has one. Sits with the map controls because it is
                            the same question answered differently. */}
                        <label className="fh-room__mapfile">
                            <input type="file" accept=".fhsave,.json,application/json" onChange={PickSave} />
                            <span>{busy ? 'Reading save…' : 'Resume a saved match'}</span>
                        </label>
                    </div>

                    {/* Shown instead of the map, because a save IS the board. Both
                        players start from where it left off and take whichever side
                        their SEAT is - the room's existing seat picker is how they
                        choose, so there is nothing extra to decide here. */}
                    {resumeSave && (
                        <div className="fh-room__resume">
                            <div className="fh-room__resumehead">
                                <strong>Resuming {resumeSave.label}</strong>
                                <button type="button" className="fh-room__resumeclear"
                                        onClick={ClearResume} title="Start a fresh match instead">
                                    ×
                                </button>
                            </div>
                            {resumeInfo && (
                                <span className="fh-room__resumenote">
                                    {'Turn ' + resumeInfo.turn + ', ' + resumeInfo.units + ' units. '
                                     + (resumeInfo.toMove === 1 ? 'Blue' : 'Red') + ' moves first.'}
                                </span>
                            )}
                        </div>
                    )}

                    {mapError && <p className="fh-lobby__error">{mapError}</p>}

                    {/* The transports are never named. "WebRTC" and "WebSocket" are answers
                        to a question the player did not ask; where the match runs and what
                        that costs them is the question they did.

                        "On your machine" and Direct Connect use the SAME mechanism - the
                        host browser runs the match in a worker and the guest is a client of
                        it. They differ only in how the two find each other: this one is a
                        real listed room and still needs the server up to broker the
                        handshake, while Direct Connect needs no server at any point. That is
                        why the copy here does not say "no server needed" - it did once, and
                        it was not true. */}
                    <div className="fh-host-choice">
                        <span className="fh-profile__label">Where the match runs</span>

                        <label className="fh-host-choice__option">
                            <input
                                type="radio"
                                name="fhHosting"
                                checked={hosting === 'server'}
                                onChange={() => setHosting('server')}
                            />
                            <span>
                                <strong>On the FortHex server</strong>
                                <em>Anyone can join. Keeps running if you tab away.</em>
                            </span>
                        </label>

                        <label className={'fh-host-choice__option'
                            + ((probing || !canHostDirect) ? ' fh-host-choice__option--off' : '')}>
                            <input
                                type="radio"
                                name="fhHosting"
                                checked={hosting === 'direct'}
                                disabled={probing || !canHostDirect}
                                onChange={() => setHosting('direct')}
                            />
                            <span>
                                <strong>On your machine</strong>
                                <em>
                                    {probing
                                        ? 'Checking your network…'
                                        : (canHostDirect
                                            ? 'Listed like any room. Ends when you close the game.'
                                            : probe.detail)}
                                </em>
                            </span>
                        </label>
                    </div>

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

    // Just clear the room. MenuApp watches for that and moves to the room list -
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
                    {/* The guest did not choose the map and has no other way to find out
                        what they are about to play on. */}
                    {room.mapName && <span className="fh-modal__status">{room.mapName}</span>}
                    <span className="fh-modal__status">{filled}/{room.seats.length}</span>
                </div>

                <div className="fh-modal__body fh-modal__body--form">
                    {/* The seats ARE the side picker. The host clicks the one they are
                        not in to move there, and if someone is already sitting in it the
                        two swap - which is the same operation, so it does not need its
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

                    {/* The join code is shown to people already inside the room - it is
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
