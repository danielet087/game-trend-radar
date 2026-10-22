import { HOUR, count, timestamp } from './metrics.js';

const WINDOW = 6, RECOVERY_HOURS = 12;
const iso = at => new Date(at).toISOString().replace('.000Z', 'Z');
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle) - 1]) / 2;
};

function normalize(rows) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!timestamp(row?.hour)) continue;
    const at = Date.parse(row.hour);
    if (at % HOUR) continue;
    unique.set(at, { at, hour: iso(at), raw: row.status === 'observed' ? count(row.viewer_count) : null });
  }
  return [...unique.values()].sort((a, b) => a.at - b.at);
}

/** A causal, threshold-based observation rule, rather than a prediction of permanent decline. */
export function analyzeCooldown(rows, { dropFraction = .5, confirmHours = 24 } = {}) {
  dropFraction = typeof dropFraction === 'number' && Number.isFinite(dropFraction) && dropFraction > 0 && dropFraction < 1 ? dropFraction : .5;
  confirmHours = Number.isSafeInteger(confirmHours) && confirmHours >= 1 && confirmHours <= 168 ? confirmHours : 24;
  const recoveryFraction = Math.max(.7, 1 - dropFraction + .1);
  const settings = { windowHours: WINDOW, dropFraction, confirmHours, recoveryFraction, recoveryHours: RECOVERY_HOURS };
  const slots = normalize(rows), points = [], episodes = [];
  let buffer = [], previousAt = null, peak = null, peakAt = null, candidate = null, active = null;
  let recoveryStart = null, recoveryPeak = null, recoveryPeakAt = null;
  let status = 'insufficient', sawSmooth = false, recovered = false, valid = 0;

  function interrupt(hour) {
    if (active) {
      active.interruptedAt = hour;
      // An incomplete recovery is not evidence of a completed return.
      active.recoveryAt = null;
      active = null;
    }
    candidate = null; recoveryStart = null; recoveryPeak = null; recoveryPeakAt = null;
    buffer = []; recovered = false; status = sawSmooth ? 'gap' : 'insufficient';
  }

  for (const slot of slots) {
    if (previousAt !== null && slot.at !== previousAt + HOUR) interrupt(iso(previousAt + HOUR));
    previousAt = slot.at;
    let smooth = null;
    if (slot.raw === null) interrupt(slot.hour);
    else {
      valid++; buffer.push(slot.raw);
      if (buffer.length > WINDOW) buffer.shift();
      if (buffer.length === WINDOW) {
        smooth = median(buffer); sawSmooth = true;
        if (active) {
          if (smooth >= active.baselineValue * recoveryFraction) {
            if (recoveryStart === null) {
              recoveryStart = slot.at; recoveryPeak = smooth; recoveryPeakAt = slot.hour;
              active.recoveryAt = slot.hour;
            }
            if (smooth > recoveryPeak) { recoveryPeak = smooth; recoveryPeakAt = slot.hour; }
            status = 'recovering';
            if (slot.at - recoveryStart >= RECOVERY_HOURS * HOUR) {
              active.recoveryConfirmedAt = slot.hour;
              active = null; peak = recoveryPeak; peakAt = recoveryPeakAt;
              recoveryStart = null; recoveryPeak = null; recoveryPeakAt = null;
              recovered = true; status = 'recovered';
            }
          } else {
            active.recoveryAt = null;
            recoveryStart = null; recoveryPeak = null; recoveryPeakAt = null;
            status = 'cooled';
          }
        } else {
          if (peak === null || smooth > peak) { peak = smooth; peakAt = slot.hour; }
          if (candidate && smooth > candidate.thresholdValue) candidate = null;
          if (!candidate && peak > 0 && smooth <= peak * (1 - dropFraction)) {
            candidate = { candidateAt: slot.hour, confirmedAt: null, baselineAt: peakAt,
              baselineValue: peak, thresholdValue: peak * (1 - dropFraction), recoveryAt: null,
              recoveryConfirmedAt: null, interruptedAt: null };
          }
          if (candidate) {
            status = 'suspected';
            if (slot.at - Date.parse(candidate.candidateAt) >= confirmHours * HOUR) {
              candidate.confirmedAt = slot.hour; episodes.push(candidate); active = candidate;
              candidate = null; recovered = false; status = 'cooled';
            }
          } else status = peak > 0 ? recovered ? 'recovered' : 'watching' : 'insufficient';
        }
      } else status = sawSmooth ? 'gap' : 'insufficient';
    }
    const baseline = active?.baselineValue ?? candidate?.baselineValue ?? peak;
    points.push({ hour: slot.hour, raw: slot.raw, smooth, baseline,
      threshold: baseline === null ? null : baseline * (1 - dropFraction), status });
  }
  const last = points.at(-1);
  const latest = { hour: last?.hour ?? null, raw: last?.raw ?? null, smooth: last?.smooth ?? null,
    baseline: last?.baseline ?? null,
    declineFraction: last?.baseline > 0 && last.smooth !== null ? (last.baseline - last.smooth) / last.baseline : null,
    candidateElapsedHours: candidate && last ? (Date.parse(last.hour) - Date.parse(candidate.candidateAt)) / HOUR : 0,
    recoveryElapsedHours: recoveryStart !== null && last ? (Date.parse(last.hour) - recoveryStart) / HOUR : 0 };
  return { settings, status, points, episodes, candidate, latest, coverage: { valid, total: slots.length },
    firstHour: points[0]?.hour ?? null, lastHour: last?.hour ?? null };
}
