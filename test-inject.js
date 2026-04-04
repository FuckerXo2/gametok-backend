import { injectTemplate } from './src/ai-engine/prompt.js';

const json = {
    "selectedTemplateId": "TopDownShooter",
    "config": {
        "primary_color": "#ff4466",
        "SCORE_LABEL": "KILLS"
    },
    "neededAssets": {
        "HERO": { "type": "emoji", "value": "🦸‍♂️" }
    }
};

try {
    const html = injectTemplate(json.selectedTemplateId, json.config, {"HERO": "data:image/svg+... "});
    console.log("HTML:", html.substring(0, 500));
} catch(e) {
    console.error("ERROR:", e);
}
