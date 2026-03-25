// src/core/speedAssist.js
import { wrap } from "./math";

// ===== speed assist (ranges) =====

function getGreenStartCandidatesBySpeed({
  distanceM,
  speedKmh,
  nowSec,
  T,
  G,
  thetaAbs,
}) {
  const v = speedKmh / 3.6;
  if (!(v > 0)) return { top: null, mid: null, bot: null, arriveGreen: null };

  const tArr = distanceM / v;
  const tGlobal = nowSec + tArr;

  const tMod = wrap(tGlobal - thetaAbs, T);
  const cycleGreenStartAbs = tGlobal - tMod;
  const baseRel = cycleGreenStartAbs - nowSec;

  const top = baseRel - T;
  const mid = baseRel;
  const bot = baseRel + T;

  const arriveGreen = tMod < G;

  // あなたの仕様：赤到達なら top を表示しない（nullに落とす）
  if (!arriveGreen) return { top: null, mid, bot, arriveGreen };
  return { top, mid, bot, arriveGreen };
}

function startTimeToSpeedRange({ distanceM, startRelSec, G, maxSpeedKmh }) {
  if (startRelSec == null) return null;

  // 青の残り（終了まで）
  const endRemaining = startRelSec + G;
  if (!(endRemaining > 0)) return null;

  // 遅い側：青終端にギリ到達
  const low = (distanceM / endRemaining) * 3.6;
  if (!(low > 0)) return null;
  if (low > maxSpeedKmh) return null;

  // 速い側：青開始にギリ到達（開始が過去なら∞→maxでクリップ）
  const startForHigh = Math.max(0, startRelSec);
  const highCandidate =
    startForHigh > 0 ? (distanceM / startForHigh) * 3.6 : Infinity;
  const high = Math.min(maxSpeedKmh, highCandidate);

  if (low > high) return null;

  return {
    low,
    high,
    start: startRelSec,
    end: startRelSec + G,
  };
}

function overlap(a, b, eps = 1e-6) {
  return Math.max(a.low, b.low) <= Math.min(a.high, b.high) + eps;
}

export function buildSpeedRanges({
  distanceM,
  nowSpeedKmh,
  maxSpeedKmh = 35,
  T,
  G,
  thetaAbs,
  nowSec,
}) {
  if (!(Number.isFinite(T) && T > 0)) return [];
  if (!(Number.isFinite(G) && G > 0)) return [];
  if (!Number.isFinite(thetaAbs)) return [];
  if (!Number.isFinite(nowSec)) return [];
  if (!(Number.isFinite(distanceM) && distanceM > 0)) return [];
  if (!(Number.isFinite(nowSpeedKmh) && nowSpeedKmh > 0)) return [];

  const cand = getGreenStartCandidatesBySpeed({
    distanceM,
    speedKmh: nowSpeedKmh,
    nowSec,
    T,
    G,
    thetaAbs,
  });

  const ranges = [];
  const add = (tag, startRelSec) => {
    const r = startTimeToSpeedRange({ distanceM, startRelSec, G, maxSpeedKmh });
    if (!r) return;
    if (ranges.some((q) => overlap(q, r))) return;
    ranges.push({ tag, ...r });
  };

  add("top", cand.top);
  add("mid", cand.mid);
  add("bot", cand.bot);

  return ranges;
}

export function phaseAtArrival({
  distanceM,
  speedKmh,
  nowSec,
  T,
  G,
  thetaAbs,
}) {
  const v = speedKmh / 3.6;
  if (!(v > 0)) return { phase: "—", tArr: null, tMod: null };

  const tArr = distanceM / v;
  const tGlobal = nowSec + tArr;
  const tMod = wrap(tGlobal - thetaAbs, T);
  const phase = tMod < G ? "青" : "赤";
  return { phase, tArr, tMod };
}
