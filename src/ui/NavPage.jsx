// src/ui/NavPage.jsx
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";

import { godSignalState } from "../core/godSignal";
import {
  saveBlueObservation,
  startRedObservation,
  finishRedObservation,
  jstDayAndEpochSec,
} from "../observationStore";
import { buildSpeedRanges } from "../core/speedAssist";
import { getRouteById, getObsForInferSignalUnified } from "../routesStore";
import { inferTG } from "../core/inferTG";
import { iconGPS } from "../leaflet/mapIcons";
import NavRouteMode from "./NavRouteMode";
import NavSignalMode from "./NavSignalMode";

import AssistSpeedSlot from "./AssistSpeedSlot";

/* =========================
   constants
========================= */
const DEFAULT_ZOOM = 16;
const SPEED_HISTORY_KEEP_MS = 4000;
const SPEED_DISPLAY_WINDOW_MS = 500;
const SPEED_JUDGE_WINDOW_MS = 1000;
const SPEED_RED_JUDGE_WINDOW_MS = 2000;
const SPEED_DIFF_MIN_DIST_M = 0.2;

// ★追加：速度サンプルを詰め込みすぎない
const SPEED_SAMPLE_INTERVAL_MS = 100;

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

function todayLocalDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function secToHHMM(sec) {
  if (!Number.isFinite(Number(sec))) return "09:00";
  const s = Math.max(0, Math.min(86399, Math.round(Number(sec))));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDateTimeLocal(ms) {
  if (!Number.isFinite(ms)) return "-";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function buildSimStartMs({ simDate, baseSecOfDay, randomRangeSec }) {
  const baseMs = new Date(`${simDate}T00:00:00`).getTime();
  if (!Number.isFinite(baseMs)) return Date.now();

  const baseSec = Number.isFinite(Number(baseSecOfDay))
    ? Number(baseSecOfDay)
    : 12 * 3600;

  const range = Math.max(0, Number(randomRangeSec) || 0);
  const jitterSec = (Math.random() * 2 - 1) * range;

  return baseMs + (baseSec + jitterSec) * 1000;
}

function toFiniteOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function FollowMe({ pos, enabled }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;
    if (!pos) return;
    map.setView([pos.lat, pos.lng], map.getZoom(), { animate: true });
  }, [pos, enabled, map]);

  return null;
}

function DetectUserMapMove({ onUserMove }) {
  useMapEvents({
    dragstart: () => onUserMove?.(),
    zoomstart: () => onUserMove?.(),
    movestart: () => onUserMove?.(),
  });
  return null;
}

function RecenterControl({ visible, pos, onDone, onBlockClickOnce }) {
  const map = useMap();
  if (!visible) return null;

  return (
    <div
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: "absolute",
        right: 12,
        top: 12,
        zIndex: 999,
        pointerEvents: "auto",
      }}
    >
      <button
        onMouseDown={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onBlockClickOnce?.();
        }}
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!pos) return alert("GPS位置がまだ取得できていません");
          map.setView([pos.lat, pos.lng], map.getZoom(), { animate: true });
          onDone?.();
        }}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #ccc",
          background: "white",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          cursor: "pointer",
        }}
      >
        現在地に戻る
      </button>
    </div>
  );
}

function ModeToggleControl({ mode, setMode, onBlockClickOnce }) {
  const isNormal = mode === "normal";

  return (
    <div
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        zIndex: 999,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          minWidth: 132,
        }}
      >
        <button
          onMouseDown={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onBlockClickOnce?.();
          }}
          onClick={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setMode((prev) => (prev === "normal" ? "traffic" : "normal"));
          }}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: isNormal ? "#fff4d6" : "#eef6ff",
            cursor: "pointer",
            fontWeight: 700,
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          }}
        >
          {isNormal ? "通常" : "渋滞"}
        </button>
      </div>
    </div>
  );
}

