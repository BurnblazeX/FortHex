import { useEffect, useState, useSyncExternalStore } from 'react';
import { Subscribe, GetSnapshot, Dismiss } from '../notify-store.js';

// How long each severity stays before it fades. Errors linger — a corrupted save is
// worth reading twice; a refused drop is not, and a confirmation least of all.
const LIFETIME_MS = { error: 6000, warn: 3500, ok: 2500 };
const FADE_MS = 400;

function Toast({ item }) {
    // Three phases, not two. 'enter' is off-screen right and transparent; 'in' slides
    // it into place; 'out' holds it in place and only drops the opacity. That last
    // distinction is the point — exit is a fade, not the entrance run backwards.
    const [phase, setPhase] = useState('enter');

    useEffect(() => {
        // Displaced by a newer message: skip the hold entirely and fade out now. The
        // store keeps the item in the array until this finishes, which is what lets
        // it animate away instead of disappearing between frames.
        if (item.expiring) {
            setPhase('out');
            const drop = setTimeout(() => Dismiss(item.id), FADE_MS);
            return () => clearTimeout(drop);
        }

        // Flipped on the frame AFTER mount, so the transition has two states to move
        // between. Setting the final phase during the mount frame animates nothing.
        const raf = requestAnimationFrame(() => setPhase('in'));
        const fade = setTimeout(() => setPhase('out'), LIFETIME_MS[item.severity]);

        // Removed from the store only once the fade has finished, or the element
        // would vanish instantly instead of animating away.
        const drop = setTimeout(() => Dismiss(item.id), LIFETIME_MS[item.severity] + FADE_MS);

        return () => { cancelAnimationFrame(raf); clearTimeout(fade); clearTimeout(drop); };
    }, [item.id, item.severity, item.expiring]);

    const classes = ['fh-toast', 'fh-toast--' + item.severity, 'fh-toast--' + phase].join(' ');

    return (
        <div className={classes} role={item.severity === 'error' ? 'alert' : 'status'}>
            {item.message}
        </div>
    );
}

export function Notifications() {
    const { items } = useSyncExternalStore(Subscribe, GetSnapshot);

    if (!items.length) return null;

    // Store order is newest-first and the column renders top-down, so a new message
    // lands at the top and pushes the older one down.
    return (
        <div className="fh-toasts">
            {items.map(item => <Toast key={item.id} item={item} />)}
        </div>
    );
}
