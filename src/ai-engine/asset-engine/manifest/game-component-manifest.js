/**
 * Game Component Manifest Schema & Domain Model
 * 
 * Persistent structural representation of all gameplay, visual, audio,
 * and procedural components that make up a GameTok game.
 */

export class GameComponentManifest {
    constructor(opts = {}) {
        this.game_id = opts.game_id || `game_${Date.now()}`;
        this.version = opts.version || 1;
        this.title = opts.title || 'Untitled Game';
        this.orientation = opts.orientation || 'portrait';
        this.components = {};
        
        if (opts.components && typeof opts.components === 'object') {
            for (const [id, comp] of Object.entries(opts.components)) {
                this.components[id] = { ...comp, component_id: id };
            }
        }

        this.lineage = {
            remixed_from: opts.lineage?.remixed_from || null,
            remixed_from_username: opts.lineage?.remixed_from_username || null,
            parent_version: opts.lineage?.parent_version || null,
            change_summary: opts.lineage?.change_summary || 'Initial creation'
        };

        this.created_at = opts.created_at || new Date().toISOString();
        this.updated_at = opts.updated_at || new Date().toISOString();
    }

    /**
     * Add or update a component in the manifest
     * @param {string} componentId 
     * @param {object} compData 
     */
    setComponent(componentId, compData) {
        this.components[componentId] = {
            component_id: componentId,
            type: compData.type || 'prop', // character | enemy | prop | environment | item | vfx | audio | ui | gameplay_system | shader
            role: compData.role || 'game_entity',
            source: compData.source || (compData.asset_id ? 'gametok_catalog' : 'procedural'),
            asset_id: compData.asset_id || null,
            cdn_url: compData.cdn_url || null,
            format: compData.format || (compData.cdn_url ? 'glb' : 'procedural'),
            rig_profile: compData.rig_profile || (compData.is_rigged ? 'humanoid_standard_v1' : 'unrigged'),
            animation_family: compData.animation_family || null,
            animations: Array.isArray(compData.animations) ? compData.animations : [],
            config: compData.config || {}
        };
        this.updated_at = new Date().toISOString();
    }

    /**
     * Get a component by ID
     * @param {string} componentId 
     * @returns {object | null}
     */
    getComponent(componentId) {
        return this.components[componentId] || null;
    }

    /**
     * Remove a component
     * @param {string} componentId 
     */
    removeComponent(componentId) {
        delete this.components[componentId];
        this.updated_at = new Date().toISOString();
    }

    /**
     * Create a new version snapshot for a remix/edit
     * @param {string} changeSummary Description of change
     * @returns {GameComponentManifest}
     */
    branchVersion(changeSummary = 'Remix update') {
        const cloned = new GameComponentManifest({
            game_id: this.game_id,
            version: this.version + 1,
            title: this.title,
            orientation: this.orientation,
            components: JSON.parse(JSON.stringify(this.components)),
            lineage: {
                remixed_from: this.lineage.remixed_from || this.game_id,
                remixed_from_username: this.lineage.remixed_from_username,
                parent_version: this.version,
                change_summary: changeSummary
            }
        });
        return cloned;
    }

    toJSON() {
        return {
            game_id: this.game_id,
            version: this.version,
            title: this.title,
            orientation: this.orientation,
            components: this.components,
            lineage: this.lineage,
            created_at: this.created_at,
            updated_at: this.updated_at
        };
    }

    static fromJSON(json) {
        if (!json) return new GameComponentManifest();
        const parsed = typeof json === 'string' ? JSON.parse(json) : json;
        return new GameComponentManifest(parsed);
    }
}
