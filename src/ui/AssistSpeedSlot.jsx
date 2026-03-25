import { useMemo, useRef, useEffect } from "react";

function fmt1(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

function bandMin(band) {
  return Math.min(Number(band?.low), Number(band?.high));
}

function bandMax(band) {
  return Math.max(Number(band?.low), Number(band?.high));
}

function findBandByTag(ranges, tag) {
  return ranges.find((r) => r.tag === tag) ?? null;
}

function normalizeBand(band) {
  if (!band) return null;
  const low = bandMin(band);
  const high = bandMax(band);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { ...band, low, high };
}

function makeGapBand(leftBand, rightBand) {
  if (!leftBand || !rightBand) return null;

  const low = bandMax(leftBand);
  const high = bandMin(rightBand);

  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (high <= low) return null;

  return { low, high };
}

function isSpeedInBand(speedKmh, band) {
  if (!band) return false;
  const v = Number(speedKmh);
  if (!Number.isFinite(v)) return false;
  return v >= bandMin(band) && v <= bandMax(band);
}

function getTargetLabel(nextTargetInfo) {
  if (!nextTargetInfo) return "—";
  if (nextTargetInfo.kind === "signal") return nextTargetInfo.name ?? "信号";
  if (nextTargetInfo.kind === "goal") return "目的地";
  return nextTargetInfo.name ?? "—";
}

function getTargetDistanceLabel(nextTargetInfo) {
  const d = Number(nextTargetInfo?.distanceToTargetM);
  if (!Number.isFinite(d)) return "—";
  if (d >= 1000) return `${(d / 1000).toFixed(2)} km`;
  return `${Math.round(d)} m`;
}

function pointOnEllipse(cx, cy, rx, ry, frac) {
  const theta = Math.PI - frac * Math.PI;
  return {
    x: cx + rx * Math.cos(theta),
    y: cy - ry * Math.sin(theta),
  };
}

function buildSkipWedgePath({
  cx,
  cy,
  outerRx,
  outerRy,
  padRx = 20,
  padRy = 14,
  startFrac = 0.66,
  endFrac = 0.985,
  topY = 8,
}) {
  const rx = outerRx + padRx;
  const ry = outerRy + padRy;

  const a = pointOnEllipse(cx, cy, rx, ry, startFrac);
  const b = pointOnEllipse(cx, cy, rx, ry, endFrac);

  const rightX = b.x - 2;
  const r = 10;

  return `
    M ${a.x} ${a.y}
    L ${rightX - r} ${topY}
    Q ${rightX} ${topY} ${rightX} ${topY + r}
    L ${rightX} ${b.y}
    A ${rx} ${ry} 0 0 0 ${a.x} ${a.y}
    Z
  `;
}

function arcSegmentPath(
  cx,
  cy,
  outerRx,
  outerRy,
  innerRx,
  innerRy,
  startFrac,
  endFrac,
) {
  const n = 36;
  const outer = [];
  const inner = [];

  for (let i = 0; i <= n; i++) {
    const f = startFrac + ((endFrac - startFrac) * i) / n;
    outer.push(pointOnEllipse(cx, cy, outerRx, outerRy, f));
  }
  for (let i = n; i >= 0; i--) {
    const f = startFrac + ((endFrac - startFrac) * i) / n;
    inner.push(pointOnEllipse(cx, cy, innerRx, innerRy, f));
  }

  const pts = [...outer, ...inner];
  if (!pts.length) return "";

  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  }
  d += " Z";
  return d;
}

function buildSlotGeometry(mode) {
  if (mode === "red") {
    return [
      { start: 0.04, end: 0.22 },
      { start: 0.22, end: 0.4 },
      { start: 0.4, end: 0.6 },
      { start: 0.6, end: 0.78 },
      { start: 0.78, end: 0.96 },
    ];
  }

  return [
    { start: 0.04, end: 0.2 },
    { start: 0.2, end: 0.36 },
    { start: 0.36, end: 0.64 },
    { start: 0.64, end: 0.8 },
    { start: 0.8, end: 0.96 },
  ];
}

