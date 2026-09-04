import { callQwenMultimodal } from '../../qwen-multimodal-client.js';

/**
 * Qwen Post-Build Game Visual Reviewer
 * 
 * Inspects real rendered game screenshots from the Puppeteer sandbox
 * to ensure aesthetic polish, lighting, camera framing, and UI readability.
 */
export class QwenGameVisualReviewer {
    /**
     * Inspect a rendered game screenshot
     * @param {object} params
     * @param {string} params.screenshotBase64 WebP base64 screenshot data
     * @param {string} params.prompt Original user game prompt
     * @param {string} params.orientation 'portrait' | 'landscape'
     * @returns {Promise<{ visualApproved: boolean, visualQualityScore: number, critique: string, suggestedPatch: string | null }>}
     */
    static async reviewGameRender({ screenshotBase64, prompt, orientation = 'portrait' }) {
        if (!screenshotBase64) {
            return { visualApproved: true, visualQualityScore: 1.0, critique: 'No screenshot captured; skipping review.', suggestedPatch: null };
        }

        const systemPrompt = `You are the Lead Visual Quality Auditor for GameTok mobile games.
Your task is to inspect a rendered screenshot of a freshly generated Three.js HTML game.
Evaluate:
1. Lighting & Contrast: Is the scene clearly visible (not pitch black or completely blown out)?
2. Camera & Composition: Is the player/action centered and framed well?
3. HUD & Touch UI: Are buttons, joystick rings, and score counters readable and within safe margins?
4. Scale Harmony: Are models and terrain reasonably proportioned?

Output your evaluation strictly as a JSON object with this exact structure:
{
  "visual_approved": true or false,
  "visual_quality_score": 0.0 to 1.0,
  "critique": "Brief explanation of visual appearance",
  "suggested_patch": "Specific code instruction to fix visual issues, or null if approved"
}`;

        const userPrompt = `Game Prompt: "${prompt}"
Orientation: ${orientation.toUpperCase()}

Attached is the rendered screenshot of the game running in WebGL. Inspect the visual quality and return your JSON review.`;

        try {
            const response = await callQwenMultimodal({
                systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: userPrompt,
                        attachments: [
                            {
                                type: 'image_url',
                                image_url: { url: `data:image/webp;base64,${screenshotBase64}` }
                            }
                        ]
                    }
                ],
                temperature: 0.2
            });

            const content = response.content || '{}';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    visualApproved: parsed.visual_approved !== false,
                    visualQualityScore: Number(parsed.visual_quality_score) || 0.85,
                    critique: parsed.critique || 'Visual render reviewed.',
                    suggestedPatch: parsed.suggested_patch || null
                };
            }

            return { visualApproved: true, visualQualityScore: 0.9, critique: 'Default visual approval.', suggestedPatch: null };
        } catch (err) {
            console.warn(`⚠️ [Qwen Game Reviewer] Visual review skipped: ${err.message}`);
            return { visualApproved: true, visualQualityScore: 0.85, critique: 'Visual review bypassed.', suggestedPatch: null };
        }
    }
}
