import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORECAST_RULES, START_RULES, closestLaunches, forecastFrom, forecastModel, launchAnchor, launchForecast, launchStart } from '../src/features/twitch/launch-model.js';

const HOUR = 3600000, DAY = 24 * HOUR;
const iso = at => new Date(at).toISOString().replace('.000Z', 'Z');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/launch-start-cases.json', import.meta.url), 'utf8'));
const launchAt = Date.parse(fixture.launch_at);
const forecastCases = JSON.parse(readFileSync(new URL('./fixtures/launch-forecast-cases.json', import.meta.url), 'utf8'));

// Rows like fullSeriesRows: one per tracked hour, later runs override earlier ones.
function rowsFrom(runs, base = launchAt) {
  const hours = new Map();
  for (const [from, to, status, viewers] of runs) {
    for (let offset = from; offset < to; offset++) {
      const at = base + offset * HOUR;
      hours.set(at, { hour: iso(at), generated_at: status === 'missing' ? null : iso(at + 600000), status,
        viewer_count: status === 'observed' ? viewers : null, streamer_count: status === 'observed' ? 10 : null });
    }
  }
  return [...hours.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}

for (const item of fixture.cases) {
  test(`launch start (shared with the builder): ${item.name}`, () => {
    const result = launchStart(rowsFrom(item.runs), launchAt, launchAt + item.now * HOUR, { walkBack: item.walk_back });
    assert.deepEqual(result, { startAt: launchAt + item.start * HOUR, basis: item.basis });
  });
}

test('the start rule is the one the analysis settled on', () => {
  assert.deepEqual({ ...START_RULES }, { share: 0.25, floor: 300, gap: 12, density: 0.5, days: 14 });
});

test('rows published after the as-of time do not count', () => {
  const rows = rowsFrom([[-72, 0, 'observed', 800], [0, 30, 'observed', 2000]])
    .map(row => Date.parse(row.hour) < launchAt ? { ...row, generated_at: iso(launchAt + 40 * HOUR) } : row);
  assert.deepEqual(launchStart(rows, launchAt, launchAt + 30 * HOUR), { startAt: launchAt, basis: 'launch' });
  assert.equal(launchStart(rows, launchAt, launchAt + 41 * HOUR).startAt, launchAt - 72 * HOUR);
});

test('the anchor follows the current launch, and a full release keeps its own instant', () => {
  const rows = rowsFrom([[-72, 0, 'observed', 800], [0, 30, 'observed', 2000]]);
  const single = { release_reference: { date: '2026-11-05', precision: 'day', steam_appid: '1' } };
  const anchor = launchAnchor(single, rows, launchAt + 30 * HOUR, '2026-11-05T00:20:00Z');
  assert.deepEqual(anchor, { kind: 'release', launchAt, startAt: launchAt - 72 * HOUR, basis: 'pre_launch' });
  const twice = { ...single, launches: { early_access: { date: '2025-03-01', source: 'Steam 台灣商店' },
    full_release: { date: '2026-11-05', source: 'Steam 台灣商店' } } };
  assert.deepEqual(launchAnchor(twice, rows, launchAt + 30 * HOUR, '2026-11-05T00:20:00Z'),
    { kind: 'full_release', launchAt, startAt: launchAt, basis: 'launch' });
  assert.equal(launchAnchor({}, rows, launchAt + 30 * HOUR, null), null);
});

const model = forecastModel({ trained_through: '2026-11-24T16:00:00Z', launches: 40,
  checkpoints: { 24: Array.from({ length: 40 }, (_, i) => (i + 1) / 100), 48: Array.from({ length: 40 }, (_, i) => (i + 1) / 50) },
  backtest: { 48: { launches: 30, median_miss: 2.5, within_range: 0.7, thresholds: {} } } });

test('a forecast model needs both checkpoints of non-negative ratios', () => {
  assert.ok(model);
  assert.equal(forecastModel(null), null);
  assert.equal(forecastModel({ trained_through: '2026-11-24T16:00:00Z', checkpoints: { 24: [0.1] } }), null);
  assert.equal(forecastModel({ trained_through: 'later', checkpoints: { 24: [], 48: [] } }), null);
  assert.equal(forecastModel({ trained_through: '2026-11-24T16:00:00Z', checkpoints: { 24: [-1], 48: [0.2] } }), null);
});

test('the forecast uses 24 hours first, then 48, and stops when days 7-9 end', () => {
  const rows = rowsFrom([[0, 24, 'observed', 1000], [24, 48, 'observed', 500], [48, 220, 'observed', 100]]);
  assert.equal(launchForecast(rows, launchAt, launchAt + 23 * HOUR, model), null);
  const early = launchForecast(rows, launchAt, launchAt + 30 * HOUR, model);
  assert.equal(early.checkpoint, 24);
  assert.equal(early.base, 1000);
  assert.equal(early.launches, 40);
  assert.ok(Math.abs(early.median - 1000 * 0.205) < 1e-9);
  assert.ok(Math.abs(early.low - 1000 * 0.049) < 1e-9 && Math.abs(early.high - 1000 * 0.361) < 1e-9);
  // 100 viewers needs a ratio of 0.1 or more: 31 of the 40 past launches.
  assert.deepEqual(early.probabilities, { 100: 31 / 40, 1000: 0, 3000: 0 });
  const later = launchForecast(rows, launchAt, launchAt + 50 * HOUR, model);
  assert.equal(later.checkpoint, 48);
  assert.equal(later.base, 750);
  assert.equal(later.first, 1000);
  assert.deepEqual(later.backtest, { launches: 30, median_miss: 2.5, within_range: 0.7, thresholds: {} });
  assert.equal(launchForecast(rows, launchAt, launchAt + FORECAST_RULES.to * HOUR, model), null);
});

const close = (actual, expected) => Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected));
const bySize = (a, b) => a[0] - b[0] || a[1] - b[1];

