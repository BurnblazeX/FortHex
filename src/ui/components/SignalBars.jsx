// Four-bar connection indicator, for the room listing.
//
// `level` is 0–4 and comes from the host, not from anything measured here: the room's
// number is the ROOM HOST's round-trip time (host/rooms.js QualityBars), measured with
// the WebSocket protocol's own ping/pong. A viewer's own latency would be identical
// for every row and would say nothing about the rooms.
//
// 0 means "not measured yet", drawn as four empty bars rather than one filled one — a
// room created a second ago has no sample, and inventing a bar would be a lie about
// the connection rather than an admission that nothing is known.
const LABELS = {
    0: 'Connection not measured yet',
    1: 'Poor connection',
    2: 'Fair connection',
    3: 'Good connection',
    4: 'Excellent connection',
};

export function SignalBars({ level = 0 }) {
    const filled = Math.max(0, Math.min(4, Number(level) || 0));

    return (
        <span
            className={'fh-bars fh-bars--' + filled}
            role="img"
            aria-label={LABELS[filled]}
            title={LABELS[filled]}
        >
            {[1, 2, 3, 4].map(bar => (
                <span
                    key={bar}
                    className={'fh-bars__bar' + (bar <= filled ? ' fh-bars__bar--on' : '')}
                />
            ))}
        </span>
    );
}
