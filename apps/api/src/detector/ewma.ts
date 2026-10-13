export interface SpikeOptions {
  alpha: number;
  zThreshold: number;
  minCount: number;
  minHistory: number;
}

export interface SpikeResult {
  /** How many standard deviations `current` is above the baseline. */
  z: number;
  baseline: number;
  std: number;
  isSpike: boolean;
}

/** How much a minute that looks like a spike counts toward the baseline, relative to a normal one. */
const SPIKE_WEIGHT = 0.25;

/** Counts are events, so their natural spread is about sqrt(mean) (Poisson); never use less. */
function spread(variance: number, mean: number): number {
  return Math.max(Math.sqrt(variance), Math.sqrt(mean), 1);
}

/**
 * Judges one minute against an exponentially weighted moving average (EWMA) of the minutes
 * before it. `history` is oldest-first with missing minutes as 0.
 *
 * Minutes that are themselves spikes still enter the baseline, but clipped at the threshold and
 * with a quarter of the normal weight, and they do not widen the spread. A long incident therefore cannot quickly teach the
 * baseline that "this is normal" and silence itself, while a permanent shift is still learned
 * eventually.
 */
export function evaluateSpike(
  history: number[],
  current: number,
  options: SpikeOptions,
): SpikeResult {
  const { alpha, zThreshold, minCount, minHistory } = options;
  if (history.length === 0) return { z: 0, baseline: 0, std: 1, isSpike: false };

  let mean = history[0];
  let variance = 0;
  for (let i = 1; i < history.length; i++) {
    const ceiling = mean + zThreshold * spread(variance, mean);
    const isSpike = history[i] > ceiling;
    const value = isSpike ? ceiling : history[i];
    const weight = isSpike ? alpha * SPIKE_WEIGHT : alpha;
    const diff = value - mean;
    const step = weight * diff;
    mean += step;
    // A spike minute must not also inflate the spread, or it would excuse the next one.
    if (!isSpike) variance = (1 - weight) * (variance + diff * step);
  }

  const std = spread(variance, mean);
  const z = (current - mean) / std;
  return {
    z,
    baseline: mean,
    std,
    isSpike: history.length >= minHistory && current >= minCount && z >= zThreshold,
  };
}
