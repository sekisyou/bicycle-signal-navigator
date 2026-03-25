import L from "leaflet";

// Leafletデフォルトアイコン画像（Viteでも読めるようにimport）
import marker2x from "leaflet/dist/images/marker-icon-2x.png";
import marker from "leaflet/dist/images/marker-icon.png";
import shadow from "leaflet/dist/images/marker-shadow.png";

// ===== helper: SVGをdivIconにする =====
function svgDivIcon(svg, { w = 30, h = 30, anchorX = 15, anchorY = 30 } = {}) {
  return L.divIcon({
    className: "",
    html: svg,
    iconSize: [w, h],
    iconAnchor: [anchorX, anchorY],
    popupAnchor: [0, -anchorY],
  });
}

// ===== 共通: 少し縦を縮めた涙型ピン =====
function makePinSvg({
  fill = "#2e7d32",
  text = "",
  textSize = 11,
  textWeight = 700,
  width = 30,
  height = 36,
}) {
  return `
  <svg width="${width}" height="${height}" viewBox="0 0 30 36" xmlns="http://www.w3.org/2000/svg">
    <path
      d="
        M 15 34
        C 15 34, 6.5 25.5, 6.5 18
        C 6.5 10, 10.5 6, 15 6
        C 19.5 6, 23.5 10, 23.5 18
        C 23.5 25.5, 15 34, 15 34
        Z
      "
      fill="${fill}"
      stroke="white"
      stroke-width="3"
      stroke-linejoin="round"
    />
    <text
      x="15"
      y="19"
      text-anchor="middle"
      dominant-baseline="middle"
      font-size="${textSize}"
      font-weight="${textWeight}"
      fill="white"
      font-family="sans-serif"
    >${text}</text>
  </svg>
  `;
}

// ===== Leaflet標準アイコン（fallbackにも使える） =====
export const iconDefault = new L.Icon({
  iconRetinaUrl: marker2x,
  iconUrl: marker,
  shadowUrl: shadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// ===== origin / dest / via / signal / gps =====

// 出発
export const iconOrigin = svgDivIcon(
  makePinSvg({
    fill: "#1976d2",
    text: "出",
    textSize: 12,
    textWeight: 700,
    width: 30,
    height: 36,
  }),
  { w: 30, h: 36, anchorX: 15, anchorY: 36 },
);

// 到着
export const iconDest = svgDivIcon(
  makePinSvg({
    fill: "#d32f2f",
    text: "着",
    textSize: 12,
    textWeight: 700,
    width: 30,
    height: 36,
  }),
  { w: 30, h: 36, anchorX: 15, anchorY: 36 },
);

// 通過地点
export const iconVia = svgDivIcon(
  makePinSvg({
    fill: "#455a64",
    text: "通",
    textSize: 11,
    textWeight: 700,
    width: 28,
    height: 36,
  }),
  { w: 28, h: 36, anchorX: 14, anchorY: 36 },
);

// 信号（通常）
export const iconSignal = svgDivIcon(
  makePinSvg({
    fill: "#2e7d32",
    text: "信",
    textSize: 11,
    textWeight: 700,
    width: 28,
    height: 36,
  }),
  { w: 28, h: 36, anchorX: 14, anchorY: 36 },
);

// 信号（要修正）
export const iconSignalFix = svgDivIcon(
  makePinSvg({
    fill: "#ff8f00",
    text: "!",
    textSize: 12,
    textWeight: 900,
    width: 28,
    height: 36,
  }),
  { w: 28, h: 36, anchorX: 14, anchorY: 36 },
);

// GPS（これは丸のままでOK）
export const iconGPS = svgDivIcon(
  `
  <svg width="24" height="24" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" fill="#111827" stroke="white" stroke-width="3"/>
    <circle cx="12" cy="12" r="3" fill="white"/>
  </svg>
  `,
  { w: 24, h: 24, anchorX: 12, anchorY: 12 },
);
