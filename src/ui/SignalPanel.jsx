import { useEffect, useState } from "react";

function appearanceToLampStyle(kind, color) {
  const isRed = color === "red";

  if (kind === "lit") {
    return {
      background: isRed ? "#140909" : "#07141b",
      borderColor: isRed ? "#5a2a2a" : "#23465a",
      color: isRed ? "#ff5a5a" : "#46f0c8",
      boxShadow: isRed
        ? "inset 0 0 16px rgba(255, 80, 80, 0.10)"
        : "inset 0 0 16px rgba(70, 240, 200, 0.10)",
      opacity: 1,
    };
  }

  if (kind === "dim") {
    return {
      background: isRed ? "#100808" : "#07131a",
      borderColor: isRed ? "#342020" : "#1c3342",
      color: isRed ? "rgba(255, 90, 90, 0.38)" : "rgba(70, 240, 200, 0.42)",
      boxShadow: "inset 0 0 12px rgba(0,0,0,0.45)",
      opacity: 1,
    };
  }

  return {
    background: isRed ? "#090505" : "#040d12",
    borderColor: isRed ? "#1e1111" : "#11232e",
    color: isRed ? "rgba(255, 90, 90, 0.10)" : "rgba(70, 240, 200, 0.12)",
    boxShadow: "inset 0 0 16px rgba(0,0,0,0.72)",
    opacity: 1,
  };
}

function lampButtonStyle({ appearance, color, enabled }) {
  const base = appearanceToLampStyle(appearance, color);

  return {
    width: "100%",
    height: "100%",
    borderRadius: 22,
    border: `3px solid ${base.borderColor}`,
    background: base.background,
    color: base.color,
    boxShadow: base.boxShadow,
    opacity: base.opacity,
    cursor: enabled ? "pointer" : "default",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    WebkitTapHighlightColor: "transparent",
    transition:
      "background 120ms ease, box-shadow 120ms ease, opacity 120ms ease, border-color 120ms ease, color 120ms ease",
  };
}

/* =========================
   Dot people
========================= */
function buildStandingPoints() {
  return [
    [-4, -45],
    [4, -45],
    [-8, -40],
    [-2.5, -39],
    [2.5, -39],
    [8, -40],
    [-4, -33],
    [4, -33],

    [-13, -24],
    [-7, -25],
    [0, -26],
    [7, -25],
    [13, -24],

    [-10, -18],
    [-3, -19],
    [3, -19],
    [10, -18],

    [-11, -10],
    [-4, -11],
    [4, -11],
    [11, -10],

    [-15, -4],
    [-7, -4],
    [0, -2],
    [7, -4],
    [15, -4],

    [-15, 4],
    [-9, 1],
    [-3, 6],
    [3, 6],
    [9, 1],
    [15, 4],

    [-16, 14],
    [-9, 10],
    [0, 14],
    [9, 10],
    [16, 14],

    [-13, 21],
    [-7, 17],
    [0, 21],
    [7, 17],
    [13, 21],

    [-20, -22],
    [-24, -15],
    [-17, -16],
    [-26, -8],
    [-18, -9],
    [-28, 1],
    [-22, -1],
    [-30, 9],
    [-23, 7],
    [-31, 17],
    [-25, 16],
    [-28, 21],

    [20, -22],
    [24, -15],
    [17, -16],
    [26, -8],
    [18, -9],
    [28, 1],
    [22, -1],
    [30, 9],
    [23, 7],
    [31, 17],
    [25, 16],
    [28, 21],

    [-14, 29],
    [-8, 25],
    [-4, 29],

    [-14, 40],
    [-9, 35],
    [-5, 40],

    [-14, 50],
    [-10, 45],
    [-6, 50],

    [-14, 60],
    [-10, 55],
    [-7, 60],

    [-18, 66],
    [-12, 66],
    [-7, 66],

    [14, 29],
    [8, 25],
    [4, 29],

    [14, 40],
    [9, 35],
    [5, 40],

    [14, 50],
    [10, 45],
    [6, 50],

    [14, 60],
    [10, 55],
    [7, 60],

    [18, 66],
    [12, 66],
    [7, 66],
  ];
}

