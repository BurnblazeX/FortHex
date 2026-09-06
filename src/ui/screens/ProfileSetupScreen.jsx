import { useState } from 'react';
import { MenuButton } from '../components/MenuButton.jsx';
import { CreateLocalProfile, GetAvatars, Instruct } from '../bridge.js';

// The React rebuild of A5's vanilla consent modal, plus the preset-portrait picker
// B1 adds. The functional contract carried over unchanged:
//
//   - consent is captured AT CREATION, passed into GetOrCreateProfile, never set
//     afterwards - so a profile is never briefly stored in an unconsented state;
//   - declining creates NOTHING, not even a consent:false profile;
//   - Continue is gated on the checkbox, and the write re-checks it rather than
//     trusting the disabled attribute.
export function ProfileSetupScreen({ onDone, onBack }) {
    const avatars = GetAvatars();
    const [name, setName] = useState('');
    const [avatar, setAvatar] = useState(avatars[0].key);
    const [agreed, setAgreed] = useState(false);

    const Accept = () => {
        if (!agreed) return; // The rule that matters, enforced where the write happens.
        const profile = CreateLocalProfile(name, true, avatar);
        Instruct('Profile created for ' + profile.name + '.', 2500);
        onDone(profile);
    };

    return (
        <div className="fh-menu__panel">
            <div className="fh-profile">
                <h2 className="fh-menu__title" style={{ textAlign: 'center' }}>
                    Set up your online profile
                </h2>
                <p className="fh-menu__subtitle">
                    Stored on this device only. No account, no password, nothing to remember.
                </p>

                <label className="fh-profile__label" htmlFor="fhProfileName">Display name</label>
                <input
                    id="fhProfileName"
                    className="fh-profile__input"
                    type="text"
                    maxLength={24}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Player"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                />

                <span className="fh-profile__label">Portrait</span>
                <div className="fh-avatars">
                    {avatars.map(option => (
                        <button
                            key={option.key}
                            type="button"
                            aria-pressed={avatar === option.key}
                            className={'fh-avatar' + (avatar === option.key ? ' fh-avatar--selected' : '')}
                            onClick={() => setAvatar(option.key)}
                        >
                            <img src={option.src} alt="" />
                            {option.label}
                        </button>
                    ))}
                </div>

                <div className="fh-profile__terms">
                    <p className="fh-profile__terms-warning">PLACEHOLDER - not final legal text.</p>
                    <p>
                        Going online creates a profile on this device: a display name you choose and a
                        randomly generated identifier. It is not an account. There is no password, nothing
                        is verified against a server, and it cannot be recovered - clearing your browser
                        data or playing in a different browser produces a new profile.
                    </p>
                    <p>
                        <strong>Match archiving.</strong> With your agreement, matches you play that involve
                        a human - against another player or against the AI - may be recorded as a log of the
                        moves made, tagged with your profile identifier. This is intended to power a future
                        replay feature and to study how the game is actually played.
                    </p>
                    <p>
                        <strong>Balance data.</strong> With the same agreement, aggregate information about
                        matches - which units win, which upgrades get chosen, how long games run - may be
                        used to balance the game.
                    </p>
                    <p>
                        <strong>Nothing is sent anywhere yet.</strong> There is no central server at this
                        stage of development. Anything recorded stays on your device.
                    </p>
                    <p>
                        You can change this answer later. Declining means no profile is created and you can
                        keep playing Singleplayer and Local Multiplayer exactly as before.
                    </p>
                </div>

                <label className="fh-profile__consent">
                    <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                    />
                    <span>I agree to the Terms of Service.</span>
                </label>

                <div className="fh-menu__row">
                    <MenuButton disabled={!agreed} onClick={Accept}>Continue</MenuButton>
                    <MenuButton variant="cancel" onClick={onBack}>Cancel</MenuButton>
                </div>
            </div>
        </div>
    );
}
