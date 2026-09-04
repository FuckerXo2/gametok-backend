import { inspectGlbBuffer } from '../../deterministic-3d-parser.js';


/**
 * GLB / glTF Format Handler
 * Handles native binary glTF (GLB) files.
 */
export class GlbHandler {
    constructor() {
        this.formatId = 'glb';
        this.supportedExtensions = ['.glb', '.gltf'];
    }

    /**
     * Inspect and normalize a GLB buffer
     * @param {Buffer} buffer 
     * @param {object} [metadata]
     * @returns {object}
     */
    async process(buffer, metadata = {}) {
        const inspection = inspectGlbBuffer(buffer);

        return {
            sourceFormat: 'glb',
            canonicalRuntimeFormat: 'glb',
            canonicalBuffer: buffer, // GLB is already canonical runtime format
            mimeType: 'model/gltf-binary',
            sha256: inspection.sha256,
            fileSizeBytes: buffer.length,
            structure: inspection.structure,
            rigging: inspection.rigging,
            animations: inspection.animations,
            spatial: inspection.spatial,
            metadata
        };
    }
}
