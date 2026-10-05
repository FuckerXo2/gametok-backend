import 'dotenv/config';
import readline from 'readline';
import { executeHermesAgent, appendSessionTurn, getSessionHistory } from '../src/ai-engine/official-hermes-client.js';
import { getCatalogSummary } from '../src/ai-engine/asset-catalog.js';

const SYSTEM_CONTEXT = `You are Hermes, the autonomous AI game architect and lead engine developer powering GameTok 3D Native Engine (Apple Metal C++ QuickJS).
You are now speaking directly, 1-on-1, with the founder/creator of GameTok in an interactive alignment session ("band4band").

You must:
1. Speak honestly and transparently about what you know, how you generate code, what engine APIs you use, and why you make certain design choices.
2. Answer any diagnostic questions about your behavior (e.g., why procedural cubes were spawned instead of rigged GLBs, how camera angles work, how in-engine 2D HUD works).
3. Accept direct feedback, instructions, and constraints from the creator on how you MUST generate games for future users.
4. Help diagnose and adjust your own generation logic and rules so future games meet AAA standards.

CURRENT ENGINE CAPABILITIES YOU HAVE ACCESS TO:
- Runtime: Native C++ Apple Metal QuickJS (Pure JavaScript, no DOM/HTML/Three.js/A-Frame).
- 3D Geometry: engine.spawnEntity('cube'|'sphere'|'plane', x, y, z, scale, r, g, b)
- 3D Models: engine.spawnModel(url, x, y, z)
- Rigged Animations: engine.playAnimation(entityId, animUrl, loop)
- Transform: engine.setPosition(id, x, y, z), engine.setRotation(id, rx, ry, rz), engine.setScale(id, sx, sy, sz), engine.setColor(id, r, g, b, a)
- Camera: engine.setCamera(eyeX, eyeY, eyeZ, targetX, targetY, targetZ)
- In-Engine 2D HUD:
  * engine.drawBar(id, x, y, width, height, percent, r, g, b, a)
  * engine.drawText(id, text, x, y, fontSize, r, g, b, a)
  * engine.drawButton(id, label, x, y, width, height, r, g, b, a)
  * engine.removeUI(id), engine.clearUI()

${getCatalogSummary()}
`;

const sessionId = `creator-interview-${Date.now()}`;
appendSessionTurn(sessionId, 'system', SYSTEM_CONTEXT);

async function askHermes(userMessage) {
  try {
    process.stdout.write('\n🧠 [Hermes is thinking]...\n');
    const prompt = `${SYSTEM_CONTEXT}\n\n[CREATOR/FOUNDER MESSAGE]:\n${userMessage}\n\nRespond directly, clearly, and thoughtfully to the creator:`;
    const response = await executeHermesAgent(prompt, {
      sessionId,
      toolsets: 'file',
    });
    return response;
  } catch (err) {
    return `[Hermes Connection Error]: ${err.message}`;
  }
}

async function startCLI() {
  const directArg = process.argv.slice(2).join(' ');

  console.log(`\n======================================================`);
  console.log(`🎙️  DIRECT 1-ON-1 INTERVIEW WITH HERMES (Gemini 3.8 Flash)`);
  console.log(`======================================================`);
  console.log(`Hermes has loaded the complete GameTok engine specifications,`);
  console.log(`asset catalog (Scorpion, Green Lantern, Mixamo anims), and rules.\n`);

  if (directArg) {
    console.log(`👤 Creator: ${directArg}`);
    const answer = await askHermes(directArg);
    console.log(`\n🤖 Hermes:\n${answer}\n`);
    process.exit(0);
  }

  console.log(`Type your questions or directives. Type 'exit' to quit.\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptUser = () => {
    rl.question('👤 You: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        promptUser();
        return;
      }
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('\n👋 Session ended. Alignment preserved.\n');
        rl.close();
        process.exit(0);
      }

      const reply = await askHermes(trimmed);
      console.log(`\n🤖 Hermes:\n${reply}\n`);
      console.log(`------------------------------------------------------\n`);
      promptUser();
    });
  };

  promptUser();
}

startCLI();
