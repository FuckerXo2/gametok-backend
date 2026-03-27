
import { Anthropic } from '@anthropic-ai/sdk';
import { buildOmniEnginePrompt } from './src/ai-engine/prompt.js';
import { compileGameHTML } from './src/ai-engine/compiler.js';
import { verifyGame } from './src/ai-engine/sandbox.js';
import fs from 'fs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const prompt = "Create a game where a gooner is at work and is trying to goo...";

async function test() {
    console.log("Mocking planner...");
    const manifest = { mechanics: prompt, assets: [] };
    const systemInstruction = buildOmniEnginePrompt({}, manifest);
    
    console.log("Calling Sonnet...");
    const coderTools = [{
        name: "generate_game_code",
        description: "Generate the complete Canvas2D game code.",
        input_schema: {
            type: "object",
            properties: {
                title: { type: "string" }, engine: { type: "string" },
                settings: { type: "object" }, code: { type: "string" }
            },
            required: ["title", "engine", "settings", "code"]
        }
    }];

    const codeRes = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: systemInstruction,
        messages: [{ role: "user", content: "CREATE THIS GAME:\n" + prompt }],
        tools: coderTools,
        tool_choice: { type: "tool", name: "generate_game_code" }
    });

    const toolUse = codeRes.content.find(c => c.type === 'tool_use');
    if (!toolUse) return console.error("No JSON");
    const json = toolUse.input;
    if (!json.code) return console.error("Missing code");

    fs.writeFileSync('test_code.js', json.code);

    const html = compileGameHTML(json, {});
    fs.writeFileSync('test_game.html', html);

    console.log("Verifying with Puppeteer...");
    const result = await verifyGame(html);
    console.log("Sandbox Result:", JSON.stringify(result, null, 2));
}

test().catch(console.error);
