// Viewer and channel counts on the Twitch pages are mostly medians, so half a
// viewer can show up (1,149,646.5). From 100 up the decimal tells nothing and
// is rounded away; smaller counts keep one decimal.
const decimal = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

export function formatCount(value) {
  return Math.abs(value) >= 100 ? whole.format(value) : decimal.format(value);
}
