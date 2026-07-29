// Game generation prompt — raw idea in, live-sourced assets out.
//
// The old blind-model pipeline (design plan → entity-level RAG over the v2 catalog → dominant-pack
// coherence re-rank → a forced "use ONLY these R2 URLs" asset list baked into the prompt) has been
// removed. Kimi now sources any art it wants LIVE from CC0 libraries at build time and verifies each
// asset actually loads before shipping it — those asset rules live in maker-kimi-cli-runner.js.
// This builder just frames the game idea and the non-asset build rules (engine, controls, layout,
// juice). It no longer touches the catalog, embeddings, or R2.

// Orientation is stated outright rather than implied. Before this existed the prompt only said
// "mobile phones inside a WebView", which left the model to guess the aspect ratio — and it guessed
// portrait, because the "never hardcode 390x844" example read as a portrait hint. A landscape game
// is played by rotating the WebView's content inside the portrait feed card, so as far as the game
// is concerned it simply boots into a wide viewport: no orientationchange, no resize, no runtime
// orientation handling of its own.
const ORIENTATION_RULES = {
    portrait: `3. **Responsive Fullscreen (PORTRAIT)**: The viewport is a TALL, NARROW phone screen — roughly 390 wide by 844 high. Design the playfield to run vertically. The game must dynamically fill 100% of the screen: read window width/height dynamically and never hardcode a fixed size. Keep all HUD text, scores, timers, and buttons within a safe area (y ∈ [10%, 90%], x ∈ [5%, 95%]) so they are not cut off. Set html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}.`,

    landscape: `3. **Responsive Fullscreen (LANDSCAPE)**: The viewport is a WIDE, SHORT screen — roughly 844 wide by 390 high. This is a real landscape viewport from the very first frame: do NOT write any rotation, orientationchange, or "please rotate your device" handling, and do NOT assume a portrait phone. Design the playfield to run horizontally (side-scrolling, wide arena, or a track receding into the distance) and use the full width. Vertical space is scarce, so keep the HUD in the CORNERS (score top-left, lives/timer top-right, controls bottom-left and bottom-right) and never in a band across the middle. The game must dynamically fill 100% of the screen: read window width/height dynamically and never hardcode a fixed size. Keep all HUD text, scores, timers, and buttons within a safe area (y ∈ [6%, 94%], x ∈ [4%, 96%]) so they are not cut off. Set html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}.`,
};

// LANDSCAPE ONLY. Landscape games carry noticeably more asset weight (wide parallax layers, long
// tracks, bigger sheets), so there is a real gap between "the document painted" and "the game is
// playable" that the host cannot fill: the app shows the game's cover art until the WebView
// finishes loading, but that is the network fetch, not the game's own asset decoding.
//
// The overlay must be static markup with inline styles, NOT rendered by the game's JS. Anything
// JS-rendered cannot appear until the bundle and the CDN engine have downloaded and executed —
// which is most of the wait it is supposed to cover.
//
// Portrait games are deliberately left alone: they are light enough that the host's cover art
// already covers the gap, and an extra overlay is one more thing to get wrong.
const LOADING_SCREEN_RULE = `
8. **Built-in Loading Screen (required for this landscape game)**: Landscape games load more art than portrait ones, so the player must never see an empty screen.
   - Put the loading overlay directly in index.html as plain markup with INLINE styles, before the game scripts. It must be visible from the moment the HTML parses — do NOT create it from JavaScript, because that cannot run until your bundle and any CDN engine have downloaded, which is exactly the wait you are covering.
   - Style it to fill the screen with the game's own palette (a themed background, the game's title, and a simple animated progress bar or spinner made from CSS only — no images, no webfonts, no external requests).
   - Hide it only once the game is genuinely ready to play: after your assets have loaded/decoded AND the first frame has been drawn. Fade it out over ~250ms and then set display:none so it never eats touches.
   - Drive it with real progress if your engine exposes it (Phaser's loader events, THREE.LoadingManager, or your own counter over an image/audio preload list). If you have no real number, animate the bar indefinitely rather than faking a percentage that jumps to 100.
   - Add a safety timeout: if loading has not completed after 15 seconds, hide the overlay anyway so a single failed asset can never leave the player stuck on a loading screen.`;

export async function buildGamePrompt(userPrompt, orientation = 'portrait') {
    const isLandscape = orientation === 'landscape';
    const orientationRule = ORIENTATION_RULES[isLandscape ? 'landscape' : 'portrait'];
    const loadingScreenRule = isLandscape ? LOADING_SCREEN_RULE : '';
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

${orientationRule}

4. **Designed Environments**: Environments must look visually appealing (gradients, layers, textured ground, details). Banned: a single flat background color, or plain wireframe grid.

5. **HUD Design**: Design a unique, beautiful HUD (custom font, score, health/lives with matching icons, restart buttons) themed to this game.

6. **Juice**: Add screen shake, visual feedback, or particles to make the game feel premium.

7. **Pure JavaScript**: Use standard JS (.js files). No TypeScript.
${loadingScreenRule}
`,
        user: `Create a complete web game based on this description:

${userPrompt}
`
    };
}
