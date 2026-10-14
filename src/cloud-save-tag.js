// Games GameTok hosts load gametok.co/cloud-save.js first thing, so a signed-in player's progress
// is saved to their account on the website (gametok-landing/public/cloud-save.js). External games
// can't be changed this way; in the app, cloud save is injected into every game instead.
export const CLOUD_SAVE_SRC = 'https://gametok.co/cloud-save.js';
const TAG = `<script src="${CLOUD_SAVE_SRC}"></script>`;

// Returns the page with the cloud-save script added at the top of <head> (before the game's own
// scripts can read their saves), or unchanged if it's already there. Accepts and returns a string
// or a Buffer, matching the input.
export function withCloudSave(page) {
  const isBuffer = Buffer.isBuffer(page) || page instanceof Uint8Array;
  const html = isBuffer ? Buffer.from(page).toString('utf8') : String(page);
  if (html.includes(CLOUD_SAVE_SRC)) return page;
  let out;
  if (/<head[^>]*>/i.test(html)) out = html.replace(/<head[^>]*>/i, (m) => `${m}${TAG}`);
  else if (/<html[^>]*>/i.test(html)) out = html.replace(/<html[^>]*>/i, (m) => `${m}<head>${TAG}</head>`);
  else out = TAG + html;
  return isBuffer ? Buffer.from(out, 'utf8') : out;
}
