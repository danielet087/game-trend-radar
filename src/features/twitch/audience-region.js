import { filteredAudience } from './metrics.js';

export const DEFAULT_REGION = 'zh';
export const regionNames = { zh: '中文區', global: '全球' };
export const regionOf = value => value === 'global' ? 'global' : DEFAULT_REGION;
const validCount = value => Number.isSafeInteger(value) && value >= 0;

// Global totals remain the collection/admission authority. The selected view
// replaces only metrics, after catalog membership and identity are resolved.
export function forRegion(row, region = 'global') {
  if (region === 'global') return { ...row, audience_region: 'global' };
  const value = row.audience_regions?.zh;
  const available = value && validCount(row.viewer_count) && validCount(row.streamer_count) && validCount(value.viewer_count) && validCount(value.streamer_count) &&
    value.viewer_count <= row.viewer_count && value.streamer_count <= row.streamer_count &&
    (value.streamer_count > 0 || value.viewer_count === 0);
  const audience = filteredAudience(available ? value.filtered_audience : null);
  if (available && ['complete', 'partial'].includes(audience.status) &&
      (audience.eligible_viewer_count > value.viewer_count ||
       audience.eligible_streamer_count + audience.excluded_low_viewer_count + audience.excluded_low_follower_count + audience.unknown_follower_count !== value.streamer_count)) {
    audience.status = 'invalid'; audience.median_viewer_count = null;
  }
  return { ...row, audience_region: 'zh', audience_region_status: available ? 'available' : 'unavailable',
    viewer_count: available ? value.viewer_count : null,
    streamer_count: available ? value.streamer_count : null,
    median_viewer_count: available ? value.median_viewer_count ?? null : null,
    filtered_audience: audience };
}
