// Play orientation for generated games.
//
// The app is portrait-locked at the OS level and always will be — a landscape game is played by
// rotating the WebView's *content* 90° inside the portrait feed card, so the player turns the phone
// while the OS never does. That means the game is simply handed a landscape viewport and needs no
// runtime orientation awareness of its own; everything hinges on this one value being carried
// faithfully from the Forge picker → generation prompt → sandbox viewport → DB → feed.
//
// Orientation is immutable after generation. The edit and remix paths read it back off the
// ai_games row rather than accepting it from a client, so a wish-edit can never silently flip a
// landscape game to portrait.

export const ORIENTATIONS = ['portrait', 'landscape'];

export const DEFAULT_ORIENTATION = 'portrait';

/** Coerce anything (client body, DB column, job payload) to a valid orientation. */
export function normalizeOrientation(value) {
    const candidate = String(value || '').trim().toLowerCase();
    return ORIENTATIONS.includes(candidate) ? candidate : DEFAULT_ORIENTATION;
}

export function isLandscape(value) {
    return normalizeOrientation(value) === 'landscape';
}

/**
 * The viewport the sandbox verifies at — the portrait numbers transposed, so a landscape game is
 * checked against exactly the box it will occupy once the feed card rotates it.
 */
export function viewportFor(orientation) {
    return isLandscape(orientation)
        ? { width: 844, height: 390 }
        : { width: 390, height: 844 };
}
