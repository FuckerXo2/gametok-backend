// The avatar Shop: every item GameTok sells, in one list. The app builds its Shop from this (GET /api/avatar/items),
// so a new item needs no app update:
//   1. its 3D file on R2 (web-games/avatar/v1/assets/lite/): parts/<set>.glb for clothing and accessories, any
//      body (cage fitting), or hair/<style>.glb for a hairstyle
//   2. its picture: made by the server after the deploy (src/avatar-pictures.js); `pic`: its version, bump it to
//      have the picture made again (its 3D file changed)
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
// (the buzz cuts: each made for its own head)
export const HAIR_STYLES = { Hair_Buzzed: ['Buzz Cut', 0, 'male'], Hair_BuzzedFemale: ['Buzz Fade', 0, 'female'], Hair_SimpleParted: ['Side Part', 0],
  Hair_Long: ['Long Hair', 75], Hair_Buns: ['Space Buns', 75],
  // made from other models (games/avatar-editor/tools/add_hair.py), colourless: sold in every colour like the above
  Hair_LayeredShag: ['Layered Shag', 75], Hair_SpikyLayers: ['Spiky Layers', 75], Hair_MessyFringe: ['Messy Fringe', 75],
  Hair_BluntBob: ['Blunt Bob', 75, 'female'], Hair_SwoopUp: ['Swoop Up', 75], Hair_LowPonytail: ['Low Ponytail', 75, 'female'],
  Hair_AnimeSpikes: ['Anime Spikes', 75], Hair_LongWaves: ['Long Waves', 75, 'female'] };
// the colours a plain style is sold in now; the others were sold before and stay with whoever bought them (retired)
export const SOLD_HAIR_COLORS = ['Black', 'Brown', 'Blonde'];
// hair that comes in its own colours (add_hair.py --keep-colors: the avatar doesn't tint it): one item each, in the
// colour of the palette nearest it (that's what its brows take)
export const COLOURED_HAIR = { Hair_GoldenCurls: ['Golden Curls', 90, 'Blonde'], Hair_RibbonBow: ['Ribbon Bow', 100, 'Brown'],
  Hair_BraidedWaves: ['Braided Waves', 90, 'Blonde'], Hair_HighBun: ['High Bun', 80, 'Black'], Hair_PeachUpdo: ['Peach Updo', 100, 'Ginger'],
  Hair_PinkRedWaves: ['Pink & Red Waves', 100, 'Red'], Hair_LongBlack: ['Long Black Hair', 90, 'Black'], Hair_HighPonytail: ['High Ponytail', 90, 'Black'],
  Hair_SideSweptBob: ['Side-Swept Bob', 90, 'Blonde'], Hair_TwinTails: ['Twin Tails', 100, 'Blonde'], Hair_VolumePonytail: ['Volume Ponytail', 100, 'Blonde'],
  Hair_WhitePinkStreaks: ['White & Pink Streaks', 100, 'Blonde'], Hair_WhiteBun: ['White Bun', 90, 'Blonde'],
  Hair_RedSideSweep: ['Red Side Sweep', 100, 'Red'], Hair_ShortWavyBangs: ['Short Wavy Bangs', 90, 'Blonde'],
  // (sold in every colour before 2026-10-30: whoever bought one of those owns this)
  Hair_LongStraight: ['Long Straight', 90, 'Red'], Hair_AuburnLong: ['Long Centre Part', 90, 'Red'] };
export const ALL_HAIR = { ...HAIR_STYLES, ...COLOURED_HAIR };

const items = [];
const part = (slot, set, name, price, more) => items.push({ id: `${set}-${slot}`, kind: 'part', slot, set, name, price, ...more });

// hair: the plain styles in the colours sold now, taking turns with the ones in their own colours, so the same style
// never sits next to itself (each round has every plain style once, in a different colour each round)
const plainHair = (style, c) => {
  const [name, price, who] = HAIR_STYLES[style];
  return { id: `hair-${style}-${c}`, kind: 'hair', hair: style, hairColor: HAIR_COLORS[c], name: `${c.replace(/(.)([A-Z])/, '$1 $2')} ${name}`,
    price, ownedAs: `hair-${style}`, tab: 'body', sub: 'Hair', category: 'hair', focus: 'head', ...(who ? { for: who } : {}),
    ...(SOLD_HAIR_COLORS.includes(c) ? {} : { retired: true }) };
};
const PLAIN = Object.keys(HAIR_STYLES);
const rounds = SOLD_HAIR_COLORS.flatMap((_, k) => PLAIN.map((style, n) => plainHair(style, SOLD_HAIR_COLORS[(n + k) % SOLD_HAIR_COLORS.length])));
const natural = Object.entries(COLOURED_HAIR).map(([style, [name, price, c]]) => ({ id: `hair-${style}-${c}`, kind: 'hair', hair: style,
  hairColor: HAIR_COLORS[c], name, price, ownedAs: `hair-${style}`, tab: 'body', sub: 'Hair', category: 'hair', focus: 'head', for: 'female' }));
