// The avatar Shop: every item GameTok sells, in one list. The app builds its Shop from this (GET /api/avatar/items),
// so a new item needs no app update:
//   1. its 3D file on R2 (web-games/avatar/v1/assets/lite/): parts/<set>.glb for clothing and accessories, any
//      body (cage fitting), or hair/<style>.glb for a hairstyle
//   2. its picture: web-games/avatar/assets/thumbs/<item id>.webp (games/avatar-editor/tools/thumbs.html); `pic`: its
//      version, bumped when the picture changes
//   3. a line below
// An item is data, never code. kind says what wearing it does:
//   part    puts `set` on `slot` (head top arms legs feet acc); `clears`: slots it replaces (a top's own sleeves);
//           `plain`: its colours are in the file (the slot's tint goes back to white)
//   hair    a hairstyle in one colour (`hair`, `hairColor`)        beard  the beard (it takes the hair's colour)
//   outfit  a whole look (`parts`: slot -> set); it costs what its unowned pieces cost, bought piece by piece
//   character  a whole character worn instead of your own avatar (`character`: its file, characters/<id>.glb,
//           rigged to Mixamo's skeleton); your own look is kept for when you take it off. `ownedAs`: the same
//           character bought inside a game (No Rules FC's heroes), which owns this too, and the other way round
// tab / sub: where the Shop shows it (gametok/src/avatar/catalog.ts TABS). focus: what the camera looks at.

export const SLOTS = ['head', 'top', 'arms', 'legs', 'feet', 'acc'];

// Hair is sold by colour, like Roblox: each style in each colour is its own item. The colourless ids
// (hair-<style>) are what was sold before colours: older apps still buy them, and owning one owns every colour.
export const HAIR_COLORS = { Black: '#141110', Brown: '#5a3420', LightBrown: '#9a6634', Blonde: '#e0b45e', Ginger: '#b4521f', Red: '#d8344a', Blue: '#3f7bff' };
export const HAIR_STYLES = { Hair_Buzzed: ['Buzz Cut', 0], Hair_BuzzedFemale: ['Buzz Fade', 0], Hair_SimpleParted: ['Side Part', 0],
  Hair_Long: ['Long Hair', 75], Hair_Buns: ['Space Buns', 75] };

const items = [];
const part = (slot, set, name, price, more) => items.push({ id: `${set}-${slot}`, kind: 'part', slot, set, name, price, ...more });

// hair
for (const [style, [name, price]] of Object.entries(HAIR_STYLES))
  for (const [c, hex] of Object.entries(HAIR_COLORS))
    items.push({ id: `hair-${style}-${c}`, kind: 'hair', hair: style, hairColor: hex, name: `${c.replace(/(.)([A-Z])/, '$1 $2')} ${name}`,
      price, ownedAs: `hair-${style}`, tab: 'body', sub: 'Hair', category: 'hair', focus: 'head' });
items.push({ id: 'beard', kind: 'beard', name: 'Full Beard', price: 40, tab: 'beards', sub: 'Beards', category: 'hair', focus: 'head' });

// street clothes, grown from the body (games/avatar-editor/tools/make_clothing.py): one item per garment and colour.
// Street files come one per body (parts/<set>_<Top|Legs|Feet>_<Male|Female>.glb, avatar-core.js SLOTS).
const FREE = ['Street_TeeWhite', 'Street_TeeBlack', 'Street_JeansBlue', 'Street_JeansBlack', 'Street_ShortsKhaki', 'Street_SneakersWhite', 'Street_SneakersBlack'];
const STREET = [
  ['top', 'Tee', 'Tee', 50, 'T-Shirts', ['White', 'Black', 'Red', 'Green']], ['top', 'Sweater', 'Sweater', 75, 'Sweaters', ['Grey', 'Navy', 'Cream']],
  ['legs', 'Jeans', 'Jeans', 75, 'Pants', ['Blue', 'Black']], ['legs', 'Shorts', 'Shorts', 40, 'Shorts', ['Khaki', 'Black']],
  ['feet', 'Sneakers', 'Sneakers', 60, 'Shoes', ['White', 'Black', 'Red']],
];
const STREET_LOOK = { top: ['clothing', 'torso'], legs: ['clothing', 'legs'], feet: ['shoes', 'feet'] };
for (const [slot, g, name, price, sub, colours] of STREET) for (const c of colours) {
  const set = `Street_${g}${c}`;
  part(slot, set, `${c} ${name}`, FREE.includes(set) ? 0 : price, { tab: 'clothing', sub, category: STREET_LOOK[slot][0], focus: STREET_LOOK[slot][1],
    plain: true, ...(slot === 'top' ? { clears: ['arms'] } : {}) });
}

