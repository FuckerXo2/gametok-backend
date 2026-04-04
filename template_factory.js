import fs from 'fs';
import path from 'path';
import OpenAI from "openai";

const nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY || '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',
});

const genres = [
    "Breakout Clone", "Snake Game", "Space Invaders", "Flappy Bird",
    "Asteroids", "Pong", "Doodle Jump", "Memory Card Match",
    "Tic Tac Toe", "Aim Trainer", "Tetris-like Drop", "Piano Tiles",
    "Knife Hit", "Fruit Ninja (Slicing)", "Dodge the Lasers", "Platformer",
    "Tower Defense (Basic)", "Idle Clicker", "Racing (Top Down)", "Bullet Hell",
    "Color Switch", "Gravity Guy", "Helicopter Game", "Pacman Maze",
    "Frogger Crosser", "Typing Game", "Simon Says", "Whack-A-Mole Variant",
    "Mining/Digging Game", "Fishing Game", "Archery/Trajectory", "Pinball Bumper",
    "Billiards Physics", "Air Hockey", "Ski Slalom", "Bowling",
    "Bouncing DVD Logo", "Jetpack Joyride", "Don't Touch the Spikes", "Subway Surfers (3-lane)",
    "Rhythm Timing", "Line Rider (Draw path)", "Physics Stacker", "Water Sort Puzzle",
    "2048 Sliding", "Jigsaw Slide", "Word Search", "Hangman",
    "Trivia Quiz", "Tug of War Mashing"
];

const dest = path.join(process.cwd(), 'src/ai-engine/templates');
if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

async function createTemplate(genre, index) {
    const filename = `T${String(index).padStart(2, '0')}_${genre.replace(/[^a-zA-Z0-9]/g, '')}.html`;
    const prompt = `
You are an expert game developer building parametric engines.
Create a bulletproof HTML5 canvas game for: "${genre}".
Rules:
1. ONLY return the index.html content. NO markdown fences.
2. Follow this structure:
<!DOCTYPE html>
<html>
<head>
  <style>body{margin:0;overflow:hidden;background:#222;color:#fff} canvas{display:block;width:100vw;height:100vh;} #hud{position:absolute;top:10px;left:10px;} #game-over{display:none;position:absolute;inset:0;background:rgba(0,0,0,0.8);align-items:center;justify-content:center;flex-direction:column;}</style>
  <script id="game-params" type="application/json">{"speed": 5, "bgColor": "#222"}</script>
</head>
<body>
  <div style="display:none;" id="assets-container"></div>
  <div id="hud">Score: <span id="score">0</span></div>
  <canvas id="gameCanvas"></canvas>
  <div id="game-over"><h1 id="finalScore">0</h1><button id="restart-btn">Retry</button></div>
  <script>
     // YOUR BULLETPROOF MATH AND RENDER LOGIC HERE
  </script>
</body>
</html>
3. It must run infinitely without crashing using requestAnimationFrame.
`;
    
    try {
        console.log(`[Factory] Initiating Generation for ${genre}...`);
        const res = await nvidiaClient.chat.completions.create({
            model: "meta/llama-3.1-70b-instruct",
            messages: [{ role: "system", content: prompt }],
            max_tokens: 4000,
            temperature: 0.1
        });
        let html = res.choices[0].message.content.trim();
        if (html.startsWith('```')) {
            html = html.replace(/```html\n?/g, '').replace(/```\n?/g, '');
        }
        fs.writeFileSync(path.join(dest, filename), html);
        console.log(`[Factory] ++ Success: ${filename}`);
    } catch(e) {
        console.log(`[Factory] -- Failed: ${genre} - ${e.message}`);
    }
}

async function main() {
    console.log(`Starting massive 50-game template factory using Llama 70B...`);
    // Throttle to 5 instances at a time to prevent API rate limiting
    for (let i = 0; i < genres.length; i += 5) {
        const batch = genres.slice(i, i + 5);
        await Promise.all(batch.map((g, idx) => createTemplate(g, i + idx + 5)));
    }
    console.log("ALL 50 TEMPLATES GENERATED!");
}

main();