const every = Math.ceil(rounds.length / natural.length);
rounds.forEach((h, n) => { items.push(h); if (n % every === every - 1 && natural.length) items.push(natural.shift()); });
items.push(...natural);
for (const style of PLAIN) for (const c of Object.keys(HAIR_COLORS)) if (!SOLD_HAIR_COLORS.includes(c)) items.push(plainHair(style, c));
items.push({ id: 'beard', kind: 'beard', name: 'Full Beard', price: 40, tab: 'beards', sub: 'Beards', category: 'hair', focus: 'head', for: 'male' });

// street clothes, grown from the body (games/avatar-editor/tools/make_clothing.py): one item per garment and colour.
// Street files come one per body (parts/<set>_<Top|Legs|Feet>_<Male|Female>.glb, avatar-core.js SLOTS).
const FREE = ['Street_TeeWhite', 'Street_TeeBlack', 'Street_JeansBlue', 'Street_JeansBlack', 'Street_ShortsKhaki', 'Street_ShortsBlack', 'Street_SneakersWhite', 'Street_SneakersBlack'];
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

// clothing made from other models (games/avatar-editor/tools/add_clothing.py): one file each, fitted to every build.
// `for`: who it's cut for (the Shop's front page shows more of what fits you; anyone can buy and wear anything).
// A full piece (a dress, a jumpsuit, a set) is an outfit: it's worn on top and takes the legs (and sleeves) too.
const MADE = [
  // [set, slot, name, price, sub, for, full]
  ['Coat_LongBlack', 'top', 'Long Black Coat', 150, 'Jackets', 'male'], ['Coat_LongBrown', 'top', 'Long Brown Coat', 150, 'Jackets', 'male'],
  ['Coat_BlackLeather', 'top', 'Black Leather Coat', 150, 'Jackets', 'male'], ['Coat_RedLeather', 'top', 'Red Leather Coat', 140, 'Jackets', 'male'],
  ['Cloak_CrimsonCloud', 'top', 'Crimson Cloud Cloak', 160, 'Jackets'], ['Jacket_LeatherCrop', 'top', 'Cropped Leather Jacket', 90, 'Jackets', 'female'],
  ['Blazer_PastelPink', 'top', 'Pastel Pink Blazer', 100, 'Jackets', 'female'], ['Hoodie_Piano', 'top', 'Piano Hoodie', 90, 'Sweaters'],
  ['Armor_Warlord', 'legs', 'Warlord Armor', 180, 'Skirts', 'male'],
  ['Top_ChainedBlack', 'top', 'Chained Black Top', 70, 'Tops', 'female'], ['Top_LaceCrop', 'top', 'Lace-Up Crop Top', 60, 'Tops', 'female'],
  ['Top_PurrCrop', 'top', 'Make Me Purr Crop Top', 55, 'Tops', 'female'],
  ['Pants_OliveCargo', 'legs', 'Olive Cargo Pants', 80, 'Pants', 'male'], ['Pants_BlackLeather', 'legs', 'Black Leather Pants', 90, 'Pants', 'male'],
  ['Jeans_Camo', 'legs', 'Camo Jeans', 80, 'Pants'], ['Jeans_PinkBootcut', 'legs', 'Pink Bootcut Jeans', 75, 'Pants', 'female'],
  ['Pants_PinkVelour', 'legs', 'Pink Velour Sweatpants', 70, 'Pants', 'female'],
  ['Shorts_Denim', 'legs', 'Denim Shorts', 50, 'Shorts', 'female'], ['Shorts_LeatherHot', 'legs', 'Leather Hotpants', 50, 'Shorts', 'female'],
  ['Skirt_DenimRuffle', 'legs', 'Ruffled Denim Skirt', 60, 'Skirts', 'female'], ['Skirt_PlaidGothic', 'legs', 'Plaid Gothic Skirt', 60, 'Skirts', 'female'],
  ['Skirt_Pleated', 'legs', 'Navy Pleated Skirt', 55, 'Skirts', 'female'],
  ['Shoes_SkateGrey', 'feet', 'Grey Skate Shoes', 70, 'Shoes'], ['Boots_CamelFur', 'feet', 'Camel Fur Boots', 100, 'Shoes', 'female'],
  ['Boots_ThighHighBlack', 'feet', 'Black Thigh-High Heels', 110, 'Shoes', 'female'],
  ['Dress_Pinstripe', 'top', 'Pinstripe Dress', 130, '', 'female', true], ['Dress_BlueCorset', 'top', 'Corset Dress', 130, '', 'female', true],
  ['Dress_LeopardFur', 'top', 'Leopard Dress & Fur Coat', 160, '', 'female', true], ['Dress_OffShoulder', 'top', 'Off-Shoulder Sweater Dress', 140, '', 'female', true],
  ['Dress_RedFur', 'top', 'Red Fur Sweater Dress', 140, '', 'female', true], ['Dress_BlackPleated', 'top', 'Black Pleated Dress', 120, '', 'female', true],
  ['Kimono_Pink', 'top', 'Pink Kimono', 140, '', 'female', true], ['Kimono_Hakama', 'top', 'Hakama Kimono', 150, '', 'male', true],
  ['Robe_Red', 'top', 'Red Robe', 130, '', null, true], ['Jumpsuit_TieSuit', 'top', 'Suit Jumpsuit', 150, '', 'female', true],
  ['Outfit_LacedBodysuit', 'top', 'Laced Bodysuit & Skirt', 140, '', 'female', true], ['Outfit_TankJeans', 'top', 'Tank & Distressed Jeans', 120, '', 'female', true],
  ['Outfit_TeeDenimSkirt', 'top', 'Tee & Denim Mini', 110, '', 'female', true], ['Outfit_LeatherOveralls', 'top', 'Leather Overalls', 120, '', 'female', true],
  ['Outfit_LeatherBiker', 'top', 'Leather Biker Set', 170, '', 'male', true],
];
for (const [set, slot, name, price, sub, who, full] of MADE)
  part(slot, set, name, price, { tab: full ? 'outfits' : 'clothing', sub, category: slot === 'feet' ? 'shoes' : 'clothing',
    focus: full ? 'body' : slot === 'top' ? 'torso' : slot === 'legs' ? 'legs' : 'feet', plain: true,
    ...(full ? { clears: ['arms', 'legs'] } : slot === 'top' ? { clears: ['arms'] } : {}), ...(who ? { for: who } : {}) });
