# GameTok Canvas Kernel

Shared runtime shell for AI-designed foundations. Do not put game logic here.
Phase 1.5 foundation agent + Phase 2 file agent own `src/main.ts`, `index.html`, and `src/styles.css`.

Fixed kernel files:
- `src/bootstrap.ts` — load DreamAssets then boot main
- `src/assetLoader.ts` — DREAM_IMAGES + background/item aliasing
- `src/types/global.d.ts` — window Dream runtime types
- Vite/TS build config
