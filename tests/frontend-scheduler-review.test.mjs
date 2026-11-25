import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReview, reviewVerdict, reviewNotice, reviewPanel } from '../src/features/scheduler/review.js';
import { dateLabel } from '../src/features/scheduler/primitives.js';

// The page's own date label (its space between date and time differs between ICU builds).
const at = iso => dateLabel(Date.parse(iso));

const check = (id, status, extra = {}) => ({ id, title: id === 'trial' ? '小遊戲試播標準' : id, status, rule: '規則 ' + id,
  summary: '這次 ' + id, baseline: '11-25：' + id, advice: '何時 ' + id, ...extra });
const review = (checks, extra = {}) => ({ schema_version: 1, generated_at: '2026-12-01T00:17:00Z', data_through: '2026-11-30T15:00:00Z',
  launches: 120, attention: checks.filter(c => c.status === 'watch').length, checks, ...extra });

test('a malformed review is not shown, and malformed checks are dropped', () => {
  assert.equal(validateReview(null), null);
  assert.equal(validateReview(review([check('trial', 'ok')], { schema_version: 2 })), null);
  assert.equal(validateReview(review([check('trial', 'ok')], { generated_at: '2026-12-01 00:17' })), null);
  assert.equal(validateReview(review([check('trial', 'maybe')])), null);
  const kept = validateReview(review([check('trial', 'ok'), { id: 'x', status: 'ok' }, check('forecast', 'few', { baseline: '' })]));
  assert.deepEqual(kept.checks.map(c => c.id), ['trial', 'forecast']);
  assert.equal(kept.checks[1].baseline, null);
  assert.equal(kept.launches, 120);
  assert.equal(kept.stamp, '2026-12-01T00:17:00Z');
});

test('the verdict names the rules to look at again', () => {
  assert.equal(reviewVerdict(validateReview(review([check('trial', 'ok'), check('forecast', 'ok')]))), '2 項都還在標準內，不用改。');
  assert.equal(reviewVerdict(validateReview(review([check('trial', 'watch'), check('forecast', 'ok'), check('curve', 'few')]))),
    '1 項要注意（小遊戲試播標準），要用回測重看；1 項正常；1 項案例還不夠，先不判斷。');
  assert.equal(reviewVerdict(validateReview(review([check('trial', 'few')]))), '1 項案例還不夠，先不判斷。');
});

test('the notice shows until this review has been dismissed', () => {
  const current = validateReview(review([check('trial', 'watch'), check('forecast', 'ok')]));
  assert.equal(reviewNotice(null, null), null);
  const notice = reviewNotice(current, null);
  assert.equal(notice.watch, true);
  assert.equal(notice.text, `每月重算有更新（${at('2026-12-01T00:17:00Z')}）：1 項要注意（小遊戲試播標準），要用回測重看；1 項正常。`);
  assert.equal(reviewNotice(current, '2026-12-01T00:17:00Z'), null);
  assert.ok(reviewNotice(current, '2026-11-25T09:00:00Z'));
  assert.ok(reviewNotice(current, 'not a time'));
  assert.equal(reviewNotice(validateReview(review([check('trial', 'ok')])), null).watch, false);
});

test('the panel lists the checks that need a look first and escapes their text', () => {
  const panel = reviewPanel(validateReview(review([check('trial', 'ok'), check('curve', 'few'), check('forecast', 'watch', { summary: '<b>2 倍</b>' })])));
  assert.equal(panel.date, '12/01 重算');
  assert.equal(panel.note, `${at('2026-12-01T00:17:00Z')} 重算 · 資料到 ${at('2026-11-30T15:00:00Z')} · 有首日紀錄的新作 120 款。1 項要注意（forecast），要用回測重看；1 項正常；1 項案例還不夠，先不判斷。`);
  assert.deepEqual([...panel.items.matchAll(/class="review-check is-(\w+)"/g)].map(m => m[1]), ['watch', 'few', 'ok']);
  assert.match(panel.items, /&lt;b&gt;2 倍&lt;\/b&gt;/);
  assert.match(panel.items, /<dt>這次<\/dt><dd>這次 trial<\/dd>/);
  assert.match(panel.items, /<span class="event-state state-interrupted">要注意<\/span>/);
  const empty = reviewPanel(null);
  assert.equal(empty.date, '尚未重算');
  assert.match(empty.items, /還沒有重算結果/);
});
