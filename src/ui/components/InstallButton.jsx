import { useEffect, useState } from 'react';
import { CanInstall, Install } from '../bridge.js';

// The square green icon in the bottom-left corner, back where it was.
//
// The one thing that changed: it lives in the React menu tree now, so it exists only
// while the menu is up. It used to be a plain element in index.html with
// `position: fixed`, which meant it sat over the board for the whole match as well.
// Unmounting is what keeps it off the game screen; there is no visibility flag to get
// out of sync.
//
// What it does is install FortHex as an app, not download a file. The name is historical
// (it replaced a single-file HTML download) and worth keeping, because "install" is not
// what anyone is looking for when they want to keep the game.
export function InstallButton() {
    // `beforeinstallprompt` fires at most once and can land either side of this
    // mounting, so the answer is read now AND listened for.
    const [installable, setInstallable] = useState(CanInstall());

    useEffect(() => {
        const Update = () => setInstallable(CanInstall());
        window.addEventListener('forthex-installable', Update);
        window.addEventListener('appinstalled', Update);
        return () => {
            window.removeEventListener('forthex-installable', Update);
            window.removeEventListener('appinstalled', Update);
        };
    }, []);

    return (
        <button
            type="button"
            className="fh-install"
            disabled={!installable}
            title={installable
                ? 'Install FortHex as an app. It works offline once installed.'
                : 'Your browser has not offered an install for this page, or it is already installed.'}
            onClick={() => { Install(); }}
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span className="fh-install__label">Download Game</span>
        </button>
    );
}