// a floor-length cloak is a jacket and a whole outfit: shown under both
for (const id of ['Cloak_CrimsonCloud-top']) items.find((i) => i.id === id).alsoTab = 'outfits';
// pictures made again: their 3D files changed (Kimono_Hakama refitted 2026-10-31)
for (const [id, v] of [['Kimono_Hakama-top', 2]]) items.find((i) => i.id === id).pic = v;

// (bundles of separate clothes as outfits were tried and dropped: an outfit is one whole piece, above. The `outfit`
// kind, described at the top, stays for old saved looks.)

// characters: No Rules FC's heroes, worn in every game (bought here or in the game: one purchase owns both)
export const CHARACTERS = { spiderman: 'Spyder-Man', baki: 'Bakki', flash: 'The Flazh', batman: 'Batmvn', lantern: 'Green Lanturn',
  goku: 'Gokv', vegeta: 'Vejeta', ironman: 'Iron Male', superman: 'Svperman', thor: 'Thur', yujiro: 'Yujirho', hulk: 'Hvlk' };
export const CHARACTER_PRICES = { spiderman: 500, baki: 500, flash: 500, batman: 500, lantern: 500, goku: 800, vegeta: 800, ironman: 800,
  superman: 800, thor: 800, yujiro: 1200, hulk: 1200 };
// a picture's version (the server renders it again: src/avatar-pictures.js); characters start at 3, their first
// server-made pictures (standing in the idle)
const PIC = {};
for (const [id, name] of Object.entries(CHARACTERS))
  items.push({ id: `char-${id}`, kind: 'character', character: id, name, price: CHARACTER_PRICES[id], ownedAs: `no-rules-fc:${id}`,
    tab: 'avatars', sub: '', category: 'clothing', focus: 'body', pic: PIC[id] || 3 });
// avatars sold only here (not No Rules FC heroes; in games you play as your own avatar): id -> [name, price].
// games/avatar-editor/ADDING_AVATARS.md; the file is games/avatar-editor/assets/lite/characters/<id>.glb
export const SHOP_CHARACTERS = {
};
for (const [id, [name, price]] of Object.entries(SHOP_CHARACTERS))
  items.push({ id: `char-${id}`, kind: 'character', character: id, name, price, tab: 'avatars', sub: '', category: 'clothing', focus: 'body', pic: PIC[id] || 3 });

export const ITEMS = items;
