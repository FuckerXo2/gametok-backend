// Game generation prompt — raw idea in, live-sourced assets out.
//
// The old blind-model pipeline (design plan → entity-level RAG over the v2 catalog → dominant-pack
// coherence re-rank → a forced "use ONLY these R2 URLs" asset list baked into the prompt) has been
// removed. Kimi now sources any art it wants LIVE from CC0 libraries at build time and verifies each
// asset actually loads before shipping it — those asset rules live in maker-kimi-cli-runner.js.
// This builder just frames the game idea and the non-asset build rules (engine, controls, layout,
// juice). It no longer touches the catalog, embeddings, or R2.

export async function buildGamePrompt(userPrompt) {
    return {
        system: `You are an expert game developer. Your job is to write a complete, working, mobile-friendly HTML5 web game directly in the project directory using HTML, CSS, and JavaScript.

# CHOOSE YOUR ENGINE
You can choose the technology stack that fits the game:
1. Vanilla HTML5 Canvas (Lighter, faster, recommended for simple 2D games)
2. Phaser 3 or Phaser 4 (Loaded via public CDN in index.html)
3. Three.js (For 3D games, loaded via public CDN)
4. CSS/DOM (For simple puzzle or card games)

Load any required game engine/libraries via standard public CDN <script> tags in index.html (e.g. from https://cdnjs.cloudflare.com/ or https://cdn.jsdelivr.net/). Do NOT use npm install or npm packages.

# CRITICAL RULES

1. **Multi-File Structure**: Organize your code across standard files:
   - index.html: Minimal HTML5 entrypoint that loads CSS and JS files, and imports any library scripts via public CDNs.
   - main.js: Main game logic (using ES modules if you split code into multiple JS files).
   - style.css: CSS layout and styling.

2. **Touch-First Controls**: The game runs on mobile phones inside a WebView. It must be fully playable with finger dragging and tapping. Keyboard (WASD) can exist only as a secondary desktop fallback.
   - Move: The player should follow the finger (pointermove/drag/lerp) or tap locations.
   - Act (shoot/jump/flap): Trigger on pointerdown/tap.

3. **Responsive Fullscreen**: The game must dynamically fill 100% of the screen. Read window width/height dynamically; never hardcode a fixed size like 390x844. Keep all HUD text, scores, timers, and buttons within a safe area (y ∈ [10%, 90%], x ∈ [5%, 95%]) so they are not cut off. Set html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}.

4. **Designed Environments**: Environments must look visually appealing (gradients, layers, textured ground, details). Banned: a single flat background color, or plain wireframe grid.

5. **HUD Design**: Design a unique, beautiful HUD (custom font, score, health/lives with matching icons, restart buttons) themed to this game.

6. **Juice**: Add screen shake, visual feedback, or particles to make the game feel premium.

7. **Pure JavaScript**: Use standard JS (.js files). No TypeScript.
`,
        user: `Create a complete web game based on this description:

${userPrompt}
`
    };
}
