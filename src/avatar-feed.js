// The Shop's front page (the app's All tab, "Recommended For You"): the order its items come in. Decided here, so
// it can get smarter (what you look at, buy, what's selling) without an app update.
// For now: every kind of item in turn (characters, outfits, clothes, hair, …) so it never reads as one long row of
// one thing, a couple of colours of each hairstyle rather than all of them, reshuffled every few hours and
// differently for each person.
import crypto from 'crypto';
import { ITEMS } from './avatar-items.js';

const SHUFFLE_HOURS = 6;
const HAIR_COLOURS_SHOWN = 2;

// a repeatable random number generator from a seed (the same person in the same few hours: the same order)
function random(seed) {
  let h = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(list, rnd) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// what kind of thing an item is, for taking turns
const KIND = (i) => (i.kind === 'character' ? 'characters' : i.kind === 'outfit' ? 'outfits' : i.kind === 'hair' || i.kind === 'beard' ? 'hair' : i.tab === 'accessories' ? 'accessories' : i.category);

export function feedFor(userId) {
  const rnd = random(`${userId || 'guest'}:${Math.floor(Date.now() / 36e5 / SHUFFLE_HOURS)}`);
  // hair: a couple of colours of each style
  const hairByStyle = {};
  for (const i of ITEMS) if (i.kind === 'hair') (hairByStyle[i.hair] ||= []).push(i);
  const hair = Object.values(hairByStyle).flatMap((cols) => shuffle(cols, rnd).slice(0, HAIR_COLOURS_SHOWN));
  const pool = [...ITEMS.filter((i) => i.kind !== 'hair'), ...hair];
  // shuffled within each kind, then the kinds take turns (in a shuffled order each round)
  const groups = {};
  for (const i of shuffle(pool, rnd)) (groups[KIND(i)] ||= []).push(i.id);
  const order = [];
  while (Object.values(groups).some((g) => g.length))
    for (const k of shuffle(Object.keys(groups), rnd)) if (groups[k].length) order.push(groups[k].shift());
  return order;
}
