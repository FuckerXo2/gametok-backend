import { searchAssetCatalog, searchAnimationCatalog } from './asset-search.js';
import { resolveComponentAsset } from './asset-escalation-orchestrator.js';

/**
 * Hermes Asset Intelligence Tools
 * 
 * Provides structured tool definitions that can be supplied to DeepSeek or Qwen
 * when determining asset availability during game generation.
 */

export const ASSET_INTELLIGENCE_TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'request_component_asset',
            description: 'Request a 3D asset for a specific game component/entity. The orchestrator automatically searches the local catalog, filters technical compatibility, evaluates visual style, escalates to external public sources if needed, and returns either a ready-to-use CDN asset with scale multipliers or a procedural fallback directive.',
            parameters: {
                type: 'object',
                properties: {
                    component_id: {
                        type: 'string',
                        description: 'Identifier for the entity e.g. "player_character", "player_mount", "boss_dragon", "castle_wall"'
                    },
                    concept: {
                        type: 'string',
                        description: 'Descriptive entity concept e.g. "knight", "horse", "dragon", "greatsword"'
                    },
                    role: {
                        type: 'string',
                        description: 'Component role in gameplay e.g. "player", "enemy", "vehicle", "scenery", "pickup"'
                    },
                    category: {
                        type: 'string',
                        enum: ['characters', 'creatures', 'environment', 'props', 'weapons'],
                        description: 'Broad asset category'
                    },
                    rig_type: {
                        type: 'string',
                        enum: ['humanoid_standard', 'quadruped_standard', 'winged_creature', 'unrigged'],
                        description: 'Required skeleton/rig type'
                    },
                    style: {
                        type: 'string',
                        enum: ['low-poly', 'stylized', 'voxel', 'pixel-art', 'realistic'],
                        description: 'Artistic style'
                    },
                    required_capabilities: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Key animations/actions required e.g. ["idle", "walk", "attack"]'
                    },
                    visual_preferences: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Visual attributes e.g. ["armored", "dark", "glowing"]'
                    }
                },
                required: ['component_id', 'concept']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_animation_catalog',
            description: 'Search the shared animation motion library for compatible skeleton animations (e.g. walk, slash, punch, hit reaction) that can be retargeted to a humanoid or quadruped rig.',
            parameters: {
                type: 'object',
                properties: {
                    rig_target: {
                        type: 'string',
                        enum: ['humanoid_standard', 'quadruped_standard'],
                        description: 'Target skeleton type'
                    },
                    category: {
                        type: 'string',
                        enum: ['movement', 'combat', 'reaction', 'dance'],
                        description: 'Animation type'
                    },
                    action: {
                        type: 'string',
                        description: 'Specific movement or attack e.g. "walk", "sword_slash", "hit_reaction"'
                    },
                    role: {
                        type: 'string',
                        enum: ['attacker', 'victim', 'neutral'],
                        description: 'Combat interaction role'
                    }
                },
                required: ['rig_target']
            }
        }
    }
];

/**
 * Executes an asset tool call invoked by either DeepSeek or Qwen
 * @param {string} toolName 
 * @param {object} args 
 * @param {object} [context]
 * @returns {Promise<object>}
 */
export async function executeAssetTool(toolName, args = {}, context = {}) {
    if (toolName === 'request_component_asset') {
        const resolution = await resolveComponentAsset(args, context);
        if (resolution.status === 'selected') {
            const asset = resolution.asset;
            return {
                status: 'selected',
                component_id: args.component_id,
                source: resolution.source,
                asset: {
                    id: asset.id,
                    name: asset.name,
                    category: asset.category,
                    style: asset.style,
                    cdnUrl: asset.cdn_url,
                    rigType: asset.rig_type,
                    suggestedScale: asset.suggested_scale,
                    boundingBox: asset.bounding_box,
                    embeddedAnimations: asset.embedded_animation_names || []
                }
            };
        } else {
            return {
                status: 'procedural_fallback',
                component_id: args.component_id,
                reason: resolution.reason
            };
        }
    }

    if (toolName === 'search_animation_catalog') {
        const results = await searchAnimationCatalog(args);
        return {
            status: 'success',
            matchCount: results.length,
            animations: results
        };
    }

    throw new Error(`Unknown asset tool: "${toolName}"`);
}
