// src/core/inferTG.js
// 新方式（T×β1 全探索 + φ再投影 + 境界推定）
// obs は { day:int, t:sec, color, wait?, nextGreen? } 前提
// ★改良: anchor(β0) を「最新赤1点」ではなく「複数赤」から推定（円統計 + unwrap）し、1回だけ再推定

import { wrap, wrapDiff } from "./math";

/* =========================
   color normalize
========================= */
function normalizeColorObs(colorRaw) {
  const c = String(colorRaw ?? "").toLowerCase();
  if (c === "red") return "red";
  if (c === "blue" || c === "green") return "blue";
  return null;
}

/* =========================
   selection helpers
========================= */
function takeLatestByColorObs(obsAll, maxRed, maxBlue) {
  const red = [];
  const blue = [];

  for (let i = obsAll.length - 1; i >= 0; i--) {
    const o = obsAll[i];
    if (o.colorObs === "red") {
      if (red.length < maxRed) red.push(o);
    } else if (o.colorObs === "blue") {
      if (blue.length < maxBlue) blue.push(o);
    }
    if (red.length >= maxRed && blue.length >= maxBlue) break;
  }

  return [...red, ...blue].sort((a, b) => a.day - b.day || a.t - b.t);
}

/* =========================
   recency weighting
========================= */
function weightByAgeDays(ageDays, tauDays, wMin = 0.05) {
  const w = Math.exp(-ageDays / Math.max(1e-6, tauDays));
  return Math.max(wMin, w);
}

/* =========================
   circular mean for phase (0..T)
========================= */
function circularMeanPhase(phases, weights, T) {
  // phases: [0..T)
  let sx = 0;
  let sy = 0;
  let sw = 0;

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const w = weights ? Number(weights[i] ?? 1) : 1;
    if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) continue;

    const ang = (2 * Math.PI * p) / T;
    sx += w * Math.cos(ang);
    sy += w * Math.sin(ang);
    sw += w;
  }
  if (sw <= 0) return null;

  const ang = Math.atan2(sy, sx); // [-pi,pi]
  const p = (T * (ang < 0 ? ang + 2 * Math.PI : ang)) / (2 * Math.PI);
  return wrap(p, T);
}

/* =========================
   anchor refinement using multiple red departObs
========================= */
// 赤の departObs を使って anchorBeta0 を推定する。
// モデル： departObs ≈ (beta0 + beta1*(d-anchorDay)) + k*T + noise
// => Xi = departObs - beta1*(d-anchorDay) ≈ beta0 + k*T
//
// 1) Xi mod T の円平均を取る（重みはrecency）
// 2) その位相を、最新赤の Xi に一番近いように整数k*Tで持ち上げて absolute beta0 を決める
function refineAnchorBeta0({
  obsAll,
  T,
  beta1,
  anchorDay,
  todayDay,
  tauDays,
  wMin,
  maxRedAnchor = 12,
}) {
  const reds = [...obsAll]
    .filter((o) => o.colorObs === "red" && o.departObs != null)
    .sort((a, b) => a.day - b.day || a.t - b.t);

  if (reds.length === 0) return null;

  const use = reds.slice(Math.max(0, reds.length - maxRedAnchor));
  const phases = [];
  const weights = [];
  const Xs = [];

  for (const o of use) {
    const d = Number(o.day);
    const depart = Number(o.departObs);
    if (!Number.isFinite(d) || !Number.isFinite(depart)) continue;

    const X = depart - Number(beta1) * (d - Number(anchorDay));
    const ph = wrap(X, T);

    const age = Number(todayDay) - d;
    const w = weightByAgeDays(age, Number(tauDays), Number(wMin));

    Xs.push(X);
    phases.push(ph);
    weights.push(w);
  }

  if (phases.length === 0) return null;

  const mu = circularMeanPhase(phases, weights, T);
  if (mu == null) return null;

  // latest red (reference)
  const latest = use[use.length - 1];
  const Xlatest =
    Number(latest.departObs) -
    Number(beta1) * (Number(latest.day) - Number(anchorDay));

  // choose integer shift so that beta0 is closest to Xlatest
  const k = Math.round((Xlatest - mu) / T);
  const beta0Abs = mu + k * T;

  // diagnostics: dispersion (0..1, higher=more集中)
  // R = |sum w e^{i ang}| / sum w
  let sx = 0,
    sy = 0,
    sw = 0;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const w = weights[i];
    const ang = (2 * Math.PI * p) / T;
    sx += w * Math.cos(ang);
    sy += w * Math.sin(ang);
    sw += w;
  }
  const R = sw > 0 ? Math.sqrt(sx * sx + sy * sy) / sw : null;

  return {
    beta0Abs,
    beta0Mod: mu,
    used: phases.length,
    R,
    Xlatest,
  };
}

