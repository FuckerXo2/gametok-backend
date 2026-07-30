// Game categories — the discovery taxonomy.
//
// This replaces the old classification entirely (category / subcategory / primary_tab /
// interaction_type / classification_confidence / classification_tags / discovery_chips). That system
// had stopped being written on publish, yet classification_confidence was still the single largest
// term in the /api/games ranking score — so the biggest ranking factor was a column that is NULL for
// every recent game, which systematically buried new games under legacy ones.
//
// Two deliberate differences from the old system:
//   1. Multi-label. A game can be Action AND Adventure; the old one forced a single bucket.
//   2. Stored in a join table, not columns on `games`, so adding a category is data, not a migration.
//
// Sub-navigation inside a category is New and Trending only — there are no sub-genres.

import { callKimiJson } from './ai-engine/moonshot-text-client.js';

/** The canonical set. `slug` is what the API and URLs use; `label` is what people see. */
export const CATEGORIES = [
    { slug: 'action', label: 'Action' },
    { slug: 'adventure', label: 'Adventure' },
    { slug: 'arcade', label: 'Arcade' },
    { slug: 'sports', label: 'Sports' },
    { slug: 'rpg', label: 'RPG' },
    { slug: 'visual-novel', label: 'Visual Novel' },
    { slug: 'horror', label: 'Horror' },
    { slug: 'racing', label: 'Racing' },
    { slug: 'puzzle', label: 'Puzzles' },
];

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

const SLUG_SET = new Set(CATEGORY_SLUGS);

export function isValidCategory(slug) {
    return SLUG_SET.has(String(slug || '').trim().toLowerCase());
}

export function normalizeCategories(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const slug = String(value || '').trim().toLowerCase();
        if (!SLUG_SET.has(slug) || seen.has(slug)) continue;
        seen.add(slug);
        out.push(slug);
        if (out.length >= MAX_CATEGORIES) break;
    }
    return out;
}

/** A game sits in at most this many categories — beyond that the label stops meaning anything. */
export const MAX_CATEGORIES = 3;

/**
 * Keyword fallback, used when the model is unavailable or returns nothing usable.
 * Deliberately conservative: it is better to leave a game uncategorised (it still shows in New and
 * Trending) than to file it somewhere wrong.
 */
const KEYWORDS = [
    ['racing', /\b(rac(e|ing|er)|drift|kart|lap|circuit|rally|drag ?race|speedway|motocross)\b/i],
    ['horror', /\b(horror|scary|creepy|haunted|zombie|ghost|nightmare|survival horror|eerie|cursed)\b/i],
    ['puzzle', /\b(puzzle|match[- ]?3|sudoku|tetris|riddle|brain|logic|jigsaw|maze|solitaire)\b/i],
    ['sports', /\b(sport|soccer|football|basketball|tennis|golf|baseball|cricket|bowling|boxing|skate)\b/i],
    ['rpg', /\b(rpg|role[- ]?play|quest|dungeon|loot|level up|party|mage|warrior|skill tree)\b/i],
    ['visual-novel', /\b(visual novel|dating sim|story[- ]?driven|dialogue|choose your own|branching story)\b/i],
    ['adventure', /\b(adventure|explore|exploration|open world|journey|treasure|discover)\b/i],
    ['action', /\b(shoot(er)?|fight(ing)?|combat|battle|attack|weapon|dodge|slash|survive|enemy|enemies)\b/i],
    ['arcade', /\b(arcade|endless|runner|flappy|stack|high ?score|combo|retro|classic)\b/i],
];

export function heuristicCategories(text) {
    const haystack = String(text || '');
    const hits = [];
    for (const [slug, pattern] of KEYWORDS) {
        if (pattern.test(haystack)) hits.push(slug);
        if (hits.length >= MAX_CATEGORIES) break;
    }
    return hits;
}

const SYSTEM_PROMPT = `You categorise browser games for a game discovery feed.

Pick 1-3 categories from EXACTLY this list (use the slug, lowercase, verbatim):
${CATEGORIES.map((c) => `- ${c.slug} (${c.label})`).join('\n')}

Rules:
- Pick the categories a player browsing for this game would actually look under.
- Categories overlap freely: a zombie shooter is both "action" and "horror".
- Pick fewer rather than padding to 3. One correct category beats three vague ones.
- If nothing fits well, return an empty array rather than guessing.

Respond with JSON only: {"categories": ["slug", ...]}`;

/**
 * Classify a game from what the creator asked for and what got built.
 * Never throws — categorisation failing must not block a publish.
 */
export async function classifyGame({ title, prompt, description } = {}) {
    const text = [title, prompt, description].filter(Boolean).join('\n').slice(0, 2000);
    if (!text.trim()) return { categories: [], source: 'none' };

    try {
        const result = await callKimiJson({
            systemPrompt: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: text }],
            maxTokens: 120,
            temperature: 0.2,
        });
        const categories = normalizeCategories(result?.categories);
        if (categories.length) return { categories, source: 'ai' };
    } catch (e) {
        console.warn('[categories] AI classification failed, falling back to keywords:', e.message);
    }

    const fallback = normalizeCategories(heuristicCategories(text));
    return { categories: fallback, source: fallback.length ? 'heuristic' : 'none' };
}

/**
 * Replace a game's categories. `source` records where they came from so a creator's own choice
 * ('creator') is never silently overwritten by a later backfill.
 */
export async function setGameCategories(pool, gameId, categories, source = 'ai') {
    const slugs = normalizeCategories(categories);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM game_categories WHERE game_id = $1', [gameId]);
        for (const slug of slugs) {
            await client.query(
                `INSERT INTO game_categories (game_id, category, source)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (game_id, category) DO UPDATE SET source = EXCLUDED.source`,
                [gameId, slug, source],
            );
        }
        await client.query('COMMIT');
        return slugs;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}
