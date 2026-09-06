import { useState, useSyncExternalStore } from 'react';
import { MenuButton } from '../components/MenuButton.jsx';
import { Subscribe, GetSnapshot, StartHosting, StartJoining, AcceptReply, Reset } from '../manual-store.js';

// The serverless path. Two people, two codes, no FortHex server involved at any point.
//
// Written for the moment it is actually reached: something is down or blocked, and the
// player is trying to salvage a game with a friend over whatever chat they already have
// open. So the screen says what to DO - copy this, send it, paste theirs - and never
// mentions offers, answers, ICE or peers.
//
// The step order is forced by WebRTC and cannot be rearranged: the host produces a code
// out of nothing, the guest answers it, the host accepts the answer. That is why "Join"
// asks for a code BEFORE it starts anything - a guest has nothing to offer until it has
// seen the host's, so a screen that opened with "here is your code" would be lying.
//
// LAYOUT RULE for this screen: one panel, one box, everything inside it. The buttons
// belong to the box they act on, so they live in it - a row of controls floating below a
// bordered card reads as belonging to the page rather than to the thing above them.

function CodeBox({ label, value, hint }) {
    const [copied, setCopied] = useState(false);

    const Copy = () => {
        // Clipboard access can be refused or absent (an insecure origin, a locked-down
        // browser). The textarea stays selectable as the fallback, because a code that
        // cannot leave this screen is no use at all.
        if (!navigator.clipboard || !navigator.clipboard.writeText) return;
        navigator.clipboard.writeText(value)
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
            .catch(() => { /* select it by hand */ });
    };

    return (
        <div className="fh-direct__block">
            <label className="fh-profile__label">{label}</label>
            <textarea
                className="fh-direct__code"
                readOnly
                rows={3}
                value={value}
                onFocus={(e) => e.target.select()}
            />
            <div className="fh-direct__row">
                <MenuButton className="fh-direct__copy" onClick={Copy}>
                    {copied ? 'Copied' : 'Copy'}
                </MenuButton>
                {hint && <span className="fh-direct__hint">{hint}</span>}
            </div>
        </div>
    );
}

// One panel, one box, everything inside it - see the layout rule above.
function Panel({ title, blurb, warning, children, actions }) {
    return (
        <div className="fh-menu__panel">
            <h2 className="fh-menu__title">{title}</h2>

            <div className="fh-modal fh-modal--narrow fh-direct">
                <div className="fh-modal__body fh-direct__body">
                    {blurb && <p className="fh-direct__blurb">{blurb}</p>}
                    {warning && <p className="fh-direct__warning">{warning}</p>}
                    {children}
                    <div className="fh-direct__actions">{actions}</div>
                </div>
            </div>
        </div>
    );
}

export function DirectConnectScreen({ onBack, onClose }) {
    const manual = useSyncExternalStore(Subscribe, GetSnapshot);

    const [fog, setFog] = useState(false);
    const [picking, setPicking] = useState(null);   // null | 'join' - before anything starts
    const [hostCode, setHostCode] = useState('');   // what the guest pastes in
    const [replyCode, setReplyCode] = useState(''); // what the host pastes in
    const [complaint, setComplaint] = useState(null);

    const Leave = () => { Reset(); setPicking(null); onBack(); };

    // Connected means the board is live behind this screen. Get out of the way.
    if (manual.phase === 'connected') {
        onClose();
        return null;
    }


    // --- picking a role ---
    if (!manual.role && picking !== 'join') {
        return (
            <Panel
                title="Direct Connect"
                blurb="Play with one other person without a server. One of you hosts, the other joins, and you swap two short codes over any chat you like."
                warning="Recommended only if the FortHex servers are offline."
                actions={(
                    <>
                        <MenuButton onClick={() => StartHosting({ fogOfWar: fog })}>Host a match</MenuButton>
                        <MenuButton onClick={() => setPicking('join')}>Join a match</MenuButton>
                        <MenuButton variant="cancel" onClick={Leave}>Back</MenuButton>
                    </>
                )}
            >
                <label className="fh-profile__consent">
                    <input type="checkbox" checked={fog} onChange={(e) => setFog(e.target.checked)} />
                    <span>Fog of war</span>
                </label>
                <p className="fh-direct__note">
                    Fog is the host's choice and fixed once the match starts. Whoever hosts
                    runs the match - it ends if they close the game.
                </p>
            </Panel>
        );
    }

    // --- joining, step one: their code ---
    if (!manual.role && picking === 'join') {
        return (
            <Panel
                title="Join a Match"
                actions={(
                    <>
                        <MenuButton
                            disabled={!hostCode.trim()}
                            onClick={() => { setComplaint(null); StartJoining(hostCode.trim()); }}
                        >
                            Continue
                        </MenuButton>
                        <MenuButton variant="cancel" onClick={() => { setPicking(null); setHostCode(''); }}>
                            Back
                        </MenuButton>
                    </>
                )}
            >
                <div className="fh-direct__block">
                    <label className="fh-profile__label" htmlFor="fhHostCode">
                        Paste the code the host sent you
                    </label>
                    <textarea
                        id="fhHostCode"
                        className="fh-direct__code"
                        rows={3}
                        value={hostCode}
                        placeholder="FH2-…"
                        autoFocus
                        onChange={(e) => { setHostCode(e.target.value); setComplaint(null); }}
                    />
                </div>
                {(complaint || manual.error) && (
                    <p className="fh-direct__error">{complaint || manual.error}</p>
                )}
            </Panel>
        );
    }

    // --- hosting ---
    if (manual.role === 'host') {
        return (
            <Panel
                title="Hosting"
                actions={(
                    <>
                        <MenuButton
                            disabled={!replyCode.trim() || manual.phase === 'connecting'}
                            onClick={() => setComplaint(AcceptReply(replyCode.trim()))}
                        >
                            {manual.phase === 'connecting' ? 'Connecting…' : 'Connect'}
                        </MenuButton>
                        <MenuButton variant="cancel" onClick={Leave}>Cancel</MenuButton>
                    </>
                )}
            >
                {manual.myCode
                    ? (
                        <CodeBox
                            label="1. Send this code to the other player"
                            value={manual.myCode}
                            hint="Any chat will do."
                        />
                    )
                    : <p className="fh-direct__note">Preparing your code…</p>}

                <div className="fh-direct__block">
                    <label className="fh-profile__label" htmlFor="fhReplyCode">
                        2. Paste the code they send back
                    </label>
                    <textarea
                        id="fhReplyCode"
                        className="fh-direct__code"
                        rows={3}
                        value={replyCode}
                        placeholder="FH2-…"
                        onChange={(e) => { setReplyCode(e.target.value); setComplaint(null); }}
                    />
                </div>

                {(complaint || manual.error) && (
                    <p className="fh-direct__error">{complaint || manual.error}</p>
                )}
            </Panel>
        );
    }

    // --- joining, step two: your reply ---
    return (
        <Panel
            title="Joining"
            actions={<MenuButton variant="cancel" onClick={Leave}>Cancel</MenuButton>}
        >
            {manual.myCode
                ? (
                    <CodeBox
                        label="2. Send this code back to the host"
                        value={manual.myCode}
                        hint="Then wait - the match starts on its own."
                    />
                )
                : <p className="fh-direct__note">Reading their code…</p>}

            {manual.error && <p className="fh-direct__error">{manual.error}</p>}
        </Panel>
    );
}
