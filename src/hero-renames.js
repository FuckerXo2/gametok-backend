// The heroes' ids before they were renamed (2026-11-16): old id -> new id. Anything saved or sent under an old id
// (owned items, the character worn, saved looks, an old app buying 'char-<old>') is read as the new one.
export const HERO_RENAMED = {
  baki: 'bako', yujiro: 'yujin', hulk: 'bulk', goku: 'koku', vegeta: 'vegar', superman: 'supremo', ironman: 'ironclad',
  thor: 'thorn', flash: 'flare', batman: 'nightbat', rambo: 'ramrod', lantern: 'lanthorn', spiderman: 'webster',
};
export const heroId = (id) => (typeof id === 'string' && HERO_RENAMED[id]) || id;
// an item id: 'char-<hero>' or '<game>:<hero>'
export function itemId(id) {
  if (typeof id !== 'string') return id;
  let m = /^char-(\w+)$/.exec(id);
  if (m && HERO_RENAMED[m[1]]) return `char-${HERO_RENAMED[m[1]]}`;
  m = /^([\w-]+):(\w+)$/.exec(id);
  if (m && HERO_RENAMED[m[2]]) return `${m[1]}:${HERO_RENAMED[m[2]]}`;
  return id;
}
