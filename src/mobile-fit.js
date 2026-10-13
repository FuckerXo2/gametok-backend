// Which devices a game is shown on: 'all' (phones + desktop) or 'desktop'.
// Two signals decide it: how the game is controlled (keyboard-only games can't be played on a
// phone) and how much it downloads (mobile data, load time, phone memory). The developer's own
// choice wins, except that a game over the hard size limit is never shown on phones.

export const SOFT_LIMIT_BYTES = 15 * 1024 * 1024;  // warn; ranked lower in phone feeds
export const HARD_LIMIT_BYTES = 50 * 1024 * 1024;  // desktop only, whatever the developer picked

export const formatMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

// 'all' | 'desktop' | null (let GameTok decide). Accepts the form's values and a few synonyms.
export function platformChoiceFrom(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['all', 'mobile', 'phone', 'phones', 'both'].includes(v)) return 'all';
  if (['desktop', 'desktop-only', 'desktop_only'].includes(v)) return 'desktop';
  return null;
}

// controls: 'touch' (listens for taps/clicks/pointer), 'keyboard' (keys only), 'none' or null
// (not measured yet). bytes: total download, or null.
export function decidePlatform({ choice = null, bytes = null, controls = null } = {}) {
  const reasons = [];
  const warnings = [];
  const size = bytes ? formatMB(bytes) : null;
  const tooBig = bytes != null && bytes > HARD_LIMIT_BYTES;
  const large = bytes != null && bytes > SOFT_LIMIT_BYTES;

  if (tooBig) {
    reasons.push(`Your game downloads ${size}, over the ${formatMB(HARD_LIMIT_BYTES)} limit for phones. Compress images and audio or trim the build to reach phones.`);
  } else if (large) {
    warnings.push(`Your game downloads ${size}. Phone players on mobile data may skip it, so it's shown lower in phone feeds. Under ${formatMB(SOFT_LIMIT_BYTES)} is best.`);
  }
  if (controls === 'keyboard') {
    // You chose phones anyway: shown on phones, but say what we saw.
    (choice === 'all' ? warnings : reasons).push('Your game only responds to the keyboard, so phone players can\'t play it. Add touch controls (or tap/click handling) to reach phones.');
  }

  let platform;
  let source;
  if (tooBig) {
    platform = 'desktop';
    source = choice === 'desktop' ? 'developer' : 'detected';
  } else if (choice) {
    platform = choice;
    source = 'developer';
  } else {
    platform = reasons.length ? 'desktop' : 'all';
    source = controls || bytes != null ? 'detected' : 'default';
  }
  return { platform, source, reasons, warnings };
}

// Phone requests come from the app (okhttp on Android, CFNetwork on iOS) or a mobile browser.
// Clients may say so explicitly with X-GameTok-Device / ?device=.
export function isPhoneRequest(req) {
  const explicit = String(req.headers['x-gametok-device'] || req.query?.device || '').toLowerCase();
  if (explicit) return explicit === 'phone' || explicit === 'tablet' || explicit === 'mobile';
  return /Android|iPhone|iPad|iPod|Mobile|okhttp|CFNetwork|Dalvik|Expo/i.test(String(req.headers['user-agent'] || ''));
}

// SQL to append to a feed's WHERE clause (games aliased as g): hides desktop-only games on phones.
export const platformSql = (req) => (isPhoneRequest(req) ? ` AND (g.platform IS NULL OR g.platform <> 'desktop')` : '');
