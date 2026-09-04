/**
 * Structured Semantic Asset Requirement Schema
 * 
 * Defines the standard specification emitted by either DeepSeek or Qwen
 * when a component/entity in the game requests an asset.
 */

export const RIG_TYPES = {
    HUMANOID_STANDARD: 'humanoid_standard',
    QUADRUPED_STANDARD: 'quadruped_standard',
    WINGED_CREATURE: 'winged_creature',
    UNRIGGED: 'unrigged'
};

export const ASSET_STYLES = {
    LOW_POLY: 'low-poly',
    STYLIZED: 'stylized',
    VOXEL: 'voxel',
    PIXEL_ART: 'pixel-art',
    REALISTIC: 'realistic'
};

/**
 * Validates and normalizes a component asset requirement
 * @param {object} req 
 * @returns {object}
 */
export function normalizeAssetRequirement(req = {}) {
    if (!req || typeof req !== 'object') {
        throw new Error('Asset requirement must be an object.');
    }

    const componentId = String(req.component_id || req.role || `comp_${Date.now()}`).trim();
    const concept = String(req.concept || req.query || req.name || 'entity').trim();
    const role = String(req.role || 'game_entity').trim();
    let category = req.category ? String(req.category).trim().toLowerCase() : null;
    if (!category) {
        if (req.rig_type === RIG_TYPES.HUMANOID_STANDARD || role === 'player' || role === 'npc') {
            category = 'characters';
        } else if (req.rig_type === RIG_TYPES.QUADRUPED_STANDARD || req.rig_type === RIG_TYPES.WINGED_CREATURE) {
            category = 'creatures';
        }
    }
    const subcategory = req.subcategory ? String(req.subcategory).trim().toLowerCase() : null;

    const style = String(req.style || ASSET_STYLES.STYLIZED).trim().toLowerCase();
    const rigType = String(req.rig_type || RIG_TYPES.UNRIGGED).trim().toLowerCase();
    const requiredCapabilities = Array.isArray(req.required_capabilities) 
        ? req.required_capabilities.map(c => String(c).trim().toLowerCase()) 
        : [];
    const visualPreferences = Array.isArray(req.visual_preferences)
        ? req.visual_preferences.map(v => String(v).trim().toLowerCase())
        : [];

    return {
        component_id: componentId,
        concept,
        role,
        category,
        subcategory,
        style,
        rig_type: rigType,
        required_capabilities: requiredCapabilities,
        visual_preferences: visualPreferences,
        priority: req.priority || 'medium',
        procedural_fallback_feasible: req.procedural_fallback_feasible !== false,
        created_at: Date.now()
    };
}
