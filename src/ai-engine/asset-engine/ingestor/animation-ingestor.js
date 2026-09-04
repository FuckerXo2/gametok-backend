import pool from '../../../db.js';
import { uploadAssetBufferToR2 } from '../asset-storage.js';
import { initAssetCatalogSchema } from '../asset-metadata-schema.js';

/**
 * Standalone Animation Ingestor
 * 
 * Ingests decoupled motion tracks (Mixamo FBX / procedural tracks)
 * into PostgreSQL `animation_catalog` and Cloudflare R2 storage.
 */
export class AnimationIngestor {
    /**
     * Ingest a standalone reusable animation track
     * @param {object} params
     * @param {string} params.name e.g. "Humanoid Greatsword Slash"
     * @param {string} params.rigTarget e.g. "humanoid_standard_v1", "quadruped_standard_v1"
     * @param {string} params.category e.g. "combat", "locomotion", "reaction"
     * @param {string} params.action e.g. "sword_slash", "run", "hit_reaction"
     * @param {string} [params.role='neutral'] 'attacker', 'victim', 'locomotion'
     * @param {number} [params.durationSeconds=1.2]
     * @param {Buffer} params.buffer Binary/JSON motion track
     * @param {string} [params.source='mixamo']
     * @param {string} [params.license='CC0']
     * @returns {Promise<object>}
     */
    static async ingestAnimation({
        name,
        rigTarget = 'humanoid_standard_v1',
        category = 'locomotion',
        action = 'walk',
        role = 'neutral',
        durationSeconds = 1.0,
        buffer,
        source = 'gametok-curated',
        license = 'CC0'
    }) {
        await initAssetCatalogSchema();

        const animId = `gt_anim_${rigTarget.replace(/[^a-zA-Z0-9]/g, '_')}_${action.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now().toString(36)}`;
        const r2Key = `animations/${rigTarget}/${category}/${action}.gtanim`;

        // 1. Upload to Cloudflare R2
        const uploadResult = await uploadAssetBufferToR2({
            key: r2Key,
            buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(JSON.stringify(buffer || {})),
            contentType: 'application/json'
        });

        // 2. Insert into PostgreSQL animation_catalog
        const animRecord = {
            id: animId,
            name,
            rig_target: rigTarget,
            category,
            action,
            role,
            duration_seconds: Number(durationSeconds) || 1.0,
            r2_key: uploadResult.key,
            cdn_url: uploadResult.cdnUrl,
            source,
            license
        };

        try {
            const query = `
                INSERT INTO animation_catalog (
                    id, name, rig_target, category, action, role, duration_seconds, r2_key, cdn_url, source, license
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING *;
            `;

            const values = [
                animId,
                name,
                rigTarget,
                category,
                action,
                role,
                Number(durationSeconds) || 1.0,
                uploadResult.key,
                uploadResult.cdnUrl,
                source,
                license
            ];

            const result = await pool.query(query, values);
            console.log(`🎬 [Animation Ingestor] Ingested reusable motion: "${name}" (${animId}) → ${uploadResult.cdnUrl}`);
            return result.rows[0];
        } catch (dbErr) {
            import('../asset-metadata-schema.js').then(m => m.addInMemoryAnimation(animRecord));
            return animRecord;
        }

    }
}
