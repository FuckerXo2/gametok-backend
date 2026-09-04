import { GameComponentManifest } from './game-component-manifest.js';

/**
 * Manifest Synthesizer
 * 
 * Inspects generated Three.js HTML/JS code, asset tool execution logs, and game requirements
 * to synthesize a verified ground-truth component manifest.
 */
export class ManifestSynthesizer {
    /**
     * Synthesize a component manifest from code and state
     * @param {object} params
     * @param {string} params.gameId
     * @param {string} params.code Generated HTML/JS code
     * @param {string} [params.orientation] 'portrait' | 'landscape'
     * @param {object} [params.assetToolsLog] Log of asset tools executed during build
     * @param {object} [params.existingManifest] Previous manifest if remixing
     * @returns {GameComponentManifest}
     */
    static synthesize({ gameId, code = '', orientation = 'portrait', assetToolsLog = [], existingManifest = null }) {
        const manifest = existingManifest 
            ? GameComponentManifest.fromJSON(existingManifest).branchVersion('Generation update')
            : new GameComponentManifest({ game_id: gameId, orientation });

        if (!code) return manifest;

        // 1. Scan for 3D Asset URLs in code (GLTFLoader / R2 CDN URLs)
        const glbMatches = Array.from(code.matchAll(/(?:loader\.load\s*\(\s*['"](https:\/\/[^'"]+\.glb)['"]|['"](https:\/\/[^'"]+\.glb)['"])/gi));
        const foundUrls = new Set();
        
        for (const match of glbMatches) {
            const url = match[1] || match[2];
            if (url && !foundUrls.has(url)) {
                foundUrls.add(url);
                
                // Identify role and componentId from URL path or variable context
                let role = 'prop';
                let componentId = 'prop_' + url.split('/').pop().replace('.glb', '');
                
                if (url.includes('/characters/')) {
                    role = url.includes('player') ? 'player' : 'character';
                    componentId = role === 'player' ? 'player' : 'npc_' + url.split('/').pop().replace('.glb', '');
                } else if (url.includes('/environment/')) {
                    role = 'environment';
                    componentId = 'environment';
                } else if (url.includes('/weapons/')) {
                    role = 'weapon';
                    componentId = 'weapon_' + url.split('/').pop().replace('.glb', '');
                }

                // Check if already in tool execution log for enriched metadata
                const toolRecord = assetToolsLog.find(t => t.asset?.cdnUrl === url || t.asset?.cdn_url === url);
                const assetMeta = toolRecord?.asset || {};

                manifest.setComponent(componentId, {
                    type: role === 'player' || role === 'character' ? 'character' : 'prop',
                    role,
                    source: 'gametok_catalog',
                    asset_id: assetMeta.id || url.split('/').pop().replace('.glb', ''),
                    cdn_url: url,
                    format: 'glb',
                    rig_profile: assetMeta.rigType || assetMeta.rig_type || (role === 'player' ? 'humanoid_standard_v1' : 'unrigged'),
                    animation_family: assetMeta.animationFamily || 'humanoid_locomotion',
                    animations: assetMeta.embeddedAnimations || assetMeta.embedded_animation_names || ['idle', 'walk_run'],
                    config: {
                        scale: assetMeta.suggestedScale || 1.0
                    }
                });
            }
        }

        // 2. Scan for Procedural Gameplay Systems
        if (/PlaneGeometry|BoxGeometry.*floor|floor.*THREE\.Mesh/i.test(code) && !manifest.getComponent('environment')) {
            manifest.setComponent('environment', {
                type: 'environment',
                role: 'arena',
                source: 'procedural',
                format: 'procedural',
                config: { type: 'grid_plane' }
            });
        }

        if (/THREE\.BoxGeometry|THREE\.SphereGeometry|THREE\.CylinderGeometry/i.test(code)) {
            if (/player.*THREE\.Mesh|hero.*THREE\.Mesh/i.test(code) && !manifest.getComponent('player')) {
                manifest.setComponent('player', {
                    type: 'character',
                    role: 'player',
                    source: 'procedural',
                    format: 'procedural',
                    config: { geometry: 'box_primitive' }
                });
            }
            if (/enemy.*THREE\.Mesh|obstacle.*THREE\.Mesh/i.test(code) && !manifest.getComponent('enemy')) {
                manifest.setComponent('enemy', {
                    type: 'character',
                    role: 'enemy',
                    source: 'procedural',
                    format: 'procedural',
                    config: { geometry: 'obstacle_primitives' }
                });
            }
        }

        // 3. Scan for UI & Audio Systems
        if (/<div id=["']hud|score|joystick/i.test(code)) {
            manifest.setComponent('ui_hud', {
                type: 'ui',
                role: 'hud',
                source: 'generated',
                config: { has_score: true }
            });
        }

        if (/AudioContext|audio.*\.play/i.test(code)) {
            manifest.setComponent('audio_system', {
                type: 'audio',
                role: 'sfx',
                source: 'generated'
            });
        }

        return manifest;
    }
}
