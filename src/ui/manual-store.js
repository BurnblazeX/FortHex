// === Direct connect, with no server anywhere (B2) ===
//
// The brokered path (direct-store.js) still needs the FortHex server up long enough to
// pass two blobs between the peers. This one needs nothing at all: the two players move
// those blobs themselves, by pasting codes into whatever they are already talking on.
//
// It exists for the case the brokered path cannot cover - the host process is off, or
// unreachable, or the players simply do not want it involved. That is also the case
// where a player is least able to ask for help, so the flow is written to be followable
// without knowing anything about how it works.
//
// The order is forced by how WebRTC works and cannot be rearranged: the host produces a
// code first, because the guest has nothing to answer until it has seen one. So it is
// always host-code -> guest -> guest-code -> host, and a screen that asks the guest for
// a code first would be asking for something that does not exist yet.

import {
    CreateDirectHost, CreateDirectGuest, CreateCodeSignal, BeginOnlineMatch,
} from './bridge.js';

let state = {
    role: null,        // null | 'host' | 'guest'
    phase: 'idle',     // idle | preparing | waiting | connecting | connected | failed
    myCode: '',        // the code to hand to the other player
    error: null,
};

const listeners = new Set();
let session = null;    // { transport, signal }

function SetState(patch) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
}

export function Subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function GetSnapshot() {
    return state;
}

export function Reset() {
    if (session) {
        try { session.transport.Close(); } catch (error) { /* already gone */ }
        try { session.signal.Close(); } catch (error) { /* already gone */ }
        session = null;
    }
    SetState({ role: null, phase: 'idle', myCode: '', error: null });
}

// Host. Produces the code immediately and then waits - there is nothing to wait FOR
// until the guest replies, so the screen shows the code and a box to paste the answer
// into at the same time.
export function StartHosting({ fogOfWar = false, unitSpeedPreset = null } = {}) {
    Reset();
    SetState({ role: 'host', phase: 'preparing', error: null });

    const signal = CreateCodeSignal({
        onCode: (code) => SetState({ myCode: code, phase: 'waiting' }),
    });

    const transport = CreateDirectHost({
        signal,
        hostSeat: 1,
        guestSeat: 2,
        settings: { fogOfWarEnabled: !!fogOfWar, unitSpeedPreset: unitSpeedPreset || null },
    });

    session = { transport, signal };

    transport.Start()
        .then(() => {
            SetState({ phase: 'connected' });
            BeginOnlineMatch(transport, 1, { fogOfWar: !!fogOfWar, unitSpeedPreset: unitSpeedPreset || null, isHost: true });
            transport.StartMatch();
        })
        .catch(error => Fail(error));

    return signal;
}

// Guest. Produces nothing until it has been given the host's code, which is why this
// takes it as an argument rather than starting on its own.
export function StartJoining(hostCode) {
    Reset();
    SetState({ role: 'guest', phase: 'preparing', error: null });

    const signal = CreateCodeSignal({
        onCode: (code) => SetState({ myCode: code, phase: 'waiting' }),
    });

    const transport = CreateDirectGuest({ signal });
    session = { transport, signal };

    // Subscribed before the code is accepted, so a paste cannot be processed before
    // anything is listening for it.
    const connecting = transport.Start();

    const complaint = signal.Accept(hostCode);
    if (complaint) {
        SetState({ phase: 'failed', error: complaint });
        Reset();
        return null;
    }

    // Fog is the HOST's setting, and the guest cannot know it - there is no server here
    // to ask. So the handover waits for the host to SAY, rather than guessing: guessing
    // false draws an unfogged board over a fogged match, and guessing true fogs a match
    // that has none. The host sends it with match-started the moment the board is dealt.
    transport.OnLobbyMessage((message) => {
        if (message.type !== 'match-started') return;
        SetState({ phase: 'connected' });
        BeginOnlineMatch(transport, message.seat || transport.seat || 2, {
            fogOfWar: !!message.fogOfWar,
            unitSpeedPreset: message.unitSpeedPreset || null,
            isHost: false,
        });
    });

    connecting.catch(error => Fail(error));

    return signal;
}

// The host pasting the guest's reply. The last step of the exchange on this side.
export function AcceptReply(code) {
    if (!session) return 'Nothing is waiting for a code.';
    SetState({ phase: 'connecting', error: null });
    const complaint = session.signal.Accept(code);
    if (complaint) {
        SetState({ phase: 'waiting', error: complaint });
        return complaint;
    }
    return null;
}

function Fail(error) {
    console.warn('[Direct] manual connection failed:', error && error.message);
    SetState({
        phase: 'failed',
        error: 'Could not connect. Check both codes were pasted in full, and that you '
             + 'each copied the right one.',
    });
}
