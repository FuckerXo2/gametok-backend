// Blog posts and announcements.
//
// One table, one API, discriminated by `kind`. An announcement is a short post that also surfaces
// on the home hero; giving it the same shape as a blog post means the modal's "read the
// announcement" resolves to a real page instead of needing a second content system.
//
// Public routes serve published posts only. Everything that writes lives under /api/admin/posts and
// is gated by the requireAdmin middleware mounted on the /api/admin prefix in index.js.

import express from 'express';
import pool from './db.js';

export const POST_CATEGORIES = ['announcements', 'product', 'creators', 'company'];
const POST_KINDS = ['blog', 'announcement'];

const publicRouter = express.Router();
const adminRouter = express.Router();

function normalizeCategories(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((v) => POST_CATEGORIES.includes(v) && !seen.has(v) && seen.add(v) !== undefined);
}

/** Slugs are the public URL, so keep them predictable and collision-resistant. */
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function formatPost(row) {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    excerpt: row.excerpt,
    coverImage: row.cover_image,
    bodyMarkdown: row.body_markdown,
    authorName: row.author_name,
    authorAvatar: row.author_avatar,
    categories: Array.isArray(row.categories) ? row.categories : [],
    published: row.published,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Cards don't need the full body; omitting it keeps the index response small. */
function formatPostCard(row) {
  const { bodyMarkdown, ...rest } = formatPost(row);
  return rest;
}

// ── Public ────────────────────────────────────────────────────────────────────

publicRouter.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const params = [limit];
    const where = ['published = TRUE'];

    const category = String(req.query.category || '').trim().toLowerCase();
    if (POST_CATEGORIES.includes(category)) {
      params.push(category);
      where.push(`$${params.length} = ANY(categories)`);
    }

    const kind = String(req.query.kind || '').trim().toLowerCase();
    if (POST_KINDS.includes(kind)) {
      params.push(kind);
      where.push(`kind = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT * FROM posts
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(published_at, created_at) DESC
       LIMIT $1`,
      params,
    );
    res.json({ posts: result.rows.map(formatPostCard), categories: POST_CATEGORIES });
  } catch (e) {
    console.error('[posts] list failed:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

publicRouter.get('/:slug', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM posts WHERE slug = $1 AND published = TRUE',
      [req.params.slug],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: formatPost(result.rows[0]) });
  } catch (e) {
    console.error('[posts] fetch failed:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin ─────────────────────────────────────────────────────────────────────

/** Includes drafts — this is the authoring view. */
adminRouter.get('/', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY updated_at DESC LIMIT 200');
    res.json({ posts: result.rows.map(formatPostCard) });
  } catch (e) {
    console.error('[posts] admin list failed:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

adminRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: formatPost(result.rows[0]) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

adminRouter.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });

    const slug = slugify(body.slug || title);
    if (!slug) return res.status(400).json({ error: 'could not derive a slug from that title' });

    const kind = POST_KINDS.includes(body.kind) ? body.kind : 'blog';
    const published = Boolean(body.published);

    const result = await pool.query(
      `INSERT INTO posts
         (slug, kind, title, excerpt, cover_image, body_markdown, author_name, author_avatar,
          categories, published, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $10 THEN NOW() ELSE NULL END)
       RETURNING *`,
      [
        slug,
        kind,
        title,
        body.excerpt || null,
        body.coverImage || null,
        body.bodyMarkdown || null,
        body.authorName || null,
        body.authorAvatar || null,
        normalizeCategories(body.categories),
        published,
      ],
    );
    res.status(201).json({ post: formatPost(result.rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That slug is already taken' });
    console.error('[posts] create failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

adminRouter.put('/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const existing = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Post not found' });
    const prev = existing.rows[0];

    const published = body.published === undefined ? prev.published : Boolean(body.published);
    // Stamp published_at on the transition into published, and never move it
    // afterwards — a later edit should not re-date the post.
    const publishedAt = published && !prev.published_at ? new Date() : prev.published_at;

    const result = await pool.query(
      `UPDATE posts SET
         slug = $2, kind = $3, title = $4, excerpt = $5, cover_image = $6, body_markdown = $7,
         author_name = $8, author_avatar = $9, categories = $10, published = $11,
         published_at = $12, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        body.slug ? slugify(body.slug) : prev.slug,
        POST_KINDS.includes(body.kind) ? body.kind : prev.kind,
        body.title !== undefined ? body.title : prev.title,
        body.excerpt !== undefined ? body.excerpt : prev.excerpt,
        body.coverImage !== undefined ? body.coverImage : prev.cover_image,
        body.bodyMarkdown !== undefined ? body.bodyMarkdown : prev.body_markdown,
        body.authorName !== undefined ? body.authorName : prev.author_name,
        body.authorAvatar !== undefined ? body.authorAvatar : prev.author_avatar,
        body.categories !== undefined ? normalizeCategories(body.categories) : prev.categories,
        published,
        publishedAt,
      ],
    );
    res.json({ post: formatPost(result.rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That slug is already taken' });
    console.error('[posts] update failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

adminRouter.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Post not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

export { publicRouter as postsPublicRouter, adminRouter as postsAdminRouter };
