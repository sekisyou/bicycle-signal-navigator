// src/ui/NavRouteMode.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Marker, Polyline, Popup } from "react-leaflet";

import { iconDest, iconSignal, iconSignalFix } from "../leaflet/mapIcons";

/* =========================
   constants
========================= */
const OFFROUTE_M = 10;
const OFFROUTE_STABLE_MS = 5000;
const VIA_PASS_RADIUS_M = 10;
const SIGNAL_MODE_ENTER_M = 30;

/* =========================
   geo helpers
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

function buildCumDist(routePts) {
  if (!Array.isArray(routePts) || routePts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < routePts.length; i++) {
    cum[i] = cum[i - 1] + haversineM(routePts[i - 1], routePts[i]);
  }
  return { cum, total: cum[cum.length - 1] };
}

function pointAtS(routePts, cumTable, s) {
  if (!routePts || routePts.length < 2 || !cumTable) return null;
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

  const A = routePts[i];
  const B = routePts[i + 1];
  return {
    lat: A.lat + t * (B.lat - A.lat),
    lng: A.lng + t * (B.lng - A.lng),
  };
}

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

function slicePolylineFromS(routePts, cumTable, s) {
  if (!routePts || routePts.length < 2 || !cumTable) return [];
  const { cum, total } = cumTable;
  const ss = Math.max(0, Math.min(total, Number(s) || 0));

  let i = 0;
  while (i + 1 < cum.length && cum[i + 1] < ss) i++;

  const head = pointAtS(routePts, cumTable, ss);
  const tail = routePts.slice(i + 1);
  return head ? [head, ...tail] : tail;
}

/* =========================
   Mapbox
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
   Main
========================= */
export default function NavRouteMode({
  route,
  pos,
  passedViaIds,
  setPassedViaIds,
  passedSignalIds,
  onEnterSignalMode,
  isSignalMode,
  onDisplayTargetChange,
  onNextTargetChange,
}) {
  const dest = route?.dest ?? null;
  const signals = route?.signals ?? [];
  const viaPts = route?.viaPts ?? [];
  const routePts = route?.routePts ?? [];

  const cumTable = useMemo(() => buildCumDist(routePts), [routePts]);

  const [reroutePts, setReroutePts] = useState(null);
  const [rerouteActive, setRerouteActive] = useState(false);

  const rerouteInFlightRef = useRef(false);
  const offrouteSinceRef = useRef(null);
  const signalModeEnteredIdRef = useRef(null);
  const currentSignalIdRef = useRef(null);

  const projNow = useMemo(() => {
    if (!pos) return null;
    if (!routePts || routePts.length < 2) return null;
    return nearestPointOnPolyline(routePts, { lat: pos.lat, lng: pos.lng });
  }, [pos, routePts]);

  const sNow = projNow?.s ?? null;

  const signalsSorted = useMemo(() => {
    return [...(signals || [])].sort(
      (a, b) => (a.distance ?? 0) - (b.distance ?? 0),
    );
  }, [signals]);

  const viaWithDist = useMemo(() => {
    if (!routePts || routePts.length < 2) return [];
    return (viaPts || []).map((v) => {
      const pr = nearestPointOnPolyline(routePts, { lat: v.lat, lng: v.lng });
      return { ...v, distance: pr?.s ?? null, offDistM: pr?.d ?? null };
    });
  }, [viaPts, routePts]);

  /* =========================
     現在ターゲット中の信号を固定
     - 一度選んだ信号は、skip または passedSignalIds に入るまで維持
  ========================= */
  useEffect(() => {
    const availableSignals = (signalsSorted || []).filter(
      (s) => Number.isFinite(s.distance) && !passedSignalIds.includes(s.id),
    );

    if (availableSignals.length === 0) {
      currentSignalIdRef.current = null;
      return;
    }

    const stillExists = availableSignals.some(
      (s) => s.id === currentSignalIdRef.current,
    );

    if (stillExists) return;

    currentSignalIdRef.current = availableSignals[0].id;
  }, [signalsSorted, passedSignalIds]);

  /* =========================
     通過地点の自動通過判定
  ========================= */
  useEffect(() => {
    if (!pos) return;
    if (!viaPts || viaPts.length === 0) return;

    const hitIds = viaPts
      .filter((v) => !passedViaIds.includes(v.id))
      .filter(
        (v) => haversineM(pos, { lat: v.lat, lng: v.lng }) <= VIA_PASS_RADIUS_M,
      )
      .map((v) => v.id);

    if (hitIds.length === 0) return;

    setPassedViaIds((prev) => {
      const set = new Set(prev);
      hitIds.forEach((id) => set.add(id));
      return [...set];
    });
  }, [pos, viaPts, passedViaIds, setPassedViaIds]);

  /* =========================
     表示用の次目的地
     - UIでは信号 or 目的地のみ表示
  ========================= */
  const displayTarget = useMemo(() => {
    if (!cumTable || !dest) return null;

    const availableSignals = (signalsSorted || []).filter(
      (s) => Number.isFinite(s.distance) && !passedSignalIds.includes(s.id),
    );

    const lockedSignal =
      availableSignals.find((s) => s.id === currentSignalIdRef.current) ??
      availableSignals[0] ??
      null;

    if (lockedSignal) {
      return {
        kind: "signal",
        id: lockedSignal.id,
        name: lockedSignal.name ?? "信号",
        lat: lockedSignal.lat,
        lng: lockedSignal.lng,
        s: lockedSignal.distance,
        obj: lockedSignal,
      };
    }

    return {
      kind: "goal",
      id: "goal",
      name: "目的地",
      lat: dest.lat,
      lng: dest.lng,
      s: cumTable.total,
      obj: dest,
    };
  }, [signalsSorted, passedSignalIds, cumTable, dest]);

  /* =========================
     reroute 用の内部目標
     - displayTarget より手前に未通過の通過地点があるなら、まずそこへ向かう
     - なければ displayTarget に向かう
  ========================= */
  const routeAnchorTarget = useMemo(() => {
    if (!displayTarget) return null;

    const displayS = displayTarget.s ?? null;
    if (displayS == null) return displayTarget;

    const nextViaBeforeDisplay = (viaWithDist || []).find(
      (v) =>
        Number.isFinite(v.distance) &&
        !passedViaIds.includes(v.id) &&
        v.distance < displayS,
    );

    if (nextViaBeforeDisplay) {
      return {
        kind: "via",
        id: nextViaBeforeDisplay.id,
        name: nextViaBeforeDisplay.name ?? "通過地点",
        lat: nextViaBeforeDisplay.lat,
        lng: nextViaBeforeDisplay.lng,
        s: nextViaBeforeDisplay.distance,
        obj: nextViaBeforeDisplay,
      };
    }

    return displayTarget;
  }, [displayTarget, viaWithDist, passedViaIds]);

  const distToNextM = useMemo(() => {
    if (!displayTarget) return null;
    if (sNow == null) return null;
    if (displayTarget.s == null) return null;
    return Math.max(0, displayTarget.s - sNow);
  }, [displayTarget, sNow]);

  const nextSignalDirectDistM = useMemo(() => {
    if (!pos) return null;
    if (!displayTarget) return null;
    if (displayTarget.kind !== "signal") return null;

    return haversineM(pos, {
      lat: displayTarget.lat,
      lng: displayTarget.lng,
    });
  }, [pos, displayTarget]);

  useEffect(() => {
    if (!onDisplayTargetChange) return;

    if (!displayTarget || displayTarget.kind !== "signal") {
      onDisplayTargetChange(null);
      return;
    }

    onDisplayTargetChange({
      kind: "signal",
      signalId: displayTarget.id,
      signalName: displayTarget.name ?? "信号",
      signal: displayTarget.obj ?? null,
      distanceToSignalM: Number.isFinite(distToNextM) ? distToNextM : null,
      directDistanceM: Number.isFinite(nextSignalDirectDistM)
        ? nextSignalDirectDistM
        : null,
      routeDistanceS: Number.isFinite(displayTarget.s) ? displayTarget.s : null,
      rerouteActive: !!rerouteActive,
    });
  }, [
    onDisplayTargetChange,
    displayTarget,
    distToNextM,
    nextSignalDirectDistM,
    rerouteActive,
  ]);

  useEffect(() => {
    if (!onNextTargetChange) return;

    if (!displayTarget) {
      onNextTargetChange(null);
      return;
    }

    onNextTargetChange({
      kind: displayTarget.kind,
      id: displayTarget.id,
      name: displayTarget.name,
      lat: displayTarget.lat,
      lng: displayTarget.lng,
      distanceToTargetM: Number.isFinite(distToNextM) ? distToNextM : null,
      rerouteActive: !!rerouteActive,
      isSignal: displayTarget.kind === "signal",
    });
  }, [onNextTargetChange, displayTarget, distToNextM, rerouteActive]);

  /* =========================
     30m以内で信号モードへ
     - 表示対象の信号に対して判定する
  ========================= */
  useEffect(() => {
    if (isSignalMode) return;

    if (!displayTarget) {
      signalModeEnteredIdRef.current = null;
      return;
    }

    if (displayTarget.kind !== "signal") {
      signalModeEnteredIdRef.current = null;
      return;
    }

    if (nextSignalDirectDistM == null) return;

    if (nextSignalDirectDistM > SIGNAL_MODE_ENTER_M) {
      signalModeEnteredIdRef.current = null;
      return;
    }

    if (signalModeEnteredIdRef.current === displayTarget.id) return;

    signalModeEnteredIdRef.current = displayTarget.id;
    onEnterSignalMode?.(displayTarget);
  }, [isSignalMode, displayTarget, nextSignalDirectDistM, onEnterSignalMode]);

  /* =========================
     display route
     - signalMode中は青線を消す
  ========================= */
  const displayPts = useMemo(() => {
    if (isSignalMode) return [];

    if (rerouteActive && reroutePts && reroutePts.length >= 2) {
      if (!pos) return reroutePts;

      const projReroute = nearestPointOnPolyline(reroutePts, {
        lat: pos.lat,
        lng: pos.lng,
      });
      if (!projReroute) return reroutePts;

      const rerouteCum = buildCumDist(reroutePts);
      if (!rerouteCum) return reroutePts;

      return slicePolylineFromS(reroutePts, rerouteCum, projReroute.s);
    }

    if (!routePts || routePts.length < 2 || sNow == null || !cumTable) {
      return routePts || [];
    }

    return slicePolylineFromS(routePts, cumTable, sNow);
  }, [isSignalMode, rerouteActive, reroutePts, pos, routePts, sNow, cumTable]);

  /* =========================
     reroute
     - signalMode中は止める
     - 内部目標 routeAnchorTarget に向かう
  ========================= */
  useEffect(() => {
    if (isSignalMode) return;
    if (!pos) return;
    if (!routePts || routePts.length < 2) return;
    if (!cumTable) return;
    if (!projNow) return;
    if (!routeAnchorTarget) return;

    const off = projNow.d > OFFROUTE_M;

    if (!off) {
      offrouteSinceRef.current = null;
      return;
    }

    const now = Date.now();
    if (offrouteSinceRef.current == null) {
      offrouteSinceRef.current = now;
      return;
    }

    if (now - offrouteSinceRef.current < OFFROUTE_STABLE_MS) return;
    if (rerouteInFlightRef.current) return;

    rerouteInFlightRef.current = true;

    (async () => {
      try {
        const seg = await fetchRoutePtsMapbox({
          origin: { lat: pos.lat, lng: pos.lng },
          viaPts: [],
          dest: { lat: routeAnchorTarget.lat, lng: routeAnchorTarget.lng },
        });

        const tail = slicePolylineFromS(
          routePts,
          cumTable,
          routeAnchorTarget.s,
        );

        let merged = seg;
        if (seg.length >= 1 && tail.length >= 1) {
          const a = seg[seg.length - 1];
          const b = tail[0];
          if (haversineM(a, b) < 3) merged = [...seg, ...tail.slice(1)];
          else merged = [...seg, ...tail];
        } else {
          merged = [...seg, ...tail];
        }

        setReroutePts(merged);
        setRerouteActive(true);
        offrouteSinceRef.current = null;
      } catch (e) {
        console.error(e);
        offrouteSinceRef.current = null;
      } finally {
        rerouteInFlightRef.current = false;
      }
    })();
  }, [isSignalMode, pos, projNow, routePts, cumTable, routeAnchorTarget]);

  return (
    <>
      {displayPts?.length >= 2 && (
        <Polyline positions={displayPts.map((p) => [p.lat, p.lng])} />
      )}

      {dest && (
        <Marker position={[dest.lat, dest.lng]} icon={iconDest}>
          <Popup>到着</Popup>
        </Marker>
      )}

      {(signals || [])
        .filter((s) => !passedSignalIds.includes(s.id))
        .map((s) => (
          <Marker
            key={s.id}
            position={[s.lat, s.lng]}
            icon={s.needsFix ? iconSignalFix : iconSignal}
          >
            <Popup>
              <div style={{ display: "grid", gap: 6, minWidth: 220 }}>
                <b>{s.name ?? "信号"}</b>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  route距離:{" "}
                  {Number.isFinite(s.distance)
                    ? `${Math.round(s.distance)} m`
                    : "—"}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
    </>
  );
}
