// src/ui/SimPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { inferTG } from "../core/inferTG";
import { buildSpeedRanges } from "../core/speedAssist";

import { godAtTime } from "../sim/godModel";
import { makeObservationFromTruth } from "../sim/observer";

/* =========================
   utils
========================= */
function fmt(x, d = 2) {
  if (x == null || !Number.isFinite(Number(x))) return "-";
  return Number(x).toFixed(d);
}
function fmtInt(x) {
  if (x == null || !Number.isFinite(Number(x))) return "-";
  return String(Math.round(Number(x)));
}
function errAbs(est, truth) {
  if (
    est == null ||
    truth == null ||
    !Number.isFinite(Number(est)) ||
    !Number.isFinite(Number(truth))
  )
    return null;
  return Math.abs(Number(est) - Number(truth));
}
function errRel(est, truth) {
  const ea = errAbs(est, truth);
  if (ea == null) return null;
  if (!Number.isFinite(Number(truth)) || Math.abs(Number(truth)) < 1e-12)
    return null;
  return ea / Math.abs(Number(truth));
}

function dtLocalToEpochSec(v) {
  const ms = new Date(v).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms / 1000;
}
function epochSecToDtLocal(sec) {
  const d = new Date(Number(sec) * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function ceil1(x) {
  return Math.ceil(x * 10) / 10;
}
function floor1(x) {
  return Math.floor(x * 10) / 10;
}

function randUniform(a, b) {
  return a + (b - a) * Math.random();
}

function addDaysYYYYMMDD(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00`);
  if (!Number.isFinite(d.getTime())) return dateStr;
  d.setDate(d.getDate() + Number(deltaDays));
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// day index: 2026-01-01 を day=0（JSTローカル00:00）
const BASE_DAY0 = "2026-01-01";
function dateToDayIndex(dateStr) {
  const base = new Date(`${BASE_DAY0}T00:00`).getTime();
  const cur = new Date(`${dateStr}T00:00`).getTime();
  if (!Number.isFinite(base) || !Number.isFinite(cur)) return 0;
  return Math.round((cur - base) / 86400000);
}

/* =========================
   Signals builder
   - route.signals の distance[m] (route上の累積距離) から segDistM を作る
========================= */
function makeInitialSignalsFromRoute(route) {
  // route が無い/信号が無いときはデフォルト3個
  if (!route?.signals || route.signals.length === 0) {
    return [
      { id: "s1", name: "S1", segDistM: 3000, obs: [] },
      { id: "s2", name: "S2", segDistM: 2500, obs: [] },
      { id: "s3", name: "S3", segDistM: 1800, obs: [] },
    ];
  }

  const sigs = [...route.signals]
    .filter((s) => Number.isFinite(s.distance))
    .sort((a, b) => Number(a.distance) - Number(b.distance));

  let prev = 0;
  return sigs.map((s, i) => {
    const dist = Math.max(0, Number(s.distance));
    const segDistM = Math.max(0, dist - prev);
    prev = dist;
    return {
      id: s.id,
      name: s.name ?? `S${i + 1}`,
      segDistM,
      obs: [],
    };
  });
}

/* =========================
   Main
   - App.jsx から route と onBack を受け取る
========================= */
export default function SimPage({ route, onBack }) {
  /* =========================
     God params (shared for all signals)
  ========================= */
  const [T, setT] = useState(100);
  const [G, setG] = useState(40);
  const [beta1True, setBeta1True] = useState(20);
  const [beta0Dt, setBeta0Dt] = useState("2026-01-01T09:00");

  /* =========================
     Observer params
  ========================= */
  const [sigmaTime, setSigmaTime] = useState(3);
  const [sigmaWait, setSigmaWait] = useState(3);

  /* =========================
     観測日と いつも使う時刻（HH:MM）
     - route.useTimeSecOfDay があれば初期値に反映（10分刻みに丸めて表示）
  ========================= */
  const [obsDate, setObsDate] = useState("2026-01-01");
  const [usualTime, setUsualTime] = useState("09:00");

  useEffect(() => {
    // route が来たら usualTime を route に合わせる（できる範囲で）
    const sec = route?.useTimeSecOfDay;
    if (sec == null || !Number.isFinite(Number(sec))) return;
    const s = Math.max(0, Math.min(86399, Math.round(Number(sec) / 600) * 600));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    setUsualTime(`${hh}:${mm}`);
  }, [route?.id, route?.useTimeSecOfDay]);

  const departDayIndex = useMemo(() => dateToDayIndex(obsDate), [obsDate]);

  const baseEpochSec = useMemo(() => {
    const dt = `${obsDate}T${usualTime}`;
    return dtLocalToEpochSec(dt);
  }, [obsDate, usualTime]);

  /* =========================
     Control params
  ========================= */
  const [randomRangeSec, setRandomRangeSec] = useState(3600);

  /* =========================
     Signals: route 由来で可変
  ========================= */
  const [signals, setSignals] = useState(() =>
    makeInitialSignalsFromRoute(route),
  );

  // route が変わったら signals を作り直す
  useEffect(() => {
    setSignals(makeInitialSignalsFromRoute(route));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id]);

  // signals を走行ループから安全に参照する ref
  const signalsRef = useRef(signals);
  useEffect(() => {
    signalsRef.current = signals;
  }, [signals]);

  /* =========================
     Running / driving
  ========================= */
  const [speedKmh, setSpeedKmh] = useState(20);
  const [maxSpeedKmh, setMaxSpeedKmh] = useState(35);

  // N倍速（走行中＆赤待ち中も適用）
  const [simSpeed, setSimSpeed] = useState(1);
  const simSpeedRef = useRef(simSpeed);
  useEffect(() => {
    simSpeedRef.current = Number(simSpeed);
  }, [simSpeed]);

  const [run, setRun] = useState({
    isRunning: false,
    runId: 0,

    departDay: 0,
    departEpochSec: 0,
    tRunSec: 0,
    distRemainM: 0,
    idx: 0,

    phase: "moving", // "moving" | "waiting"
    waitRemainSec: 0,
  });

  const [lastArrival, setLastArrival] = useState(null);

  const speedRef = useRef(speedKmh);
  useEffect(() => {
    speedRef.current = Number(speedKmh);
  }, [speedKmh]);

  const beta0EpochSec = useMemo(() => dtLocalToEpochSec(beta0Dt), [beta0Dt]);

  const godParams = useMemo(
    () => ({
      T: Number(T),
      G: Number(G),
      beta0: Number(beta0EpochSec ?? 0),
      beta1: Number(beta1True),
    }),
    [T, G, beta0EpochSec, beta1True],
  );

  const obsParams = useMemo(
    () => ({ sigmaTime: Number(sigmaTime), sigmaWait: Number(sigmaWait) }),
    [sigmaTime, sigmaWait],
  );

  /* =========================
     Estimation per signal (inferTG)
  ========================= */
  const estBySignalId = useMemo(() => {
    const out = {};
    for (const s of signals) {
      out[s.id] = inferTG(s.obs, {
        sigmaTime: Number(sigmaTime),
        sigmaWait: Number(sigmaWait),
        T_MIN: 30,
        T_MAX: 200,
        BETA_STEP: 1,
      });
    }
    return out;
  }, [signals, sigmaTime, sigmaWait]);

  const curSignal = run.isRunning ? signals[run.idx] : null;
  const curEst = curSignal ? estBySignalId[curSignal.id] : null;

  /* =========================
     Counts
  ========================= */
  const totalObs = signals.reduce((acc, s) => acc + s.obs.length, 0);
  const nRedTotal = signals.reduce(
    (acc, s) => acc + s.obs.filter((o) => o.color === "red").length,
    0,
  );
  const nBlueTotal = signals.reduce(
    (acc, s) => acc + s.obs.filter((o) => o.color === "blue").length,
    0,
  );

  /* =========================
     Running loop (N倍速)
  ========================= */
  useEffect(() => {
    if (!run.isRunning) return;

    const dtReal = 0.2;
    const timer = setInterval(() => {
      const k = Math.max(0.1, Number(simSpeedRef.current) || 1);
      const dtSim = dtReal * k;

      setRun((r) => {
        if (!r.isRunning) return r;

        const sigs = signalsRef.current;

        // waiting（赤待ち）
        if (r.phase === "waiting") {
          const wNext = Number(r.waitRemainSec) - dtSim;
          const tNext = Number(r.tRunSec) + dtSim;

          if (wNext > 0) {
            return { ...r, waitRemainSec: wNext, tRunSec: tNext };
          }

          // 待ち終了 → 次の信号へ（or 終了）
          const nextIdx = r.idx + 1;
          if (nextIdx >= sigs.length) {
            return {
              ...r,
              isRunning: false,
              phase: "moving",
              waitRemainSec: 0,
              tRunSec: tNext,
            };
          }

          const nextDepartEpochSec = Number(r.departEpochSec) + Number(tNext);

          return {
            ...r,
            idx: nextIdx,
            departEpochSec: nextDepartEpochSec,
            tRunSec: 0,
            distRemainM: Number(sigs[nextIdx].segDistM),
            phase: "moving",
            waitRemainSec: 0,
            isRunning: true,
          };
        }

        // moving
        const v = Math.max(0, Number(speedRef.current) / 3.6);
        const distNext = Number(r.distRemainM) - v * dtSim;
        const tNext = Number(r.tRunSec) + dtSim;

        if (distNext > 0) {
          return { ...r, distRemainM: distNext, tRunSec: tNext };
        }

        // 到着
        const arrivalEpochSec = Number(r.departEpochSec) + Number(tNext);
        const day = Number(r.departDay);
        const s = sigs[r.idx];
        if (!s) {
          return { ...r, isRunning: false, distRemainM: 0, tRunSec: tNext };
        }

        const truth = godAtTime(godParams, arrivalEpochSec, day);
        const ob = makeObservationFromTruth(truth, obsParams, { day });

        // 観測は「到着した信号の箱」へ
        setSignals((prev) =>
          prev.map((x, idx) => {
            if (idx !== r.idx) return x;
            const nextObs = [...x.obs, ob].sort(
              (a, b) => a.day - b.day || a.t - b.t,
            );
            return { ...x, obs: nextObs };
          }),
        );

        setLastArrival({
          runId: r.runId,
          idx: r.idx,
          signalId: s.id,
          arrivalEpochSec,
          colorTrue: truth.colorTrue,
          waitTrue: truth.waitTrue,
        });

        const nextIdx = r.idx + 1;
        const isLast = nextIdx >= sigs.length;

        // 最後の信号
        if (isLast) {
          if (truth.colorTrue === "blue") {
            return { ...r, isRunning: false, distRemainM: 0, tRunSec: tNext };
          }
          const wait = Math.max(0, Number(truth.waitTrue ?? 0));
          return {
            ...r,
            distRemainM: 0,
            tRunSec: tNext,
            phase: "waiting",
            waitRemainSec: wait,
            isRunning: true,
          };
        }

        // 次へ（青）
        if (truth.colorTrue === "blue") {
          return {
            ...r,
            idx: nextIdx,
            departEpochSec: Number(arrivalEpochSec),
            tRunSec: 0,
            distRemainM: Number(sigs[nextIdx].segDistM),
            phase: "moving",
            waitRemainSec: 0,
            isRunning: true,
          };
        }

        // 次へ（赤待ち）
        const wait = Math.max(0, Number(truth.waitTrue ?? 0));
        return {
          ...r,
          distRemainM: 0,
          tRunSec: tNext,
          phase: "waiting",
          waitRemainSec: wait,
          isRunning: true,
        };
      });
    }, dtReal * 1000);

    return () => clearInterval(timer);
  }, [run.isRunning, godParams, obsParams]);

  /* =========================
     Speed Assist (only while running & moving)
  ========================= */
  const thetaAbsForDay = useMemo(() => {
    if (!curEst) return null;
    const { anchorBeta0, anchorDay, beta1 } = curEst;
    if (!Number.isFinite(anchorBeta0)) return null;
    if (!Number.isFinite(anchorDay)) return null;
    if (!Number.isFinite(beta1)) return null;
    const day = Number(run.departDay);
    return Number(anchorBeta0) + Number(beta1) * (day - Number(anchorDay));
  }, [curEst, run.departDay]);

  const nowSec = useMemo(() => {
    if (!run.isRunning) return null;
    return Number(run.departEpochSec) + Number(run.tRunSec);
  }, [run.isRunning, run.departEpochSec, run.tRunSec]);

  const ranges = useMemo(() => {
    if (!run.isRunning) return [];
    if (run.phase !== "moving") return [];
    if (!curEst) return [];
    if (!Number.isFinite(thetaAbsForDay)) return [];
    if (!Number.isFinite(nowSec)) return [];
    if (!(Number.isFinite(curEst.T) && Number.isFinite(curEst.G))) return [];

    return buildSpeedRanges({
      distanceM: Number(run.distRemainM),
      nowSpeedKmh: Number(speedKmh),
      maxSpeedKmh: Number(maxSpeedKmh),
      T: Number(curEst.T),
      G: Number(curEst.G),
      thetaAbs: Number(thetaAbsForDay),
      nowSec: Number(nowSec),
    });
  }, [
    run.isRunning,
    run.phase,
    run.distRemainM,
    speedKmh,
    maxSpeedKmh,
    curEst,
    thetaAbsForDay,
    nowSec,
  ]);

  /* =========================
     latest logs (display only)
  ========================= */
  const latestObsAll = useMemo(() => {
    const arr = [];
    for (const s of signals)
      for (const o of s.obs) arr.push({ signalId: s.id, ...o });
    arr.sort((a, b) => a.day - b.day || a.t - b.t);
    return arr.slice(-20);
  }, [signals]);

  /* =========================
     truth (shared for compare)
  ========================= */
  const truthT = Number(T);
  const truthG = Number(G);
  const truthB1 = Number(beta1True);

  // 可変列（最大4列、超えたら折り返し）
  const gridCols = useMemo(() => {
    const n = Math.max(1, signals.length);
    return `repeat(${Math.min(4, n)}, 1fr)`;
  }, [signals.length]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {onBack && <button onClick={onBack}>← Mapに戻る</button>}
        <h2 style={{ margin: 0 }}>
          Signal Sim（複数信号 / 区間距離型 / N倍速）
        </h2>
      </div>

      {route?.name && (
        <div style={{ marginTop: 6, fontSize: 13, color: "#666" }}>
          route: <b>{route.name}</b> / signals:{" "}
          <b>{route.signals?.length ?? 0}</b>
        </div>
      )}

      {/* God + Observer */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>神パラメーター（全信号共通）</h3>

          <label>
            T (sec)
            <input
              type="number"
              value={T}
              onChange={(e) => setT(e.target.value)}
              style={{ width: "100%" }}
              disabled={run.isRunning}
            />
          </label>

          <label>
            G (sec)
            <input
              type="number"
              value={G}
              onChange={(e) => setG(e.target.value)}
              style={{ width: "100%" }}
              disabled={run.isRunning}
            />
          </label>

          <label>
            β0（緑開始の基準時刻）
            <input
              type="datetime-local"
              value={beta0Dt}
              onChange={(e) => setBeta0Dt(e.target.value)}
              step={600}
              style={{ width: "100%" }}
              disabled={run.isRunning}
            />
          </label>

          <label>
            β1 (sec/day) ※dayごとの位相ドリフト（真値）
            <input
              type="number"
              value={beta1True}
              onChange={(e) => setBeta1True(e.target.value)}
              style={{ width: "100%" }}
              disabled={run.isRunning}
            />
          </label>

          <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
            β0(day) = β0 + β1 * day（β0はepoch秒で内部処理）
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>観測者パラメーター</h3>

          <label>
            σTime (sec)
            <input
              type="number"
              value={sigmaTime}
              onChange={(e) => setSigmaTime(e.target.value)}
              style={{ width: "100%" }}
              disabled={run.isRunning}
            />
          </label>

          <label>
            σWait (sec)
            <input
              type="number"
              value={sigmaWait}
              onChange={(e) => setSigmaWait(e.target.value)}
              style={{ width: "100%" }}
              disabled={run.isRunning}
            />
          </label>

          <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
            obs合計：red={nRedTotal}, blue={nBlueTotal}, total={totalObs}
          </div>
        </div>
      </div>

      {/* Signals */}
      <div
        style={{
          marginTop: 12,
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <h3 style={{ marginTop: 0 }}>信号（区間距離 / 可変）</h3>

        <div
          style={{ display: "grid", gridTemplateColumns: gridCols, gap: 10 }}
        >
          {signals.map((s, i) => {
            const est = estBySignalId[s.id];
            const nR = s.obs.filter((o) => o.color === "red").length;
            const nB = s.obs.filter((o) => o.color === "blue").length;
            const isTarget = run.isRunning && run.idx === i;

            return (
              <div
                key={s.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: 10,
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {s.name}（{s.id}）
                  {isTarget && (
                    <span
                      style={{
                        marginLeft: 8,
                        color: run.phase === "moving" ? "#0a6" : "#a60",
                      }}
                    >
                      ←{run.phase === "moving" ? "走行中" : "待機中"}
                    </span>
                  )}
                </div>

                <label style={{ display: "block", marginTop: 8 }}>
                  区間距離 segDistM (m)
                  <input
                    type="number"
                    value={s.segDistM}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setSignals((prev) =>
                        prev.map((x) =>
                          x.id === s.id ? { ...x, segDistM: v } : x,
                        ),
                      );
                    }}
                    style={{ width: "100%" }}
                    disabled={run.isRunning}
                  />
                </label>

                <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
                  obs: red={nR}, blue={nB}, total={s.obs.length}
                </div>

                <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                  est: T=<b>{fmtInt(est?.T)}</b>, G=<b>{fmtInt(est?.G)}</b>, β1=
                  <b>{fmt(est?.beta1, 3)}</b>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* controls */}
      <div
        style={{
          marginTop: 12,
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <h3 style={{ marginTop: 0 }}>
          観測（観測日 + いつも使う時刻 + N倍速）
        </h3>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          <label>
            観測する日（YYYY-MM-DD）
            <input
              type="date"
              value={obsDate}
              onChange={(e) => setObsDate(e.target.value)}
              style={{ width: "100%" }}
              disabled={run.isRunning}
            />
          </label>

          <label>
            いつも使う時刻（10分刻み）
            <input
              type="time"
              value={usualTime}
              onChange={(e) => setUsualTime(e.target.value)}
              step={600}
              style={{ width: "100%" }}
              disabled={run.isRunning}
            />
          </label>

          <label>
            ランダム時間（±秒）
            <input
              type="number"
              value={randomRangeSec}
              onChange={(e) => setRandomRangeSec(e.target.value)}
              style={{ width: "100%" }}
              disabled={run.isRunning}
            />
          </label>

          <div style={{ fontSize: 12, color: "#666", alignSelf: "end" }}>
            base:{" "}
            <b>
              {baseEpochSec == null ? "-" : epochSecToDtLocal(baseEpochSec)}
            </b>
            {" / "}dayIndex: <b>{departDayIndex}</b>
          </div>

          <label>
            速度 (km/h)
            <input
              type="number"
              value={speedKmh}
              onChange={(e) => setSpeedKmh(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>

          <label>
            最大速度 (km/h)
            <input
              type="number"
              value={maxSpeedKmh}
              onChange={(e) => setMaxSpeedKmh(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
        </div>

        {/* speed buttons */}
        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 13, color: "#444", fontWeight: 700 }}>
            倍速:
          </div>

          {[1, 2, 5, 10, 20, 50].map((k) => (
            <button
              key={k}
              onClick={() => setSimSpeed(k)}
              style={{
                fontWeight: simSpeed === k ? 800 : 500,
                border: simSpeed === k ? "2px solid #111" : "1px solid #ccc",
                borderRadius: 8,
                padding: "6px 10px",
                background: simSpeed === k ? "#f2f2f2" : "white",
              }}
            >
              {k}×
            </button>
          ))}

          <label style={{ marginLeft: 6, fontSize: 13, color: "#444" }}>
            任意:
            <input
              type="number"
              value={simSpeed}
              min={0.1}
              step={0.1}
              onChange={(e) => setSimSpeed(Number(e.target.value))}
              style={{ width: 90, marginLeft: 6 }}
            />
            ×
          </label>

          <div style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>
            ※赤待ちも {fmt(simSpeed, 1)}× で短縮
          </div>
        </div>

        <div
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}
        >
          <button
            onClick={() => {
              setLastArrival(null);
              setRun((r) => ({ ...r, isRunning: false }));
              setSignals(makeInitialSignalsFromRoute(route));
            }}
            disabled={run.isRunning}
          >
            設定を反映（全リセット）
          </button>

          <button
            onClick={() => setObsDate((d) => addDaysYYYYMMDD(d, 1))}
            disabled={run.isRunning}
          >
            日付 +1（シミュ用）
          </button>

          <button
            onClick={() => {
              if (run.isRunning) return;
              if (baseEpochSec == null) return;

              const sigs = signalsRef.current;
              if (!sigs || sigs.length === 0) return alert("信号がありません");

              const day = Number(departDayIndex);
              const jitter = randUniform(
                -Math.abs(Number(randomRangeSec)),
                Math.abs(Number(randomRangeSec)),
              );
              const departEpochSec = Number(baseEpochSec) + jitter;
              const runId = (run.runId ?? 0) + 1;

              setRun({
                isRunning: true,
                runId,
                departDay: day,
                departEpochSec,
                tRunSec: 0,
                distRemainM: Number(sigs[0]?.segDistM ?? 0),
                idx: 0,
                phase: "moving",
                waitRemainSec: 0,
              });

              setLastArrival(null);
            }}
            style={{ fontWeight: 700 }}
            disabled={run.isRunning}
          >
            観測（先頭→末尾 自動進行）
          </button>

          <div style={{ marginLeft: "auto", fontSize: 13, color: "#555" }}>
            {run.isRunning ? (
              <>
                状態: <b>{run.phase === "moving" ? "走行" : "赤待ち"}</b> / 信号{" "}
                <b>{signals[run.idx]?.name ?? "-"}</b> / 残り{" "}
                <b>
                  {fmt(
                    run.phase === "moving"
                      ? run.distRemainM
                      : run.waitRemainSec,
                    1,
                  )}
                </b>{" "}
                {run.phase === "moving" ? "m" : "s"} / 経過{" "}
                <b>{fmt(run.tRunSec, 1)}</b> s
              </>
            ) : (
              "停止中"
            )}
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, color: "#333" }}>
          到着結果：{" "}
          {lastArrival ? (
            <>
              runId=<b>{lastArrival.runId}</b> / signal=
              <b>{lastArrival.signalId}</b> / 到着=
              <b>{epochSecToDtLocal(lastArrival.arrivalEpochSec)}</b> /
              色（真値）=
              <b>{lastArrival.colorTrue === "blue" ? "青" : "赤"}</b>
              {lastArrival.colorTrue === "red" && (
                <>
                  {" "}
                  / waitTrue=<b>{fmt(lastArrival.waitTrue, 2)}</b>
                  s（倍速で短縮）
                </>
              )}
            </>
          ) : (
            <span style={{ color: "#777" }}>—</span>
          )}
        </div>

        {/* 適切速度は「走行中のみ」 */}
        {run.isRunning && run.phase === "moving" && (
          <div
            style={{
              marginTop: 12,
              border: "2px solid #2a2a2a",
              borderRadius: 10,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              適切速度（走行中のみ） — 対象: {signals[run.idx]?.name ?? "-"}
            </h3>

            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              使用：T,G は推定値 / thetaAbs は推定(anchorから算出) / nowSec は
              depart+経過
            </div>

            <div style={{ fontSize: 13, color: "#555" }}>
              nowSec: <b>{nowSec == null ? "-" : fmt(nowSec, 1)}</b> / thetaAbs:{" "}
              <b>{thetaAbsForDay == null ? "-" : fmt(thetaAbsForDay, 1)}</b>
            </div>

            <div style={{ fontSize: 13, color: "#555" }}>
              pred T=<b>{fmtInt(curEst?.T)}</b> sec, G=
              <b>{fmtInt(curEst?.G)}</b> sec
            </div>

            <div style={{ marginTop: 10 }}>
              {ranges.length === 0 ? (
                <div style={{ color: "#777" }}>
                  該当なし（推定不足 or 条件なし）
                </div>
              ) : (
                <div style={{ display: "grid", rowGap: 6 }}>
                  {ranges.map((r) => (
                    <div key={r.tag}>
                      <b>{r.tag}</b>: {ceil1(r.low)} 〜 {floor1(r.high)} km/h{" "}
                      <span style={{ color: "#666" }}>
                        (start={fmt(r.start, 1)}s, end={fmt(r.end, 1)}s)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Compare */}
      <div
        style={{
          marginTop: 12,
          border: "2px solid #333",
          borderRadius: 10,
          padding: 12,
        }}
      >
        <h3 style={{ marginTop: 0 }}>結果（比較）— 全信号</h3>

        <div
          style={{ display: "grid", gridTemplateColumns: gridCols, gap: 10 }}
        >
          {signals.map((s) => {
            const est = estBySignalId[s.id] ?? null;

            const estT = est?.T ?? null;
            const estG = est?.G ?? null;
            const estB1 = est?.beta1 ?? null;

            const dT = errAbs(estT, truthT);
            const dG = errAbs(estG, truthG);
            const dB1 = errAbs(estB1, truthB1);

            const relT = errRel(estT, truthT);
            const relG = errRel(estG, truthG);
            const relB1 = errRel(estB1, truthB1);

            return (
              <div
                key={s.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: 10,
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  {s.name}（{s.id}）
                </div>

                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                  obs={s.obs.length}（red=
                  {s.obs.filter((o) => o.color === "red").length}, blue=
                  {s.obs.filter((o) => o.color === "blue").length}）
                </div>

                <div style={{ fontSize: 13, color: "#555" }}>
                  T truth <b>{fmtInt(truthT)}</b> / est <b>{fmtInt(estT)}</b> /
                  |Δ| <b>{fmt(dT, 2)}</b> / rel{" "}
                  <b>{fmt(relT == null ? null : 100 * relT, 2)}</b>%
                </div>
                <div style={{ fontSize: 13, color: "#555" }}>
                  G truth <b>{fmtInt(truthG)}</b> / est <b>{fmtInt(estG)}</b> /
                  |Δ| <b>{fmt(dG, 2)}</b> / rel{" "}
                  <b>{fmt(relG == null ? null : 100 * relG, 2)}</b>%
                </div>
                <div style={{ fontSize: 13, color: "#555" }}>
                  β1 truth <b>{fmt(truthB1, 3)}</b> / est <b>{fmt(estB1, 3)}</b>{" "}
                  / |Δ| <b>{fmt(dB1, 3)}</b> / rel{" "}
                  <b>{fmt(relB1 == null ? null : 100 * relB1, 2)}</b>%
                </div>

                <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>
                  confidence <b>{fmt(est?.confidence, 3)}</b> / score{" "}
                  <b>{fmt(est?.score, 2)}</b>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Log */}
      <div
        style={{
          marginTop: 12,
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <h3 style={{ marginTop: 0 }}>観測ログ（全信号まとめ表示・最新20件）</h3>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          ※表示のために結合しているだけで、保存は「信号ごとに別箱」です。
        </div>
        <pre style={{ whiteSpace: "pre-wrap" }}>
          {JSON.stringify(latestObsAll, null, 2)}
        </pre>
      </div>
    </div>
  );
}
