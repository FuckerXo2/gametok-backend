import { callQwenMultimodal } from '../../qwen-multimodal-client.js';

/**
 * Qwen Asset Visual Appraisal Evaluator
 * 
 * Performs multimodal visual evaluation over candidate 3D asset thumbnails
 * to verify artistic style, mood, and aesthetic fit before asset injection.
 */
export class QwenAssetEvaluator {
    /**
     * Evaluate asset candidates using Qwen3.8-Max vision
     * @param {Array<object>} candidates List of asset candidate records (with thumbnail_url)
     * @param {object} requirement Semantic component requirement
     * @returns {Promise<{ selectedId: string | null, confidence: number, rationale: string }>}
     */
    static async evaluateCandidates(candidates = [], requirement = {}) {
        if (!candidates || candidates.length === 0) {
            return { selectedId: null, confidence: 0, rationale: 'No candidate assets provided.' };
        }

        // If only 1 candidate and no thumbnail, return deterministic selection
        if (candidates.length === 1 && !candidates[0].thumbnail_url) {
            return { selectedId: candidates[0].id, confidence: 1.0, rationale: 'Single candidate matching technical criteria.' };
        }

        const candidateBriefs = candidates.map((c, i) => `
Candidate #${i + 1} (ID: "${c.id}"):
- Name: "${c.name}"
- Category/Style: ${c.category} / ${c.style}
- Rig Type: ${c.rig_type} (Bones: ${c.bone_count || 0})
- Embedded Animations: [${(c.embedded_animation_names || []).join(', ')}]
- Thumbnail: ${c.thumbnail_url || 'None'}
`).join('\n');

        const systemPrompt = `You are the Lead Art Director for GameTok.
Your task is to inspect candidate 3D game assets and choose the candidate that best matches the game's aesthetic and gameplay requirements.
Output your decision strictly as a JSON object with this exact structure:
{
  "selected_id": "string ID of chosen candidate OR null if all should be rejected",
  "confidence": 0.0 to 1.0,
  "rationale": "Brief explanation of why this candidate fits the style or why candidates were rejected"
}`;

        const userPrompt = `Game Component Requirement:
- Entity: "${requirement.concept}" (Role: ${requirement.role || 'game_entity'})
- Target Style: "${requirement.style || 'stylized'}"
- Required Rig: "${requirement.rig_type || 'unrigged'}"
- Visual Preferences: [${(requirement.visual_preferences || []).join(', ')}]

Available Candidates:
${candidateBriefs}

Inspect the candidates and return your JSON decision.`;

        try {
            const visualAttachments = candidates
                .filter(c => c.thumbnail_url)
                .map(c => ({
                    type: 'image_url',
                    image_url: { url: c.thumbnail_url }
                }));

            const response = await callQwenMultimodal({
                systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: userPrompt,
                        attachments: visualAttachments
                    }
                ],
                temperature: 0.2
            });

            // Parse JSON response
            const content = response.content || '{}';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    selectedId: parsed.selected_id || null,
                    confidence: Number(parsed.confidence) || 0.8,
                    rationale: parsed.rationale || 'Qwen visual appraisal completed.'
                };
            }

            // Fallback to first candidate if JSON parse missed
            return { selectedId: candidates[0].id, confidence: 0.8, rationale: 'Defaulted to top technical match.' };
        } catch (err) {
            console.warn(`⚠️ [Qwen Asset Evaluator] Multimodal evaluation skipped: ${err.message}. Defaulting to first candidate.`);
            return { selectedId: candidates[0].id, confidence: 0.7, rationale: 'Fallback to top technical candidate.' };
        }
    }
}