function buildMeterModel(ranges, currentSpeedKmh) {
  const bot = normalizeBand(findBandByTag(ranges, "bot"));
  const mid = normalizeBand(findBandByTag(ranges, "mid"));
  const top = normalizeBand(findBandByTag(ranges, "top"));

  const blueBands = [
    { key: "bot", band: bot },
    { key: "mid", band: mid },
    { key: "top", band: top },
  ].filter((x) => !!x.band);

  if (blueBands.length === 0) {
    return {
      mode: "blue",
      currentInBlue: false,
      slots: Array.from({ length: 5 }, (_, i) => ({
        role: `slot${i}`,
        kind: "gray",
        band: null,
        current: i === 2,
        subtleDividerRight: false,
        showText: false,
      })),
      boundaryValues: [],
    };
  }

  const gaps = [];
  for (let i = 0; i < blueBands.length - 1; i++) {
    gaps.push({
      leftIndex: i,
      rightIndex: i + 1,
      band: makeGapBand(blueBands[i].band, blueBands[i + 1].band),
    });
  }

  const currentBlueIndex = blueBands.findIndex((x) =>
    isSpeedInBand(currentSpeedKmh, x.band),
  );

  if (currentBlueIndex >= 0) {
    const leftBlue = blueBands[currentBlueIndex - 1]?.band ?? null;
    const leftRed = gaps[currentBlueIndex - 1]?.band ?? null;
    const centerBlue = blueBands[currentBlueIndex]?.band ?? null;
    const rightRed = gaps[currentBlueIndex]?.band ?? null;
    const rightBlue = blueBands[currentBlueIndex + 1]?.band ?? null;

    return {
      mode: "blue",
      currentInBlue: true,
      slots: [
        {
          role: "slot0",
          kind: leftBlue ? "blue" : "gray",
          band: leftBlue,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot1",
          kind: leftRed ? "red" : "gray",
          band: leftRed,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot2",
          kind: centerBlue ? "blue" : "gray",
          band: centerBlue,
          current: true,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot3",
          kind: rightRed ? "red" : "gray",
          band: rightRed,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot4",
          kind: rightBlue ? "blue" : "gray",
          band: rightBlue,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
      ],
      boundaryValues: [
        leftBlue ? bandMin(leftBlue) : null,
        leftBlue ? bandMax(leftBlue) : null,
        leftRed ? bandMax(leftRed) : null,
        centerBlue ? bandMax(centerBlue) : null,
        rightRed ? bandMax(rightRed) : null,
        rightBlue ? bandMax(rightBlue) : null,
      ],
    };
  }

  const currentGapIndex = gaps.findIndex((g) =>
    isSpeedInBand(currentSpeedKmh, g.band),
  );

  if (currentGapIndex >= 0) {
    const leftBlue = blueBands[currentGapIndex]?.band ?? null;
    const centerRed = gaps[currentGapIndex]?.band ?? null;
    const rightBlue = blueBands[currentGapIndex + 1]?.band ?? null;

    return {
      mode: "red",
      currentInBlue: false,
      slots: [
        {
          role: "slot0",
          kind: leftBlue ? "blue" : "gray",
          band: leftBlue,
          current: false,
          subtleDividerRight: true,
          showText: false,
        },
        {
          role: "slot1",
          kind: leftBlue ? "blue" : "gray",
          band: leftBlue,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot2",
          kind: centerRed ? "red" : "gray",
          band: centerRed,
          current: true,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot3",
          kind: rightBlue ? "blue" : "gray",
          band: rightBlue,
          current: false,
          subtleDividerRight: true,
          showText: false,
        },
        {
          role: "slot4",
          kind: rightBlue ? "blue" : "gray",
          band: rightBlue,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
      ],
      leftBlueLabel: leftBlue
        ? `${fmt1(bandMin(leftBlue))} 〜 ${fmt1(bandMax(leftBlue))}`
        : "",
      rightBlueLabel: rightBlue
        ? `${fmt1(bandMin(rightBlue))} 〜 ${fmt1(bandMax(rightBlue))}`
        : "",
      boundaryValues: [
        leftBlue ? bandMin(leftBlue) : null,
        leftBlue ? bandMax(leftBlue) : null,
        centerRed ? bandMax(centerRed) : null,
        rightBlue ? bandMax(rightBlue) : null,
      ],
    };
  }

  const slowest = blueBands[0]?.band ?? null;
  const fastest = blueBands[blueBands.length - 1]?.band ?? null;
  const v = Number(currentSpeedKmh);

  if (slowest && Number.isFinite(v) && v < bandMin(slowest)) {
    return {
      mode: "red",
      currentInBlue: false,
      slots: [
        {
          role: "slot0",
          kind: "gray",
          band: null,
          current: false,
          subtleDividerRight: true,
          showText: false,
        },
        {
          role: "slot1",
          kind: "gray",
          band: null,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot2",
          kind: "red",
          band: { low: 0, high: bandMin(slowest) },
          current: true,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot3",
          kind: "blue",
          band: slowest,
          current: false,
          subtleDividerRight: true,
          showText: false,
        },
        {
          role: "slot4",
          kind: "blue",
          band: slowest,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
      ],
      leftBlueLabel: "",
      rightBlueLabel: slowest
        ? `${fmt1(bandMin(slowest))} 〜 ${fmt1(bandMax(slowest))}`
        : "",
      boundaryValues: [
        null,
        null,
        slowest ? bandMin(slowest) : null,
        slowest ? bandMax(slowest) : null,
      ],
    };
  }

  if (fastest && Number.isFinite(v) && v > bandMax(fastest)) {
    return {
      mode: "red",
      currentInBlue: false,
      slots: [
        {
          role: "slot0",
          kind: "blue",
          band: fastest,
          current: false,
          subtleDividerRight: true,
          showText: false,
        },
        {
          role: "slot1",
          kind: "blue",
          band: fastest,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot2",
          kind: "red",
          band: { low: bandMax(fastest), high: bandMax(fastest) + 1 },
          current: true,
          subtleDividerRight: false,
          showText: false,
        },
        {
          role: "slot3",
          kind: "gray",
          band: null,
          current: false,
          subtleDividerRight: true,
          showText: false,
        },
        {
          role: "slot4",
          kind: "gray",
          band: null,
          current: false,
          subtleDividerRight: false,
          showText: false,
        },
      ],
      leftBlueLabel: fastest
        ? `${fmt1(bandMin(fastest))} 〜 ${fmt1(bandMax(fastest))}`
        : "",
      rightBlueLabel: "",
      boundaryValues: [
        fastest ? bandMin(fastest) : null,
        fastest ? bandMax(fastest) : null,
        null,
        null,
      ],
    };
  }

  return {
    mode: "blue",
    currentInBlue: false,
    slots: Array.from({ length: 5 }, (_, i) => ({
      role: `slot${i}`,
      kind: "gray",
      band: null,
      current: i === 2,
      subtleDividerRight: false,
      showText: false,
    })),
    boundaryValues: [],
  };
}

function uniqueFinite(values) {
  const out = [];
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const n = Number(v.toFixed(6));
    if (!out.some((x) => Math.abs(x - n) < 1e-6)) out.push(n);
  }
  return out;
}

function segmentFill(kind) {
  if (kind === "blue") return "url(#meterBlue)";
  if (kind === "red") return "url(#meterRed)";
  return "rgba(65,65,65,0.42)";
}

function SegmentText({
  cx,
  cy,
  outerRx,
  outerRy,
  innerRx,
  innerRy,
  frac,
  slot,
  speed,
  fontScale = 1,
}) {
  const p = pointOnEllipse(
    cx,
    cy,
    (outerRx + innerRx) / 2,
    (outerRy + innerRy) / 2,
    (frac.start + frac.end) / 2,
  );

  if (slot.current) {
    return (
      <>
        <text
          x={p.x}
          y={p.y + 14}
          textAnchor="middle"
          fill="white"
          style={{ fontSize: 50 * fontScale, fontWeight: 900 }}
        >
          {fmt1(speed)}
        </text>
        <text
          x={p.x}
          y={p.y + 34}
          textAnchor="middle"
          fill="white"
          style={{ fontSize: 15 * fontScale, fontWeight: 700 }}
        >
          km/h
        </text>
      </>
    );
  }

  if (slot.kind === "gray" || !slot.band || !slot.showText) return null;

  const leftValue = bandMin(slot.band);
  const rightValue = bandMax(slot.band);

  return (
    <text
      x={p.x}
      y={p.y + 6}
      textAnchor="middle"
      fill="white"
      style={{ fontSize: 17 * fontScale, fontWeight: 800 }}
    >
      {fmt1(leftValue)} 〜 {fmt1(rightValue)}
    </text>
  );
}

function BoundaryLabel({ value, left, top, scale = 1 }) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        transform: "translate(-50%, -50%)",
        minWidth: 54 * scale,
        padding: `${4 * scale}px ${8 * scale}px`,
        borderRadius: 12 * scale,
        background: "white",
        border: "2px solid rgba(0,0,0,0.25)",
        fontSize: 14 * scale,
        fontWeight: 800,
        textAlign: "center",
        boxShadow: "0 3px 8px rgba(0,0,0,0.08)",
        zIndex: 6,
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {fmt1(value)}
    </div>
  );
}

