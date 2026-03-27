import { useEffect, useMemo, useRef, useState } from "react";

import SignalPanel from "./SignalPanel";

/* =========================
   constants
========================= */

// 速度帯ヒステリシス
const SLOW_ENTER_KMH = 3.5;
const SLOW_EXIT_KMH = 4.5;
const FAST_ENTER_KMH = 8.5;
const FAST_EXIT_KMH = 7.5;

// 赤自動検出（2秒平均）
const RED_AUTO_KMH = 2.0;
const RED_AUTO_MAX_DIST_M = 12;

// 青候補を出すための「離れ始めた」判定
const BLUE_MID_S_ADVANCE_M = 3;
const BLUE_FAST_S_ADVANCE_M = 4;
const BLUE_MID_DIST_INCREASE_M = 3;
const BLUE_FAST_DIST_INCREASE_M = 4;

// 赤後青の自動検出
const POST_RED_BLUE_JUDGE_KMH = 4.0;
const POST_RED_BLUE_S_ADVANCE_M = 3.0;
const POST_RED_BLUE_CORRECTION_MS = 1500;

// routeMode復帰
const RETURN_FAST_MS = 2000;
const RETURN_MID_MS = 4000;
const RETURN_LOW_EXTEND_MS = 4000;

// 赤→青の表示を少し見せる
const POST_BLUE_SHOW_MS = 500;

// 延長発火（1秒平均）
const RETURN_LOW_EVENT_KMH = 2.0;
const RETURN_LOW_EVENT_COOLDOWN_MS = 1000;

// 強制復帰
const NEAR_FOR_FORCE_RETURN_M = 10;
const FORCE_RETURN_DIST_M = 15;

// s後退ノイズ許容
const BACKWARD_EPS_M = 5;

