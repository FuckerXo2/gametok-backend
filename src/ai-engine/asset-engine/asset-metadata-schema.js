import pool from '../../db.js';

/**
 * Asset Catalog Database Schema & In-Memory Fallback Cache
 */

const inMemoryAssetCatalog = new Map();
const inMemoryAnimationCatalog = new Map();

export async function initAssetCatalogSchema() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS asset_catalog (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                category VARCHAR(64) NOT NULL,
                subcategory VARCHAR(64),
                dimension VARCHAR(8) NOT NULL DEFAULT '3D',
                format VARCHAR(16) NOT NULL,
                style VARCHAR(32) NOT NULL,
                
                is_rigged BOOLEAN NOT NULL DEFAULT FALSE,
                rig_type VARCHAR(32) DEFAULT 'unrigged',
                bone_count INTEGER DEFAULT 0,
                has_embedded_animations BOOLEAN DEFAULT FALSE,
                embedded_animation_names JSONB DEFAULT '[]'::jsonb,
                
                bounding_box JSONB NOT NULL DEFAULT '{"size": {"x": 1, "y": 1, "z": 1}}'::jsonb,
                suggested_scale REAL DEFAULT 1.0,
                
                r2_key VARCHAR(512) NOT NULL,
                cdn_url TEXT NOT NULL,
                thumbnail_url TEXT,
                file_size_bytes INTEGER NOT NULL,
                sha256_hash VARCHAR(64) UNIQUE NOT NULL,
                
                source VARCHAR(64) NOT NULL,
                license VARCHAR(32) NOT NULL,
                attribution_text TEXT,
                
                tags TEXT[] DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS character_categories (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(64) NOT NULL,
                label VARCHAR(128) NOT NULL,
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS animation_catalog (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                rig_target VARCHAR(32) NOT NULL,
                category VARCHAR(64) NOT NULL,
                action VARCHAR(64) NOT NULL,
                role VARCHAR(32) DEFAULT 'neutral',
                duration_seconds REAL DEFAULT 1.0,
                r2_key VARCHAR(512) NOT NULL,
                cdn_url TEXT NOT NULL,
                source VARCHAR(64) NOT NULL,
                license VARCHAR(32) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
    } catch (e) {
        console.warn(`⚠️ [Asset Schema] DB pool unavailable (${e.code || e.message}). Operating with in-memory catalog cache.`);
    }
}

/**
 * Upsert an asset into the catalog (PostgreSQL + in-memory cache)
 * @param {object} asset 
 * @returns {Promise<object>}
 */
export async function upsertCatalogAsset(asset) {
    // 1. Update in-memory fallback cache
    inMemoryAssetCatalog.set(asset.id, asset);
    inMemoryAssetCatalog.set(asset.sha256_hash, asset);

    // 2. Persist to PostgreSQL if available
    try {
        await initAssetCatalogSchema();

        const query = `
            INSERT INTO asset_catalog (
                id, name, category, subcategory, dimension, format, style,
                is_rigged, rig_type, bone_count, has_embedded_animations, embedded_animation_names,
                bounding_box, suggested_scale, r2_key, cdn_url, thumbnail_url,
                file_size_bytes, sha256_hash, source, license, attribution_text, tags
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18, $19, $20, $21, $22, $23
            )
            ON CONFLICT (sha256_hash) DO UPDATE SET
                name = EXCLUDED.name,
                category = EXCLUDED.category,
                subcategory = EXCLUDED.subcategory,
                style = EXCLUDED.style,
                tags = EXCLUDED.tags,
                cdn_url = EXCLUDED.cdn_url,
                updated_at = NOW()
            RETURNING *;
        `;

        const values = [
            asset.id,
            asset.name,
            asset.category || 'props',
            asset.subcategory || null,
            asset.dimension || '3D',
            asset.format || 'glb',
            asset.style || 'stylized',
            Boolean(asset.is_rigged),
            asset.rig_type || 'unrigged',
            Number(asset.bone_count || 0),
            Boolean(asset.has_embedded_animations),
            JSON.stringify(asset.embedded_animation_names || []),
            JSON.stringify(asset.bounding_box || {}),
            Number(asset.suggested_scale || 1.0),
            asset.r2_key,
            asset.cdn_url,
            asset.thumbnail_url || null,
            Number(asset.file_size_bytes || 0),
            asset.sha256_hash,
            asset.source || 'gametok-curated',
            asset.license || 'CC0',
            asset.attribution_text || null,
            asset.tags || []
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (dbErr) {
        return asset; // return in-memory cached object
    }
}

export function getInMemoryAssets() {
    return Array.from(inMemoryAssetCatalog.values());
}

export function getInMemoryAnimations() {
    return Array.from(inMemoryAnimationCatalog.values());
}

export function addInMemoryAnimation(anim) {
    inMemoryAnimationCatalog.set(anim.id, anim);
}

export const DEFAULT_CHARACTER_CATEGORIES = [
    { id: 'superheroes', name: 'superheroes', label: 'Superheroes', description: 'Spider-Man, Homelander, Batman, Hal Jordan' },
    { id: 'urban_gangsters_gta', name: 'urban_gangsters_gta', label: 'Urban & GTA Legends', description: 'Franklin GTA V, CJ, Trevor, Street Hustlers' },
    { id: 'anime', name: 'anime', label: 'Anime & Manga', description: 'Shonen Heroes, Ninjas, Anime Fighters' },
    { id: 'sports_athletes', name: 'sports_athletes', label: 'Sports & Athletes', description: 'Footballers, Basketball Players, Boxers, Racers' },
    { id: 'historical_figures', name: 'historical_figures', label: 'Historical Figures', description: 'Samurai, Medieval Knights, Ancient Kings, Gladiators' },
    { id: 'fighters_martial_artists', name: 'fighters_martial_artists', label: 'Fighters & Martial Artists', description: 'Scorpion, Sub-Zero, Ninjas, Street Brawlers' },
    { id: 'villains', name: 'villains', label: 'Villains & Bosses', description: 'Green Goblin, Venom, Joker, Criminal Masterminds' },
    { id: 'soldiers_military', name: 'soldiers_military', label: 'Military & Tactical', description: 'Special Ops, Soldiers, Tactical Operators' },
    { id: 'monsters_zombies_creatures', name: 'monsters_zombies_creatures', label: 'Monsters & Zombies', description: 'Zombies, Undead, Beasts, Orcs, Aliens' },
    { id: 'civilians_pedestrians', name: 'civilians_pedestrians', label: 'Civilians & Pedestrians', description: 'City Crowds, Bystanders, Regular People' }
];

const inMemoryCategories = new Map(DEFAULT_CHARACTER_CATEGORIES.map(c => [c.id, c]));

export async function getCharacterCategories() {
    try {
        await initAssetCatalogSchema();
        const res = await pool.query('SELECT * FROM character_categories ORDER BY created_at ASC');
        if (res.rows.length === 0) {
            // Seed defaults into database
            for (const cat of DEFAULT_CHARACTER_CATEGORIES) {
                await pool.query(
                    'INSERT INTO character_categories (id, name, label, description) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                    [cat.id, cat.name, cat.label, cat.description]
                ).catch(() => {});
            }
            return DEFAULT_CHARACTER_CATEGORIES;
        }
        return res.rows;
    } catch {
        return Array.from(inMemoryCategories.values());
    }
}

export async function addCharacterCategory({ id, name, label, description }) {
    const cleanId = (id || name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const categoryRecord = {
        id: cleanId,
        name: name || cleanId,
        label: label || cleanId,
        description: description || ''
    };
    inMemoryCategories.set(cleanId, categoryRecord);

    try {
        await initAssetCatalogSchema();
        await pool.query(
            'INSERT INTO character_categories (id, name, label, description) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description',
            [categoryRecord.id, categoryRecord.name, categoryRecord.label, categoryRecord.description]
        );
    } catch (e) {
        console.warn(`⚠️ [Asset Schema] DB save category error (${e.message}), stored in-memory.`);
    }
    return categoryRecord;
}

export async function deleteCharacterCategory(id) {
    inMemoryCategories.delete(id);
    try {
        await pool.query('DELETE FROM character_categories WHERE id = $1', [id]);
    } catch {}
    return { success: true, id };
}

export async function updateAssetCharacterCategory(assetId, newCategory) {
    // Update in memory
    for (const [key, asset] of inMemoryAssetCatalog.entries()) {
        if (asset.id === assetId) {
            asset.subcategory = newCategory;
            if (!asset.tags.includes(newCategory)) asset.tags.push(newCategory);
        }
    }

    try {
        await pool.query(
            'UPDATE asset_catalog SET subcategory = $1, tags = array_append(tags, $1), updated_at = NOW() WHERE id = $2',
            [newCategory, assetId]
        );
        return { success: true, assetId, subcategory: newCategory };
    } catch (e) {
        return { success: true, assetId, subcategory: newCategory, cached: true };
    }
}
