// btc-cent-forecast-01 entry: "Patient Mean"
// Forecasts Bitcoin's price 240 minutes after each checkpoint.
//
// Model: persistence plus a whisper of trend.
//   forecast = last close + 0.1 * (24h linear-trend slope) * 240
// i.e. take the least-squares trend of the last 24 hours of closes,
// extrapolate it 4 hours, and use only a tenth of that move.
//
// Why this, honestly: 4-hour Bitcoin is very close to a martingale.
// Backtested on 37 days of hourly closes (~200 independent 4h
// checkpoints) and 30 days of 5-minute closes (~175 checkpoints),
// nothing reliably beat guessing the last close. Mean reversion toward
// the 24h mean — which looked good on the kit's 4-day practice window —
// lost decisively on the longer samples, in every week of them, and
// worse the harder it pulled. Momentum and hour-of-day drift were
// noise too (regression slopes near zero). The 24h trend at 10% weight
// was the only tilt that was never meaningfully worse than persistence
// on any sample, and a touch better on two of three.
// That is the point: the prize needs a score strictly below the house
// baseline, and the baseline IS persistence, so guessing the last close
// exactly ties it and can never take a place. The entry has to differ
// from persistence to have any chance — and the difference should be
// the smallest one with any evidence behind it, so the forecast stays
// within a fraction of a percent of the baseline while breaking the tie.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

// The trend is fitted over the last 24 hours of closes (one a minute).
const TREND_MINUTES = 1440;
// Only this share of the extrapolated 4-hour trend move is used.
const TREND_WEIGHT = 0.1;
// The horizon the cases ask for, in minutes.
const HORIZON_MINUTES = 240;

function fail(message: string): never {
  throw new Error(`entry rejected: ${message}`);
}

// Least-squares slope of the prices, in dollars per minute.
function slope(prices: number[]): number {
  const n = prices.length;
  const meanX = (n - 1) / 2;
  const meanY = prices.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (prices[i] - meanY);
    den += (i - meanX) * (i - meanX);
  }
  return den === 0 ? 0 : num / den;
}

// The forecast for one case: the last close plus a tenth of the
// 24-hour trend extrapolated over the horizon, rounded to the
// price grid's 5 decimals.
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
  const window = prices.slice(-Math.min(TREND_MINUTES, prices.length));
  const guess = last + TREND_WEIGHT * slope(window) * HORIZON_MINUTES;
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
