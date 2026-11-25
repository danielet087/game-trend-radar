import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCount } from '../src/features/twitch/number-format.js';

test('counts from 100 up are whole numbers, smaller ones keep one decimal', () => {
  assert.deepEqual([1149646.5, 3159.5, 159.5, 100.4, -420981, -150.5].map(formatCount),
    ['1,149,647', '3,160', '160', '100', '-420,981', '-151']);
  assert.deepEqual([99.5, 4.5, 12.25, 0, 99.96].map(formatCount), ['99.5', '4.5', '12.3', '0', '100']);
});
