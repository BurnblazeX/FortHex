// The FORTHEX wordmark, shared by the main menu and the in-game title.
//
// Plain white, no outline. It stays SVG rather than reverting to styled text for
// one reason: this way a single CSS rule (`.fh-wordmark text` in css/main.css)
// paints both this component and the copy inlined in index.html, so they cannot
// drift - and reinstating an outline later is a stroke plus stroke-linejoin: miter
// in that rule, not a change of approach. The viewBox also scales the lettering
// with the element rather than needing a font-size clamp.
//
// Nothing paint-related belongs on the attributes below: var() does not resolve in
// an SVG presentation attribute, so a token-valued fill would silently render black.
export function Wordmark({ className = '', onClick = null, title = null }) {
    const svg = (
        <svg
            className={('fh-wordmark ' + className).trim()}
            viewBox="0 0 660 110"
            role="img"
            aria-label="FortHex"
        >
            <text x="330" y="84" textAnchor="middle">FORTHEX</text>
        </svg>
    );

    if (!onClick) return svg;

    // A real <button> rather than a click handler on the SVG: the shortcut has to be
    // reachable by keyboard and announce itself, and a clickable graphic does neither.
    return (
        <button type="button" className="fh-wordmark-button" onClick={onClick} title={title || undefined}>
            {svg}
        </button>
    );
}
