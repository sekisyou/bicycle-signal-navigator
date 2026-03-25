// src/sim/simEngine.js
import { godAtTime } from "./godModel";
import { makeObservationFromTruth } from "./observer";

function randUniform(a, b) {
  return a + (b - a) * Math.random();
}

export function makeInitialSimState(baseEpochSec) {
  return {
    dayOffset: 0, // 観測開始日から何日目か（= 出発日 index）
    baseEpochSec: Number(baseEpochSec), // dayOffset=0 の「いつも使う時刻」の epoch 秒
    obs: [],
    run: null, // 走行中なら { running:true, departEpochSec, distanceM, traveledM, speedKmh, travelSecAccum }
  };
}

export function setBaseEpoch(state, baseEpochSec) {
  return {
    ...state,
    baseEpochSec: Number(baseEpochSec),
    dayOffset: 0,
    obs: [],
    run: null,
  };
}

export function stepDay(state) {
  // 走行中に日付をいじらない
  if (state.run?.running) return state;
  return { ...state, dayOffset: state.dayOffset + 1 };
}

export function resetSim(baseEpochSec) {
  return makeInitialSimState(baseEpochSec);
}

// ===== 走行A：観測ボタンを押したら出発時刻を生成して走行開始 =====
// 出発時刻 = baseEpochSec + dayOffset*86400 + jitter
export function startRunA(
  state,
  {
    distanceM = 300,
    speedKmh = 20,
    randomRangeSec = 3600, // ±
  } = {},
) {
  if (state.run?.running) return state;

  const day = state.dayOffset;
  const jitter = randUniform(
    -Math.abs(Number(randomRangeSec) || 0),
    Math.abs(Number(randomRangeSec) || 0),
  );

  const departEpochSec = Number(state.baseEpochSec) + day * 86400 + jitter;

  return {
    ...state,
    run: {
      running: true,
      day, // ★出発日として固定（到着が日跨ぎでも変えない）
      departEpochSec,
      distanceM: Math.max(0, Number(distanceM) || 0),
      traveledM: 0,
      speedKmh: Math.max(0, Number(speedKmh) || 0),
      travelSecAccum: 0,
      arrived: false,
      arrivalEpochSec: null,
    },
  };
}

// 走行中の速度変更（リアルタイム反映）
export function setRunSpeed(state, speedKmh) {
  if (!state.run?.running) return state;
  return {
    ...state,
    run: { ...state.run, speedKmh: Math.max(0, Number(speedKmh) || 0) },
  };
}

// tick（dt秒ぶん進める）
// - traveled と travelSecAccum を更新
// - 到着したら arrivalEpochSec を確定し、観測を作って obs に追加して run を終了
export function tickRunA(state, godParams, obsParams, dtSec = 0.1) {
  if (!state.run?.running) return state;

  const run = state.run;
  const dt = Math.max(0, Number(dtSec) || 0);

  const speedMps = (Number(run.speedKmh) || 0) / 3.6;
  const dMove = speedMps * dt;

  const traveledNext = Math.min(run.distanceM, run.traveledM + dMove);
  const travelSecAccumNext = run.travelSecAccum + dt;

  // まだ到着してない
  if (traveledNext + 1e-9 < run.distanceM) {
    return {
      ...state,
      run: {
        ...run,
        traveledM: traveledNext,
        travelSecAccum: travelSecAccumNext,
      },
    };
  }

  // ===== 到着 =====
  const arrivalEpochSec = Number(run.departEpochSec) + travelSecAccumNext;

  // ★day は出発日に固定
  const day = run.day;

  // 真の信号状態（到着時刻で評価）
  const truth = godAtTime(godParams, arrivalEpochSec, day);

  // 観測（色は真値・時刻は誤差付き）
  const ob = makeObservationFromTruth(truth, obsParams, { day });

  const obsNext = [...state.obs, ob].sort((a, b) => a.day - b.day || a.t - b.t);

  return {
    ...state,
    obs: obsNext,
    run: {
      ...run,
      running: false,
      arrived: true,
      traveledM: run.distanceM,
      travelSecAccum: travelSecAccumNext,
      arrivalEpochSec,
    },
  };
}

// 走行を強制終了（デバッグ用）
export function cancelRun(state) {
  if (!state.run) return state;
  return { ...state, run: null };
}
