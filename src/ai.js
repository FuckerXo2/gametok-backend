// Re-export the AI router and OpenGame queue worker.
// Keeping this entrypoint avoids churn in src/index.js and older imports.

import aiRoutes from './ai-engine/routes.js';
export { startGenerationQueueWorker, stopGenerationQueueWorker } from './ai-engine/routes.js';
export default aiRoutes;
