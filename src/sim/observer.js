// src/sim/observer.js
function randn() {
  // Box-Muller
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function makeObservationFromTruth(
  truth,
  { sigmaTime = 0, sigmaWait = 0 },
  { day },
) {
  const tObs = truth.tTrue + randn() * sigmaTime;

  if (truth.colorTrue === "blue") {
    return {
      day,
      t: tObs,
      color: "blue",
      wait: null,
      nextGreen: null,
    };
  }

  // red
  const waitObsRaw = (truth.waitTrue ?? 0) + randn() * sigmaWait;
  const waitObs = Math.max(0, waitObsRaw);
  const nextGreenObs = tObs + waitObs;

  return {
    day,
    t: tObs,
    color: "red",
    wait: waitObs,
    nextGreen: nextGreenObs,
  };
}