function buildWalkingPoints() {
  return [
    [-10, -45.5],
    [-4, -44],
    [0.5, -39.5],
    [-5, -37.5],
    [-10, -39.5],
    [-15, -41],
    [-15, -35],
    [-10, -32.5],
    [-2, -32.5],

    [-11, -24],
    [-4, -25],
    [1, -26],
    [8, -23],
    [14, -20],

    [-14, -16],
    [-7, -17],
    [1, -19],
    [8, -16],
    [14, -13],

    [-11, -10],
    [-1, -12],
    [5, -8],
    [11, -5],

    [-8, -5],
    [0, -2],
    [7, 0],
    [14, 2],

    [-10, 1],
    [-5, 3],
    [3, 6],
    [7, 9],
    [15, 10],

    [-9, 9],
    [-4, 12],
    [3, 14],

    [-20, -10],
    [-17, -2],
    [-26, -2],
    [-35, 3],
    [-26, 3],
    [-20, 4],
    [-43, 9],
    [-36, 10],
    [-28, 7],

    [22, -17],
    [19, -10],
    [27, -13],
    [23, -4],
    [29, -4],
    [25, 3],
    [30, 2],
    [27, 10],
    [32, 10],
    [29, 15],

    [-12, 16],
    [-7, 20],
    [-1, 19],

    [-15, 24],
    [-11, 28],
    [-6, 28],

    [-19, 32],
    [-15, 36],
    [-10, 38],

    [-22, 41],
    [-18, 45],
    [-13, 46],

    [-24, 48],
    [-20, 53],
    [-15, 55],

    [-27, 57],
    [-23, 61],
    [-17, 63],

    [-28, 66],
    [-23, 68],
    [-19, 70],

    [4, 25],
    [8, 19],
    [13, 17],

    [7, 33],
    [10, 29],
    [15, 26],

    [10, 42],
    [14, 37],
    [17, 34],

    [13, 51],
    [17, 46],
    [21, 42],

    [16, 58],
    [20, 54],
    [25, 49],

    [22, 62],
    [27, 58],

    [21, 67],
    [26, 66],
    [31, 63],
  ];
}

function DotPersonIcon({
  walking = false,
  lampColor = "#46f0c8",
  dim = false,
}) {
  const points = walking ? buildWalkingPoints() : buildStandingPoints();

  const dotFill = lampColor;
  const dotOpacity = dim ? 0.42 : 0.96;
  const glowOpacity = dim ? 0.1 : 0.3;

  return (
    <svg
      viewBox="-40 -44 80 112"
      width="85%"
      height="85%"
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <filter
          id={`glow-${walking ? "walk" : "stand"}-${lampColor.replace(/[^a-zA-Z0-9]/g, "")}`}
        >
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {points.map(([x, y], i) => (
        <g
          key={i}
          filter={`url(#glow-${walking ? "walk" : "stand"}-${lampColor.replace(/[^a-zA-Z0-9]/g, "")})`}
        >
          <circle cx={x} cy={y} r="2.5" fill={dotFill} opacity={glowOpacity} />
          <circle cx={x} cy={y} r="1.7" fill={dotFill} opacity={dotOpacity} />
        </g>
      ))}
    </svg>
  );
}

