/**
 * External Asset Provider Interface & Registry
 * 
 * Defines standard pluggable contract for public asset repositories
 * (Poly Pizza, Quaternius, Kenney, OpenGameArt, Sketchfab, etc.).
 */

export class ExternalAssetProvider {
    /**
     * @param {string} id Unique provider ID e.g. 'polypizza', 'quaternius'
     * @param {string} name Human readable name
     */
    constructor(id, name) {
        if (this.constructor === ExternalAssetProvider) {
            throw new Error("Abstract class 'ExternalAssetProvider' cannot be instantiated directly.");
        }
        this.id = id;
        this.name = name;
    }

    /**
     * Search external source for candidate models
     * @param {object} requirement Normalized asset requirement
     * @param {object} [options]
     * @returns {Promise<Array<{ externalId: string, name: string, previewUrl?: string, downloadUrl?: string, format: string, license: string, author?: string }>>}
     */
    async search(requirement, options = {}) {
        throw new Error("Method 'search()' must be implemented by provider.");
    }

    /**
     * Download asset binary buffer
     * @param {string} externalId 
     * @param {string} [downloadUrl]
     * @returns {Promise<{ buffer: Buffer, format: string, metadata: object }>}
     */
    async fetchBinary(externalId, downloadUrl = null) {
        throw new Error("Method 'fetchBinary()' must be implemented by provider.");
    }
}

class ProviderRegistry {
    constructor() {
        this.providers = new Map();
    }

    register(provider) {
        if (!(provider instanceof ExternalAssetProvider)) {
            throw new Error(`Provider must extend ExternalAssetProvider.`);
        }
        this.providers.set(provider.id, provider);
        console.log(`🔌 [Asset Providers] Registered external provider: "${provider.name}" (${provider.id})`);
    }

    get(id) {
        return this.providers.get(id) || null;
    }

    getAll() {
        return Array.from(this.providers.values());
    }
}

export const externalProviderRegistry = new ProviderRegistry();