/* =========================
   boundary estimators
========================= */
// 赤のTopKから German tank 風で R を作る（w = T-phi が大きい順）
function estimateRhatFromRed(phaseData, T, topK, redWMax = Infinity) {
  const wDesc = phaseData
    .filter((v) => v.color === "red")
    .map((v) => T - v.phi)
    .filter((w) => w < redWMax)
    .sort((a, b) => b - a);

  const n = wDesc.length;
  if (n === 0) return { Rhat: null, nRed: 0, usedK: 0, topW: [] };

  const K = Math.max(1, Math.min(Number(topK) || 1, n));

  let s = 0;
  for (let j = 1; j <= K; j++) {
    const factor = (n + 1) / (n + 1 - j);
    s += factor * wDesc[j - 1];
  }
  return { Rhat: s / K, nRed: n, usedK: K, topW: wDesc.slice(0, K) };
}

// 青のTopKからOLS外挿で G を作る（phi が大きい順）
function estimateGhatFromBlue(phaseData, T, topK, bluePhiMax = Infinity) {
  const yDesc = phaseData
    .filter((v) => v.color === "blue")
    .map((v) => v.phi)
    .filter((phi) => phi < bluePhiMax)
    .sort((a, b) => b - a);

  const n = yDesc.length;
  if (n === 0) return null;

  const K = Math.max(2, Math.min(Number(topK) || 2, n));
  const y = yDesc.slice(0, K).sort((a, b) => a - b);

  let sumX = 0,
    sumY = 0,
    sumXX = 0,
    sumXY = 0;
  for (let i = 0; i < K; i++) {
    const x = i + 1;
    const yi = y[i];
    sumX += x;
    sumY += yi;
    sumXX += x * x;
    sumXY += x * yi;
  }
  const denom = K * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;

  const a = (K * sumXY - sumX * sumY) / denom;
  const b = (sumY - a * sumX) / K;

  return a * (K + 1) + b;
}

