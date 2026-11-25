import { filteredAudience } from './metrics.js';

export const DEFAULT_REGION = 'global';
export const regionNames = { zh: '中文區', global: '全球', compare: '兩區比較' };
export const regionOf = value => ['global', 'zh'].includes(value) ? value : DEFAULT_REGION;
export const viewOf = value => ['global', 'zh', 'compare'].includes(value) ? value : DEFAULT_REGION;
// Channels with more viewers than each tier, counted every hour. Hours
// collected before 2026-11-26 have three tiers; the 60-viewer tier came then.
export const VIEWER_TIERS = [30, 50, 60, 100];
const LEGACY_VIEWER_TIERS = [30, 50, 100];
export const CHINESE_MEASUREMENT_CHANGE_AT = '2026-11-15T08:00:00Z';
export const isIndependentChineseMeasurement = row => row?.audience_regions?.zh?.measurement_source === 'helix_language_filter';
const validCount = value => Number.isSafeInteger(value) && value >= 0;

/** The tiers a list of counts was collected with, or null. */
export function tierLayout(counts) {
  if (!Array.isArray(counts)) return null;
  return [VIEWER_TIERS, LEGACY_VIEWER_TIERS].find(tiers => tiers.length === counts.length) ?? null;
}

/** Channels with more than `viewers` viewers, or null when that tier was not counted. */
export function channelsAbove(counts, viewers) {
  const layout = tierLayout(counts), i = layout ? layout.indexOf(viewers) : -1;
  return i < 0 ? null : counts[i];
}

function viewerTiers(sample) {
  const counts = sample?.streamer_counts_above_viewers, layout = tierLayout(counts);
  if (!layout || !validCount(sample.viewer_count) || !validCount(sample.streamer_count) ||
      counts.some((count, i) => !validCount(count) || count > (i ? counts[i - 1] : sample.streamer_count))) return null;
  const minimum = counts.reduce((sum, count, i) => sum + count * (layout[i] - (layout[i - 1] ?? -1)), 0);
  return minimum <= sample.viewer_count ? counts : null;
}

// Global totals remain the collection/admission authority. The selected view
// replaces only metrics, after catalog membership and identity are resolved.
export function forRegion(row, region = 'global') {
  if (region !== 'zh') return { ...row, audience_region: 'global', streamer_counts_above_viewers: viewerTiers(row) };
  const value = row.audience_regions?.zh;
  const independent = isIndependentChineseMeasurement(row);
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
