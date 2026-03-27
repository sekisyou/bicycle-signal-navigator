// src/ui/MapPage.jsx
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  useMap,
  useMapEvents,
  Circle,
} from "react-leaflet";

import {
  saveRoute,
  listRoutes,
  routeNameExists,
  updateRoute,
  deleteRoute,
} from "../routesStore";

import {
  iconOrigin,
  iconDest,
  iconVia,
  iconSignal,
  iconSignalFix,
  iconGPS,
} from "../leaflet/mapIcons";

/* =========================
   constants
========================= */
const SNAP_THRESH_M = 30;
const DEFAULT_ZOOM = 16;

/* =========================
   Firestore: undefined除去（超重要）
========================= */
function stripUndefinedDeep(v) {
  if (Array.isArray(v)) {
    return v.map(stripUndefinedDeep).filter((x) => x !== undefined);
  }
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      const vv = stripUndefinedDeep(val);
      if (vv === undefined) continue;
      out[k] = vv;
    }
    return out;
  }
  return v;
}

/* =========================
   geo helpers (meter)
========================= */
function haversineM(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function polylineLengthM(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += haversineM(pts[i - 1], pts[i]);
  return sum;
}

// HH:MM <-> sec
function hhmmToSec(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return hh * 3600 + mm * 60;
}
function secToHHMM(sec) {
  if (sec == null) return null;
  const s = Math.max(0, Math.min(86399, Number(sec)));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * nearest point on polyline (local plane approx)
 * returns {lat,lng, d, s, segIndex}
 */
function nearestPointOnPolyline(routePts, p) {
  if (!Array.isArray(routePts) || routePts.length < 2) return null;

  const lat0 = routePts[0].lat;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;

  const toXY = (ll) => ({ x: ll.lng * kx, y: ll.lat * ky });
  const toLL = (xy) => ({ lat: xy.y / ky, lng: xy.x / kx });

  const P = toXY(p);

  let best = null;
  let cum = 0;

  for (let i = 0; i < routePts.length - 1; i++) {
    const A0 = routePts[i];
    const B0 = routePts[i + 1];
    const A = toXY(A0);
    const B = toXY(B0);

    const vx = B.x - A.x;
    const vy = B.y - A.y;
    const wx = P.x - A.x;
    const wy = P.y - A.y;

    const vv = vx * vx + vy * vy;
    const t = vv > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;

    const Q = { x: A.x + t * vx, y: A.y + t * vy };
    const dx = P.x - Q.x;
    const dy = P.y - Q.y;
    const d = Math.sqrt(dx * dx + dy * dy);

    const segLen = Math.sqrt(vv);
    const s = cum + t * segLen;

    if (!best || d < best.d) {
      const ll = toLL(Q);
      best = { ...ll, d, s, segIndex: i };
    }

    cum += segLen;
  }

  return best;
}

/* =========================
   route data summary
========================= */
function getSignalObsCount(signal) {
  const n = Number(signal?.obsCount);
  return Number.isFinite(n) ? n : 0;
}

function getRouteDataSummary(route) {
  const signals = Array.isArray(route?.signals) ? route.signals : [];

  if (signals.length === 0) {
    return {
      level: "none",
      avgObs: null,
      label: "信号未登録",
      color: "#6b7280",
      bg: "#f3f4f6",
      border: "#d1d5db",
    };
  }

  const counts = signals.map(getSignalObsCount);
  const sum = counts.reduce((a, b) => a + b, 0);
  const avgObs = sum / signals.length;

  if (avgObs < 5) {
    return {
      level: "low",
      avgObs,
      label: "データ少",
      color: "#9a3412",
      bg: "#ffedd5",
      border: "#fdba74",
    };
  }

  if (avgObs < 15) {
    return {
      level: "mid",
      avgObs,
      label: "データ中",
      color: "#1d4ed8",
      bg: "#dbeafe",
      border: "#93c5fd",
    };
  }

  return {
    level: "high",
    avgObs,
    label: "データ十分",
    color: "#166534",
    bg: "#dcfce7",
    border: "#86efac",
  };
}

function routeButtonStyle(summary) {
  return {
    padding: "7px 11px",
    borderRadius: 10,
    border: `1px solid ${summary.border}`,
    background: summary.bg,
    color: summary.color,
    fontWeight: 700,
    fontSize: 14,
  };
}

/* =========================
   Mapbox Directions
========================= */
async function fetchRoutePtsMapbox({ origin, viaPts, dest }) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token) throw new Error("VITE_MAPBOX_TOKEN が未設定です");

  const coords = [];
  coords.push([origin.lng, origin.lat]);
  for (const v of viaPts || []) coords.push([v.lng, v.lat]);
  coords.push([dest.lng, dest.lat]);

  const url =
    "https://api.mapbox.com/directions/v5/mapbox/cycling/" +
    coords.map((c) => c.join(",")).join(";") +
    `?geometries=geojson&overview=full&steps=false&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Mapbox Directions API error: " + res.status);
  const json = await res.json();

  const g = json?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(g) || g.length < 2) return [];

  return g.map(([lng, lat]) => ({ lat, lng }));
}

/* =========================
   Map helpers
========================= */
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

function ClickHandler({ onPick, shouldBlockClick }) {
  useMapEvents({
    click(e) {
      if (shouldBlockClick?.()) return;
      onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
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

/* =========================
   Main Page
========================= */
export default function MapPage({ user, onDone }) {
  // stage: 1=出発/到着 2=通過 3=信号
  const [stage, setStage] = useState(1);
  const [pickTarget, setPickTarget] = useState("origin");

  // edit mode
  const [editMode, setEditMode] = useState(false);
  const [editRouteId, setEditRouteId] = useState(null);
  const editSnapshotRef = useRef(null);

  const [routeName, setRouteName] = useState("");
  const [useTimeStr, setUseTimeStr] = useState("12:00");
  const useTimeSecOfDay = useMemo(() => hhmmToSec(useTimeStr), [useTimeStr]);

  // data
  const [origin, setOrigin] = useState(null);
  const [dest, setDest] = useState(null);
  const [viaPts, setViaPts] = useState([]);
  const [signals, setSignals] = useState([]);
  const [routePts, setRoutePts] = useState([]);
  const distM = useMemo(() => polylineLengthM(routePts), [routePts]);

  // GPS
  const [pos, setPos] = useState(null);

  // follow
  const [followGPS, setFollowGPS] = useState(true);
  const [showRecenterBtn, setShowRecenterBtn] = useState(false);

  // saved routes list
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  const sortedSavedRoutes = useMemo(() => {
    return [...(savedRoutes || [])].sort((a, b) => {
      const aAvg = getRouteDataSummary(a).avgObs ?? -1;
      const bAvg = getRouteDataSummary(b).avgObs ?? -1;

      if (bAvg !== aAvg) return bAvg - aAvg;

      const aName = String(a?.name ?? "");
      const bName = String(b?.name ?? "");
      return aName.localeCompare(bName, "ja");
    });
  }, [savedRoutes]);

  // block click once
  const blockNextMapClickRef = useRef(false);
  const blockClickOnce = useCallback(() => {
    blockNextMapClickRef.current = true;
    setTimeout(() => {
      blockNextMapClickRef.current = false;
    }, 250);
  }, []);

  /* =========================
     Firestore: list
  ========================= */
  const refreshRoutes = useCallback(async () => {
    const uid = user?.uid;
    if (!uid) return;

    setLoadingRoutes(true);
    try {
      const rs = await listRoutes(uid);
      setSavedRoutes(rs);
    } catch (e) {
      console.error(e);
      alert("ルート一覧取得失敗: " + String(e?.message ?? e));
    } finally {
      setLoadingRoutes(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    refreshRoutes();
  }, [refreshRoutes]);

  function enterEditFromDoc(r) {
    editSnapshotRef.current = {
      routeName: r.name ?? "",
      useTimeSecOfDay: r.useTimeSecOfDay ?? null,
      origin: r.origin ?? null,
      dest: r.dest ?? null,
      viaPts: r.viaPts ?? [],
      signals: r.signals ?? [],
      routePts: r.routePts ?? [],
    };

    setEditMode(true);
    setEditRouteId(r.id);

    setRouteName(r.name ?? "");
    setUseTimeStr(secToHHMM(r.useTimeSecOfDay ?? 12 * 3600) ?? "12:00");
    setOrigin(r.origin ?? null);
    setDest(r.dest ?? null);
    setViaPts(r.viaPts ?? []);
    setSignals(r.signals ?? []);
    setRoutePts(r.routePts ?? []);

    setStage(2);
    setPickTarget("origin");
  }

  function exitEditDiscard() {
    const ok = window.confirm("編集を破棄して戻りますか？（変更は失われます）");
    if (!ok) return;

    const snap = editSnapshotRef.current;
    if (snap) {
      setRouteName(snap.routeName ?? "");
      setUseTimeStr(
        snap.useTimeSecOfDay != null
          ? (secToHHMM(snap.useTimeSecOfDay) ?? "12:00")
          : "12:00",
      );
      setOrigin(snap.origin ?? null);
      setDest(snap.dest ?? null);
      setViaPts(snap.viaPts ?? []);
      setSignals(snap.signals ?? []);
      setRoutePts(snap.routePts ?? []);
    }

    setEditMode(false);
    setEditRouteId(null);
    editSnapshotRef.current = null;

    setStage(1);
    setPickTarget("origin");
  }

  function newRoute() {
    setEditMode(false);
    setEditRouteId(null);
    editSnapshotRef.current = null;

    setStage(1);
    setPickTarget("origin");

    setRouteName("");
    setUseTimeStr("12:00");
    setOrigin(null);
    setDest(null);
    setViaPts([]);
    setSignals([]);
    setRoutePts([]);
  }

  /* =========================
     GPS watch
  ========================= */
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy,
        });
      },
      (e) => console.warn("gps error:", e),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  /* =========================
     center
  ========================= */
  const center = useMemo(() => {
    if (pos) return [pos.lat, pos.lng];
    if (origin) return [origin.lat, origin.lng];
    return [35.681236, 139.767125];
  }, [pos, origin]);

  /* =========================
     route building
  ========================= */
  const rebuildRoute = useCallback(async () => {
    if (!origin || !dest) return;
    try {
      const pts = await fetchRoutePtsMapbox({ origin, viaPts, dest });
      setRoutePts(pts);
    } catch (e) {
      console.error(e);
      alert("ルート生成に失敗: " + String(e?.message ?? e));
      setRoutePts([]);
    }
  }, [origin, dest, viaPts]);

  useEffect(() => {
    if (stage !== 1) return;
    if (!origin || !dest) return;
    setStage(2);
    rebuildRoute();
  }, [stage, origin, dest, rebuildRoute]);

  useEffect(() => {
    if (!origin || !dest) return;
    if (stage === 2 || stage === 3) rebuildRoute();
  }, [viaPts, origin, dest, stage, rebuildRoute]);

  /* =========================
     snap signal
  ========================= */
  const snapSignal = useCallback(
    (sig) => {
      if (!routePts || routePts.length < 2) return { ...sig, needsFix: true };

      const nearest = nearestPointOnPolyline(routePts, {
        lat: sig.lat,
        lng: sig.lng,
      });
      if (!nearest) return { ...sig, needsFix: true };

      const needsFix = nearest.d > SNAP_THRESH_M;

      if (!needsFix) {
        return {
          ...sig,
          lat: nearest.lat,
          lng: nearest.lng,
          needsFix: false,
          distance: nearest.s,
          offDistM: undefined,
        };
      }
      return {
        ...sig,
        needsFix: true,
        distance: nearest.s,
        offDistM: nearest.d,
      };
    },
    [routePts],
  );

  useEffect(() => {
    if (!routePts || routePts.length < 2) return;
    if (!signals || signals.length === 0) return;
    setSignals((arr) => (arr || []).map((s) => snapSignal(s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePts]);

  /* =========================
     pick handler
  ========================= */
  function applyPickPoint(p) {
    if (stage === 1) {
      if (pickTarget === "origin") {
        setOrigin(p);
        setPickTarget("dest");
        return;
      }
      if (pickTarget === "dest") {
        setDest(p);
        setPickTarget("origin");
        return;
      }
      return;
    }

    if (stage === 2) {
      const id = `via_${Date.now()}`;
      setViaPts([...(viaPts || []), { ...p, id }]);
      return;
    }

    if (stage === 3) {
      if (!routePts || routePts.length < 2) {
        alert("先にルート（出発/到着）を作成してください");
        return;
      }
      const nearest = nearestPointOnPolyline(routePts, p);
      if (!nearest || nearest.d > SNAP_THRESH_M) {
        alert("ルートから遠すぎます（30m以内で追加してください）");
        return;
      }
      const id = `sig_${Date.now()}`;
      const base = {
        id,
        name: `信号${(signals?.length || 0) + 1}`,
        lat: nearest.lat,
        lng: nearest.lng,
        needsFix: false,
        distance: nearest.s,
        obsCount: 0,
        cycle: {
          T: null,
          beta1: null,
          G: null,
          R: null,
          theta: null,
          confidence: null,
          updatedAt: null,
        },
      };
      setSignals([...(signals || []), base]);
      return;
    }
  }

  function pickCurrentLocation() {
    if (!pos) return alert("GPS位置がまだ取得できていません");
    applyPickPoint({ lat: pos.lat, lng: pos.lng });
  }

  /* =========================
     stage transitions
  ========================= */
  function goStage2() {
    if (stage === 1) return;
    setStage(2);
  }
  function goStage3() {
    if (!origin || !dest) return alert("先に出発/到着を決めてください");
    if (!routePts || routePts.length < 2)
      return alert("ルート生成がまだです（少し待つか、やり直してください）");
    setStage(3);
  }

  /* =========================
     clear
  ========================= */
  function onClearInternal() {
    if (editMode) {
      setViaPts([]);
      setSignals([]);
      setRoutePts([]);
      setStage(2);
      return;
    }
    newRoute();
  }

  function onClearClick() {
    const msg = editMode
      ? "通過点/信号/ルート表示をクリアしますか？（出発/到着はそのまま）"
      : "入力中の内容をすべてクリアして新規作成しますか？";
    const ok = window.confirm(msg);
    if (!ok) return;
    onClearInternal();
  }

  /* =========================
     save / update
  ========================= */
  async function saveCurrentRouteToFirestore({ goSim = false } = {}) {
    const uid = user?.uid;
    if (!uid) throw new Error("uidがありません（ログインしてる？）");

    const name = (routeName ?? "").trim();
    if (!name) throw new Error("ルート名を入力してください");
    if (!origin || !dest) throw new Error("出発/到着を設定してください");
    if (!routePts || routePts.length < 2) throw new Error("ルートがありません");
    if (useTimeSecOfDay == null)
      throw new Error(
        "使う出発時刻は HH:MM 形式で入力してください（例 12:00）",
      );

    const cleanedSignals = (signals || [])
      .map((s) => snapSignal(s))
      .filter((s) => !s.needsFix)
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

    const payload = {
      name,
      useTimeSecOfDay,
      origin,
      dest,
      viaPts: viaPts || [],
      signals: cleanedSignals,
      routePts,
      distM,
    };

    const payloadSanitized = stripUndefinedDeep(payload);

    const exists = await routeNameExists(
      uid,
      name,
      editMode ? editRouteId : null,
    );
    if (exists)
      throw new Error("同名のルートが既にあります。別名にしてください。");

    let routeId = null;

    if (editMode && editRouteId) {
      await updateRoute(uid, editRouteId, payloadSanitized);
      routeId = editRouteId;
    } else {
      routeId = await saveRoute(uid, payloadSanitized);
    }

    await refreshRoutes();

    if (!goSim) {
      newRoute();
    }

    return { routeId };
  }

  async function onSave() {
    try {
      const { routeId } = await saveCurrentRouteToFirestore({ goSim: false });
      alert(editMode ? `更新しました: ${routeId}` : `保存しました: ${routeId}`);
      if (editMode) {
        setEditMode(false);
        setEditRouteId(null);
        editSnapshotRef.current = null;
      }
    } catch (e) {
      console.error(e);
      alert(String(e?.message ?? e));
    }
  }

  async function onDeleteRoute(r) {
    const uid = user?.uid;
    if (!uid) return;

    const ok = window.confirm(`削除しますか？\n${r?.name ?? "(no name)"}`);
    if (!ok) return;

    try {
      await deleteRoute(uid, r.id);
      await refreshRoutes();

      if (editMode && editRouteId === r.id) {
        newRoute();
      }
    } catch (e) {
      console.error(e);
      alert("削除に失敗: " + String(e?.message ?? e));
    }
  }

  function onOpenRouteForNav(r) {
    onDone?.({ routeId: r.id, mode: "nav" });
  }

  const stageLabel =
    stage === 1 ? "1: 出発/到着" : stage === 2 ? "2: 通過地点" : "3: 信号";

  return (
    <div
      className="hud-screen"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        height: "calc(100vh - 20px)",
      }}
    >
      {/* =========================
          保存したルート
      ========================= */}
      <div className="hud-card hud-card--padded" style={{ border: "none" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 800 }}>保存したルート</div>
          {loadingRoutes && (
            <span style={{ fontSize: 12, opacity: 0.7 }}>読込中...</span>
          )}
          <div style={{ flex: 1 }} />
          {editMode && (
            <button onClick={exitEditDiscard} style={{ background: "#eee" }}>
              編集を終了（破棄）
            </button>
          )}
        </div>

        <div
          className="saved-routes-scroll"
          style={{
            marginTop: 10,
            display: "grid",
            gap: 8,
            maxHeight: sortedSavedRoutes.length > 3 ? 220 : undefined,
            overflowY: sortedSavedRoutes.length > 3 ? "auto" : "visible",
            WebkitOverflowScrolling:
              sortedSavedRoutes.length > 3 ? "touch" : undefined,
            paddingRight: sortedSavedRoutes.length > 3 ? 4 : 0,
          }}
        >
          {sortedSavedRoutes.map((r) => {
            const summary = getRouteDataSummary(r);

            return (
              <div
                key={r.id}
                style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
              >
                <button
                  onClick={() => onOpenRouteForNav(r)}
                  style={routeButtonStyle(summary)}
                  title={`${summary.label}${
                    summary.avgObs != null
                      ? ` / 平均観測数 ${summary.avgObs.toFixed(1)}`
                      : ""
                  }`}
                >
                  {r.name ?? "(no name)"}{" "}
                  <span style={{ fontSize: 11, opacity: 0.75 }}>
                    {Number.isFinite(r.distM)
                      ? ` - ${Math.round(r.distM)} m`
                      : ""}
                    {r.useTimeSecOfDay != null
                      ? ` / ${secToHHMM(r.useTimeSecOfDay) ?? ""}`
                      : ""}
                    {summary.avgObs != null
                      ? ` / ${summary.avgObs.toFixed(1)}`
                      : ""}
                  </span>
                </button>

                <button
                  onClick={() => enterEditFromDoc(r)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                    background: "#f7f7f7",
                    fontSize: 13,
                  }}
                >
                  編集
                </button>

                <button
                  onClick={() => onDeleteRoute(r)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                    background: "#fff0f0",
                    fontSize: 13,
                  }}
                >
                  削除
                </button>
              </div>
            );
          })}

          {(!sortedSavedRoutes || sortedSavedRoutes.length === 0) && (
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              まだ保存がありません
            </div>
          )}
        </div>
      </div>

      {/* =========================
          道順登録
      ========================= */}
      <div className="hud-card hud-card--padded" style={{ border: "none" }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>
          {editMode ? "道順編集" : "道順登録"} /{" "}
          <span style={{ opacity: 0.7 }}>{stageLabel}</span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            placeholder="通学ルート"
            style={{ flex: "1 1 320px", padding: 8 }}
          />
          <div style={{ fontSize: 12, color: "#555" }}>
            距離: {routePts?.length >= 2 ? `${Math.round(distM)} m` : "—"}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 10,
          }}
        >
          <label style={{ fontSize: 12, color: "#555" }}>
            使う出発時刻（10分刻み）
            <input
              type="time"
              value={useTimeStr}
              step={600}
              onChange={(e) => setUseTimeStr(e.target.value)}
              onBlur={() => {
                const sec = hhmmToSec(useTimeStr);
                if (sec == null) return;
                const rounded = Math.round(sec / 600) * 600;
                setUseTimeStr(secToHHMM(rounded % 86400) ?? "12:00");
              }}
              style={{ marginLeft: 8, padding: 6, width: 140 }}
            />
          </label>
          <div
            style={{
              fontSize: 12,
              color: useTimeSecOfDay == null ? "#b26" : "#666",
            }}
          >
            {useTimeSecOfDay == null
              ? "※ 形式が違います（例 12:00）"
              : "※ ±1時間のみ予測データとして使用します"}
          </div>
        </div>

        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}
        >
          {!editMode && stage === 1 && (
            <>
              <button
                onClick={() => setPickTarget("origin")}
                style={{
                  fontWeight: pickTarget === "origin" ? 800 : 400,
                  outline: pickTarget === "origin" ? "2px solid #333" : "none",
                }}
              >
                出発
              </button>
              <button
                onClick={() => setPickTarget("dest")}
                style={{
                  fontWeight: pickTarget === "dest" ? 800 : 400,
                  outline: pickTarget === "dest" ? "2px solid #333" : "none",
                }}
              >
                到着
              </button>
              <button onClick={pickCurrentLocation}>現在地</button>
            </>
          )}

          {(stage === 2 || stage === 3 || editMode) && (
            <>
              <button onClick={goStage2} disabled={stage === 2}>
                通過モード
              </button>
              <button onClick={goStage3} disabled={stage === 3}>
                信号モード
              </button>
              <button onClick={pickCurrentLocation}>現在地で追加</button>
            </>
          )}

          <button
            onClick={onClearClick}
            style={{
              border: "1px solid #ccc",
              background: "#f5f5f5",
              borderRadius: 10,
              padding: "8px 12px",
            }}
            title={
              editMode ? "通過点/信号/ルート表示をクリア" : "新規作成に戻す"
            }
          >
            クリア
          </button>

          <button onClick={onSave} style={{ fontWeight: 800 }}>
            {editMode ? "編集を保存" : "保存"}
          </button>
        </div>
      </div>

      {/* ===== map ===== */}
      <div
        className="hud-map-frame"
        style={{
          flex: 1,
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

          <FollowMe pos={pos} enabled={followGPS} />
          <DetectUserMapMove
            onUserMove={() => {
              if (followGPS) setFollowGPS(false);
              setShowRecenterBtn(true);
            }}
          />
          <ClickHandler
            onPick={applyPickPoint}
            shouldBlockClick={() => blockNextMapClickRef.current}
          />

          {(signals || []).some((s) => s.needsFix) && (
            <div
              style={{
                position: "absolute",
                left: 12,
                bottom: 12,
                zIndex: 999,
                background: "rgba(255,255,255,0.95)",
                border: "1px solid #d99",
                padding: "8px 10px",
                borderRadius: 10,
                fontSize: 12,
                color: "#b26",
                maxWidth: 420,
              }}
            >
              ルートから30m以上外れた信号があります（警告アイコン）。保存時に除外されます。
            </div>
          )}

          <RecenterControl
            visible={showRecenterBtn}
            pos={pos}
            onBlockClickOnce={blockClickOnce}
            onDone={() => {
              setFollowGPS(true);
              setShowRecenterBtn(false);
            }}
          />

          {routePts?.length >= 2 && (
            <Polyline positions={routePts.map((p) => [p.lat, p.lng])} />
          )}

          {origin && (
            <Marker position={[origin.lat, origin.lng]} icon={iconOrigin}>
              <Popup>出発</Popup>
            </Marker>
          )}
          {dest && (
            <Marker position={[dest.lat, dest.lng]} icon={iconDest}>
              <Popup>到着</Popup>
            </Marker>
          )}

          {pos && (
            <Marker
              position={[pos.lat, pos.lng]}
              icon={iconGPS}
              zIndexOffset={1000}
            >
              <Popup>現在地</Popup>
            </Marker>
          )}

          {pos && pos.acc && (
            <Circle
              center={[pos.lat, pos.lng]}
              radius={pos.acc}
              pathOptions={{ color: "#1976d2", opacity: 0.3 }}
            />
          )}

          {(viaPts || []).map((v) => (
            <Marker
              key={v.id}
              position={[v.lat, v.lng]}
              icon={iconVia}
              draggable={true}
              eventHandlers={{
                dragend: (e) => {
                  const ll = e.target.getLatLng();
                  setViaPts((arr) =>
                    (arr || []).map((x) =>
                      x.id === v.id ? { ...x, lat: ll.lat, lng: ll.lng } : x,
                    ),
                  );
                },
              }}
            >
              <Popup>
                <div style={{ display: "grid", gap: 8 }}>
                  <b>通過地点</b>
                  <button
                    onClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      blockClickOnce();
                      setViaPts((arr) =>
                        (arr || []).filter((x) => x.id !== v.id),
                      );
                    }}
                  >
                    削除
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}

          {(signals || []).map((s) => (
            <Marker
              key={s.id}
              position={[s.lat, s.lng]}
              icon={s.needsFix ? iconSignalFix : iconSignal}
              draggable={true}
              eventHandlers={{
                dragend: (e) => {
                  const ll = e.target.getLatLng();
                  const moved = { ...s, lat: ll.lat, lng: ll.lng };
                  const snapped = snapSignal(moved);

                  if (snapped.needsFix) {
                    alert(
                      "ルートから遠すぎます（信号はルート上に置いてください）",
                    );
                    return;
                  }

                  setSignals((arr) =>
                    (arr || []).map((x) => (x.id === s.id ? snapped : x)),
                  );
                },
              }}
            >
              <Popup>
                <div style={{ display: "grid", gap: 8, minWidth: 240 }}>
                  <b>{s.name ?? "信号"}</b>
                  {s.needsFix && (
                    <div style={{ color: "#b26", fontSize: 12 }}>
                      ルートから外れています（30m以内に修正してください）
                    </div>
                  )}
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    route距離:{" "}
                    {Number.isFinite(s.distance)
                      ? `${Math.round(s.distance)} m`
                      : "—"}
                  </div>
                  <button
                    onClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      const ok = window.confirm(
                        "この信号を削除すると、この信号の観測データも失われます。削除しますか？",
                      );
                      if (!ok) return;
                      blockClickOnce();
                      setSignals((arr) =>
                        (arr || []).filter((x) => x.id !== s.id),
                      );
                    }}
                  >
                    削除
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
