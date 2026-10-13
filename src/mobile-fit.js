// Where a game is shown on phones ("Works on"):
//   'all'     — the home feed and Explore (light, quick to load, playable at once)
//   'explore' — Explore, search and categories, not the swipe feed (heavy or slow to load)
//   'desktop' — not on phones (keyboard-only, or too big to download on a phone)
// Desktop web shows every game everywhere. Signals: the game's controls, how much it downloads
// and how long it takes to load. The developer's choice wins, except that size caps it: over the
// feed limit can't be in the feed, over the hard limit can't be on phones.

export const FEED_LIMIT_BYTES = 15 * 1024 * 1024;  // over this: Explore only on phones
export const HARD_LIMIT_BYTES = 50 * 1024 * 1024;  // over this: desktop only
export const FEED_LOAD_MS = 8000;                  // slower to load than this: Explore only

export const formatMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

const RANK = { all: 0, explore: 1, desktop: 2 };
const worst = (a, b) => (RANK[a] >= RANK[b] ? a : b);

// 'all' | 'explore' | 'desktop' | null (let GameTok decide). Accepts the form's values and synonyms.
export function platformChoiceFrom(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['all', 'feed', 'mobile', 'phone', 'phones', 'both'].includes(v)) return 'all';
  if (['explore', 'explore-only', 'explore_only'].includes(v)) return 'explore';
  if (['desktop', 'desktop-only', 'desktop_only'].includes(v)) return 'desktop';
  return null;
}

// controls: 'touch' (listens for taps/clicks/pointer), 'keyboard' (keys only), 'none' or null
// (not measured yet). bytes: total download, or null. loadMs: time to load, or null.
export function decidePlatform({ choice = null, bytes = null, controls = null, loadMs = null } = {}) {
  const reasons = [];   // why it isn't in the feed / on phones
  const warnings = [];  // what we saw that the developer's choice overrides
  const size = bytes ? formatMB(bytes) : null;

  // Size is a cap the developer can't lift.
  let cap = 'all';
  if (bytes != null && bytes > HARD_LIMIT_BYTES) {
    cap = 'desktop';
    reasons.push(`Your game downloads ${size}, over the ${formatMB(HARD_LIMIT_BYTES)} limit for phones. Compress images and audio or trim the build to reach phones.`);
  } else if (bytes != null && bytes > FEED_LIMIT_BYTES) {
    cap = 'explore';
    reasons.push(`Your game downloads ${size}, too much for the swipe feed on mobile data, so phones see it in Explore. Under ${formatMB(FEED_LIMIT_BYTES)} gets it into the home feed.`);
  }

  // What the game itself suggests; the developer's choice overrides these.
  let detected = 'all';
  const notes = [];
  if (controls === 'keyboard') {
    detected = 'desktop';
    notes.push('Your game only responds to the keyboard, so phone players can\'t play it. Add touch controls (or tap/click handling) to reach phones.');
  } else if (loadMs != null && loadMs > FEED_LOAD_MS) {
    detected = 'explore';
    notes.push(`Your game took ${(loadMs / 1000).toFixed(0)} s to load, too slow for the swipe feed, so phones see it in Explore. Load in under ${FEED_LOAD_MS / 1000} s to reach the home feed.`);
  }
  (choice ? warnings : reasons).push(...notes);

  const platform = worst(choice || detected, cap);
  const source = choice && platform === choice ? 'developer'
    : (controls || bytes != null || loadMs != null ? 'detected' : 'default');
  return { platform, source, reasons, warnings };
}

// Phone requests come from the app (okhttp on Android, CFNetwork on iOS) or a mobile browser.
// Clients may say so explicitly with X-GameTok-Device / ?device=.
export function isPhoneRequest(req) {
  const explicit = String(req.headers['x-gametok-device'] || req.query?.device || '').toLowerCase();
  if (explicit) return explicit === 'phone' || explicit === 'tablet' || explicit === 'mobile';
  return /Android|iPhone|iPad|iPod|Mobile|okhttp|CFNetwork|Dalvik|Expo/i.test(String(req.headers['user-agent'] || ''));
}

// SQL to append to a WHERE clause (games aliased as g) for phone requests: Explore lists hide
// desktop-only games; the home feed (feed: true) also hides Explore-only ones.
export function platformSql(req, { feed = false } = {}) {
  if (!isPhoneRequest(req)) return '';
  return feed
    ? ` AND (g.platform IS NULL OR g.platform = 'all')`
    : ` AND (g.platform IS NULL OR g.platform <> 'desktop')`;
}
