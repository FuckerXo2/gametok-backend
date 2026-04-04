import fs from 'fs';
import path from 'path';

export function buildOmniEnginePrompt(assetMap, manifest) {
    const templatesDir = path.join(process.cwd(), 'src/ai-engine/templates');
    let templatesList = "1. T01_TopDownShooter\n2. T02_WhackAMole\n3. T03_EndlessRunner\n4. T04_CatchFalling\n";
    try {
        const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.html'));
        if (files.length > 0) {
            templatesList = files.map(f => f.replace('.html', '')).join('\n');
        }
    } catch(e) {}

    return `You are a Game Modding AI. We have a massive library of pre-built, robust HTML5 mini-game templates.
You DO NOT write Javascript. Your entire job is to select the correct template and generate the JSON configuration to "skin" and "mod" the template to match the user's prompt.

=== AVAILABLE TEMPLATE ENGINES ===
${templatesList}

=== USER PROMPT ===
${manifest ? manifest.mechanics : "Create an engaging casual game."}

=== ASSETS PROVIDED SO FAR ===
${Object.keys(assetMap || {}).join(", ") || "None yet."}

=== YOUR TASK ===
You must return a raw JSON object (and nothing else). The JSON must match this EXACT schema:
{
    "selectedTemplateId": "T01_TopDownShooter", // EXACT string from the list above
    "config": {
        "primary_color": "#ff4466",
        "SCORE_LABEL": "KILLS",
        "HEALTH_LABEL": "ARMOR",
        "GAMEOVER_TITLE": "WASTED",
        "FINAL_SCORE_LABEL": "TOTAL KILLS",
        "RESTART_TEXT": "REDEPLOY",
        "heroSpeed": 8, // any specific parameter you want to tweak
        "gameSpeed": 10
    },
    // Assets needed to skin the game. Types can be "emoji", "kenney", or "ai". Only use "ai" if absolutely necessary. Emojis load instantly and are highly preferred.
    "neededAssets": {
        "HERO": { "type": "emoji", "value": "🦸‍♂️" },
        "ENEMY": { "type": "kenney", "value": "alien" },
        "BACKGROUND": { "type": "ai", "value": "A dark, starry nebula backdrop" }
    }
}

Do NOT output Markdown. Just raw JSON.`;
}

export function injectTemplate(templateId, config, assetMap) {
    const templatesDir = path.join(process.cwd(), 'src/ai-engine/templates');
    let rawHtml = '';
    try {
        rawHtml = fs.readFileSync(path.join(templatesDir, templateId + '.html'), 'utf-8');
    } catch(e) {
        rawHtml = fs.readFileSync(path.join(templatesDir, 'T01_TopDownShooter.html'), 'utf-8'); // fallback
    }

    // Prepare JSON parameters
    const safeConfig = config || {};
    const paramsStr = JSON.stringify(safeConfig);

    // Prepare Image Tags
    let assetTagsStr = '';
    if (assetMap) {
        for (const [key, url] of Object.entries(assetMap)) {
            assetTagsStr += `<img id="img_${key}" src="${url}" hidden>\n`;
        }
    }

    // Replace placeholders
    let finalHtml = rawHtml.replace('{{GAME_PARAMETERS}}', paramsStr);
    finalHtml = finalHtml.replace('{{ASSET_TAGS}}', assetTagsStr);
    
    // Replace text placeholders
    const textPlaceholders = ['primary_color', 'SCORE_LABEL', 'HEALTH_LABEL', 'TIMER_LABEL', 'GAMEOVER_TITLE', 'FINAL_SCORE_LABEL', 'RESTART_TEXT'];
    for (const ph of textPlaceholders) {
        const val = safeConfig[ph] || ph.replace(/_/g, ' ');
        const regex = new RegExp('{{' + ph + '}}', 'g');
        finalHtml = finalHtml.replace(regex, val);
    }
    
    // Ensure cleanup of any unfilled brackets
    finalHtml = finalHtml.replace(/{{.*?}}/g, '');

    return finalHtml;
}
