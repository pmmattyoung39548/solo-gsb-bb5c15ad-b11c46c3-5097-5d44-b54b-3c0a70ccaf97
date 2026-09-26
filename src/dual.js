'use strict';

/**
 * 双档换速选配算法
 *
 * 场景：一台装置需要在两个档位间切换，每个档位均为“恰好两级”传动：
 *   - 第一级为两档共用的同一“有向齿轮对”（固定级，方向一致，换档时不拆装）；
 *   - 第二级为按档换装的“有向齿轮对”（换装级）。
 *
 * 约束：
 *   - 每档内部 4 枚齿轮互不重复（固定级 2 枚 + 换装级 2 枚）；
 *   - 两档互斥运行（不会同时工作），因此两档的换装级允许使用相同实物齿轮；
 *   - 速比与容差判定沿用精确分数（BigInt），与其他页面完全一致。
 *
 * 择优（基于完整候选，不截断）：
 *   1. 换装级主动、从动两个轴位中“需更换”的数量最少（0～2 个）；
 *   2. 两档相对误差之和最小（精确分数相加比较）；
 *   3. 按 (固定主动, 固定从动, 档位一换装主动, 档位一换装从动,
 *      档位二换装主动, 档位二换装从动) 的齿轮编号自然序决胜，保证结果唯一。
 */

const { makeFrac } = require('./search');

/** 双档换速齿轮数量约束（固定级 2 枚 + 换装级 2 枚，至少 4 枚） */
const MIN_GEARS = 4;

/**
 * 完整方案择优比较（<0 表示 x 更优）：
 * 需更换轴位最少 → 两档误差之和最小 → 齿轮编号自然序。
 * gears 已按编号自然序排列，直接比较下标序列即等价于编号自然序。
 */
function planCmp(x, y) {
  if (x.change !== y.change) return x.change - y.change;
  const le = x.errNum * y.errDen;
  const re = y.errNum * x.errDen;
  if (le !== re) return le < re ? -1 : 1;
  const sx = [x.d, x.w, x.s1.a, x.s1.b, x.s2.a, x.s2.b];
  const sy = [y.d, y.w, y.s1.a, y.s1.b, y.s2.a, y.s2.b];
  for (let i = 0; i < sx.length; i++) {
    if (sx[i] !== sy[i]) return sx[i] - sy[i];
  }
  return 0;
}

/**
 * 完整枚举并择优（不截断）。
 *
 * @param {Array<{id:string,teeth:number}>} gears 规范化齿轮（4～12 枚，按编号自然序）
 * @param {Array<{name:string,target:object,tolerance:object}>} speeds 恰好 2 个档位
 * @returns {object} 见 README 与 /api/dual-speed 返回结构
 */
function planDualSpeed(gears, speeds) {
  const n = gears.length;
  const teeth = gears.map((g) => BigInt(g.teeth));

  let best = null; // 当前最优完整方案（轻量：齿轮全部用下标表示）
  let candidateCount = 0; // 达标完整方案总数（固定级 × 两档换装级组合）
  // 诊断：各档位在任意固定第一级下是否存在达标的换装组合
  const hasCandidate = [false, false];

  // 枚举固定第一级（有向对 d→w）
  for (let d = 0; d < n; d++) {
    for (let w = 0; w < n; w++) {
      if (w === d) continue;
      const fn = teeth[d];
      const fd = teeth[w];

      // 该固定级下，两档各自达标的换装级（有向对 a→b，a、b 不占用 d、w）
      const lists = [[], []];
      for (let a = 0; a < n; a++) {
        if (a === d || a === w) continue;
        for (let b = 0; b < n; b++) {
          if (b === d || b === w || b === a) continue;
          // 总速比 = (d/w)·(a/b)，未约分整数累计，达标判定走整数乘法不等式
          const rn = fn * teeth[a];
          const rd = fd * teeth[b];
          for (let s = 0; s < 2; s++) {
            const t = speeds[s].target;
            const tol = speeds[s].tolerance;
            const diff = rn * t.den - t.num * rd;
            const abs = diff < 0n ? -diff : diff;
            if (abs * tol.den > tol.num * t.num * rd) continue;
            // 仅对达标换装级约分误差：相对误差 = |r-t|/t = abs / (rd·tn)
            const error = makeFrac(abs, rd * t.num);
            lists[s].push({ a, b, errNum: error.num, errDen: error.den });
          }
        }
      }

      if (lists[0].length > 0) hasCandidate[0] = true;
      if (lists[1].length > 0) hasCandidate[1] = true;
      if (lists[0].length === 0 || lists[1].length === 0) continue;

      candidateCount += lists[0].length * lists[1].length;

      // 组合两档换装级（两档互斥运行，换装级允许使用相同实物齿轮）
      for (const s1 of lists[0]) {
        for (const s2 of lists[1]) {
          const cand = {
            d,
            w,
            s1,
            s2,
            // 需更换的轴位数：换装级主动 / 从动轴位上实物不同的个数
            change: (s1.a !== s2.a ? 1 : 0) + (s1.b !== s2.b ? 1 : 0),
            // 两档误差之和（未约分，交叉相乘精确比较）
            errNum: s1.errNum * s2.errDen + s2.errNum * s1.errDen,
            errDen: s1.errDen * s2.errDen,
          };
          if (!best || planCmp(cand, best) < 0) best = cand;
        }
      }
    }
  }

  if (!best) {
    return { feasible: false, candidateCount: 0, hasCandidate };
  }

  // 展开为带编号/齿数的富对象，供接口展示
  const byIndex = (i) => ({ id: gears[i].id, teeth: gears[i].teeth });
  const makeStage = (drive, driven) => ({
    drive: byIndex(drive),
    driven: byIndex(driven),
    stageRatio: makeFrac(teeth[drive], teeth[driven]),
  });

  const fixedStage = makeStage(best.d, best.w);
  const speedPlans = [best.s1, best.s2].map((s) => ({
    swapStage: makeStage(s.a, s.b),
    ratio: makeFrac(teeth[best.d] * teeth[s.a], teeth[best.w] * teeth[s.b]),
    error: { num: s.errNum, den: s.errDen }, // 入列时已约分
  }));

  const changedPositions = [];
  if (best.s1.a !== best.s2.a) changedPositions.push('drive');
  if (best.s1.b !== best.s2.b) changedPositions.push('driven');

  return {
    feasible: true,
    candidateCount,
    fixedStage,
    speeds: speedPlans,
    changeCount: changedPositions.length,
    changedPositions,
    errorSum: makeFrac(best.errNum, best.errDen),
    hasCandidate,
  };
}

module.exports = {
  MIN_GEARS,
  planDualSpeed,
  planCmp,
};
