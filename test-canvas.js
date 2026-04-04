import fs from 'fs';
import { injectTemplate } from './src/ai-engine/prompt.js';

const json = { "selectedTemplateId": "TopDownShooter", "config": { "primary_color": "#ff00ff" }, "neededAssets": {} }
const testHtml = injectTemplate(json.selectedTemplateId, json.config, {});
fs.writeFileSync('output-canvas.html', testHtml);
