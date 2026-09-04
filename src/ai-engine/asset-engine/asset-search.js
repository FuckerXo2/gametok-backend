import pool from '../../db.js';
import { initAssetCatalogSchema, getInMemoryAssets, getInMemoryAnimations } from './asset-metadata-schema.js';

/**
 * Progressive Asset & Animation Search Engine
 */

export async function searchAssetCatalog(params = {}) {
    try {
        await initAssetCatalogSchema();

        const conditions = ["dimension = '3D'"];
        const values = [];

        if (params.category) {
            values.push(params.category.toLowerCase().trim());
            conditions.push(`LOWER(category) = $${values.length}`);
        }

        if (params.subcategory) {
            values.push(params.subcategory.toLowerCase().trim());
            conditions.push(`LOWER(subcategory) = $${values.length}`);
        }

        if (params.rig_type) {
            const baseRig = params.rig_type.toLowerCase().trim().split('_v')[0];
            values.push(`${baseRig}%`);
            conditions.push(`LOWER(rig_type) LIKE $${values.length}`);
        }

        if (params.style) {
            values.push(params.style.toLowerCase().trim());
            conditions.push(`LOWER(style) = $${values.length}`);
        }

        if (params.requires_animations) {
            conditions.push(`has_embedded_animations = true`);
        }

        if (params.query && params.query.trim()) {
            const STOP_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'and', 'for', 'with']);
            const tokens = params.query.trim().toLowerCase().split(/\s+/).filter(t => t && !STOP_WORDS.has(t));
            for (const token of (tokens.length > 0 ? tokens : [params.query.trim().toLowerCase()])) {
                const tokenTerm = `%${token}%`;
                values.push(tokenTerm);
                conditions.push(`(
                    LOWER(name) LIKE $${values.length} OR 
                    EXISTS (SELECT 1 FROM unnest(tags) tag WHERE LOWER(tag) LIKE $${values.length})
                )`);
            }
        }

        const limit = Math.min(25, Math.max(1, Number(params.limit) || 8));
        values.push(limit);

        const sql = `
            SELECT 
                id, name, category, subcategory, style, format,
                is_rigged, rig_type, bone_count,
                has_embedded_animations, embedded_animation_names,
                bounding_box, suggested_scale,
                cdn_url, thumbnail_url, license, attribution_text, tags
            FROM asset_catalog
            WHERE ${conditions.join(' AND ')}
            ORDER BY created_at DESC
            LIMIT $${values.length};
        `;

        const result = await pool.query(sql, values);
        if (result.rows.length > 0) return result.rows;
    } catch (e) {
        // Fallback to in-memory search
    }

    // In-Memory Search Fallback
    const STOP_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'and', 'for', 'with']);
    const inMemory = getInMemoryAssets();
    return inMemory.filter(item => {
        if (params.category && item.category && item.category.toLowerCase() !== params.category.toLowerCase()) return false;
        if (params.rig_type && item.rig_type && params.rig_type !== 'unrigged') {
            const reqBase = params.rig_type.toLowerCase().split('_v')[0];
            const itemBase = item.rig_type.toLowerCase().split('_v')[0];
            if (!itemBase.startsWith(reqBase) && !reqBase.startsWith(itemBase)) return false;
        }
        if (params.style && item.style && item.style.toLowerCase() !== params.style.toLowerCase()) return false;
        if (params.requires_animations && !item.has_embedded_animations) return false;

        if (params.query) {
            const qTokens = params.query.toLowerCase().split(/\s+/).filter(t => t && !STOP_WORDS.has(t));
            const tokensToMatch = qTokens.length > 0 ? qTokens : [params.query.toLowerCase()];
            const matchesName = tokensToMatch.some(t => {
                const stem = t.replace(/(?:es|s)$/i, '');
                return item.name && (item.name.toLowerCase().includes(t) || item.name.toLowerCase().includes(stem));
            });
            const matchesTag = Array.isArray(item.tags) && item.tags.some(tag => tokensToMatch.some(t => {
                const stem = t.replace(/(?:es|s)$/i, '');
                return tag.toLowerCase().includes(t) || tag.toLowerCase().includes(stem) || t.includes(tag.toLowerCase());
            }));
            if (!matchesName && !matchesTag) return false;
        }
        return true;
    }).slice(0, Number(params.limit) || 8);


}

export async function searchAnimationCatalog(params = {}) {
    try {
        await initAssetCatalogSchema();

        const conditions = [];
        const values = [];

        if (params.rig_target) {
            values.push(params.rig_target.toLowerCase().trim());
            conditions.push(`LOWER(rig_target) = $${values.length}`);
        }

        if (params.category) {
            values.push(params.category.toLowerCase().trim());
            conditions.push(`LOWER(category) = $${values.length}`);
        }

        if (params.action) {
            values.push(params.action.toLowerCase().trim());
            conditions.push(`LOWER(action) LIKE $${values.length}`);
        }

        if (params.role) {
            values.push(params.role.toLowerCase().trim());
            conditions.push(`LOWER(role) = $${values.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `
            SELECT id, name, rig_target, category, action, role, duration_seconds, cdn_url, license
            FROM animation_catalog
            ${whereClause}
            ORDER BY name ASC
            LIMIT 20;
        `;

        const result = await pool.query(sql, values);
        if (result.rows.length > 0) return result.rows;
    } catch (e) {
        // Fallback to in-memory search
    }

    const inMemory = getInMemoryAnimations();
    return inMemory.filter(anim => {
        if (params.rig_target && anim.rig_target && anim.rig_target.toLowerCase() !== params.rig_target.toLowerCase()) return false;
        if (params.category && anim.category && anim.category.toLowerCase() !== params.category.toLowerCase()) return false;
        if (params.action && anim.action && !anim.action.toLowerCase().includes(params.action.toLowerCase())) return false;
        if (params.role && anim.role && anim.role.toLowerCase() !== params.role.toLowerCase()) return false;
        return true;
    });
}
