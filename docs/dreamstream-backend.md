## DreamStream Backend

This backend currently has one real production game-generation path and one experimental alternate path.

### Production path

- App entrypoint: `gametok/src/services/api.ts`
- Backend route: `POST /api/ai/dream`
- Worker: `executeDreamJob()` in `src/ai-engine/routes.js`
- Models:
  - Phase 1 spec extraction: Gemma on NVIDIA NIM
  - Phase 2A artist: Qwen 3.5 on NVIDIA NIM
  - Phase 2B engineer: Qwen 3 Coder on NVIDIA NIM
- Verification: `verifyGame()` in `src/ai-engine/sandbox.js`
- Persistence: `ai_games` rows in `src/db.js`
- Preview payload returned to app: `html_payload` via `GET /api/ai/dream/status/:jobId`

### Experimental path

- Route: `POST /api/ai/dream-labs`
- Purpose: alternate provider experiments
- Current difference: uses the same Gemma spec stage, then an alternate Labs artist/engineer combination
- This path is not the default mobile app flow

### Source-of-truth files

- `src/ai-engine/routes.js`
  - API routes
  - job orchestration
  - provider/model wiring
- `src/ai-engine/promptRegistry.js`
  - prompt contracts
  - post-processing and runtime diagnostics injection
- `src/ai-engine/sandbox.js`
  - Puppeteer verification contract
- `src/db.js`
  - `ai_games` schema and compatibility migrations

### What is not production

The repo still contains old probes, test scripts, and provider experiments. Treat these as scratch space unless they are wired into `package.json`, imported by production code, or referenced by the routes above.

Good rule:
- If it is not called by `src/index.js`, `src/ai-engine/routes.js`, or a package script, it is probably not part of the live DreamStream path.

### Maintenance rule

When changing the DreamStream backend:

1. Update the route/prompt/sandbox contract together.
2. Keep provider labels truthful in comments and logs.
3. Run `npm run check:ai-engine` before shipping.
4. Prefer moving experiments into a clearly named folder instead of mixing them into the production root.
