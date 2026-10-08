import { createHelpers } from './helpers.js';
import { createComparison } from './comparison.js';
import { createJourney } from './journey.js';
import { createActivity } from './activity.js';

let initialized;

export function initInteractions({ insights, storage, motion }) {
  if (initialized) return initialized;
  const helpers = createHelpers(motion);
  const comparison = createComparison(insights, helpers);
  const enhancements = { ...helpers, attachCompare: comparison.attachCompare, feedback: comparison.feedback };
  const journey = createJourney(motion);
  createActivity({ insights, storage, motion, helpers });
  initialized = { RadarEnhancements: enhancements, RadarCompare: comparison.api, RadarJourney: journey };
  return initialized;
}
