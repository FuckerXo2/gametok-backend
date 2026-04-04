import fs from 'fs';
import { injectTemplate } from './src/ai-engine/prompt.js';

const json = { "selectedTemplateId": "TopDownShooter", "config": { "primary_color": "#4a0000", "SCORE_LABEL": "TVs FOUND", "HEALTH_LABEL": "STAMINA", "GAMEOVER_TITLE": "CAUGHT BY THE PRIEST", "FINAL_SCORE_LABEL": "TVs COLLECTED", "RESTART_TEXT": "TRY AGAIN", "heroSpeed": 5, "enemySpeed": 4, "sprintMultiplier": 1.8, "visibilityRadius": 150, "collectibleCount": 8, "winConditionLabel": "COLLECT ALL" }, "neededAssets": { "HERO": { "type": "ai", "value": "player_boy" }, "ENEMY": { "type": "ai", "value": "enemy_priest" }, "COLLECTIBLE": { "type": "ai", "value": "glowing_tv" }, "BACKGROUND": { "type": "ai", "value": "horror_background" } } }

const testHtml = injectTemplate(json.selectedTemplateId, json.config, {"HERO": "http://img", "BACKGROUND": "http://bg"});
fs.writeFileSync('output-test.html', testHtml);
