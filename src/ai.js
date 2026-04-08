// Re-export the DreamStream AI router from the modular ai-engine folder.
// Keeping this entrypoint avoids churn in src/index.js and older imports.

import aiRoutes from './ai-engine/routes.js';
export default aiRoutes;