// the fantasy sets (Quaternius), sold piece by piece
const SETS = [['Male_Peasant', 'Peasant', 50], ['Male_Ranger', 'Ranger', 75], ['Female_Peasant', 'Peasant II', 50], ['Female_Ranger', 'Ranger II', 75]];
const PIECES = [['top', 'Top', 'clothing', 'torso', 'clothing', 'Shirts'], ['arms', 'Sleeves', 'clothing', 'torso', 'clothing', 'Shirts'],
  ['legs', 'Pants', 'clothing', 'legs', 'clothing', 'Pants'], ['feet', 'Boots', 'shoes', 'feet', 'clothing', 'Shoes'],
  ['head', 'Hood', 'accessories', 'head', 'accessories', 'Hats', true], ['acc', 'Pauldron', 'accessories', 'torso', 'accessories', 'Shoulders', true]];
for (const [set, name, price] of SETS) for (const [slot, piece, category, focus, tab, sub, rangerOnly] of PIECES)
  if (!rangerOnly || set.endsWith('_Ranger')) part(slot, set, `${name} ${piece}`, price, { tab, sub, category, focus });

// outfits (Roblox's "Avatars"): whole looks, made of the items above. Pictures: outfit-<id>.webp (tools/thumbs.html OUTFITS)
const OUTFITS = [
  ['StreetClassic', 'Street Classic', { top: 'Street_TeeWhite', legs: 'Street_JeansBlue', feet: 'Street_SneakersWhite' }],
  ['AllBlack', 'All Black', { top: 'Street_TeeBlack', legs: 'Street_JeansBlack', feet: 'Street_SneakersBlack' }],
  ['Summer', 'Summer', { top: 'Street_TeeRed', legs: 'Street_ShortsKhaki', feet: 'Street_SneakersRed' }],
  ['Cozy', 'Cozy', { top: 'Street_SweaterCream', legs: 'Street_JeansBlue', feet: 'Street_SneakersWhite' }],
  ['NightOut', 'Night Out', { top: 'Street_SweaterNavy', legs: 'Street_JeansBlack', feet: 'Street_SneakersBlack' }],
  ...SETS.map(([set, name]) => [set.replace('_', ''), name, { top: set, arms: set, legs: set, feet: set }]),
];
for (const [id, name, parts] of OUTFITS)
  items.push({ id: `outfit-${id}`, kind: 'outfit', name, price: 0, parts, tab: 'outfits', sub: '', category: 'clothing', focus: 'body' });

// characters: No Rules FC's heroes, worn in every game (bought here or in the game: one purchase owns both)
export const CHARACTERS = { spiderman: 'Spyder-Man', baki: 'Bakki', flash: 'The Flazh', batman: 'Batmvn', lantern: 'Green Lanturn',
  goku: 'Gokv', vegeta: 'Vejeta', ironman: 'Iron Male', superman: 'Svperman', thor: 'Thur', yujiro: 'Yujirho', hulk: 'Hvlk' };
export const CHARACTER_PRICES = { spiderman: 500, baki: 500, flash: 500, batman: 500, lantern: 500, goku: 800, vegeta: 800, ironman: 800,
  superman: 800, thor: 800, yujiro: 1200, hulk: 1200 };
// a picture's version: bump it when the picture changes (phones keep pictures a day)
const PIC = { thor: 2 };
for (const [id, name] of Object.entries(CHARACTERS))
  items.push({ id: `char-${id}`, kind: 'character', character: id, name, price: CHARACTER_PRICES[id], ownedAs: `no-rules-fc:${id}`,
    tab: 'avatars', sub: '', category: 'clothing', focus: 'body', ...(PIC[id] ? { pic: PIC[id] } : {}) });

export const ITEMS = items;
