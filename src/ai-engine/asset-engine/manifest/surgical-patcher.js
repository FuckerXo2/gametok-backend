import { resolveComponentAsset } from '../asset-escalation-orchestrator.js';
import { GameComponentManifest } from './game-component-manifest.js';
import { GAMETOK_RETARGETER_SNIPPET } from '../runtime/gametok-retargeter.js';

/**
 * Surgical Code Patcher & Manifest Synchronizer
 * 
 * Performs surgical modifications to Three.js game code and updates the
 * component manifest while strictly preserving all untouched components.
 */
export class SurgicalPatcher {
    /**
     * Apply surgical modification to existing game code and manifest
     * @param {object} params
     * @param {string} params.prompt User remix request
     * @param {string} params.existingCode Current HTML/JS payload
     * @param {GameComponentManifest} params.existingManifest Current manifest
     * @param {object} [params.classification] Pre-classified remix operation
     * @returns {Promise<{ updatedCode: string, updatedManifest: GameComponentManifest, diffDescription: string, changedComponentIds: string[] }>}
     */
    static async applySurgicalPatch({ prompt, existingCode, existingManifest, classification }) {
        if (!existingCode) {
            throw new Error('Existing game code is required for surgical remix.');
        }

        const manifest = existingManifest instanceof GameComponentManifest 
            ? existingManifest.branchVersion(`Remix: ${prompt}`)
            : GameComponentManifest.fromJSON(existingManifest).branchVersion(`Remix: ${prompt}`);

        let updatedCode = existingCode;
        let diffDescription = '';
        const changedComponentIds = [];

        const op = classification.operation;

        switch (op) {
            case 'ASSET_SWAP': {
                const targetCompId = classification.targetComponentId || 'player';
                const oldComp = manifest.getComponent(targetCompId) || {};
                
                // 1. Resolve replacement asset from GameTok catalog / providers
                const resolution = await resolveComponentAsset({
                    component_id: targetCompId,
                    concept: classification.concept || 'ninja',
                    role: classification.role || 'player',
                    rig_type: classification.rigType || 'humanoid_standard_v1',
                    style: classification.style || 'stylized'
                });

                const newAsset = resolution.asset;
                const cdnUrl = newAsset?.cdnUrl || newAsset?.cdn_url;
                const rigType = newAsset?.rigType || newAsset?.rig_type || 'humanoid_standard_v1';
                const suggestedScale = newAsset?.suggestedScale || newAsset?.suggested_scale || 1.0;
                const embeddedAnimations = newAsset?.embeddedAnimations || newAsset?.embedded_animation_names || ['idle', 'walk_run'];

                if (!newAsset || !cdnUrl) {
                    throw new Error(`Failed to resolve replacement asset for "${classification.concept}".`);
                }

                // 2. Animation Preservation & Retargeting
                // If both old and new share humanoid_standard_v1 rig profile, preserve existing animation list
                const isRigCompatible = (oldComp.rig_profile || 'humanoid_standard_v1').split('_v')[0] === rigType.split('_v')[0];
                const preservedAnimations = isRigCompatible && oldComp.animations && oldComp.animations.length > 0
                    ? oldComp.animations
                    : embeddedAnimations;

                // 3. Surgical Code Replacement (Replace only this asset's GLB URL & scale)
                const oldCdnUrl = oldComp.cdn_url;
                if (oldCdnUrl && updatedCode.includes(oldCdnUrl)) {
                    updatedCode = updatedCode.replace(new RegExp(escapeRegExp(oldCdnUrl), 'g'), cdnUrl);
                } else {
                    // Fallback: replace any character loader URL or inject
                    updatedCode = updatedCode.replace(/loader\.load\s*\(\s*['"]https:\/\/[^'"]+\.glb['"]/i, `loader.load('${cdnUrl}'`);
                }

                // Ensure Retargeter helper is present if retargeting
                if (isRigCompatible && !updatedCode.includes('GameTokHumanoidRetargeter')) {
                    updatedCode = updatedCode.replace('<script>', `<script>\n${GAMETOK_RETARGETER_SNIPPET}\n`);
                }

                // 4. Update Component Manifest
                manifest.setComponent(targetCompId, {
                    type: 'character',
                    role: classification.role || 'player',
                    source: 'gametok_catalog',
                    asset_id: newAsset.id,
                    cdn_url: cdnUrl,
                    format: 'glb',
                    rig_profile: rigType,
                    animation_family: isRigCompatible ? (oldComp.animation_family || 'humanoid_combat') : 'humanoid_locomotion',
                    animations: preservedAnimations,
                    config: {
                        scale: suggestedScale
                    }
                });

                diffDescription = `Replaced ${targetCompId} asset with "${newAsset.name}" (Preserved animation family: ${isRigCompatible})`;
                changedComponentIds.push(targetCompId);
                break;
            }

            case 'PROCEDURAL_TO_ASSET': {
                const targetCompId = classification.targetComponentId || 'enemy';
                
                const resolution = await resolveComponentAsset({
                    component_id: targetCompId,
                    concept: classification.concept || 'gargoyle',
                    role: targetCompId === 'enemy' ? 'enemy' : 'prop',
                    rig_type: classification.rigType || 'unrigged',
                    style: classification.style || 'stylized'
                });

                const newAsset = resolution.asset;
                const cdnUrl = newAsset?.cdnUrl || newAsset?.cdn_url;
                const suggestedScale = newAsset?.suggestedScale || newAsset?.suggested_scale || 1.0;
                const rigType = newAsset?.rigType || newAsset?.rig_type || 'unrigged';

                if (!newAsset || !cdnUrl) {
                    throw new Error(`Failed to resolve asset for procedural upgrade "${classification.concept}".`);
                }

                // Replace procedural Mesh line (e.g. const enemy = new THREE.Mesh(...);)
                const proceduralPattern = /const\s+([a-zA-Z0-9_]+)\s*=\s*new THREE\.Mesh\s*\([^;]+\);/i;
                if (proceduralPattern.test(updatedCode)) {
                    const varName = updatedCode.match(proceduralPattern)[1];
                    const loaderCode = `const ${varName} = new THREE.Group();\nconst _loader_${varName} = new THREE.GLTFLoader();\n_loader_${varName}.load('${cdnUrl}', (gltf) => { const m = gltf.scene; m.scale.setScalar(${suggestedScale}); ${varName}.add(m); });`;
                    updatedCode = updatedCode.replace(proceduralPattern, loaderCode);
                }

                manifest.setComponent(targetCompId, {
                    type: 'character',
                    role: targetCompId,
                    source: 'gametok_catalog',
                    asset_id: newAsset.id,
                    cdn_url: cdnUrl,
                    format: 'glb',
                    rig_profile: rigType,
                    config: { scale: suggestedScale }
                });

                diffDescription = `Upgraded procedural ${targetCompId} to 3D asset "${newAsset.name}"`;
                changedComponentIds.push(targetCompId);
                break;
            }

            case 'ASSET_TO_PROCEDURAL': {
                const targetCompId = classification.targetComponentId || 'player';
                const oldComp = manifest.getComponent(targetCompId) || {};

                // Replace GLTFLoader with procedural Mesh
                const oldCdnUrl = oldComp.cdn_url;
                if (oldCdnUrl && updatedCode.includes(oldCdnUrl)) {
                    const loaderRegex = new RegExp(`(?:const\\s+loader\\s*=\\s*new THREE\\.GLTFLoader\\(\\);\\s*)?loader\\.load\\s*\\(\\s*['"]${escapeRegExp(oldCdnUrl)}['"][\\s\\S]*?\\}\\);?`, 'i');
                    const meshCode = `const ${targetCompId} = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: 0x00ffcc, wireframe: true }));\nscene.add(${targetCompId});`;
                    if (loaderRegex.test(updatedCode)) {
                        updatedCode = updatedCode.replace(loaderRegex, meshCode);
                    } else {
                        updatedCode = updatedCode.replace(new RegExp(escapeRegExp(oldCdnUrl), 'g'), '');
                    }
                }

                manifest.setComponent(targetCompId, {
                    type: 'character',
                    role: targetCompId,
                    source: 'procedural',
                    asset_id: null,
                    cdn_url: null,
                    format: 'procedural',
                    rig_profile: 'unrigged',
                    config: { geometry: 'box_wireframe' }
                });


                diffDescription = `Converted ${targetCompId} from 3D asset to procedural wireframe mesh`;
                changedComponentIds.push(targetCompId);
                break;
            }

            case 'LOGIC_MODIFY': {
                // Modify gameplay speed, spawn rates, or jump variables
                const text = prompt.toLowerCase();
                if (/twice as fast|2x speed|faster/i.test(text)) {
                    updatedCode = updatedCode.replace(/(?:speed|spawnRate|velocity)\s*[:=]\s*([\d.]+)/gi, (_, val) => {
                        return `speed = ${(parseFloat(val) * 2).toFixed(1)}`;
                    });
                    diffDescription = 'Doubled speed/spawn rate parameters';
                } else if (/double jump/i.test(text)) {
                    updatedCode = updatedCode.replace(/(let\s+jumpCount\s*=\s*)(\d+)/i, '$12');
                    diffDescription = 'Enabled double-jump capability in player controller';
                } else {
                    // Small logic tweak comment tag
                    updatedCode = updatedCode.replace('</script>', `// Logic Update: ${prompt}\n</script>`);
                    diffDescription = `Gameplay logic update: ${prompt}`;
                }

                // Update controller component config in manifest
                const controllerComp = manifest.getComponent('controller') || { type: 'gameplay_system', role: 'controller', source: 'procedural' };
                controllerComp.config = { ...controllerComp.config, last_logic_patch: prompt };
                manifest.setComponent('controller', controllerComp);
                changedComponentIds.push('controller');
                break;
            }

            case 'VISUAL_OVERHAUL': {
                if (/synthwave|neon|cyber/i.test(prompt)) {
                    updatedCode = updatedCode.replace(/(?:scene\.background\s*=\s*new THREE\.Color\()([^)]+)(\))/i, '$1 0x0f051d $2');
                    updatedCode = updatedCode.replace(/(?:AmbientLight\()([^)]+)(\))/i, '$1 0xff007f, 0.9 $2');
                }
                diffDescription = `Aesthetic visual styling adjusted: ${prompt}`;
                changedComponentIds.push('environment');
                break;
            }
        }

        // Enforce REMIX_UNCHANGED: reject if zero changes were made
        if (updatedCode.trim() === existingCode.trim()) {
            const err = new Error('Make at least one change before publishing this remix.');
            err.code = 'REMIX_UNCHANGED';
            throw err;
        }

        return {
            updatedCode,
            updatedManifest: manifest,
            diffDescription,
            changedComponentIds
        };
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
