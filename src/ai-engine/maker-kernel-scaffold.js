import { buildMakerScaffoldForLane } from './maker-scaffold-router.js';

/** @deprecated Prefer buildMakerScaffoldForLane — kept for imports. */
export async function buildKernelScaffold(foundation = {}, qualityIntent = {}, laneSelection = null) {
    return buildMakerScaffoldForLane(foundation, qualityIntent, laneSelection);
}