/* =========================
   2D estimator (T × beta1 full search)
   - 赤depart整合 + (任意で) 青/赤の位相分離ペナルティ
========================= */
function estimate2D({
  data,
  tMin,
  tMax,
  betaStep,
  sigmaDepart,
  enforceTgtWait,
  tauDays,
  wMin,
  todayDay,
  anchor,

  // phase separation (blue used in Step1)
  usePhaseSep = true,
  kPhase = 0.2,
  sigmaPhase = 3,
  phaseGateStartN = 10,
  blueGateFracCycle = 0.9,
  redGateFracCycle = 0.95,
}) {
  if (!data || data.length === 0) return null;
  if (!anchor || anchor.knownBeta0 == null || anchor.anchorDay == null)
    return null;

  const TminI = Math.max(2, Math.floor(tMin));
  const TmaxI = Math.max(TminI, Math.floor(tMax));
  const step = Math.max(1e-6, Number(betaStep));

  const sigD = Math.max(1e-6, Number(sigmaDepart));
  const sigP = Math.max(1e-6, Number(sigmaPhase));

  const nRed = data.filter((x) => x.colorObs === "red").length;
  const nBlue = data.filter((x) => x.colorObs === "blue").length;

  let best = null;

  for (let Tcand = TminI; Tcand <= TmaxI; Tcand++) {
    const bMin = -Tcand / 2;
    const bMax = Tcand / 2;
    const nSteps = Math.floor((bMax - bMin) / step) + 1;

    for (let si = 0; si < nSteps; si++) {
      const beta1 = bMin + si * step;
      let nll = 0;

      // --- candidate-wise simple G for phase separation ---
      const enableBlueGate = nBlue >= Number(phaseGateStartN);
      const enableRedGate = nRed >= Number(phaseGateStartN);
      const bluePhiMaxGate = enableBlueGate
        ? Tcand * Number(blueGateFracCycle)
        : Infinity;
      const redWMaxGate = enableRedGate
        ? Tcand * Number(redGateFracCycle)
        : Infinity;

      let maxBluePhi = -Infinity;
      let maxRedW = -Infinity;

      if (usePhaseSep) {
        for (let i = 0; i < data.length; i++) {
          const { day: d, colorObs, arrivalObs } = data[i];
          if (arrivalObs == null) continue;

          const thetaHat =
            Number(anchor.knownBeta0) +
            beta1 * (Number(d) - Number(anchor.anchorDay));

          const phi = wrap(Number(arrivalObs) - thetaHat, Tcand);

          if (colorObs === "blue") {
            if (phi < bluePhiMaxGate && phi > maxBluePhi) maxBluePhi = phi;
          } else if (colorObs === "red") {
            const w = Tcand - phi;
            if (w < redWMaxGate && w > maxRedW) maxRedW = w;
          }
        }
      }

      const maxRedBoundary = maxRedW > -Infinity ? Tcand - maxRedW : null;

      const GhatSimple =
        usePhaseSep && maxBluePhi > -Infinity && maxRedBoundary != null
          ? Math.max(0, Math.min(Tcand, 0.5 * (maxBluePhi + maxRedBoundary)))
          : null;

      // --- main likelihood ---
      for (let i = 0; i < data.length; i++) {
        const { day: d, colorObs, waitObs, departObs, arrivalObs } = data[i];

        const age = Number(todayDay) - Number(d);
        const w = weightByAgeDays(age, Number(tauDays), Number(wMin));

        const thetaHat =
          Number(anchor.knownBeta0) +
          beta1 * (Number(d) - Number(anchor.anchorDay));

        // (A) red depart consistency
        if (colorObs === "red" && departObs != null) {
          if (enforceTgtWait && waitObs != null) {
            if (!(Tcand > Number(waitObs))) {
              nll += w * 1e6;
              continue;
            }
          }
          const e = wrapDiff(Number(departObs) - thetaHat, Tcand);
          const z = e / sigD;
          nll += w * (0.5 * z * z);
        }

        // (B) phase separation penalty (blue included)
        if (usePhaseSep && GhatSimple != null && arrivalObs != null) {
          const phi = wrap(Number(arrivalObs) - thetaHat, Tcand);

          if (colorObs === "blue") {
            const eBlue = Math.max(0, phi - GhatSimple);
            const z = eBlue / sigP;
            nll += w * Number(kPhase) * (0.5 * z * z);
          }
          if (colorObs === "red") {
            const eRed = Math.max(0, GhatSimple - phi);
            const z = eRed / sigP;
            nll += w * Number(kPhase) * (0.5 * z * z);
          }
        }
      }

      const score = -nll;
      if (!best || score > best.score) {
        best = { T: Tcand, beta1, score, n: data.length, nRed, nBlue };
      }
    }
  }

  return best;
}

