// === Running a match with no server in the middle (B2) ===
//
// The lobby found the opponent; from here the two browsers talk to each other. This is
// the small amount of glue between net-store's `match-direct` and the two transports in
// js/client/rtc-transport.js.
//
// The whole design rests on one thing being true: BeginOnlineMatch does not care which
// transport it is handed. A direct match therefore reuses every line of the hosted
// path - the same renderer, the same ApplyRemoteView, the same disconnect handling -
// and this file is short because that is where the work already happened.
//
// WHAT IS DIFFERENT, and it is worth stating plainly rather than leaving implied:
//
//   The host player's browser is the authority. There is no third machine to appeal
//   to. That is accepted policy - direct play is the modded, unpoliced path by
//   design - but it means a direct match must never be treated as a record of
//   anything. Ranked standing and the Gospel corpus stay on server rooms.
//
//   The match ends when the host closes the tab. Nothing is holding state anywhere
//   else, and no reconnect can reach a browser that is gone.

import { CreateDirectHost, CreateDirectGuest, CreateRelaySignal, BeginOnlineMatch } from './bridge.js';
import { Notify } from './notify-store.js';

let active = null;   // { transport, signal }

export function GetDirectTransport() {
    return active ? active.transport : null;
}

// Both peers call this on `match-direct`; which branch runs depends on who the server
// said is hosting. The host must be listening before the guest answers, but that is
// guaranteed by the order of operations rather than by timing: the host is the one who
// sends the offer, so nothing can arrive before it is ready for it.
export async function BeginDirectMatch(socketTransport, message) {
    EndDirectMatch();

    const signal = CreateRelaySignal(socketTransport);

    try {
        if (message.isHost) {
            const hostSeat = message.seat;
            const transport = CreateDirectHost({
                signal,
                hostSeat,
                guestSeat: hostSeat === 1 ? 2 : 1,
                matchId: message.room ? message.room.id : null,
                settings: {
                    fogOfWarEnabled: !!(message.room && message.room.fogOfWar),
                },
            });

            active = { transport, signal };

            // Settles when the guest is actually on the channel - see rtc-transport.js
            // for why it does not settle earlier. Starting the match into a pipe with
            // nobody at the far end would deal an opening board to no one.
            await transport.Start();

            HandOver(transport, hostSeat, message, true);

            // The board is dealt only once both are connected AND both are listening.
            // The worker's 'started' reply is what pushes the opening position to each
            // of them, so this is the last step rather than the first.
            // The map the room was created with, handed straight to this browser's own
            // match worker. Same two fields the FortHex server would post to its worker,
            // because it is the same worker running the same driver.
            transport.StartMatch(message.map || {});
        } else {
            const transport = CreateDirectGuest({ signal });
            active = { transport, signal };

            await transport.Start();
            HandOver(transport, message.seat, message, false);
        }
    } catch (error) {
        // A failed direct connection is an ordinary outcome on a lot of networks, not
        // an exception - which is exactly what the probe exists to warn about before
        // anyone gets this far. Say so in plain words and leave them in the room.
        console.warn('[Direct] could not connect:', error && error.message);
        Notify('Could not connect directly to the other player.', 'error');
        EndDirectMatch();
    }
}

function HandOver(transport, seat, message, isHost) {
    BeginOnlineMatch(transport, seat, {
        fogOfWar: !!(message.room && message.room.fogOfWar),
        isHost,
    });
}

export function EndDirectMatch() {
    if (!active) return;
    try { active.transport.Close(); } catch (error) { /* already gone */ }
    try { active.signal.Close(); } catch (error) { /* already gone */ }
    active = null;
}
