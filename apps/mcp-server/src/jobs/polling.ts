import type { RateLimitConfig } from "@comvenio/connector-contracts";

export function nextJobPollDelayMs(
  attempt: number,
  config: RateLimitConfig,
  random: () => number = Math.random,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("Der Polling-Versuch ist ungültig.");
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("Die Polling-Jitterquelle ist ungültig.");
  const baseSeconds = config.polling_seconds[Math.min(attempt, config.polling_seconds.length - 1)]!;
  const jitterFraction = config.polling_jitter_percent / 100;
  const factor = 1 - jitterFraction + sample * jitterFraction * 2;
  return Math.round(baseSeconds * factor * 1_000);
}