export default function AssistSpeedSlot({
  ranges = [],
  currentSpeedKmh,
  redCount = 0,
  nextTargetInfo = null,
  onSkipSignal,
  observationCount,
}) {
  const safeSpeed = Number(currentSpeedKmh);
  const hasEnoughData = Number(redCount) > 2;

  const obsCount = Number.isFinite(Number(observationCount))
    ? Number(observationCount)
    : Number(redCount);

  const targetLabel = getTargetLabel(nextTargetInfo);
  const targetDistLabel = getTargetDistanceLabel(nextTargetInfo);
  const showSkip =
    !!nextTargetInfo?.isSignal && typeof onSkipSignal === "function";
  const isGoalTarget = nextTargetInfo?.kind === "goal";

  const meter = useMemo(
    () => buildMeterModel(ranges, safeSpeed),
    [ranges, safeSpeed],
  );

  const stripRef = useRef(null);
  const prevSpeedRef = useRef(Number.isFinite(safeSpeed) ? safeSpeed : 0);

  useEffect(() => {
    if (!Number.isFinite(safeSpeed)) {
      prevSpeedRef.current = 0;
      return;
    }

    const prevSpeed = prevSpeedRef.current;
    if (!Number.isFinite(prevSpeed)) {
      prevSpeedRef.current = safeSpeed;
      return;
    }

    if (!stripRef.current) {
      prevSpeedRef.current = safeSpeed;
      return;
    }

    const diff = safeSpeed - prevSpeed;
    if (Math.abs(diff) < 0.05) return;

    stripRef.current.animate(
      [
        { transform: "translateX(-50%)" },
        {
          transform: `translateX(calc(-50% - ${Math.max(
            -4,
            Math.min(4, diff * 0.2),
          )}px))`,
        },
        { transform: "translateX(-50%)" },
      ],
      {
        duration: 140,
        easing: "ease-out",
      },
    );

    prevSpeedRef.current = safeSpeed;
  }, [safeSpeed]);

  if (isGoalTarget) {
    return (
      <div
        style={{
          width: "100%",
          padding: "10px 12px 6px 12px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            border: "none",
            borderRadius: 0,
            background: "transparent",
            boxShadow: "none",
            padding: "20px 24px 22px 24px",
            display: "grid",
            justifyItems: "center",
            alignItems: "center",
            gap: 8,
            minHeight: 150,
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#666",
              letterSpacing: "0.04em",
            }}
          >
            目的地
          </div>

          <div
            style={{
              fontSize: 40,
              fontWeight: 900,
              color: "#222",
              lineHeight: 1.05,
            }}
          >
            {targetDistLabel}
          </div>

          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#777",
              marginTop: 2,
            }}
          >
            現在速度
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              lineHeight: 1,
            }}
          >
            <span
              style={{
                fontSize: 48,
                fontWeight: 900,
                color: "#333",
              }}
            >
              {fmt1(safeSpeed)}
            </span>
            <span
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: "#555",
              }}
            >
              km/h
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!hasEnoughData) {
    return (
      <div
        style={{
          width: "100%",
          padding: "8px 6px 0 6px",
          display: "grid",
          gap: 10,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 12, color: "#666" }}>
              観測数: {obsCount}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{targetLabel}</div>
            <div style={{ fontSize: 15, color: "#555" }}>
              距離: {targetDistLabel}
            </div>
          </div>

          {showSkip && (
            <button
              onClick={onSkipSignal}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #cfcfcf",
                background: "white",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              この信号をスキップ
            </button>
          )}
        </div>

        <div
          style={{
            borderRadius: 14,
            border: "2px dashed #d4d4d8",
            background: "#f8f8f8",
            padding: "18px 14px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900, color: "#555" }}>
            データ不足
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#777" }}>
            赤観測が少ないため、速度帯をまだ表示できません
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: "#999" }}>
            赤観測数: {obsCount}
          </div>
        </div>
      </div>
    );
  }

  const scale = 1.12;

  const W = 1020;
  const H = 172;
  const cx = W / 2;
  const cy = 162;
  const outerRx = 420;
  const outerRy = 150;
  const innerRx = 255;
  const innerRy = 68;

  const slotFracs = buildSlotGeometry(meter.mode);
  const boundaryValues = uniqueFinite(meter.boundaryValues);

  const boundaryFracs =
    meter.mode === "blue"
      ? [0.04, 0.2, 0.36, 0.64, 0.8, 0.96]
      : [0.04, 0.4, 0.6, 0.96];

  const leftBluePairFrac = { start: slotFracs[0].start, end: slotFracs[1].end };
  const rightBluePairFrac = {
    start: slotFracs[3].start,
    end: slotFracs[4].end,
  };

  return (
    <div
      style={{
        width: "100%",
        padding: 0,
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {showSkip && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 8,
            pointerEvents: "none",
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              width: W,
              height: H,
              transform: "translateX(-50%)",
              overflow: "visible",
              pointerEvents: "none",
            }}
          >
            {(() => {
              const skipPath = buildSkipWedgePath({
                cx,
                cy,
                outerRx,
                outerRy,
                padRx: 22,
                padRy: 14,
                startFrac: 0.62,
                endFrac: 0.9,
                topY: 8,
              });

              return (
                <>
                  <path
                    d={skipPath}
                    fill="#FFD54F"
                    stroke="rgba(0,0,0,0.18)"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{
                      filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.08))",
                      cursor: "pointer",
                      pointerEvents: "auto",
                    }}
                    onClick={onSkipSignal}
                  />
                  <text
                    x={870}
                    y={35}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#111"
                    style={{
                      fontSize: 24,
                      fontWeight: 800,
                      cursor: "pointer",
                      pointerEvents: "auto",
                      userSelect: "none",
                    }}
                    onClick={onSkipSignal}
                  >
                    スキップ
                  </text>
                </>
              );
            })()}
          </svg>
        </div>
      )}

      {!isGoalTarget && (
        <div
          style={{
            position: "absolute",
            left: 10,
            top: 0,
            zIndex: 8,
            fontSize: 16,
            color: "#666",
          }}
        >
          観測数: <b>{obsCount}</b>
        </div>
      )}

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 1080,
          height: 168,
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <div
          ref={stripRef}
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: W,
            height: H,
            transform: "translateX(-50%)",
            zIndex: 1,
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="meterBlue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" />
                <stop offset="100%" stopColor="#2563eb" />
              </linearGradient>
              <linearGradient id="meterRed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff8a8a" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
              <pattern
                id="meterStripe"
                width="18"
                height="18"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="18" height="18" fill="rgba(255,255,255,0)" />
                <rect width="8" height="18" fill="rgba(255,255,255,0.14)" />
              </pattern>
            </defs>

            {meter.slots.map((slot, idx) => {
              const frac = slotFracs[idx];
              const path = arcSegmentPath(
                cx,
                cy,
                outerRx,
                outerRy,
                innerRx,
                innerRy,
                frac.start,
                frac.end,
              );

              const dividerStroke = slot.subtleDividerRight
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.16)";
              const dividerWidth = slot.subtleDividerRight ? 0.4 : 1.2;

              return (
                <g key={`${slot.role}-${idx}`}>
                  <path
                    d={path}
                    fill={segmentFill(slot.kind)}
                    stroke={dividerStroke}
                    strokeWidth={dividerWidth}
                  />
                  {slot.kind !== "gray" && (
                    <path d={path} fill="url(#meterStripe)" opacity="0.9" />
                  )}
                  {meter.mode === "blue" && (
                    <SegmentText
                      cx={cx}
                      cy={cy}
                      outerRx={outerRx}
                      outerRy={outerRy}
                      innerRx={innerRx}
                      innerRy={innerRy}
                      frac={frac}
                      slot={slot}
                      speed={safeSpeed}
                      fontScale={scale}
                    />
                  )}
                </g>
              );
            })}

            {meter.mode === "red" && (
              <>
                <SegmentText
                  cx={cx}
                  cy={cy}
                  outerRx={outerRx}
                  outerRy={outerRy}
                  innerRx={innerRx}
                  innerRy={innerRy}
                  frac={leftBluePairFrac}
                  slot={{
                    kind: meter.slots[0].kind,
                    band: meter.slots[0].band,
                    current: false,
                    showText: meter.slots[0].kind !== "gray",
                  }}
                  speed={safeSpeed}
                  fontScale={scale}
                />
                <SegmentText
                  cx={cx}
                  cy={cy}
                  outerRx={outerRx}
                  outerRy={outerRy}
                  innerRx={innerRx}
                  innerRy={innerRy}
                  frac={slotFracs[2]}
                  slot={{
                    kind: meter.slots[2].kind,
                    band: meter.slots[2].band,
                    current: true,
                    showText: false,
                  }}
                  speed={safeSpeed}
                  fontScale={scale}
                />
                <SegmentText
                  cx={cx}
                  cy={cy}
                  outerRx={outerRx}
                  outerRy={outerRy}
                  innerRx={innerRx}
                  innerRy={innerRy}
                  frac={rightBluePairFrac}
                  slot={{
                    kind: meter.slots[4].kind,
                    band: meter.slots[4].band,
                    current: false,
                    showText: meter.slots[4].kind !== "gray",
                  }}
                  speed={safeSpeed}
                  fontScale={scale}
                />
              </>
            )}
          </svg>
        </div>

        {boundaryValues.map((value, i) => {
          if (i >= boundaryFracs.length) return null;
          const labelRx = (outerRx + innerRx) / 2;
          const labelRy = (outerRy + innerRy) / 2;

          const p = pointOnEllipse(cx, cy, labelRx, labelRy, boundaryFracs[i]);
          return (
            <BoundaryLabel
              key={`${value}-${i}`}
              value={value}
              left={`calc(50% + ${p.x - W / 2}px)`}
              top={`${p.y}px`}
              scale={scale}
            />
          );
        })}

        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 105,
            transform: "translateX(-50%)",
            zIndex: 7,
            textAlign: "center",
            minWidth: 260,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 25,
              fontWeight: 900,
              color: "#222",
              lineHeight: 1.05,
            }}
          >
            {targetLabel}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 24,
              fontWeight: 700,
              color: "#555",
            }}
          >
            距離: {targetDistLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
