import { filteredAudience } from './metrics.js';

export const DEFAULT_REGION = 'global';
export const regionNames = { zh: '中文區', global: '全球', compare: '兩區比較' };
export const regionOf = value => ['global', 'zh'].includes(value) ? value : DEFAULT_REGION;
export const viewOf = value => ['global', 'zh', 'compare'].includes(value) ? value : DEFAULT_REGION;
export const VIEWER_TIERS = [30, 50, 100];
const validCount = value => Number.isSafeInteger(value) && value >= 0;

function viewerTiers(sample) {
  const counts = sample?.streamer_counts_above_viewers;
  if (!Array.isArray(counts) || counts.length !== VIEWER_TIERS.length ||
      !validCount(sample.viewer_count) || !validCount(sample.streamer_count) ||
      counts.some((count, i) => !validCount(count) || count > (i ? counts[i - 1] : sample.streamer_count))) return null;
  const minimum = counts.reduce((sum, count, i) => sum + count * (VIEWER_TIERS[i] - (VIEWER_TIERS[i - 1] ?? -1)), 0);
  return minimum <= sample.viewer_count ? counts : null;
}

// Global totals remain the collection/admission authority. The selected view
// replaces only metrics, after catalog membership and identity are resolved.
export function forRegion(row, region = 'global') {
  if (region !== 'zh') return { ...row, audience_region: 'global', streamer_counts_above_viewers: viewerTiers(row) };
  const value = row.audience_regions?.zh;
  const independent = value?.measurement_source === 'helix_language_filter';
  const available = value && validCount(value.viewer_count) && validCount(value.streamer_count) &&
    (independent || (validCount(row.viewer_count) && validCount(row.streamer_count) &&
      value.viewer_count <= row.viewer_count && value.streamer_count <= row.streamer_count)) &&
    (value.streamer_count > 0 || value.viewer_count === 0);
  const largest = value?.largest_stream_viewer_count;
  const concentrationAvailable = available && validCount(largest) && largest <= value.viewer_count &&
    largest * value.streamer_count >= value.viewer_count;
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
    largest_stream_viewer_count: concentrationAvailable ? largest : null,
    streamer_counts_above_viewers: available ? viewerTiers(value) : null,
    filtered_audience: audience };
}