for (const item of forecastCases.cases) {
  test(`forecast from the closest past launches (shared with the builder): ${item.name}`, () => {
    assert.deepEqual(closestLaunches(item.samples, item.base).sort(bySize), item.chosen);
    const result = forecastFrom(item.samples, item.base);
    assert.equal(result.launches, item.launches);
    assert.equal(result.pool, item.samples.length);
    for (const key of ['ratio', 'median', 'low', 'high']) assert.ok(close(result[key], item[key]), `${key}: ${result[key]} vs ${item[key]}`);
    assert.deepEqual(Object.fromEntries(Object.entries(result.probabilities).map(([key, value]) => [String(key), value])), item.chances);
  });
}

test('with sizes a big launch is compared with big launches only; without them every launch counts', () => {
  assert.deepEqual({ share: FORECAST_RULES.share, neighbours: FORECAST_RULES.neighbours }, { share: 0.5, neighbours: 40 });
  // Twenty small launches lost every viewer; sixty bigger ones kept a fifth.
  const sizes = [...Array.from({ length: 20 }, (_, i) => [50 + i, 0]), ...Array.from({ length: 60 }, (_, i) => [1000 * (i + 1), 0.2])];
  const sized = forecastModel({ trained_through: '2026-11-24T16:00:00Z', checkpoints: { 24: sizes.map(([, r]) => r), 48: sizes.map(([, r]) => r) },
    samples: { 24: sizes, 48: sizes } });
  const rows = rowsFrom([[0, 30, 'observed', 100000]]);
  const big = launchForecast(rows, launchAt, launchAt + 30 * HOUR, sized);
  assert.deepEqual([big.launches, big.pool, big.probabilities[3000]], [40, 80, 1]);
  assert.ok(close(big.median, 20000));
  const pooled = launchForecast(rows, launchAt, launchAt + 30 * HOUR, { ...sized, samples: null });
  assert.deepEqual([pooled.launches, pooled.pool, pooled.probabilities[3000]], [80, 80, 0.75]);
  // Malformed sizes fall back to every launch.
  const broken = forecastModel({ trained_through: '2026-11-24T16:00:00Z', checkpoints: { 24: [0.2], 48: [0.2] }, samples: { 24: [[0, 0.2]], 48: [[10, 0.2]] } });
  assert.equal(broken.samples, null);
});

