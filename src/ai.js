// Re-export the AI router and OpenGame queue worker.
// Keeping this entrypoint avoids churn in src/index.js and older imports.

import aiRoutes from './ai-engine/routes.js';
export { startGenerationQueueWorker, stopGenerationQueueWorker } from './ai-engine/routes.js';
export { startForgeAutoscaler, stopForgeAutoscaler } from './ai-engine/forge-autoscale.js';
export default aiRoutes;
