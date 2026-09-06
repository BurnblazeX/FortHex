// Reuses .action-button from css/main.css deliberately: B4 adopts React for new
// screens without restyling what exists, so the menu should look like the rest of
// the game, not like a second design. Candidates F2 restyles both together.
export function MenuButton({ variant, className = '', children, ...rest }) {
    const classes = ['action-button'];
    if (variant === 'cancel') classes.push('action-button-cancel');
    if (className) classes.push(className);

    return (
        <button type="button" className={classes.join(' ')} {...rest}>
            {children}
        </button>
    );
}
