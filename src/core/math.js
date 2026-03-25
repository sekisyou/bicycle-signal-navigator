// src/core/math.js
export function wrap(x, T) {
  x %= T;
  if (x < 0) x += T;
  return x;
}

export function wrapDiff(x, T) {
  x = wrap(x, T);
  if (x > T / 2) x -= T;
  return x;
}
