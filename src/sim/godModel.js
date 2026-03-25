// src/sim/godModel.js
import { wrap } from "../core/math";

// beta0: day=0 の緑開始基準時刻（sec）
// beta1: 1日あたりの位相ドリフト（sec/day）
export function godAtTime({ T, G, beta0, beta1 }, tSec, day) {
  const beta0Day = Number(beta0) + Number(beta1) * Number(day);

  const phi = wrap(tSec - beta0Day, T); // 0..T
  const isBlue = phi < G;

  if (isBlue) {
    return {
      tTrue: tSec,
      day,
      colorTrue: "blue",
      waitTrue: null,
      nextGreenTrue: null,
      phi,
      beta0Day,
    };
  }

  const wait = T - phi; // 次の青開始まで
  return {
    tTrue: tSec,
    day,
    colorTrue: "red",
    waitTrue: wait,
    nextGreenTrue: tSec + wait,
    phi,
    beta0Day,
  };
}