/* =========================
   helpers
========================= */
function haversineM(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad((b.lat ?? 0) - (a.lat ?? 0));
  const dLng = toRad((b.lng ?? 0) - (a.lng ?? 0));
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat ?? 0)) *
      Math.cos(toRad(b.lat ?? 0)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function pointToSegmentProjectionMeters(P, A, B) {
  const lat0 =
    (((A.lat ?? 0) + (B.lat ?? 0) + (P.lat ?? 0)) / 3) * (Math.PI / 180);

  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(lat0);

  const ax = (A.lng ?? 0) * mPerDegLng;
  const ay = (A.lat ?? 0) * mPerDegLat;
  const bx = (B.lng ?? 0) * mPerDegLng;
  const by = (B.lat ?? 0) * mPerDegLat;
  const px = (P.lng ?? 0) * mPerDegLng;
  const py = (P.lat ?? 0) * mPerDegLat;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const ab2 = abx * abx + aby * aby;
  const tRaw = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
  const t = Math.max(0, Math.min(1, tRaw));

  const qx = ax + t * abx;
  const qy = ay + t * aby;

  const dx = px - qx;
  const dy = py - qy;
  const dist = Math.hypot(dx, dy);

  return { t, dist };
}

function buildRouteCum(routePts) {
  if (!Array.isArray(routePts) || routePts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < routePts.length; i++) {
    cum[i] = cum[i - 1] + haversineM(routePts[i - 1], routePts[i]);
  }
  return {
    cum,
    total: cum[cum.length - 1],
  };
}

function projectPointToRouteS(P, routePts, cumTable) {
  if (!P || !routePts || routePts.length < 2 || !cumTable) return null;

  let best = null;

  for (let i = 0; i < routePts.length - 1; i++) {
    const A = routePts[i];
    const B = routePts[i + 1];
    const segLen = cumTable.cum[i + 1] - cumTable.cum[i];
    const pr = pointToSegmentProjectionMeters(P, A, B);
    const s = cumTable.cum[i] + pr.t * segLen;

    if (!best || pr.dist < best.dist) {
      best = {
        segIndex: i,
        t: pr.t,
        dist: pr.dist,
        s,
      };
    }
  }

  return best;
}

function speedBandFromSpeed(v) {
  const x = Number(v) || 0;
  if (x < 4) return "slow";
  if (x < 8) return "mid";
  return "fast";
}

/* =========================
   main
========================= */
export default function NavSignalMode({
  gpsPos,
  targetSignal,
  approachRoute,
  approachStart,
  displaySpeedKmh,
  judgeSpeedKmh,
  redJudgeSpeedKmh,
  speedKmh,
  setSpeedKmh,
  onPassSignal,
  onCancelSignalMode,
  nowMs,
  godEnabled,
  godState,
  signalBehaviorMode = "normal",
  setSignalBehaviorMode,
}) {
  /* eslint-disable react-hooks/set-state-in-effect */
  const isTrafficMode = signalBehaviorMode === "traffic";

  const cumTable = useMemo(() => buildRouteCum(approachRoute), [approachRoute]);

  const signalProj = useMemo(() => {
    if (!targetSignal || !approachRoute || !cumTable) return null;
    return projectPointToRouteS(targetSignal, approachRoute, cumTable);
  }, [targetSignal, approachRoute, cumTable]);

  const currentProj = useMemo(() => {
    if (!gpsPos || !approachRoute || !cumTable) return null;
    return projectPointToRouteS(gpsPos, approachRoute, cumTable);
  }, [gpsPos, approachRoute, cumTable]);

  const distanceToSignalM = useMemo(() => {
    if (!gpsPos || !targetSignal) return Infinity;
    return haversineM(gpsPos, targetSignal);
  }, [gpsPos, targetSignal]);

  const sCurrent = currentProj?.s ?? null;
  const sSignal = signalProj?.s ?? null;

  const reachedStopLine = useMemo(() => {
    if (!Number.isFinite(sCurrent)) return false;
    if (!Number.isFinite(sSignal)) return false;
    return sCurrent >= sSignal - 0.5;
  }, [sCurrent, sSignal]);

  const entryDisplaySpeedKmh = Number(approachStart?.startDisplaySpeedKmh) || 0;
  const entryJudgeSpeedKmh = Number(approachStart?.startJudgeSpeedKmh) || 0;
  const entrySpeedBand = useMemo(
    () => speedBandFromSpeed(entryJudgeSpeedKmh),
    [entryJudgeSpeedKmh],
  );

  const [speedBand, setSpeedBand] = useState(entrySpeedBand);
  const [lockedSpeedBand, setLockedSpeedBand] = useState(null);

  const [minDistanceM, setMinDistanceM] = useState(
    Number.isFinite(approachStart?.startDistanceM)
      ? approachStart.startDistanceM
      : Infinity,
  );
  const [minDistanceAt, setMinDistanceAt] = useState(null);

  const [passDetectedAt, setPassDetectedAt] = useState(null);

  const [blueCandidateAt, setBlueCandidateAt] = useState(null);
  const [blueCandidateSource, setBlueCandidateSource] = useState(null);

  const [redMeasuredAt, setRedMeasuredAt] = useState(null);
  const [redSource, setRedSource] = useState(null);
  const [redDetectedS, setRedDetectedS] = useState(null);

  const [postRedBlueAt, setPostRedBlueAt] = useState(null);
  const [postRedBlueSource, setPostRedBlueSource] = useState(null);

  const [extraDelayMs, setExtraDelayMs] = useState(0);

  const [godStopActive, setGodStopActive] = useState(false);
  const [godReachedLine, setGodReachedLine] = useState(false);
  const resumeSpeedRef = useRef(Number(speedKmh) || 0);

  const currentNowMs = Number.isFinite(nowMs) ? Number(nowMs) : 0;

  const [hasBeenNearForForceReturn, setHasBeenNearForForceReturn] =
    useState(false);

  const sAtMinRef = useRef(null);
  const prevSRef = useRef(null);
  const hasBackwardBreakRef = useRef(false);

  const lastLowExtendAtRef = useRef(null);

  const finishedRef = useRef(false);
  const blueCancelledLoggedRef = useRef(false);

  const observedJudgeSpeedKmh = Number(judgeSpeedKmh) || 0;
  const observedDisplaySpeedKmh = Number(displaySpeedKmh) || 0;
  const observedRedJudgeSpeedKmh = Number(redJudgeSpeedKmh) || 0;

  const currentPhase = useMemo(() => {
    if (postRedBlueAt) return "done-post-red-blue";
    if (redMeasuredAt) return "red-waiting-blue";
    if (passDetectedAt) return "pass-detected";
    return "approaching";
  }, [postRedBlueAt, redMeasuredAt, passDetectedAt]);

  /* =========================
     speed band update
  ========================= */
  useEffect(() => {
    if (lockedSpeedBand) return;
    if (redMeasuredAt) return;

    const v = observedJudgeSpeedKmh;

    if (speedBand === "slow") {
      if (v >= SLOW_EXIT_KMH) {
        setSpeedBand("mid");
      }
      return;
    }

    if (speedBand === "mid") {
      if (v <= SLOW_ENTER_KMH) {
        setSpeedBand("slow");
        return;
      }
      if (v >= FAST_ENTER_KMH) {
        setSpeedBand("fast");
      }
      return;
    }

    if (speedBand === "fast") {
      if (v <= FAST_EXIT_KMH) {
        setSpeedBand("mid");
      }
    }
  }, [observedJudgeSpeedKmh, speedBand, lockedSpeedBand, redMeasuredAt]);

  /* =========================
     near flag
  ========================= */
  useEffect(() => {
    if (!Number.isFinite(distanceToSignalM)) return;
    if (distanceToSignalM <= NEAR_FOR_FORCE_RETURN_M) {
      setHasBeenNearForForceReturn(true);
    }
  }, [distanceToSignalM]);

  /* =========================
     min distance update
  ========================= */
  useEffect(() => {
    if (passDetectedAt) return;
    if (redMeasuredAt) return;
    if (!Number.isFinite(distanceToSignalM)) return;

    if (distanceToSignalM < minDistanceM) {
      setMinDistanceM(distanceToSignalM);
      setMinDistanceAt(currentNowMs);
      sAtMinRef.current = sCurrent;
    }
  }, [
    passDetectedAt,
    redMeasuredAt,
    distanceToSignalM,
    minDistanceM,
    sCurrent,
    currentNowMs,
  ]);

  /* =========================
     s backward check
  ========================= */
  useEffect(() => {
    if (!Number.isFinite(sCurrent)) return;
    const prev = prevSRef.current;
    if (prev != null && sCurrent < prev - BACKWARD_EPS_M) {
      hasBackwardBreakRef.current = true;
    }
    prevSRef.current = sCurrent;
  }, [sCurrent]);

  /* =========================
     red helper
  ========================= */
  const applyRedMeasurement = (tMs, source) => {
    if (redMeasuredAt) return;

    const tt = Number.isFinite(Number(tMs)) ? Number(tMs) : currentNowMs;
    setRedMeasuredAt(tt);
    setRedSource(source);
    setRedDetectedS(Number.isFinite(sCurrent) ? sCurrent : null);
    console.log("RED_DETECTED");
  };

  /* =========================
     red auto detect
  ========================= */
  useEffect(() => {
    if (isTrafficMode) return;
    if (godEnabled) return;
    if (redMeasuredAt) return;
    if (postRedBlueAt) return;
    if (passDetectedAt) return;
    if (!Number.isFinite(distanceToSignalM)) return;
    if (distanceToSignalM > RED_AUTO_MAX_DIST_M) return;

    if (observedRedJudgeSpeedKmh < RED_AUTO_KMH) {
      applyRedMeasurement(currentNowMs, "auto");
    }
  }, [
    isTrafficMode,
    godEnabled,
    observedRedJudgeSpeedKmh,
    redMeasuredAt,
    postRedBlueAt,
    passDetectedAt,
    distanceToSignalM,
    currentNowMs,
  ]);

  /* =========================
     pass detect + blue candidate
  ========================= */
  useEffect(() => {
    if (isTrafficMode) return;
    if (godEnabled) return;
    if (passDetectedAt) return;
    if (blueCandidateAt) return;
    if (redMeasuredAt) return;
    if (speedBand === "slow") return;
    if (!minDistanceAt) return;
    if (!Number.isFinite(sCurrent)) return;
    if (!Number.isFinite(distanceToSignalM)) return;

    const sAtMin = sAtMinRef.current;
    if (!Number.isFinite(sAtMin)) return;

    const sAdvanceNeed =
      speedBand === "fast" ? BLUE_FAST_S_ADVANCE_M : BLUE_MID_S_ADVANCE_M;

    const distIncreaseNeed =
      speedBand === "fast"
        ? BLUE_FAST_DIST_INCREASE_M
        : BLUE_MID_DIST_INCREASE_M;

    const advancedEnough = sCurrent >= sAtMin + sAdvanceNeed;
    const fartherEnough = distanceToSignalM >= minDistanceM + distIncreaseNeed;

    if (!advancedEnough) return;
    if (!fartherEnough) return;

    setBlueCandidateAt(minDistanceAt);
    setBlueCandidateSource("auto");
    setPassDetectedAt(currentNowMs);
    setLockedSpeedBand(speedBand);

    console.log("PASS_DETECTED");
    console.log("BLUE_CANDIDATE");
  }, [
    isTrafficMode,
    godEnabled,
    passDetectedAt,
    blueCandidateAt,
    redMeasuredAt,
    speedBand,
    minDistanceAt,
    minDistanceM,
    sCurrent,
    distanceToSignalM,
    currentNowMs,
  ]);

  /* =========================
     blue cancelled by red
  ========================= */
  useEffect(() => {
    if (blueCancelledLoggedRef.current) return;
    if (!blueCandidateAt) return;
    if (!redMeasuredAt) return;

    blueCancelledLoggedRef.current = true;
    console.log("BLUE_CANCELLED_BY_RED");
  }, [blueCandidateAt, redMeasuredAt]);

  /* =========================
     post-red blue auto detect
  ========================= */
  useEffect(() => {
    if (isTrafficMode) return;
    if (godEnabled) return;
    if (!redMeasuredAt) return;
    if (postRedBlueAt) return;
    if (!Number.isFinite(redDetectedS)) return;
    if (!Number.isFinite(sCurrent)) return;

    const fastEnough = observedJudgeSpeedKmh >= POST_RED_BLUE_JUDGE_KMH;
    const advancedEnough = sCurrent >= redDetectedS + POST_RED_BLUE_S_ADVANCE_M;

    if (!fastEnough) return;
    if (!advancedEnough) return;

    const detectedAt = currentNowMs;
    const correctedAt = Math.max(
      redMeasuredAt,
      detectedAt - POST_RED_BLUE_CORRECTION_MS,
    );

    setPostRedBlueAt(correctedAt);
    setPostRedBlueSource("auto");
    console.log("POST_RED_BLUE_AUTO");
  }, [
    isTrafficMode,
    godEnabled,
    redMeasuredAt,
    redDetectedS,
    sCurrent,
    observedJudgeSpeedKmh,
    postRedBlueAt,
    currentNowMs,
  ]);

  /* =========================
     god signal control
  ========================= */
  useEffect(() => {
    if (!godEnabled) return;
    if (!godState) return;
    if (finishedRef.current) return;

    if (!godReachedLine) {
      if (!reachedStopLine) return;

      setGodReachedLine(true);

      if (godState.isGreen) {
        if (!blueCandidateAt) {
          setBlueCandidateAt(currentNowMs);
          setBlueCandidateSource("god-auto");
        }
        if (!passDetectedAt) {
          setPassDetectedAt(currentNowMs);
        }
        if (!lockedSpeedBand) {
          setLockedSpeedBand(speedBand);
        }
        return;
      }

      resumeSpeedRef.current = Number(speedKmh) || 0;

      if (!redMeasuredAt) {
        setRedMeasuredAt(currentNowMs);
        setRedSource("god-auto");
        setRedDetectedS(Number.isFinite(sCurrent) ? sCurrent : null);
      }

      setGodStopActive(true);
      setSpeedKmh?.(0);
      return;
    }

    if (godStopActive && godState.isGreen) {
      if (!postRedBlueAt) {
        setPostRedBlueAt(currentNowMs);
        setPostRedBlueSource("god-auto");
      }

      setGodStopActive(false);
      setSpeedKmh?.(Math.max(1, resumeSpeedRef.current || 1));
    }
  }, [
    godEnabled,
    godState,
    godReachedLine,
    reachedStopLine,
    currentNowMs,
    blueCandidateAt,
    passDetectedAt,
    lockedSpeedBand,
    speedBand,
    redMeasuredAt,
    sCurrent,
    speedKmh,
    godStopActive,
    postRedBlueAt,
    setSpeedKmh,
  ]);

  /* =========================
     low-speed extension
  ========================= */
  useEffect(() => {
    if (!passDetectedAt) return;
    if (redMeasuredAt) return;
    if (lockedSpeedBand !== "fast" && lockedSpeedBand !== "mid") return;

    if (observedJudgeSpeedKmh > RETURN_LOW_EVENT_KMH) return;

    const last = lastLowExtendAtRef.current;
    if (last != null && currentNowMs - last < RETURN_LOW_EVENT_COOLDOWN_MS) {
      return;
    }

    lastLowExtendAtRef.current = currentNowMs;
    setExtraDelayMs((prev) => prev + RETURN_LOW_EXTEND_MS);
  }, [
    observedJudgeSpeedKmh,
    passDetectedAt,
    redMeasuredAt,
    lockedSpeedBand,
    currentNowMs,
  ]);

  /* =========================
     auto return time
  ========================= */
  const autoReturnAt = useMemo(() => {
    if (!passDetectedAt) return null;
    if (!lockedSpeedBand) return null;
    if (redMeasuredAt) return null;

    if (lockedSpeedBand === "fast") {
      return passDetectedAt + RETURN_FAST_MS + extraDelayMs;
    }
    if (lockedSpeedBand === "mid") {
      return passDetectedAt + RETURN_MID_MS + extraDelayMs;
    }
    return null;
  }, [passDetectedAt, lockedSpeedBand, redMeasuredAt, extraDelayMs]);

  /* =========================
     finish helper
  ========================= */
  const finishSignalMode = (reason) => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const finalBlueAt = redMeasuredAt ? null : blueCandidateAt;
    const finalBlueSource = redMeasuredAt ? null : blueCandidateSource;

    const payload = {
      ...targetSignal,
      passedAt: currentNowMs,

      passReason: reason,

      entryDisplaySpeedKmh,
      entryJudgeSpeedKmh,
      entrySpeedBand,

      displaySpeedKmh: observedDisplaySpeedKmh,
      judgeSpeedKmh: observedJudgeSpeedKmh,
      redJudgeSpeedKmh: observedRedJudgeSpeedKmh,

      speedBand,
      lockedSpeedBand,

      skipped: reason === "signalmode-skipped",

      observations: {
        redAt: redMeasuredAt,
        redSource,

        blueAt: finalBlueAt,
        blueSource: finalBlueSource,

        postRedBlueAt,
        postRedBlueSource,

        minDistanceAt,
        minDistanceM,

        passDetectedAt,
        redDetectedS,
      },

      debug: {
        signalBehaviorMode,
        distanceToSignalM,
        sCurrent,
        sSignal,
        hasBackwardBreak: hasBackwardBreakRef.current,
        hasBeenNearForForceReturn,
        currentPhase,
        extraDelayMs,
        godEnabled,
        godStopActive,
        godReachedLine,
      },
    };

    onPassSignal?.(payload);
  };

  /* =========================
     auto return
  ========================= */
  useEffect(() => {
    if (finishedRef.current) return;
    if (!autoReturnAt) return;

    const delayMs = Math.max(0, autoReturnAt - currentNowMs);

    const timerId = setTimeout(() => {
      if (finishedRef.current) return;
      console.log("ROUTE_RETURN_AUTO");
      finishSignalMode("auto-return-after-pass");
    }, delayMs);

    return () => clearTimeout(timerId);
  }, [autoReturnAt, currentNowMs]);

  /* =========================
     finish after post-red-blue
  ========================= */
  useEffect(() => {
    if (finishedRef.current) return;
    if (!postRedBlueAt) return;

    const timerId = setTimeout(() => {
      if (finishedRef.current) return;
      finishSignalMode("post-red-blue-finished");
    }, POST_BLUE_SHOW_MS);

    return () => clearTimeout(timerId);
  }, [postRedBlueAt]);

  /* =========================
     force return
  ========================= */
  useEffect(() => {
    if (finishedRef.current) return;
    if (redMeasuredAt) return;
    if (!Number.isFinite(distanceToSignalM)) return;
    if (!Number.isFinite(sCurrent)) return;
    if (!hasBeenNearForForceReturn) return;

    const sAtMin = sAtMinRef.current;
    const forwardEnough = Number.isFinite(sAtMin)
      ? sCurrent >= sAtMin - 2
      : true;

    if (
      distanceToSignalM >= FORCE_RETURN_DIST_M &&
      forwardEnough &&
      !hasBackwardBreakRef.current
    ) {
      console.log("ROUTE_RETURN_FORCE");
      finishSignalMode("force-return-15m");
    }
  }, [distanceToSignalM, sCurrent, hasBeenNearForForceReturn, redMeasuredAt]);

  /* =========================
     button handlers
  ========================= */
  const handleManualRed = () => {
    applyRedMeasurement(currentNowMs, "manual");
  };

  const blueManualEnabled = !!redMeasuredAt || speedBand === "slow";

  const handleManualBlue = () => {
    if (!blueManualEnabled) return;

    const now = currentNowMs;

    if (redMeasuredAt) {
      setPostRedBlueAt(now);
      setPostRedBlueSource("manual");
      console.log("POST_RED_BLUE_MANUAL");
      return;
    }

    setBlueCandidateAt(now);
    setBlueCandidateSource("manual");
    setPassDetectedAt(now);
    setLockedSpeedBand("slow");
    console.log("BLUE_CANDIDATE");
    console.log("PASS_DETECTED");

    setTimeout(() => {
      if (finishedRef.current) return;
      console.log("ROUTE_RETURN_AUTO");
      finishSignalMode("manual-blue-slow");
    }, 0);
  };

  const canRender = !!(
    targetSignal &&
    approachRoute &&
    Array.isArray(approachRoute) &&
    approachRoute.length >= 2
  );

  if (!canRender) {
    return (
      <div
        style={{
          flex: 1,
          border: "1px solid #ddd",
          borderRadius: 10,
          padding: 16,
          background: "#fff",
          display: "grid",
          gap: 10,
        }}
      >
        <b>信号モード</b>
        <div style={{ color: "#b00020" }}>必要な情報が不足しています。</div>
        <button
          onClick={() => onCancelSignalMode?.("invalid-props")}
          style={{
            width: 160,
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            cursor: "pointer",
          }}
        >
          戻る
        </button>
      </div>
    );
  }

  const isPostBlueFlash = !!postRedBlueAt;
  const isRedVisual = !!redMeasuredAt && !postRedBlueAt;
  const isInitialBlueVisual = !redMeasuredAt && !postRedBlueAt;

  const blueBlink = isInitialBlueVisual && speedBand === "slow";

  const redAppearance = isRedVisual ? "lit" : "off";

  let blueAppearance = "off";

  if (isPostBlueFlash) {
    blueAppearance = "lit";
  } else if (isInitialBlueVisual) {
    blueAppearance = "lit";
  } else {
    blueAppearance = "off";
  }

  const redEnabled = !godEnabled && !isRedVisual;
  const blueEnabled = !godEnabled && blueManualEnabled;

  const disabledReason = godEnabled
    ? "神信号制御中"
    : isInitialBlueVisual && !blueEnabled && speedBand !== "slow"
      ? "青は自動判定中"
      : "";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <SignalPanel
        speedKmh={observedDisplaySpeedKmh}
        trafficMode={isTrafficMode}
        onToggleTrafficMode={() =>
          setSignalBehaviorMode?.((prev) =>
            prev === "normal" ? "traffic" : "normal",
          )
        }
        redAppearance={redAppearance}
        blueAppearance={blueAppearance}
        blueBlink={blueBlink}
        redEnabled={redEnabled}
        blueEnabled={blueEnabled}
        onRed={handleManualRed}
        onBlue={handleManualBlue}
        onCancel={() => onCancelSignalMode?.("manual-cancel")}
        disabledReason={disabledReason}
      />

      {/*
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 12,
          background: "white",
          display: "grid",
          gap: 6,
          fontSize: 13,
        }}
      >
        <div>entry表示速度: {entryDisplaySpeedKmh.toFixed(1)} km/h</div>
        <div>entry判定速度: {entryJudgeSpeedKmh.toFixed(1)} km/h</div>
        <div>信号モード: {isTrafficMode ? "traffic" : "normal"}</div>
        <div>
          信号まで距離:{" "}
          {Number.isFinite(distanceToSignalM)
            ? distanceToSignalM.toFixed(1)
            : "-"}{" "}
          m
        </div>
        <div>
          最短距離:{" "}
          {Number.isFinite(minDistanceM) ? minDistanceM.toFixed(1) : "-"} m
        </div>
        <div>
          最短時刻あり: <b>{minDistanceAt ? "YES" : "NO"}</b>
        </div>
        <div>
          近接済み(強制復帰用):{" "}
          <b>{hasBeenNearForForceReturn ? "YES" : "NO"}</b>
        </div>
        <div>
          現在s: {Number.isFinite(sCurrent) ? sCurrent.toFixed(1) : "-"} m
        </div>
        <div>
          信号s: {Number.isFinite(sSignal) ? sSignal.toFixed(1) : "-"} m
        </div>
        <div>
          青候補:{" "}
          {blueCandidateAt
            ? `${blueCandidateSource} / ${formatTimeMs(blueCandidateAt)}`
            : "-"}
        </div>
        <div>
          赤観測:{" "}
          {redMeasuredAt
            ? `${redSource} / ${formatTimeMs(redMeasuredAt)}`
            : "-"}
        </div>
        <div>
          赤後青:{" "}
          {postRedBlueAt
            ? `${postRedBlueSource} / ${formatTimeMs(postRedBlueAt)}`
            : "-"}
        </div>
        <div>
          通過検出: {passDetectedAt ? formatTimeMs(passDetectedAt) : "-"}
        </div>
        <div>追加待機: {Math.round(extraDelayMs / 1000)} 秒</div>
        <div>
          自動復帰予定: {autoReturnAt ? formatTimeMs(autoReturnAt) : "-"}
        </div>
        <div>神停止中: {godStopActive ? "YES" : "NO"}</div>
        <div>停止線到達済み: {godReachedLine ? "YES" : "NO"}</div>
        <div style={{ color: "#666" }}>debug: {debugMsg || "-"}</div>
      </div>
      */}
    </div>
  );
  /* eslint-enable react-hooks/set-state-in-effect */
}
