export function godSignalState({ T, G, beta0, beta1, day, nowSec, anchorDay }) {
  if (
    !Number.isFinite(T) ||
    !Number.isFinite(G) ||
    !Number.isFinite(beta0) ||
    !Number.isFinite(beta1) ||
    !Number.isFinite(day) ||
    !Number.isFinite(nowSec) ||
    !Number.isFinite(anchorDay)
  ) {
    return null;
  }

  const thetaAbs = beta0 + beta1 * (day - anchorDay);

  let phase = (nowSec - thetaAbs) % T;
  if (phase < 0) phase += T;

  const isGreen = phase < G;

  const secToRed = isGreen ? G - phase : 0;
  const secToGreen = isGreen ? 0 : T - phase;

  return {
    phase,
    isGreen,
    secToRed,
    secToGreen,
  };
}
