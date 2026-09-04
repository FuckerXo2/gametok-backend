/**
 * Remix & Edit Request Classifier
 * 
 * Inspects the user's remix prompt against the existing component manifest and code
 * to determine the minimal surgical operations and model routing required.
 */
export class RemixClassifier {
    /**
     * Classify remix request into surgical operations
     * @param {object} params
     * @param {string} params.prompt User remix request
     * @param {import('./game-component-manifest.js').GameComponentManifest} params.manifest Current component manifest
     * @param {string} params.code Current game code
     * @returns {{ operation: string, targetComponentId?: string, concept?: string, rigType?: string, model: string, requiresQwenVisual: boolean, description: string }}
     */
    static classify({ prompt = '', manifest, code = '' }) {
        const text = prompt.toLowerCase().trim();

        // 1. Check for Procedural -> 3D Asset Upgrade (e.g. "turn the red cubes into gargoyles")
        if (/turn the .* (?:cubes|boxes|blocks|primitives) into|replace .* with (?:3d|a|an|curated)/i.test(text) ||
            (/gargoyle|dragon|knight|robot|car|monster|building|tower/i.test(text) && /cube|box|enemy|obstacle/i.test(text))) {
            const isEnemy = /enemy|cube|obstacle/i.test(text);
            const concept = text.match(/(?:into|with|a|an)\s+([a-z\s]+)/i)?.[1]?.trim() || 'gargoyle';
            return {
                operation: 'PROCEDURAL_TO_ASSET',
                targetComponentId: isEnemy ? 'enemy' : 'player',
                concept: concept.replace(/gothic\s+/i, '').trim(),
                style: /gothic|dark/i.test(text) ? 'stylized' : 'low-poly',
                rigType: /player|hero|ninja|knight|warrior|paladin|skeleton|samurai/i.test(concept) ? 'humanoid_standard_v1' : 'unrigged',
                model: 'deepseek-v4-flash',
                requiresQwenVisual: /dark|cyber|gothic|aesthetic|style/i.test(text),
                description: `Upgrade procedural ${isEnemy ? 'enemy' : 'player'} component to 3D asset "${concept}"`
            };

        }

        // 2. Check for Asset -> Procedural Downgrade (e.g. "turn the character into a glowing wireframe box")
        if (/turn .* into (?:a\s+)?(?:procedural|wireframe|cube|box|geometric)/i.test(text) ||
            /make .* procedural/i.test(text)) {
            const isPlayer = /player|character|hero/i.test(text);
            return {
                operation: 'ASSET_TO_PROCEDURAL',
                targetComponentId: isPlayer ? 'player' : 'enemy',
                model: 'deepseek-v4-flash',
                requiresQwenVisual: false,
                description: `Convert ${isPlayer ? 'player' : 'enemy'} component to procedural geometry`
            };
        }

        // 3. Check for Character / Asset Replacement (e.g. "change the player to a cyberpunk ninja")
        if (/change the player to|replace the player with|make the player|swap (?:the )?character/i.test(text) ||
            (/ninja|warrior|paladin|skeleton|wizard|samurai|robot/i.test(text) && /player|character/i.test(text))) {
            let concept = text.replace(/change the player to|replace the player with|make the player a|make the player|swap character to/gi, '').trim();
            concept = concept.replace(/^(?:a|an|the)\s+/i, '').trim();
            return {
                operation: 'ASSET_SWAP',
                targetComponentId: 'player',
                concept: concept || 'ninja',
                role: 'player',
                rigType: 'humanoid_standard_v1',
                style: /cyber|sci-fi/i.test(text) ? 'stylized' : 'stylized',
                model: 'deepseek-v4-flash',
                requiresQwenVisual: /dark|cyber|aesthetic|art/i.test(text),
                description: `Replace player component with "${concept}"`
            };
        }


        // 4. Check for Visual / Aesthetic Overhaul (e.g. "make the entire game dark synthwave")
        if (/make the (?:entire )?game (?:look )?(?:dark|synthwave|cyberpunk|retro|neon|pixel|pastel)/i.test(text) ||
            /aesthetic|visual style|shader|lighting/i.test(text)) {
            return {
                operation: 'VISUAL_OVERHAUL',
                model: 'qwen3.8-max',
                requiresQwenVisual: true,
                description: `Aesthetic visual overhaul: "${prompt}"`
            };
        }

        // 5. Default: Gameplay Logic / Mechanics Modification (e.g. "make enemies spawn twice as fast", "add double jump")
        return {
            operation: 'LOGIC_MODIFY',
            model: 'deepseek-v4-flash',
            requiresQwenVisual: false,
            description: `Surgical gameplay logic modification: "${prompt}"`
        };
    }
}