export default function SignalPanel({
  speedKmh,
  trafficMode = false,
  onToggleTrafficMode,

  redAppearance = "off",
  blueAppearance = "off",
  blueBlink = false,

  redEnabled = false,
  blueEnabled = false,

  onRed,
  onBlue,
  onCancel,

  disabledReason = "",
}) {
  const [blinkTick, setBlinkTick] = useState(true);
  const [pulseTick, setPulseTick] = useState(true);

  useEffect(() => {
    if (!blueBlink) return;

    const id = setInterval(() => {
      setBlinkTick((v) => !v);
    }, 500);

    return () => clearInterval(id);
  }, [blueBlink]);

  useEffect(() => {
    if (!trafficMode) return;

    const id = setInterval(() => {
      setPulseTick((v) => !v);
    }, 1400);

    return () => clearInterval(id);
  }, [trafficMode]);

  const speedText = Number.isFinite(Number(speedKmh))
    ? Number(speedKmh).toFixed(1)
    : "—";

  const blinkOn = !blueBlink || blinkTick;
  const pulseOn = !trafficMode || pulseTick;
  const effectiveBlueAppearance = blueBlink && !blinkOn ? "dim" : blueAppearance;

  const redDim = redAppearance !== "lit";
  const blueDim = effectiveBlueAppearance !== "lit";

  const redLamp = appearanceToLampStyle(redAppearance, "red");
  const blueLamp = appearanceToLampStyle(effectiveBlueAppearance, "blue");

  const panelOuterStyle = trafficMode
    ? {
        width: "100%",
        maxWidth: 360,
        background:
          "linear-gradient(155deg, rgba(253, 224, 71, 0.94), rgba(245, 158, 11, 0.88))",
        border: "1px solid rgba(146, 83, 18, 0.18)",
        borderRadius: 34,
        padding: 20,
        boxShadow: pulseOn
          ? "0 0 0 6px rgba(245, 158, 11, 0.16), 0 26px 60px rgba(64, 32, 2, 0.22)"
          : "0 0 0 1px rgba(245, 158, 11, 0.12), 0 26px 60px rgba(64, 32, 2, 0.22)",
        transition: "box-shadow 0.6s ease",
        display: "grid",
        gridTemplateRows: "auto auto",
        gap: 14,
        justifyItems: "center",
      }
    : {
        width: "100%",
        maxWidth: 360,
        background:
          "linear-gradient(180deg, rgba(248, 252, 252, 0.98), rgba(223, 237, 235, 0.95))",
        border: "1px solid rgba(87, 121, 132, 0.16)",
        borderRadius: 34,
        padding: 20,
        boxShadow: "0 26px 60px rgba(10, 40, 50, 0.18)",
        display: "grid",
        gridTemplateRows: "auto auto",
        gap: 14,
        justifyItems: "center",
      };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 16,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.78), rgba(231, 242, 240, 0.82))",
        borderRadius: 28,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.62)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2.8fr 3.6fr 2.8fr",
          alignItems: "center",
          gap: 14,
        }}
      >
        {/* 左：渋滞モード切替 */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            onClick={onToggleTrafficMode}
            style={{
              minWidth: 74,
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid rgba(93, 124, 128, 0.18)",
              background: trafficMode
                ? "linear-gradient(180deg, #edf7ff, #d8efff)"
                : "linear-gradient(180deg, #fff7dc, #ffe8a3)",
              cursor: "pointer",
              fontWeight: 700,
              whiteSpace: "nowrap",
              boxShadow: "0 18px 34px rgba(13, 40, 50, 0.08)",
              backdropFilter: "blur(12px)",
            }}
          >
            {trafficMode ? "渋滞" : "通常"}
          </button>
        </div>

        {/* 中央：信号情報 */}
        <div
          style={{
            display: "grid",
            justifyItems: "center",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: 52,
              fontWeight: 900,
              lineHeight: 1,
              color: "#10232d",
              letterSpacing: "-0.05em",
              textAlign: "center",
            }}
          >
            {speedText}
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginLeft: 6,
                color: "#47626d",
              }}
            >
              km/h
            </span>
          </div>
        </div>

        {/* 右：キャンセル */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "10px 14px",
              borderRadius: 16,
              border: "1px solid rgba(104, 132, 144, 0.18)",
              background: "rgba(255,255,255,0.78)",
              color: "#24404c",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: "nowrap",
              boxShadow: "0 18px 34px rgba(13, 40, 50, 0.08)",
              backdropFilter: "blur(12px)",
              minWidth: 88,
            }}
          >
            キャンセル
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 420,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "center",
        }}
      >
        <div style={panelOuterStyle}>
          <div
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
            }}
          >
            <button
              onClick={redEnabled ? onRed : undefined}
              style={lampButtonStyle({
                appearance: redAppearance,
                color: "red",
                enabled: redEnabled,
              })}
              aria-label="赤"
            >
              <DotPersonIcon
                walking={false}
                dim={redDim}
                lampColor={redLamp.color}
              />
            </button>
          </div>

          <div
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
            }}
          >
            <button
              onClick={blueEnabled ? onBlue : undefined}
              style={lampButtonStyle({
                appearance: effectiveBlueAppearance,
                color: "blue",
                enabled: blueEnabled,
              })}
              aria-label="青"
            >
              <DotPersonIcon
                walking={true}
                dim={blueDim}
                lampColor={blueLamp.color}
              />
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          minHeight: 22,
          textAlign: "center",
          fontSize: 13,
          color: disabledReason ? "#5b7280" : "transparent",
          letterSpacing: "0.04em",
        }}
      >
        {disabledReason || "　"}
      </div>
    </div>
  );
}
