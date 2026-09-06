import { MenuButton } from '../components/MenuButton.jsx';

// B1b. The roadmap calls this "a real deliverable, not boilerplate" - a statement
// in the author's own words about AI's role in the project, on record before anyone
// asks rather than explained defensively afterwards.
//
// PLACEHOLDER: the wording below is a stand-in written to the roadmap's description.
// It is Burn's statement to make, and should be replaced with his own text.
export function CreditsScreen({ onBack }) {
    return (
        <div className="fh-menu__panel">
            <h2 className="fh-menu__title">Credits</h2>

            <div className="fh-credits">
                <p>
                    <strong>FortHex</strong> 
                </p>
                <p>
                    Made by Mirza Musab (Burn). All Rights Reserved.
                </p>

                <h3>Use of AI</h3>
                <p>
                    All art assets, design, mechanics and concepts were created by human(s) and human(s) alone.
                </p>
                <p>
                    The Assistance of Artificial Intelligence (LLMs) such as Google's Gemini and Anthropic's Claude were used as implementation tools.
                </p>
            </div>

            <MenuButton variant="cancel" className="fh-menu__back" onClick={onBack}>Back</MenuButton>
        </div>
    );
}
