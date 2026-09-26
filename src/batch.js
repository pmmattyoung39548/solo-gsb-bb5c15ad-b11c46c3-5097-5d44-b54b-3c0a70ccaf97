'use strict';

/**
 * 批量装配分配算法
 *
 * 输入 2~3 台装置（各自目标速比与容差）与共用齿轮清单：
 *   1. 对每台装置枚举“全部”达标配对（精确分数判定，1~3 级、每级两轮），
 *      不使用单台搜索截断后的前 300 条；
 *   2. 对各台按“占用齿轮集合”保留最优候选（同集合只留级数/误差/编号最优的一条）；
 *   3. 在各台候选间求互不冲突（每枚齿轮整批至多使用一次）的组合；
 *   4. 组合择优顺序：达标台数最多 → 总级数最少 → 相对误差之和最小，
 *      最后按装置输入顺序、逐台比较齿轮编号序列自然序稳定决胜。
 *
 * 方案在内部以轻量结构表示（仅齿轮下标 + 精确分数），picks 输出前再统一展开。
 */

const {
  enumerateMatches,
  enrichMatch,
  cmpSolutions,
  cmpIdxs,
} = require('./search');

/** 轻量方案的占用齿轮位掩码（齿轮 ≤ 12 枚） */
function maskOfIdxs(idxs) {
  let mask = 0;
  for (const p of idxs) mask |= (1 << p.driveIndex) | (1 << p.drivenIndex);
  return mask;
}

/**
 * 完整方案之间的全局择优比较（<0 表示 a 优于 b）。
 *
 * @param {{count:number,stages:number,errNum:bigint,errDen:bigint,picks:Array}} a
 * @param {{count:number,stages:number,errNum:bigint,errDen:bigint,picks:Array}} b
 */
function planCmp(a, b) {
  // 1) 达标台数最多
  if (a.count !== b.count) return b.count - a.count;
  // 2) 总级数最少
  if (a.stages !== b.stages) return a.stages - b.stages;
  // 3) 相对误差之和最小（精确分数比较）
  const le = a.errNum * b.errDen;
  const re = b.errNum * a.errDen;
  if (le !== re) return le < re ? -1 : 1;
  // 4) 按装置输入顺序逐台决胜：有方案优先于未满足，再比齿轮编号序列自然序
  for (let i = 0; i < a.picks.length; i++) {
    const pa = a.picks[i];
    const pb = b.picks[i];
    if (!pa && !pb) continue;
    if (!pa) return 1;
    if (!pb) return -1;
    const c = cmpIdxs(pa.idxs, pb.idxs);
    if (c) return c;
  }
  return 0;
}

/**
 * 对单台的全部达标方案按“占用齿轮集合”保留最优候选。
 * 候选按单台规则（级数/误差/编号）排序，使深度优先搜索尽早命中优质组合。
 *
 * @param {Array} matches enumerateMatches 的完整结果（未截断）
 * @returns {Array<{match:object,mask:number}>}
 */
function buildCandidates(matches) {
  const bestBySet = new Map();
  for (const m of matches) {
    // 位掩码即占用齿轮集合的唯一键（齿轮 ≤ 12 枚）
    const mask = maskOfIdxs(m.idxs);
    const cur = bestBySet.get(mask);
    if (!cur || cmpSolutions(m, cur) < 0) bestBySet.set(mask, m);
  }
  return [...bestBySet.entries()]
    .map(([mask, match]) => ({ match, mask }))
    .sort((a, b) => cmpSolutions(a.match, b.match));
}

/**
 * @param {Array<{id:string,teeth:number}>} gears 规范化后的共用齿轮（按编号自然序）
 * @param {Array<Array<{match:object,mask:number}>>} candidateList 各台按占用集合去重后的候选
 * @param {number} [availableMask] 可选齿轮位掩码（默认全部可选）。
 *        补货场景下枚举不同可购子集时复用同一份候选，仅需过滤掩码。
 * @returns {{
 *   picks: Array,                      // picks[i] 为该台选中方案（富对象），未满足为 null
 *   matchedCount: number,
 *   totalStages: number,
 *   errorSum: {num:bigint, den:bigint},
 * }}
 */