/* =========================
   MAIN API: inferTG(obs, opts)
========================= */
export function inferTG(
  obs,
  {
    MAX_RED_T = 30,
    MAX_BLUE_T = 10,

    MAX_RED_BOUND = 30,
    MAX_BLUE_BOUND = 30,

    T_MIN = 30,
    T_MAX = 200,
    BETA_STEP = 0.1,

    sigmaTime = 3,
    sigmaWait = 3,
    enforceTgtWait = true,

    tauDays = 150,
    wMin = 0.05,

    topK = 5,
    fusionMinEach = 10,

    blueGateStartN = 10,
    blueGateFrac = 0.9,

    redGateStartN = 10,
    redGateFrac = 0.95,

    // ===== ★Step1に青を入れる =====
    usePhaseSep = true,
    kPhase = 0.2,
    phaseGateStartN = 10,
    blueGateFracCycle = 0.9,
    redGateFracCycle = 0.95,

    // ===== ★anchor強化（複数赤） =====
    maxRedAnchor = 12, // anchor推定に使う赤の個数
    anchorRefinePasses = 1, // 0=旧式, 1=推定→anchor再推定→再推定
  } = {},
) {
  if (!obs || obs.length === 0) return null;

  // ---- normalize input ----
  const obsAll = obs
    .slice()
    .map((o) => {
      const t = Number(o.t);
      if (!Number.isFinite(t)) return null;

      const day = Number(o.day);
      if (!Number.isFinite(day)) return null;

      const colorObs = normalizeColorObs(o.color);
      if (!colorObs) return null;

      const arrivalObs = t;

      let departObs = null;
      if (colorObs === "red") {
        if (o.nextGreen != null && Number.isFinite(Number(o.nextGreen))) {
          departObs = Number(o.nextGreen);
        } else if (o.wait != null && Number.isFinite(Number(o.wait))) {
          departObs = t + Number(o.wait);
        }
      }

      return {
        ...o,
        t,
        day,
        arrivalObs,
        colorObs,
        waitObs: o.wait != null ? Number(o.wait) : null,
        departObs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);

  if (obsAll.length === 0) return null;

  const todayDay = obsAll[obsAll.length - 1].day;

  // ---- initial anchor (fallback): 最新 red の departObs ----
  const latestRedWithDepart = [...obsAll]
    .reverse()
    .find((o) => o.colorObs === "red" && o.departObs != null);

  const anchor0 =
    latestRedWithDepart != null
      ? {
          knownBeta0: Number(latestRedWithDepart.departObs),
          anchorDay: Number(latestRedWithDepart.day),
        }
      : null;

  if (!anchor0) return null;

  // ---- Step1 data ----
  const dataForCycle = takeLatestByColorObs(obsAll, MAX_RED_T, MAX_BLUE_T).map(
    (o) => ({
      day: o.day,
      arrivalObs: o.arrivalObs,
      colorObs: o.colorObs,
      waitObs: o.waitObs,
      departObs: o.departObs,
    }),
  );

  const sigmaDepart = Math.sqrt(
    Number(sigmaTime) * Number(sigmaTime) +
      Number(sigmaWait) * Number(sigmaWait),
  );

  // ===== Pass 1: estimate with anchor0 =====
  let anchor = { ...anchor0 };
  let est2D = estimate2D({
    data: dataForCycle,
    tMin: T_MIN,
    tMax: T_MAX,
    betaStep: BETA_STEP,
    sigmaDepart,
    enforceTgtWait,
    tauDays,
    wMin,
    todayDay,
    anchor,

    usePhaseSep,
    kPhase,
    sigmaPhase: Number(sigmaTime),
    phaseGateStartN,
    blueGateFracCycle,
    redGateFracCycle,
  });

  if (!est2D) return null;

  // ===== anchor refinement + Pass 2 (optional) =====
  let anchorRefinedInfo = null;

  if (Number(anchorRefinePasses) >= 1) {
    const That0 = est2D.T;
    const b10 = est2D.beta1;

    const refined = refineAnchorBeta0({
      obsAll,
      T: That0,
      beta1: b10,
      anchorDay: anchor.anchorDay, // anchorDayは最新赤の日を維持（安定）
      todayDay,
      tauDays,
      wMin,
      maxRedAnchor: Number(maxRedAnchor),
    });

    if (refined && Number.isFinite(refined.beta0Abs)) {
      anchor = {
        ...anchor,
        knownBeta0: Number(refined.beta0Abs),
      };
      anchorRefinedInfo = refined;

      // 再推定（anchorを複数赤で安定化した後）
      const est2D_2 = estimate2D({
        data: dataForCycle,
        tMin: T_MIN,
        tMax: T_MAX,
        betaStep: BETA_STEP,
        sigmaDepart,
        enforceTgtWait,
        tauDays,
        wMin,
        todayDay,
        anchor,

        usePhaseSep,
        kPhase,
        sigmaPhase: Number(sigmaTime),
        phaseGateStartN,
        blueGateFracCycle,
        redGateFracCycle,
      });

      if (est2D_2) est2D = est2D_2;
    }
  }

  const That = est2D.T;
  const beta1Hat = est2D.beta1;

  // ---- 今日の theta ----
  const thetaToday =
    Number(anchor.knownBeta0) +
    beta1Hat * (Number(todayDay) - Number(anchor.anchorDay));
  const thetaTodayMod = wrap(thetaToday, That);

  // ---- Step2: boundary ----
  const dataForBoundary = takeLatestByColorObs(
    obsAll,
    MAX_RED_BOUND,
    MAX_BLUE_BOUND,
  );

  const phaseData = dataForBoundary.map((o) => {
    const thetaHat =
      Number(anchor.knownBeta0) +
      beta1Hat * (Number(o.day) - Number(anchor.anchorDay));
    const phiHat = wrap(Number(o.arrivalObs) - thetaHat, That);

    return {
      phi: phiHat,
      color: o.colorObs,
      day: o.day,
      t: o.t,
      arrivalObs: o.arrivalObs,
      departObs: o.departObs,
      waitObs: o.waitObs,
    };
  });

  const nRedPhase = phaseData.filter((v) => v.color === "red").length;
  const nBluePhase = phaseData.filter((v) => v.color === "blue").length;

  const enableBlueGate = nBluePhase >= Number(blueGateStartN);
  const bluePhiMax = enableBlueGate ? That * Number(blueGateFrac) : Infinity;

  const enableRedGate = nRedPhase >= Number(redGateStartN);
  const redWMax = enableRedGate ? That * Number(redGateFrac) : Infinity;

  const redSorted = phaseData
    .filter((v) => v.color === "red")
    .map((v) => ({ ...v, w: That - v.phi }))
    .filter((v) => v.w < redWMax)
    .sort((a, b) => b.w - a.w);
  const redTopK = redSorted.slice(0, Math.min(topK, redSorted.length));

  const blueSorted = phaseData
    .filter((v) => v.color === "blue")
    .filter((v) => v.phi < bluePhiMax)
    .sort((a, b) => b.phi - a.phi);
  const blueTopK = blueSorted.slice(0, Math.min(topK, blueSorted.length));

  const { Rhat, usedK, topW } = estimateRhatFromRed(
    phaseData,
    That,
    topK,
    redWMax,
  );

  const GhatRaw = estimateGhatFromBlue(phaseData, That, topK, bluePhiMax);
  const Ghat =
    GhatRaw == null ? null : Math.max(0, Math.min(That, Number(GhatRaw)));

  const Gred = Rhat == null ? null : That - Rhat;

  const blues = phaseData.filter((v) => v.color === "blue").map((v) => v.phi);
  const redsW = phaseData
    .filter((v) => v.color === "red")
    .map((v) => That - v.phi);

  const maxBlue = blues.length ? Math.max(...blues) : null;
  const maxRedBoundary = redsW.length ? That - Math.max(...redsW) : null;

  const Gsimple =
    maxBlue == null || maxRedBoundary == null
      ? null
      : 0.5 * (maxBlue + maxRedBoundary);

  const useFusion = nBluePhase > fusionMinEach && nRedPhase > fusionMinEach;

  const diffRG = Gred == null || Ghat == null ? null : Math.abs(Gred - Ghat);
  const gap = That / 20;
  const alpha =
    diffRG == null
      ? null
      : diffRG <= gap
        ? 1
        : Math.max(0, Math.min(1, gap / diffRG));

  const Gfinal = (() => {
    if (!useFusion) return Gsimple;
    if (Gred == null && Ghat == null) return null;
    if (Gred == null) return Ghat;
    if (Ghat == null) return Gred;
    if (alpha == null) return Gred;
    return (Gred + alpha * Ghat) / (1 + alpha);
  })();

  const confidence = (() => {
    const r = Math.min(
      1,
      (dataForCycle.filter((x) => x.colorObs === "red").length || 0) / 10,
    );
    return 0.5 + 0.5 * r;
  })();

  const Graw = Gfinal ?? Gsimple ?? Gred ?? Ghat ?? null;
  const Tfinite = Number.isFinite(That) && That > 0 ? That : null;

  let Gsafe = null;
  if (Tfinite != null && Number.isFinite(Graw)) {
    Gsafe = Math.max(0, Math.min(Tfinite, Number(Graw)));
  }
  if (Gsafe == null && Tfinite != null) {
    Gsafe = 0.5 * Tfinite;
  }

  const Rsafe =
    Tfinite != null && Gsafe != null ? Math.max(0, Tfinite - Gsafe) : null;

  return {
    T: Tfinite,
    G: Gsafe,
    R: Rsafe,
    theta: Number.isFinite(thetaTodayMod) ? thetaTodayMod : 0,
    confidence,
    score: est2D.score,

    beta1: beta1Hat,
    thetaAbsToday: thetaToday,
    anchorDay: anchor.anchorDay,
    anchorBeta0: anchor.knownBeta0,

    // ★追加：anchor強化の診断
    anchorRefined: anchorRefinedInfo,

    boundary: {
      nRedPhase,
      nBluePhase,

      enableBlueGate,
      blueGateStartN,
      blueGateFrac,
      bluePhiMax,

      enableRedGate,
      redGateStartN,
      redGateFrac,
      redWMax,

      topK,
      usedK,
      Rhat,
      Gred,
      Ghat,
      Gsimple,
      useFusion,
      alpha,
      topW,
      redTopK,
      blueTopK,
    },
  };
}
