// btc-cent-forecast-01 entry: "Patient Mean"
// Forecasts Bitcoin's price 240 minutes after each checkpoint.
//
// Model, chosen by backtesting on the kit's practice history (a merged
// 92-hour minute series, Nov 7-11 2026, scored at 4-hour checkpoints):
//   forecast = last close + 0.2 * (24-hour mean - last close)
//
// Why this, and why so modest:
// - Guessing the last close (persistence) is the house baseline; the
//   prize needs a score strictly below it, so the entry must beat it.
//   (Persistence itself ties the baseline and can never take a place.)
// - 4-hour BTC returns show mild mean reversion toward the daily mean:
//   pulling 20% of the way toward the 24h mean beat persistence on
//   10 of 16 independent 4h checkpoints, in both halves of the sample,
//   and on the hourly grid too. Stronger pulls (0.3-0.5) looked better
//   on average but won no more often and swung much harder from case
//   to case; trend-following and EMA momentum both lost to persistence.
//   A small, robust edge beats a large, fragile one over 12 cases.
// - The 24h mean is always available: every case holds 4,320 closes
//   (72 hours), so the last 1,440 are the last 24 hours.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

// How far toward the 24-hour mean the forecast is pulled (0 = persistence).
const REVERSION = 0.2;
// The mean is taken over the last 24 hours of closes (one a minute).
const MEAN_MINUTES = 1440;

function fail(message: string): never {
  throw new Error(`entry rejected: ${message}`);
}

// The forecast for one case: last close pulled a fifth of the way
// toward its 24-hour mean, rounded to the price grid's 5 decimals.
function forecast(prices: number[]): number {
  if (!Array.isArray(prices) || prices.length === 0) {
    fail("case has no prices");
  }
  for (const p of prices) {
    if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) {
      fail("case holds a non-finite or non-positive price");
    }
  }
  const last = prices[prices.length - 1];
  const window = prices.slice(-Math.min(MEAN_MINUTES, prices.length));
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const guess = last + REVERSION * (mean - last);
  if (!Number.isFinite(guess) || guess <= 0 || guess >= 10_000_000) {
    fail(`forecast ${guess} is outside the allowed range`);
  }
  return Math.round(guess * 100000) / 100000;
}

const inputs = readdirSync(INPUT_DIR)
  .filter((name) => name.endsWith(".in"))
  .sort();
if (inputs.length === 0) fail(`no .in files in ${INPUT_DIR}`);

mkdirSync(OUT_DIR, { recursive: true });
for (const name of inputs) {
  const raw = JSON.parse(readFileSync(join(INPUT_DIR, name), "utf8"));
  if (raw.schema !== "makefun/btc-cent-case/v1") {
    fail(`${name}: unexpected schema ${raw.schema}`);
  }
  const caseId = raw.case;
  const markets = raw.markets;
  if (!Array.isArray(markets) || markets.length < 1) {
    fail(`${name}: no markets`);
  }
  const price = forecast(markets[0].prices);
  const outName = name.replace(/\.in$/, ".out");
  const out = { forecasts: [{ case: caseId, price }] };
  writeFileSync(join(OUT_DIR, outName), JSON.stringify(out), "utf8");
  console.log(`wrote ${outName}: ${caseId} -> ${price}`);
}
