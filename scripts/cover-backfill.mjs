#!/usr/bin/env node
/**
 * Backfill rich cover art for existing AI games.
 *
 *   node scripts/cover-backfill.mjs            # 25 games, missing only
 *   node scripts/cover-backfill.mjs --limit 100
 *   node scripts/cover-backfill.mjs --all      # include games that already have covers
 *   node scripts/cover-backfill.mjs --concurrency 3
 *
 * Reads existing ai_games rows, generates a FLUX.1-schnell cover for each, and
 * updates ai_games.thumbnail + games.thumbnail.
 */

import { setTimeout as sleep } from 'timers/promises';
import pkg from 'pg';
import { generateAndApplyCover } from '../src/cover-art.js';

const { Pool } = pkg;

function parseArgs(argv) {
    const args = { limit: 25, all: false, concurrency: 2 };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--all') args.all = true;
        else if (arg === '--limit') args.limit = Number(argv[++i]);
        else if (arg === '--concurrency') args.concurrency = Number(argv[++i]);
    }
    return args;
}

async function main() {
    const { limit, all, concurrency } = parseArgs(process.argv);

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL is not set.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    });

    const where = all
        ? "WHERE is_draft = FALSE AND html_payload != ''"
        : "WHERE is_draft = FALSE AND html_payload != '' AND (thumbnail IS NULL OR thumbnail = '' OR thumbnail NOT LIKE '/uploads/covers/%')";

    const { rows } = await pool.query(
        `SELECT id AS draft_id, title, prompt, category, subcategory, primary_tab, interaction_type, classification_tags, discovery_chips
         FROM ai_games
         ${where}
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
    );

    console.log(`📸 Backfilling cover art for ${rows.length} games (concurrency=${concurrency})…`);

    let done = 0;
    let failed = 0;
    let inFlight = 0;
    let cursor = 0;

    await new Promise((resolve) => {
        function tick() {
            while (inFlight < concurrency && cursor < rows.length) {
                const row = rows[cursor++];
                inFlight += 1;
                const draftId = row.draft_id;
                const gameId = `gm-ai-${String(draftId).substring(0, 8)}`;
                generateAndApplyCover(pool, {
                    draftId,
                    gameId,
                    title: row.title,
                    prompt: row.prompt,
                    classification: {
                        category: row.category,
                        subcategory: row.subcategory,
                        primaryTab: row.primary_tab,
                        interactionType: row.interaction_type,
                        tags: Array.isArray(row.classification_tags) ? row.classification_tags : [],
                        discoveryChips: Array.isArray(row.discovery_chips) ? row.discovery_chips : [],
                    },
                })
                    .then((url) => {
                        if (url) done += 1; else failed += 1;
                        process.stdout.write(`\r✓ ${done}  ✗ ${failed}  / ${rows.length}   `);
                    })
                    .catch(() => { failed += 1; })
                    .finally(() => {
                        inFlight -= 1;
                        if (cursor >= rows.length && inFlight === 0) resolve();
                        else tick();
                    });
            }
        }
        tick();
    });

    console.log(`\n✅ Done: ${done} succeeded, ${failed} failed`);
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
