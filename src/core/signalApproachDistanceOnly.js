// src/core/signalApproachDistanceOnly.js
// UI非依存：距離の時系列だけで「通過」を判定する。
// - enterDistM 以内に入ったら "tracking開始"
// - その後 dist が増加に転じ、minDist < passDistM を満たしたら「通過」とみなして autoBlue を返す
// - red観測開始(obsPhase !== 'idle') や dragging 中は抑制する

export function createSignalApproachDistanceOnly({
  enterDistM = 40,
  exitDistM = 70,
  passDistM = 10,
} = {}) {
  const state = {
    tracking: false,
    signalId: null,
    minD: Infinity,
    minT: null,
    prevD: null,
    prevT: null,
  };

  function reset() {
    state.tracking = false;
    state.signalId = null;
    state.minD = Infinity;
    state.minT = null;
    state.prevD = null;
    state.prevT = null;
  }

  /**
   * @param {Object} p
   * @param {string|number} p.signalId
   * @param {number} p.distM
   * @param {number} p.nowMs
   * @param {boolean} p.dragging
   * @param {"idle"|"redArmed"} p.obsPhase
   * @param {number} p.cooldownMsRemain
   */
  function update({
    signalId,
    distM,
    nowMs,
    dragging,
    obsPhase,
    cooldownMsRemain = 0,
  }) {
    if (!Number.isFinite(distM) || !Number.isFinite(nowMs)) return null;

    // 条件で全抑制
    if (dragging) {
      // ドラッグ中は判定が壊れるので完全停止（minD更新もしない）
      return null;
    }
    if (obsPhase !== "idle") return null;
    if (cooldownMsRemain > 0) return null;

    const sid = String(signalId);

    // signalが変わったらリセット
    if (state.signalId !== sid) {
      reset();
      state.signalId = sid;
    }

    // ENTER
    if (!state.tracking) {
      if (distM <= enterDistM) {
        state.tracking = true;
        state.minD = distM;
        state.minT = nowMs;
        state.prevD = distM;
        state.prevT = nowMs;
      }
      return null;
    }

    // TRACKING
    if (distM < state.minD) {
      state.minD = distM;
      state.minT = nowMs;
    }

    // EXIT（離れすぎたら追跡終了）
    if (distM >= exitDistM) {
      // 「minD が十分小さかった」なら最後に通過判定を返す
      if (state.minD <= passDistM) {
        const out = {
          autoBlue: { signalId: sid, minT: state.minT, minD: state.minD },
        };
        reset();
        return out;
      }
      reset();
      return null;
    }

    // 「近づいた後に遠ざかり始めた」を通過の合図として使う
    // prevD -> distM が増加に転じた & minDが十分小さい
    const prevD = state.prevD;
    state.prevD = distM;
    state.prevT = nowMs;

    if (prevD != null && distM > prevD + 0.3) {
      if (state.minD <= passDistM) {
        const out = {
          autoBlue: { signalId: sid, minT: state.minT, minD: state.minD },
        };
        reset();
        return out;
      }
    }

    return null;
  }

  return { update, reset };
}