test('no forecast below 50 viewers in the first 24 hours, without enough hours or past launches', () => {
  const quiet = rowsFrom([[0, 48, 'observed', 49]]);
  assert.equal(launchForecast(quiet, launchAt, launchAt + 30 * HOUR, model), null);
  const sparse = rowsFrom([[0, 11, 'observed', 900], [11, 48, 'missing', null]]);
  assert.equal(launchForecast(sparse, launchAt, launchAt + 30 * HOUR, model), null);
  // Too few hours in the first 48 keep the 24-hour forecast.
  const gap = rowsFrom([[0, 23, 'observed', 900], [23, 48, 'missing', null]]);
  assert.equal(launchForecast(gap, launchAt, launchAt + 50 * HOUR, model).checkpoint, 24);
  const thin = forecastModel({ trained_through: '2026-11-24T16:00:00Z', checkpoints: { 24: [0.2], 48: [0.2] } });
  assert.equal(launchForecast(rowsFrom([[0, 30, 'observed', 900]]), launchAt, launchAt + 30 * HOUR, thin), null);
  assert.equal(launchForecast(rowsFrom([[0, 30, 'observed', 900]]), launchAt, launchAt + 30 * HOUR, null), null);
});

test('forecast wording rounds to two figures, writes out the ends of the chances and says why the start moved', async () => {
  const { about, chance, launchForecastShort, launchForecastText, launchStartText } = await import('../src/features/twitch/launch-advice.js');
  assert.deepEqual([about(56.4), about(234), about(1234), about(12345), about(null)], ['56', '230', '1,200', '12,000', '—']);
  assert.deepEqual([chance(0.02), chance(0.5), chance(0.333), chance(0.97), chance(undefined)], ['不到 5%', '50%', '35%', '超過 95%', '—']);
  assert.equal(launchStartText({ basis:'launch', launchAt, startAt:launchAt }), null);
  assert.equal(launchStartText({ basis:'pre_launch', launchAt, startAt:launchAt - 121 * HOUR }),
    '上市前 5 天就已經有上市水準的實況，天數從 10/31 07:00 起算。');
  assert.equal(launchStartText({ basis:'pre_launch', launchAt, startAt:launchAt - 5 * HOUR }),
    '上市前 5 小時就已經有上市水準的實況，天數從 11/05 03:00 起算。');
  // Streams that go live just before the unlock keep the start but are not called out.
  assert.equal(launchStartText({ basis:'pre_launch', launchAt, startAt:launchAt - 2 * HOUR }), null);
  assert.equal(launchStartText({ basis:'pre_launch', launchAt, startAt:launchAt - 3 * HOUR }),
    '上市前 3 小時就已經有上市水準的實況，天數從 11/05 05:00 起算。');
  const rows = rowsFrom([[0, 30, 'observed', 1000]]);
  const early = launchForecast(rows, launchAt, launchAt + 30 * HOUR, model);
  const text = launchForecastText(early, 'zh');
  assert.equal(text.title, '上市第 7～9 天約 210 人');
  assert.equal(text.text, '首 24 小時中位數 1,000 人（全球觀眾）。照過去 40 款新作，第 7～9 天大約是首 24 小時的 21%；'
    + '換成這款，中間八成落在 49～360 人；滿 48 小時後改用前 48 小時再算一次。');
  assert.deepEqual(text.chances, [[100, '80%'], [1000, '不到 5%'], [3000, '不到 5%']]);
  assert.deepEqual(launchForecastShort(early), { label:'第 7～9 天預估', text:'約 210 人（100 人 80% · 1,000 人 不到 5% · 3,000 人 不到 5%）' });
  assert.equal(launchForecastText(null), null);
});