function SimControlPanel({
  visible,
  onToggleVisible,
  simEnabled,
  setSimEnabled,
  simMode,
  setSimMode,
  speedKmh,
  setSpeedKmh,
  simPaused,
  setSimPaused,
  onResetToOrigin,

  simDate,
  setSimDate,
  randomRangeSec,
  setRandomRangeSec,
  simNowMs,
  onReseedSimClock,

  godEnabled,
  setGodEnabled,
  godState,
  godT,
  setGodT,
  godG,
  setGodG,
  godBeta1,
  setGodBeta1,
  godBaseDate,
  setGodBaseDate,
  godBaseTime,
  setGodBaseTime,
}) {
  if (!visible) {
    return (
      <div
        style={{
          position: "absolute",
          left: 10,
          top: 10,
          zIndex: 999,
          pointerEvents: "auto",
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <button
          onClick={onToggleVisible}
          style={{
            minHeight: 34,
            padding: "6px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 800,
            background: "rgba(255,255,255,0.94)",
          }}
        >
          シミュ
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 10,
        top: 10,
        zIndex: 999,
        pointerEvents: "auto",
        background: "rgba(255,255,255,0.95)",
        border: "1px solid #ddd",
        borderRadius: 10,
        padding: "8px 8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
        minWidth: 210,
        width: "min(220px, calc(100vw - 24px))",
        maxWidth: 220,
        maxHeight: "34vh",
        overflowY: "auto",
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <b style={{ fontSize: 12 }}>GPS手動</b>

        <button
          onClick={() => setSimEnabled((v) => !v)}
          style={{
            padding: "4px 8px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: simEnabled ? "#fff4d6" : "white",
            cursor: "pointer",
            fontSize: 11,
          }}
          title="ONにすると実GPSの代わりにシミュレーション位置を使います"
        >
          {simEnabled ? "ON" : "OFF"}
        </button>

        <button
          onClick={() => setSimPaused((v) => !v)}
          disabled={!simEnabled || simMode !== "auto"}
          style={{
            padding: "4px 8px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background:
              simEnabled && simMode === "auto"
                ? simPaused
                  ? "#e8f5e9"
                  : "#fff0f0"
                : "white",
            cursor:
              simEnabled && simMode === "auto" ? "pointer" : "not-allowed",
            fontSize: 11,
          }}
        >
          {simPaused ? "再開" : "停止"}
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={onToggleVisible}
          style={{
            padding: "4px 8px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          閉じる
        </button>

        <button
          onClick={onResetToOrigin}
          style={{
            padding: "4px 8px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            cursor: "pointer",
            fontSize: 11,
          }}
          disabled={!simEnabled}
        >
          先頭へ
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => {
            setSimMode("drag");
            setSimPaused(false);
          }}
          disabled={!simEnabled}
          style={{
            padding: "4px 8px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: simEnabled && simMode === "drag" ? "#eef6ff" : "white",
            cursor: simEnabled ? "pointer" : "not-allowed",
            fontSize: 11,
          }}
        >
          ドラッグ
        </button>

        <button
          onClick={() => {
            setSimMode("auto");
            setSimPaused(false);
          }}
          disabled={!simEnabled}
          style={{
            padding: "4px 8px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: simEnabled && simMode === "auto" ? "#eef6ff" : "white",
            cursor: simEnabled ? "pointer" : "not-allowed",
            fontSize: 11,
          }}
        >
          ルート自走
        </button>

        <label style={{ fontSize: 11, color: "#333", marginLeft: "auto" }}>
          速度(km/h)
          <input
            type="number"
            value={speedKmh}
            min={0}
            max={35}
            step={1}
            disabled={!simEnabled || simMode !== "auto"}
            onChange={(e) => setSpeedKmh(Number(e.target.value || 0))}
            style={{
              width: 60,
              marginLeft: 6,
              padding: "4px 6px",
              borderRadius: 10,
              border: "1px solid #ccc",
              fontSize: 11,
            }}
          />
        </label>
      </div>

      <div
        style={{
          marginTop: 8,
          borderTop: "1px solid #eee",
          paddingTop: 8,
          display: "grid",
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 12 }}>
          シミュレーション時刻
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <label style={{ fontSize: 11 }}>
            日付
            <input
              type="date"
              value={simDate}
              onChange={(e) => setSimDate(e.target.value)}
              style={{ marginLeft: 6, padding: 4, fontSize: 11 }}
            />
          </label>

          <label style={{ fontSize: 11 }}>
            ±秒
            <input
              type="number"
              value={randomRangeSec}
              onChange={(e) => setRandomRangeSec(Number(e.target.value || 0))}
              style={{ width: 64, marginLeft: 6, padding: 4, fontSize: 11 }}
            />
          </label>

          <button
            onClick={onReseedSimClock}
            disabled={!simEnabled}
            style={{
              padding: "4px 8px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
              cursor: simEnabled ? "pointer" : "not-allowed",
              fontSize: 11,
            }}
          >
            時刻再抽選
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#666" }}>
          現在のシミュ時刻: <b>{formatDateTimeLocal(simNowMs)}</b>
        </div>
      </div>

      <div
        style={{
          marginTop: 8,
          borderTop: "1px solid #eee",
          paddingTop: 8,
          display: "grid",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <b style={{ fontSize: 12 }}>神信号</b>

          <button
            onClick={() => setGodEnabled((v) => !v)}
            style={{
              padding: "4px 8px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: godEnabled ? "#fff4d6" : "white",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {godEnabled ? "ON" : "OFF"}
          </button>

          <div
            style={{
              marginLeft: 4,
              minWidth: 56,
              height: 32,
              padding: "0 10px",
              borderRadius: 999,
              border: "1px solid #d6d6d6",
              background: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 800,
              color:
                godEnabled && godState
                  ? godState.isGreen
                    ? "#1976d2"
                    : "#d32f2f"
                  : "#888",
            }}
          >
            {godEnabled && godState ? (godState.isGreen ? "青" : "赤") : "—"}
          </div>
        </div>

        <div
          style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr" }}
        >
          <label style={{ fontSize: 11 }}>
            T
            <input
              type="number"
              value={godT}
              onChange={(e) => setGodT(Number(e.target.value || 0))}
              style={{ width: "100%", marginTop: 4, padding: 4, fontSize: 11 }}
            />
          </label>

          <label style={{ fontSize: 11 }}>
            G
            <input
              type="number"
              value={godG}
              onChange={(e) => setGodG(Number(e.target.value || 0))}
              style={{ width: "100%", marginTop: 4, padding: 4, fontSize: 11 }}
            />
          </label>

          <label style={{ fontSize: 11 }}>
            β1 (sec/day)
            <input
              type="number"
              value={godBeta1}
              onChange={(e) => setGodBeta1(Number(e.target.value || 0))}
              style={{ width: "100%", marginTop: 4, padding: 4, fontSize: 11 }}
            />
          </label>

          <div />
        </div>

        <div
          style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr" }}
        >
          <label style={{ fontSize: 11 }}>
            β0基準日
            <input
              type="date"
              value={godBaseDate}
              onChange={(e) => setGodBaseDate(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: 4, fontSize: 11 }}
            />
          </label>

          <label style={{ fontSize: 11 }}>
            β0基準時刻
            <input
              type="time"
              value={godBaseTime}
              onChange={(e) => setGodBaseTime(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: 4, fontSize: 11 }}
            />
          </label>
        </div>
      </div>

      <div style={{ marginTop: 6, fontSize: 11, color: "#666" }}>
        {simEnabled
          ? simMode === "drag"
            ? "※ GPSマーカーをドラッグして位置を動かせます"
            : "※ ルート上を速度で進みます（高頻度更新）"
          : "※ OFF時は実GPSを使用"}
      </div>
    </div>
  );
}

/* =========================
   Main
========================= */
export default function NavPage({ user, routeId, onSignalModeChange }) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);

  const [realPos, setRealPos] = useState(null);

  const [simEnabled, setSimEnabled] = useState(false);
  const [simMode, setSimMode] = useState("drag");
  const [simPaused, setSimPaused] = useState(false);
  const [speedKmh, setSpeedKmh] = useState(18);
  const [simS, setSimS] = useState(0);
  const [simPos, setSimPos] = useState(null);
  const [simDate, setSimDate] = useState(todayLocalDateStr());
  const [randomRangeSec, setRandomRangeSec] = useState(3600);
  const [simNowMs, setSimNowMs] = useState(Date.now());

  const [godEnabled, setGodEnabled] = useState(false);
  const [godT, setGodT] = useState(90);
  const [godG, setGodG] = useState(40);
  const [godBeta1, setGodBeta1] = useState(20);
  const [godBaseDate, setGodBaseDate] = useState(todayLocalDateStr());
  const [godBaseTime, setGodBaseTime] = useState("09:00");
  const [showSimPanel, setShowSimPanel] = useState(false);

  const [followGPS, setFollowGPS] = useState(true);
  const [showRecenterBtn, setShowRecenterBtn] = useState(false);

  const [passedViaIds, setPassedViaIds] = useState([]);
  const [passedSignalIds, setPassedSignalIds] = useState([]);

  const [activeMode, setActiveMode] = useState("route");
  const [activeSignal, setActiveSignal] = useState(null);

  const [frozenApproachRoute, setFrozenApproachRoute] = useState(null);
  const [approachStart, setApproachStart] = useState(null);

  const [speedSamples, setSpeedSamples] = useState([]);
  const prevPosSampleRef = useRef(null);

  const [assistTarget, setAssistTarget] = useState(null);
  const [assistObs, setAssistObs] = useState([]);
  const [assistPred, setAssistPred] = useState(null);
  const [_assistLoading, setAssistLoading] = useState(false);
  const [_assistError, setAssistError] = useState("");

  const [nextTargetInfo, setNextTargetInfo] = useState(null);

  const [signalBehaviorMode, setSignalBehaviorMode] = useState("normal");

  // ★追加
  const lastSpeedSampleAtRef = useRef(null);

  const blockNextMapClickRef = useRef(false);
  const blockClickOnce = useCallback(() => {
    blockNextMapClickRef.current = true;
    setTimeout(() => {
      blockNextMapClickRef.current = false;
    }, 250);
  }, []);

  const origin = route?.origin ?? null;
  const routePts = route?.routePts ?? [];
  const pos = simEnabled ? simPos : realPos;

  const apiSpeedKmh =
    pos?.speed != null && Number.isFinite(pos.speed) ? pos.speed * 3.6 : null;

  const realNowMsRef = useRef(Date.now());
  const lastSimClockTickRef = useRef(null);

  const [realNowMs, setRealNowMs] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      realNowMsRef.current = now;
      setRealNowMs(now);
    }, 250);
    return () => clearInterval(id);
  }, []);

  const currentClockMs = simEnabled ? simNowMs : realNowMs;

  const nowInfo = useMemo(
    () => jstDayAndEpochSec(currentClockMs),
    [currentClockMs],
  );

  const assistNowSec =
    nowInfo?.t != null && Number.isFinite(Number(nowInfo.t))
      ? Number(nowInfo.t) / 1000
      : null;

  const assistNowDay = nowInfo?.day ?? null;

  useEffect(() => {
    const baseSec = route?.useTimeSecOfDay;
    if (Number.isFinite(Number(baseSec))) {
      setGodBaseTime(secToHHMM(baseSec));
    }
  }, [route?.id, route?.useTimeSecOfDay]);

  const godAnchorMs = useMemo(() => {
    const ms = new Date(`${godBaseDate}T${godBaseTime}:00`).getTime();
    return Number.isFinite(ms) ? ms : null;
  }, [godBaseDate, godBaseTime]);

  const godAnchorDay = useMemo(() => {
    if (!Number.isFinite(godAnchorMs)) return null;
    return jstDayAndEpochSec(godAnchorMs).day;
  }, [godAnchorMs]);

  const godState = useMemo(() => {
    if (!godEnabled) return null;
    if (!Number.isFinite(godAnchorMs)) return null;
    if (!Number.isFinite(godAnchorDay)) return null;

    const nowSec =
      nowInfo?.t != null && Number.isFinite(Number(nowInfo.t))
        ? Number(nowInfo.t) / 1000
        : null;

    if (!Number.isFinite(nowSec)) return null;

    return godSignalState({
      T: Number(godT),
      G: Number(godG),
      beta0: godAnchorMs / 1000,
      beta1: Number(godBeta1),
      day: Number(nowInfo.day),
      nowSec,
      anchorDay: godAnchorDay,
    });
  }, [godEnabled, godT, godG, godBeta1, godAnchorMs, godAnchorDay, nowInfo]);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || !routeId) return;

    setLoading(true);
    (async () => {
      try {
        const r = await getRouteById(uid, routeId);
        setRoute(r);
        setPassedViaIds([]);
        setPassedSignalIds([]);
        setActiveMode("route");
        setActiveSignal(null);
        setFrozenApproachRoute(null);
        setApproachStart(null);
        setSignalBehaviorMode("normal");

        setSimEnabled(true);
        setSimMode("drag");
        setSimPaused(false);

        const startMs = buildSimStartMs({
          simDate,
          baseSecOfDay: r?.useTimeSecOfDay,
          randomRangeSec,
        });
        setSimNowMs(startMs);
      } catch (e) {
        console.error(e);
        alert("ルート取得失敗: " + String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.uid, routeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!("geolocation" in navigator)) return;

    const id = navigator.geolocation.watchPosition(
      (p) => {
        setRealPos({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy,
          speed: p.coords.speed,
        });
      },
      (e) => console.warn("gps error:", e),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    if (!simEnabled) setSimPaused(false);
  }, [simEnabled]);

  useEffect(() => {
    if (simMode !== "auto") setSimPaused(false);
  }, [simMode]);

  const reseedSimClock = useCallback(() => {
    const startMs = buildSimStartMs({
      simDate,
      baseSecOfDay: route?.useTimeSecOfDay,
      randomRangeSec,
    });
    setSimNowMs(startMs);
    lastSimClockTickRef.current = null;
  }, [simDate, route?.useTimeSecOfDay, randomRangeSec]);

  const handleAssistTargetChange = useCallback((next) => {
    setAssistTarget((prev) => {
      const prevId = prev?.signalId ?? null;
      const nextId = next?.signalId ?? null;

      const prevDist = prev?.distanceToSignalM ?? null;
      const nextDist = next?.distanceToSignalM ?? null;

      const prevReroute = prev?.rerouteActive ?? false;
      const nextReroute = next?.rerouteActive ?? false;

      if (
        prevId === nextId &&
        prevDist === nextDist &&
        prevReroute === nextReroute
      ) {
        return prev;
      }

      return next;
    });
  }, []);

  const handleNextTargetChange = useCallback((next) => {
    setNextTargetInfo(next ?? null);
  }, []);

  useEffect(() => {
    if (!simEnabled) return;

    const p0 =
      (routePts?.length >= 1 ? routePts[0] : null) ?? realPos ?? origin ?? null;

    if (p0) {
      const initPos = {
        lat: p0.lat,
        lng: p0.lng,
        acc: 5,
        speed: 0,
      };
      setSimPos(initPos);
      setSimS(0);
      prevPosSampleRef.current = { pos: initPos, t: simNowMs };
    } else {
      setSimPos(null);
      setSimS(0);
      prevPosSampleRef.current = null;
    }

    // ★追加
    setSpeedSamples([]);
    lastSpeedSampleAtRef.current = null;

    reseedSimClock();
    setFollowGPS(true);
    setShowRecenterBtn(false);
  }, [simEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!simEnabled) return;

    let rafId = null;

    const tick = (tMs) => {
      if (lastSimClockTickRef.current == null) {
        lastSimClockTickRef.current = tMs;
      }

      const dtSec = Math.min((tMs - lastSimClockTickRef.current) / 1000, 0.2);
      lastSimClockTickRef.current = tMs;

      const shouldAdvance = simMode !== "auto" || !simPaused;
      if (shouldAdvance) {
        setSimNowMs((prev) => prev + dtSec * 1000);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      lastSimClockTickRef.current = null;
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [simEnabled, simMode, simPaused]);

  useEffect(() => {
    if (!simEnabled) return;
    if (simMode !== "auto") return;
    if (!routePts || routePts.length < 2) return;

    const buildCumDist = (pts) => {
      if (!Array.isArray(pts) || pts.length < 2) return null;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) {
        cum[i] = cum[i - 1] + haversineM(pts[i - 1], pts[i]);
      }
      return { cum, total: cum[cum.length - 1] };
    };

    const pointAtS = (pts, cumTable, s) => {
      if (!pts || pts.length < 2 || !cumTable) return null;
      const { cum, total } = cumTable;
      const ss = Math.max(0, Math.min(total, Number(s) || 0));

      let lo = 0;
      let hi = cum.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= ss) lo = mid;
        else hi = mid;
      }

      const i = lo;
      const s0 = cum[i];
      const s1 = cum[i + 1];
      const t = s1 > s0 ? (ss - s0) / (s1 - s0) : 0;

      const A = pts[i];
      const B = pts[i + 1];
      return {
        lat: A.lat + t * (B.lat - A.lat),
        lng: A.lng + t * (B.lng - A.lng),
      };
    };

    const cumTable = buildCumDist(routePts);
    if (!cumTable) return;

    const speedMps = Math.max(0, Number(speedKmh) || 0) / 3.6;

    let rafId = null;
    let lastT = null;

    const tick = (tMs) => {
      if (lastT == null) lastT = tMs;

      let dt = (tMs - lastT) / 1000;
      lastT = tMs;
      dt = Math.min(dt, 0.2);

      setSimS((s) => {
        if (simPaused) return s;

        const s0 = Number(s) || 0;
        const next = s0 + speedMps * dt;
        const clamped = Math.min(cumTable.total, next);
        const p = pointAtS(routePts, cumTable, clamped);
        if (p) {
          setSimPos({
            lat: p.lat,
            lng: p.lng,
            acc: 5,
            speed: speedMps,
          });
        }
        return clamped;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [simEnabled, simMode, simPaused, speedKmh, routePts]);

  useEffect(() => {
    if (!pos) return;

    const now = currentClockMs;

    // ★追加：100ms未満ではサンプルを追加しない
    const lastSampleAt = lastSpeedSampleAtRef.current;
    if (lastSampleAt != null && now - lastSampleAt < SPEED_SAMPLE_INTERVAL_MS) {
      return;
    }

    const prev = prevPosSampleRef.current;

    if (!prev) {
      prevPosSampleRef.current = { pos, t: now };
      lastSpeedSampleAtRef.current = now;
      return;
    }

    const dtSec = (now - prev.t) / 1000;
    const distM = haversineM(prev.pos, pos);

    prevPosSampleRef.current = { pos, t: now };

    if (!Number.isFinite(dtSec) || dtSec <= 0.05) return;

    let kmh = null;

    if (pos?.speed != null && Number.isFinite(pos.speed)) {
      kmh = pos.speed * 3.6;
    }

    if (kmh == null) {
      if (!Number.isFinite(distM)) return;
      if (distM < SPEED_DIFF_MIN_DIST_M) return;
      kmh = (distM / dtSec) * 3.6;
    }

    if (!Number.isFinite(kmh)) return;

    kmh = Math.min(kmh, 60);

    // ★追加
    lastSpeedSampleAtRef.current = now;

    setSpeedSamples((prevSamples) => {
      const next = [...prevSamples, { t: now, kmh }];
      return next.filter((x) => now - x.t <= SPEED_HISTORY_KEEP_MS);
    });
  }, [pos, currentClockMs]);

  const displaySpeedKmh = useMemo(() => {
    const now = currentClockMs;
    const recent = speedSamples.filter(
      (x) => now - x.t <= SPEED_DISPLAY_WINDOW_MS,
    );
    if (!recent.length) return apiSpeedKmh ?? 0;
    const avg = recent.reduce((sum, x) => sum + x.kmh, 0) / recent.length;
    return Number.isFinite(avg) ? avg : (apiSpeedKmh ?? 0);
  }, [speedSamples, apiSpeedKmh, currentClockMs]);

  const judgeSpeedKmh = useMemo(() => {
    const now = currentClockMs;
    const recent = speedSamples.filter(
      (x) => now - x.t <= SPEED_JUDGE_WINDOW_MS,
    );
    if (!recent.length) return apiSpeedKmh ?? 0;
    const avg = recent.reduce((sum, x) => sum + x.kmh, 0) / recent.length;
    return Number.isFinite(avg) ? avg : (apiSpeedKmh ?? 0);
  }, [speedSamples, apiSpeedKmh, currentClockMs]);

  const redJudgeSpeedKmh = useMemo(() => {
    const now = currentClockMs;
    const recent = speedSamples.filter(
      (x) => now - x.t <= SPEED_RED_JUDGE_WINDOW_MS,
    );
    if (!recent.length) return apiSpeedKmh ?? 0;
    const avg = recent.reduce((sum, x) => sum + x.kmh, 0) / recent.length;
    return Number.isFinite(avg) ? avg : (apiSpeedKmh ?? 0);
  }, [speedSamples, apiSpeedKmh, currentClockMs]);

  const center = useMemo(() => {
    if (pos) return [pos.lat, pos.lng];
    if (origin) return [origin.lat, origin.lng];
    return [35.681236, 139.767125];
  }, [pos, origin]);

  const onResetToOrigin = useCallback(() => {
    if (!simEnabled) return;
    if (routePts?.length >= 1) {
      const p0 = routePts[0];
      const resetPos = {
        lat: p0.lat,
        lng: p0.lng,
        acc: 5,
        speed: 0,
      };
      setSimS(0);
      setSimPos(resetPos);
      prevPosSampleRef.current = {
        pos: resetPos,
        t: currentClockMs,
      };

      // ★追加
      setSpeedSamples([]);
      lastSpeedSampleAtRef.current = currentClockMs;

      reseedSimClock();
      setFollowGPS(true);
      setShowRecenterBtn(false);
    }
  }, [simEnabled, routePts, reseedSimClock, currentClockMs]);

  useEffect(() => {
    let cancelled = false;

    async function runAssistInfer() {
      const uid = user?.uid;
      const rid = routeId;
      const signalId = assistTarget?.signalId;

      if (!uid || !rid || !signalId) {
        setAssistObs([]);
        setAssistPred(null);
        setAssistError("");
        setAssistLoading(false);
        return;
      }

      setAssistLoading(true);
      setAssistError("");

      try {
        const obs = await getObsForInferSignalUnified(uid, rid, signalId, {
          maxRed: 30,
          maxBlue: 10,
        });

        if (cancelled) return;

        const safeObs = Array.isArray(obs) ? obs : [];

        console.log(
          "assist obs count",
          "total:",
          safeObs.length,
          "red:",
          safeObs.filter((o) => String(o?.color ?? "").toLowerCase() === "red")
            .length,
          "blue:",
          safeObs.filter((o) => String(o?.color ?? "").toLowerCase() !== "red")
            .length,
        );

        console.log("assist signalId list", [
          ...new Set(safeObs.map((o) => o?.signalId ?? null)),
        ]);

        console.log(
          "assist obs summary",
          safeObs.map((o) => ({
            signalId: o?.signalId ?? null,
            color: o?.color ?? null,
            t: Number.isFinite(Number(o?.t)) ? Math.round(Number(o.t)) : null,
            nextGreen: Number.isFinite(Number(o?.nextGreen))
              ? Math.round(Number(o.nextGreen))
              : null,
            wait: Number.isFinite(Number(o?.wait)) ? Number(o.wait) : null,
          })),
        );

        setAssistObs(safeObs);

        const pred = inferTG(safeObs, {
          sigmaTime: 3,
          sigmaWait: 3,
          T_MIN: 30,
          T_MAX: 200,
          BETA_STEP: 1,
        });

        if (cancelled) return;

        console.log("assist pred result", pred);
        setAssistPred(pred ?? null);
      } catch (e) {
        if (cancelled) return;
        console.error("assist infer failed:", e);
        setAssistObs([]);
        setAssistPred(null);
        setAssistError(String(e?.message ?? e ?? "assist infer failed"));
      } finally {
        if (!cancelled) setAssistLoading(false);
      }
    }

    runAssistInfer();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, routeId, assistTarget?.signalId]);

  const thetaAbsForAssist = useMemo(() => {
    if (!assistPred) return null;

    const anchorBeta0 = Number(assistPred.anchorBeta0);
    const anchorDay = Number(assistPred.anchorDay);
    const beta1 = Number(assistPred.beta1);

    if (!Number.isFinite(anchorBeta0)) return null;
    if (!Number.isFinite(anchorDay)) return null;
    if (!Number.isFinite(beta1)) return null;
    if (!Number.isFinite(assistNowDay)) return null;

    return anchorBeta0 + beta1 * (assistNowDay - anchorDay);
  }, [assistPred, assistNowDay]);

  const assistRanges = useMemo(() => {
    if (activeMode !== "route") return [];
    if (!assistPred) return [];
    if (!Number.isFinite(thetaAbsForAssist)) return [];
    if (!Number.isFinite(assistNowSec)) return [];
    if (!Number.isFinite(assistTarget?.distanceToSignalM)) return [];
    if (!(assistTarget.distanceToSignalM > 0)) return [];
    if (!(Number.isFinite(displaySpeedKmh) && displaySpeedKmh > 0)) return [];

    return buildSpeedRanges({
      distanceM: Number(assistTarget.distanceToSignalM),
      nowSpeedKmh: Number(displaySpeedKmh),
      maxSpeedKmh: 35,
      T: Number(assistPred.T),
      G: Number(assistPred.G),
      thetaAbs: Number(thetaAbsForAssist),
      nowSec: Number(assistNowSec),
    });
  }, [
    activeMode,
    assistPred,
    thetaAbsForAssist,
    assistNowSec,
    assistTarget?.distanceToSignalM,
    displaySpeedKmh,
  ]);

  const assistRedCount = useMemo(() => {
    return assistObs.filter(
      (o) => String(o?.color ?? "").toLowerCase() === "red",
    ).length;
  }, [assistObs]);

  const handleEnterSignalMode = useCallback(
    (signal) => {
      if (!signal) return;

      const frozen =
        Array.isArray(routePts) && routePts.length >= 2
          ? routePts.map((p) => ({ lat: p.lat, lng: p.lng }))
          : null;

      setActiveSignal(signal);
      setFrozenApproachRoute(frozen);
      setApproachStart({
        startedAt: currentClockMs,
        startDistanceM: pos ? haversineM(pos, signal) : null,
        startS: null,
        startDisplaySpeedKmh: displaySpeedKmh,
        startJudgeSpeedKmh: judgeSpeedKmh,
      });

      // ★追加：SignalMode突入時に速度履歴をリセット
      setSpeedSamples([
        {
          t: currentClockMs,
          kmh: Number.isFinite(judgeSpeedKmh) ? Number(judgeSpeedKmh) : 0,
        },
      ]);
      prevPosSampleRef.current = pos ? { pos, t: currentClockMs } : null;
      lastSpeedSampleAtRef.current = currentClockMs;

      setActiveMode("signal");
    },
    [routePts, pos, displaySpeedKmh, judgeSpeedKmh, currentClockMs],
  );

  const handlePassSignal = useCallback(
    async (payload) => {
      const uid = user?.uid;
      const rid = routeId;
      const signalId = payload?.id ?? activeSignal?.id;

      if (!signalId) return;

      try {
        const obs = payload?.observations ?? {};

        const redAtMs = toFiniteOrNull(obs.redAt);
        const blueAtMs = toFiniteOrNull(obs.blueAt);
        const postRedBlueAtMs = toFiniteOrNull(obs.postRedBlueAt);

        if (redAtMs == null && blueAtMs != null) {
          await saveBlueObservation(uid, rid, signalId, blueAtMs);
        }

        if (redAtMs != null) {
          const redObsId = await startRedObservation(
            uid,
            rid,
            signalId,
            redAtMs,
          );

          if (postRedBlueAtMs != null) {
            await finishRedObservation(
              uid,
              rid,
              redObsId,
              redAtMs,
              postRedBlueAtMs,
            );
          }
        }

        setPassedSignalIds((prev) => {
          if (prev.includes(signalId)) return prev;
          return [...prev, signalId];
        });
      } catch (e) {
        console.error("failed to save observations:", e);
        alert("観測保存に失敗: " + String(e?.message ?? e));
      } finally {
        setActiveSignal(null);
        setFrozenApproachRoute(null);
        setApproachStart(null);
        setActiveMode("route");
      }
    },
    [user?.uid, routeId, activeSignal],
  );

  const handleExitSignalMode = useCallback(() => {
    setActiveSignal(null);
    setFrozenApproachRoute(null);
    setApproachStart(null);
    setActiveMode("route");
  }, []);

  const showAssistSpeedSlot = activeMode === "route" && nextTargetInfo != null;

  useEffect(() => {
    onSignalModeChange?.(activeMode === "signal");
    return () => onSignalModeChange?.(false);
  }, [activeMode, onSignalModeChange]);

  return (
    <div
      className="hud-screen hud-screen--nav"
      style={{
        height: "calc(100dvh - 88px)",
        minHeight: "calc(100vh - 88px)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflow: "hidden",
      }}
    >
      {(loading || showAssistSpeedSlot) && (
        <div
          className="hud-card hud-card--compact nav-route-summary"
          style={{
            border: "none",
            borderRadius: 10,
            padding: 8,
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            flex: "0 0 auto",
          }}
        >
          {loading && (
            <span style={{ fontSize: 12, opacity: 0.7 }}>読込中...</span>
          )}

          {showAssistSpeedSlot && (
            <AssistSpeedSlot
              ranges={nextTargetInfo?.kind === "goal" ? [] : assistRanges}
              currentSpeedKmh={displaySpeedKmh}
              redCount={assistRedCount}
              nextTargetInfo={nextTargetInfo}
              onSkipSignal={
                nextTargetInfo?.isSignal
                  ? () => {
                      setPassedSignalIds((prev) => {
                        if (!nextTargetInfo?.id) return prev;
                        if (prev.includes(nextTargetInfo.id)) return prev;
                        return [...prev, nextTargetInfo.id];
                      });
                    }
                  : undefined
              }
            />
          )}
        </div>
      )}

      {activeMode === "signal" ? (
        <NavSignalMode
          gpsPos={pos}
          targetSignal={activeSignal}
          approachRoute={frozenApproachRoute}
          approachStart={approachStart}
          displaySpeedKmh={displaySpeedKmh}
          judgeSpeedKmh={judgeSpeedKmh}
          redJudgeSpeedKmh={redJudgeSpeedKmh}
          simEnabled={simEnabled}
          simMode={simMode}
          speedKmh={speedKmh}
          setSpeedKmh={setSpeedKmh}
          simPaused={simPaused}
          setSimPaused={setSimPaused}
          onPassSignal={handlePassSignal}
          onCancelSignalMode={handleExitSignalMode}
          nowMs={currentClockMs}
          godEnabled={godEnabled}
          godState={godState}
          signalBehaviorMode={signalBehaviorMode}
          setSignalBehaviorMode={setSignalBehaviorMode}
        />
      ) : (
        <div
          className="hud-map-frame nav-route-map"
          style={{
            flex: 1,
            minHeight: 0,
            border: "none",
            borderRadius: 10,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <MapContainer
            center={center}
            zoom={DEFAULT_ZOOM}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <SimControlPanel
              visible={showSimPanel}
              onToggleVisible={() => setShowSimPanel((prev) => !prev)}
              simEnabled={simEnabled}
              setSimEnabled={setSimEnabled}
              simMode={simMode}
              setSimMode={setSimMode}
              speedKmh={speedKmh}
              setSpeedKmh={setSpeedKmh}
              simPaused={simPaused}
              setSimPaused={setSimPaused}
              onResetToOrigin={onResetToOrigin}
              simDate={simDate}
              setSimDate={setSimDate}
              randomRangeSec={randomRangeSec}
              setRandomRangeSec={setRandomRangeSec}
              simNowMs={simNowMs}
              onReseedSimClock={reseedSimClock}
              godEnabled={godEnabled}
              setGodEnabled={setGodEnabled}
              godState={godState}
              godT={godT}
              setGodT={setGodT}
              godG={godG}
              setGodG={setGodG}
              godBeta1={godBeta1}
              setGodBeta1={setGodBeta1}
              godBaseDate={godBaseDate}
              setGodBaseDate={setGodBaseDate}
              godBaseTime={godBaseTime}
              setGodBaseTime={setGodBaseTime}
            />

            <FollowMe pos={pos} enabled={followGPS} />

            <DetectUserMapMove
              onUserMove={() => {
                if (followGPS) setFollowGPS(false);
                setShowRecenterBtn(true);
              }}
            />

            <RecenterControl
              visible={showRecenterBtn}
              pos={pos}
              onBlockClickOnce={blockClickOnce}
              onDone={() => {
                setFollowGPS(true);
                setShowRecenterBtn(false);
              }}
            />

            <ModeToggleControl
              mode={signalBehaviorMode}
              setMode={setSignalBehaviorMode}
              onBlockClickOnce={blockClickOnce}
            />

            <NavRouteMode
              route={route}
              pos={pos}
              passedViaIds={passedViaIds}
              setPassedViaIds={setPassedViaIds}
              passedSignalIds={passedSignalIds}
              setPassedSignalIds={setPassedSignalIds}
              onEnterSignalMode={handleEnterSignalMode}
              isSignalMode={activeMode === "signal"}
              onDisplayTargetChange={handleAssistTargetChange}
              onNextTargetChange={handleNextTargetChange}
            />

            {pos && (
              <Marker
                position={[pos.lat, pos.lng]}
                icon={iconGPS}
                zIndexOffset={1000}
                draggable={!!(simEnabled && simMode === "drag")}
                eventHandlers={{
                  dragstart: (e) => {
                    if (!simEnabled || simMode !== "drag") return;
                    blockClickOnce();

                    const ll = e.target.getLatLng();
                    const now = currentClockMs;

                    const dragPos = {
                      lat: ll.lat,
                      lng: ll.lng,
                      acc: 5,
                      speed: null,
                    };

                    prevPosSampleRef.current = { pos: dragPos, t: now };
                    setSimPos(dragPos);
                  },

                  drag: (e) => {
                    if (!simEnabled || simMode !== "drag") return;
                    const ll = e.target.getLatLng();
                    setSimPos({
                      lat: ll.lat,
                      lng: ll.lng,
                      acc: 5,
                      speed: null,
                    });
                  },

                  dragend: (e) => {
                    if (!simEnabled || simMode !== "drag") return;
                    const ll = e.target.getLatLng();
                    setSimPos({
                      lat: ll.lat,
                      lng: ll.lng,
                      acc: 5,
                      speed: null,
                    });
                    setFollowGPS(true);
                    setShowRecenterBtn(false);
                  },
                }}
              >
                <Popup>
                  <div style={{ display: "grid", gap: 6 }}>
                    <b>現在地</b>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {simEnabled ? "（シミュレーション）" : "（実GPS）"}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      vAPI: {apiSpeedKmh != null ? apiSpeedKmh.toFixed(1) : "-"}{" "}
                      km/h
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      vDisp: {displaySpeedKmh.toFixed(1)} km/h
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      vJudge: {judgeSpeedKmh.toFixed(1)} km/h
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      vRed: {redJudgeSpeedKmh.toFixed(1)} km/h
                    </div>
                    {simEnabled &&
                      simMode === "auto" &&
                      route?.routePts?.length >= 2 && (
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                          進捗: {Math.round(simS)} m
                        </div>
                      )}
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      sim時刻: {formatDateTimeLocal(simNowMs)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}

            {!simEnabled && realPos && realPos.acc && (
              <Circle
                center={[realPos.lat, realPos.lng]}
                radius={realPos.acc}
                pathOptions={{ color: "#1976d2", opacity: 0.3 }}
              />
            )}
          </MapContainer>
        </div>
      )}
    </div>
  );
}