function allocateCandidates(gears, candidateList, availableMask = -1) {
  const n = candidateList.length;

  // 仅保留占用集合完全落在可用齿轮内的候选
  const usable = candidateList.map(
    (list) => list.filter((c) => (c.mask & ~availableMask) === 0),
  );

  // remCap[i]：第 i 台起（含）候选非空的台数，即继续搜索时达标台数的上界
  const remCap = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    remCap[i] = remCap[i + 1] + (usable[i].length > 0 ? 1 : 0);
  }

  let best = null;
  const picks = new Array(n).fill(null);

  function dfs(i, usedMask, count, stages, errNum, errDen) {
    if (best) {
      const maxCount = count + remCap[i];
      // 剩余台全达标也无法追平已知最优台数
      if (maxCount < best.count) return;
      if (maxCount === best.count) {
        // 要追平台数还需选中 need 台，每台至少 1 级、误差非负，
        // 据此对总级数与误差和做下界剪枝
        const need = best.count - count;
        if (stages + need > best.stages) return;
        if (stages + need === best.stages && errNum * best.errDen > best.errNum * errDen) return;
      }
    }

    if (i === n) {
      const plan = { count, stages, errNum, errDen, picks: picks.slice() };
      if (!best || planCmp(plan, best) < 0) best = plan;
      return;
    }

    // 先尝试“选中一个兼容候选”，再尝试跳过本台，保证快速发现全达标组合
    for (const c of usable[i]) {
      if (c.mask & usedMask) continue;
      const e = c.match.error;
      picks[i] = c.match;
      dfs(
        i + 1,
        usedMask | c.mask,
        count + 1,
        stages + c.match.stages,
        errNum * e.den + e.num * errDen,
        errDen * e.den,
      );
    }
    picks[i] = null;
    dfs(i + 1, usedMask, count, stages, errNum, errDen);
  }

  dfs(0, 0, 0, 0, 0n, 1n);

  return {
    // 展开为带编号/齿数/占用集合的富对象，供接口展示与未用齿轮统计
    picks: best.picks.map((m) => (m ? enrichMatch(m, gears) : null)),
    matchedCount: best.count,
    totalStages: best.stages,
    errorSum: { num: best.errNum, den: best.errDen },
  };
}

/**
 * @param {Array<{id:string,teeth:number}>} gears 规范化后的共用齿轮（按编号自然序）
 * @param {Array<Array>} matchesList matchesList[i] 为第 i 台的全部达标方案
 *        （enumerateMatches 的完整结果，未截断）
 * @returns {{
 *   picks: Array,
 *   matchedCount: number,
 *   totalStages: number,
 *   errorSum: {num:bigint, den:bigint},
 *   candidateCounts: Array<number>,   // 各台按占用集合去重后的候选数
 *   totalMatches: Array<number>,      // 各台达标方案总数（未截断）
 * }}
 */
function allocate(gears, matchesList) {
  const candidateList = matchesList.map(buildCandidates);
  const result = allocateCandidates(gears, candidateList);
  return {
    ...result,
    candidateCounts: candidateList.map((list) => list.length),
    totalMatches: matchesList.map((matches) => matches.length),
  };
}

/**
 * 便捷入口：解析后的齿轮与装置参数，直接完成“枚举 + 分配”。
 * @param {Array} gears 规范化齿轮
 * @param {Array<{target:object,tolerance:object}>} devices
 */
function planBatch(gears, devices) {
  const matchesList = devices.map((d) =>
    enumerateMatches(gears, d.target, d.tolerance),
  );
  return allocate(gears, matchesList);
}

module.exports = {
  allocate,
  allocateCandidates,
  buildCandidates,
  maskOfIdxs,
  planBatch,
  planCmp,
};
