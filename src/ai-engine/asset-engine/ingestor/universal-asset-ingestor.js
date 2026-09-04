import path from 'node:path';
import { GlbHandler } from './handlers/glb-handler.js';
import { ObjHandler } from './handlers/obj-handler.js';
import { FbxHandler } from './handlers/fbx-handler.js';
import { AnimationIngestor } from './animation-ingestor.js';
import { uploadAssetBufferToR2 } from '../asset-storage.js';
import { upsertCatalogAsset, initAssetCatalogSchema } from '../asset-metadata-schema.js';

/**
 * Universal Asset Ingestor
 * 
 * Format-agnostic ingestion engine for:
 * - GLB / glTF
 * - Wavefront OBJ
 * - Autodesk FBX (Character models + Standalone motion tracks)
 * 
 * Flow:
 * Source File/Buffer -> Format Detection -> Handler Normalization -> SHA256 -> Real R2 Upload -> PostgreSQL Catalog -> Ready CDN Asset
 */
export class UniversalAssetIngestor {
    constructor() {
        this.handlers = new Map();
        this.registerHandler(new GlbHandler());
        this.registerHandler(new ObjHandler());
        this.registerHandler(new FbxHandler());
    }

    registerHandler(handler) {
        this.handlers.set(handler.formatId, handler);
        for (const ext of handler.supportedExtensions || []) {
            this.handlers.set(ext.toLowerCase(), handler);
        }
    }

    /**
     * Ingest an asset from buffer or local file
     * @param {object} params
     * @param {Buffer} params.buffer Binary buffer
     * @param {string} [params.filename] Original filename (e.g. 'Knight.fbx')
     * @param {string} [params.sourceFormat] Explicit format override ('glb', 'obj', 'fbx')
     * @param {string} [params.name] Human readable title
     * @param {string} [params.category='props'] 'characters', 'creatures', 'environment', 'props', 'weapons'
     * @param {string} [params.subcategory]
     * @param {string} [params.style='stylized'] 'low-poly', 'stylized', 'voxel', 'pixel-art', 'realistic'
     * @param {string[]} [params.tags=[]]
     * @param {string} [params.source='gametok-curated'] 'gametok-curated', 'quaternius', 'kenney', etc.
     * @param {string} [params.license='CC0']
     * @param {string} [params.attribution]
     * @param {object} [params.animationMetadata] If standalone animation: { rigTarget, action, role, durationSeconds }
     * @returns {Promise<object>} Ingested canonical asset record
     */
    async ingest(params = {}) {
        await initAssetCatalogSchema();

        const buffer = params.buffer;
        if (!Buffer.isBuffer(buffer)) {
            throw new Error('Universal Ingestion Error: buffer is required and must be a Buffer instance.');
        }

        const filename = params.filename || 'asset.bin';
        const ext = path.extname(filename).toLowerCase();
        const detectedFormat = (params.sourceFormat || ext.replace('.', '') || this._detectMagic(buffer)).toLowerCase();

        const handler = this.handlers.get(detectedFormat) || this.handlers.get(ext) || this.handlers.get('glb');
        if (!handler) {
            throw new Error(`Universal Ingestion Error: unsupported asset format "${detectedFormat}" (${filename})`);
        }

        console.log(`📦 [Universal Ingestor] Processing "${filename}" via ${handler.constructor.name}...`);

        // 1. Process and extract technical metadata
        const processed = await handler.process(buffer, {
            name: params.name || path.basename(filename, ext),
            category: params.category,
            style: params.style
        });

        // 2. Handle Standalone Animation Clips (e.g. Mixamo FBX motion track)
        if (processed.isStandaloneAnimation || params.targetType === 'standalone_animation') {
            const animMeta = params.animationMetadata || {};
            return AnimationIngestor.ingestAnimation({
                name: params.name || path.basename(filename, ext),
                rigTarget: animMeta.rigTarget || 'humanoid_standard_v1',
                category: animMeta.category || 'locomotion',
                action: animMeta.action || 'motion',
                role: animMeta.role || 'neutral',
                durationSeconds: animMeta.durationSeconds || 1.0,
                buffer: processed.canonicalBuffer || buffer,
                source: params.source || 'gametok-curated',
                license: params.license || 'CC0'
            });
        }

        // 3. Upload Canonical Runtime Asset to Cloudflare R2
        const category = params.category || 'props';
        const assetId = `gt_${category}_${processed.sha256.substring(0, 12)}`;
        const r2Key = `assets/3d/${category}/${assetId}.${processed.canonicalRuntimeFormat}`;

        console.log(`☁️  [Universal Ingestor] Uploading canonical runtime asset to R2: "${r2Key}"...`);
        const r2Upload = await uploadAssetBufferToR2({
            key: r2Key,
            buffer: processed.canonicalBuffer,
            contentType: processed.mimeType
        });

        // 4. Render Studio WebP Thumbnail if not provided
        let thumbnailUrl = params.thumbnailUrl || null;

        if (!thumbnailUrl && processed.canonicalRuntimeFormat === 'glb') {
            try {
                const { StudioThumbnailRenderer } = await import('../visual/thumbnail-renderer.js');
                const thumbResult = await StudioThumbnailRenderer.renderThumbnail({
                    modelUrl: r2Upload.cdnUrl,
                    sha256: processed.sha256,
                    boundingBox: processed.spatial?.boundingBox
                });
                if (thumbResult) {
                    thumbnailUrl = thumbResult.thumbnailUrl;
                }
            } catch (thumbErr) {
                console.warn(`⚠️ [Universal Ingestor] Auto-thumbnail rendering skipped: ${thumbErr.message}`);
            }
        }

        // 5. Upsert Normalized Record into PostgreSQL Catalog
        const assetRecord = {
            id: assetId,
            name: params.name || path.basename(filename, ext),
            category,
            subcategory: params.subcategory || null,
            dimension: '3D',
            format: processed.canonicalRuntimeFormat,
            style: params.style || 'stylized',
            is_rigged: processed.rigging.isRigged,
            rig_type: processed.rigging.rigType,
            bone_count: processed.rigging.boneCount,
            has_embedded_animations: processed.animations.hasEmbeddedAnimations,
            embedded_animation_names: processed.animations.clipNames,
            bounding_box: processed.spatial.boundingBox,
            suggested_scale: processed.spatial.suggestedScale,
            r2_key: r2Upload.key,
            cdn_url: r2Upload.cdnUrl,
            thumbnail_url: thumbnailUrl,
            file_size_bytes: processed.canonicalBuffer.length,
            sha256_hash: processed.sha256,
            source: params.source || 'gametok-curated',
            license: params.license || 'CC0',
            attribution_text: params.attribution || `${params.source || 'GameTok'} (${params.license || 'CC0'})`,
            tags: params.tags || [params.name || 'asset']
        };


        const cataloged = await upsertCatalogAsset(assetRecord);
        console.log(`🎉 [Universal Ingestor] Successfully cataloged: "${cataloged.name}" (${cataloged.id}) → ${cataloged.cdn_url}`);
        return cataloged;
    }

    _detectMagic(buffer) {
        if (buffer.length >= 4) {
            const magic = buffer.readUInt32LE(0);
            if (magic === 0x46546C67) return 'glb';
        }
        const textSample = buffer.subarray(0, 100).toString('utf-8');
        if (textSample.startsWith('v ') || textSample.includes('vn ') || textSample.includes('vt ')) return 'obj';
        if (textSample.includes('Kaydara FBX') || textSample.includes('FBXHeaderExtension')) return 'fbx';
        return 'glb';
    }
}

export const universalAssetIngestor = new UniversalAssetIngestor();
