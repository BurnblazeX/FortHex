// localStorage keys. Client-only: a Worker has no localStorage, so these
// have no reason to be shared with the server engine. Not called out in the
// A1 guide's config.js triage (§4) — flagging as an addition, not a silent move.
const SETTINGS_STORAGE_KEY = 'forthex_user_settings';
const COLOR_PREF_STORAGE_KEY = 'forthex_color_preferences';
const MAP_MAKER_AUTOSAVE_KEY = 'forthex_map_maker_autosave';
