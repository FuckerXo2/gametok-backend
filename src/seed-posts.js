// The first blog posts, as content in the repo.
//
// These are authored here rather than through the admin tool on purpose: the admin tool exists so
// future writers can add posts without a deploy, but the launch set has to exist before there is
// anyone to use it. Seeding runs on boot and is idempotent — a slug that already exists is left
// completely alone, so editing a post in the admin tool later will never be overwritten by a
// redeploy.
//
// Covers: any post without one gets an image generated through the blog image service, using the
// same OpenAI/R2 credentials the server already has. That happens once, on the run that first
// inserts the post, and never again.

import pool from './db.js';
import { generateCoverArtImage } from './cover-art.js';

/**
 * `coverImage` set   → used as-is (the Forge hero is the same art as the home modal).
 * `coverPrompt` set  → generated once at insert time.
 */
const SEED_POSTS = [
    {
        slug: 'introducing-forge-1',
        kind: 'announcement',
        title: 'Introducing Forge-1',
        excerpt: 'Our most capable game model yet — describe a game, get something playable back.',
        // Deliberately the same art as the announcement card on the home page.
        coverImage: '/app-assets/dream-forge-hero.png',
        authorName: 'GameTok',
        categories: ['announcements', 'product'],
        bodyMarkdown: `**Meet Forge-1 — the most capable game model we have shipped.**

It is not a longer list of features. It is the same thing you already do — describe a game — coming back better built.

## Nothing changes about how you work

You write a brief. You pick a screen shape. The forge designs the game, writes it, tests that it actually plays, and hands you something you can put in front of someone.

That last part is the bit that matters. You are not being handed a project to finish. You are being handed a game.

## What is different

**More of them just work.** The forge now verifies a game runs before it ever reaches you, and repairs it when it does not. Fewer builds come back broken.

**One prompt, not ten.** What used to take several rounds of nudging now more often lands the first time.

**The shape is respected.** Tall or wide is decided up front and the game is built *and* tested against that exact viewport — 390×844 or 844×390. A wide game is genuinely wide, not a tall game letterboxed.

## Bring your own things

Attach images, video clips, sound effects or music, and say how each should be used. A photo of your dog can be the player character. A voice note can be the death sound.

## Then publish it

When it is ready it goes to the feed, where anyone can play it instantly with nothing to install — and remix it into something of their own.

Go make something. We want to see what breaks.`,
    },
    {
        slug: 'why-screen-shape-is-permanent',
        kind: 'blog',
        title: 'Why your game\'s screen shape can never change',
        excerpt: 'Tall or wide is the one decision you cannot undo — and that constraint is what makes the games work.',
        coverPrompt: 'Two glowing rectangles floating in dark space, one tall and one wide, rendered as luminous holographic frames with soft volumetric light, deep blues and purples, minimal and architectural',
        authorName: 'GameTok',
        categories: ['product'],
        bodyMarkdown: `Every game made on GameTok asks you one question before it starts building: **tall or wide?**

You cannot change it afterwards. There is no setting, no toggle, no "switch to landscape" button. That is not an oversight.

## A game is built for one viewport

When the forge writes your game, it writes it against exact pixel dimensions — 390×844 for tall, 844×390 for wide. The layout, the controls, the camera, the size of everything on screen: all of it assumes that shape.

It then *tests* the game at that size. A build that does not run gets repaired before you ever see it.

Change the shape afterwards and none of that holds. The controls sit off screen. The camera frames the wrong thing. The game technically loads and is no longer playable.

## Which is why it is a deliberate tap

Most settings can be a default you slide past. This one cannot, so it is a choice you make on purpose, before anything is built.

**Tall** suits runners, stackers, anything vertical, anything one-thumb.
**Wide** suits racers, platformers, fighters — anything where seeing ahead of you matters.

Pick the one the game actually wants. If you get it wrong, building again is cheap.`,
    },
    {
        slug: 'remix-is-the-point',
        kind: 'blog',
        title: 'Remix is the point',
        excerpt: 'Every game on GameTok is a starting point for somebody else\'s.',
        coverPrompt: 'A single glowing seed of light splitting into many branching paths of light in dark space, each branch a slightly different colour, organic and generative, deep violet and cyan',
        authorName: 'GameTok',
        categories: ['creators'],
        bodyMarkdown: `Most places you make a game, the game is the end of the process. You finish it, you ship it, it sits there.

Here it is raw material.

## Anything in the feed can be taken apart

Open a game you like, hit remix, and you get your own copy as a draft — the whole thing, not a template of it. Change the character, change the rules, change the entire genre if you want. What you publish is yours.

The original creator keeps theirs. Nothing is taken from them.

## Why we built it this way

The hardest part of making anything is the blank page. Remix deletes it. You are never starting from nothing — you are starting from something that already works, and asking what if.

That is also how most good things actually get made. Somebody sees a thing, thinks *almost*, and makes the version they wanted.

## One rule

You have to change something. Republishing an untouched copy of someone else's game is not a remix, and the publish step will tell you so.

Beyond that: take anything, break anything, make it yours.`,
    },
];

async function ensureCover(post) {
    if (post.coverImage) return post.coverImage;
    if (!post.coverPrompt) return null;
    if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCESS_KEY_ID) {
        console.warn('[seed-posts] R2 not configured — publishing', post.slug, 'without a cover');
        return null;
    }

    try {
        const result = await generateCoverArtImage({
            // Raw, so the game-poster rewrite and the title-in-the-artwork
            // instruction are both bypassed.
            rawPrompt: [
                'Editorial illustration for a technology article.',
                post.coverPrompt,
                'Cinematic lighting, rich colour, clean composition with a clear focal point.',
                'Absolutely no text, no words, no letters, no logos, no watermarks, no user-interface elements.',
            ].join(' '),
            gameId: `blog-${post.slug}`,
            prefix: 'blog',
            unique: true,
            openAiSize: '1536x1024',
            hfSize: { width: 1216, height: 704 },
            hordeSize: { width: 640, height: 384 },
            compress: { maxWidth: 1536, maxHeight: 864, quality: 84, fit: 'cover' },
        });
        if (result?.url) {
            await pool.query(
                'INSERT INTO blog_image_generations (prompt, url, provider) VALUES ($1, $2, $3)',
                [post.coverPrompt, result.url, result.provider],
            );
            return result.url;
        }
    } catch (e) {
        console.warn('[seed-posts] cover generation failed for', post.slug, '-', e.message);
    }
    return null;
}

export async function seedPosts() {
    if (process.env.DISABLE_POST_SEED === '1') return;

    for (const post of SEED_POSTS) {
        try {
            // Never touch a post that exists — it may have been edited since.
            const existing = await pool.query('SELECT id FROM posts WHERE slug = $1', [post.slug]);
            if (existing.rows.length > 0) continue;

            const coverImage = await ensureCover(post);

            await pool.query(
                `INSERT INTO posts
                   (slug, kind, title, excerpt, cover_image, body_markdown, author_name,
                    categories, published, published_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8, TRUE, NOW())
                 ON CONFLICT (slug) DO NOTHING`,
                [
                    post.slug,
                    post.kind,
                    post.title,
                    post.excerpt,
                    coverImage,
                    post.bodyMarkdown,
                    post.authorName,
                    post.categories,
                ],
            );
            console.log('[seed-posts] published', post.slug, coverImage ? '(with cover)' : '(no cover)');
        } catch (e) {
            // A failed seed must never stop the server from booting.
            console.warn('[seed-posts] could not seed', post.slug, '-', e.message);
        }
    }
}
