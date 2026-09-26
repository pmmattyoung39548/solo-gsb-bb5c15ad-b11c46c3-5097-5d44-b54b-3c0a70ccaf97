'use strict';

/**
 * 试制前缺齿补货采购建议算法
 *
 * 场景：两台装置需要同时装配，现有库存齿轮可能不够；另有 1~4 枚“可购实物齿轮”
 * （各有唯一编号、齿数与非负整数价格）。
 *
 * 沿用批量装配的全部规则：1~3 级传动、每级一枚主动轮 + 一枚从动轮、
 * 精确分数（BigInt）速比与容差判定、任一实物齿轮在两台间不复用。
 *
 * 做法：
 *   1. 在“现有 + 全部可购”合并齿轮池上，对两台枚举全部达标方案并按占用集合
 *      去重（候选只需构建一次）；
 *   2. 枚举可购齿轮的全部子集（含空集），在“现有 + 子集”的可用掩码下，
 *      用与批量装配完全相同的完整达标分配判断两台能否同时达标；
 *   3. 在“可装配”的子集中按 购买枚数最少 → 总价最低 → 购买编号自然序
 *      选出唯一建议；空集可行即现有库存已足够，返回空采购清单；
 *   4. 所有子集均不可行时返回 feasible:false，并给出各台在完整齿轮池上
 *      是否存在达标候选，供接口明确提示原因。
 */

const {
  MAX_GEARS,
  MIN_TEETH,
  MAX_TEETH,
  naturalCmp,
  enumerateMatches,
} = require('./search');
const { buildCandidates, allocateCandidates } = require('./batch');

/** 现有齿轮 / 可购齿轮 / 合计数量约束 */
const MIN_EXISTING = 2;
const MAX_EXISTING = 8;
const MIN_BUYABLE = 1;
const MAX_BUYABLE = 4;
/** 单价上限（非负整数，取安全整数范围内的实用上限） */
const MAX_PRICE = 1_000_000_000_000;

/**
 * 校验可购实物齿轮：编号唯一、齿数为正整数、价格为非负整数。
 * @param {*} input
 * @returns {{ok:true, gears:Array<{id:string,teeth:number,price:number}>}|{ok:false,error:string}}
 */
function validateBuyableGears(input) {
  if (!Array.isArray(input)) return { ok: false, error: '可购齿轮列表格式不正确' };
  if (input.length < MIN_BUYABLE || input.length > MAX_BUYABLE) {
    return { ok: false, error: `可购齿轮数量需在 ${MIN_BUYABLE}~${MAX_BUYABLE} 枚之间（当前 ${input.length} 枚）` };
  }
  const gears = [];
  const ids = new Set();
  for (let i = 0; i < input.length; i++) {
    const row = input[i];
    if (!row || typeof row !== 'object') return { ok: false, error: `第 ${i + 1} 行可购齿轮数据格式不正确` };
    const id = String(row.id ?? '').trim();
    if (!id) return { ok: false, error: `第 ${i + 1} 行缺少可购齿轮编号` };
    if (ids.has(id)) return { ok: false, error: `可购齿轮编号重复：${id}` };
    ids.add(id);
    const teeth = Number(row.teeth);
    if (!Number.isInteger(teeth) || teeth < MIN_TEETH || teeth > MAX_TEETH) {
      return { ok: false, error: `可购齿轮 ${id} 的齿数需为 ${MIN_TEETH}~${MAX_TEETH} 的整数` };
    }
    const price = Number(row.price);
    if (!Number.isInteger(price) || price < 0 || price > MAX_PRICE) {
      return { ok: false, error: `可购齿轮 ${id} 的价格需为 0~${MAX_PRICE} 的非负整数` };
    }
    gears.push({ id, teeth, price });
  }
  gears.sort((a, b) => naturalCmp(a.id, b.id));
  return { ok: true, gears };
}

/**
 * 采购子集比较（<0 表示 a 更优）：枚数最少 → 总价最低 → 编号自然序字典序。
 * 子集均为按编号自然序排列的可购齿轮下标数组。
 */
function subsetCmp(a, b) {
  if (a.size !== b.size) return a.size - b.size;
  if (a.price !== b.price) return a.price - b.price;
  for (let i = 0; i < Math.min(a.indices.length, b.indices.length); i++) {
    if (a.indices[i] !== b.indices[i]) return a.indices[i] - b.indices[i];
  }
  return 0;
}

/**
 * 主入口：枚举可购齿轮子集并给出唯一采购建议。
 *
 * @param {Array<{id:string,teeth:number}>} existing 规范化后的现有齿轮（自然序）
 * @param {Array<{id:string,teeth:number,price:number}>} buyable 规范化后的可购齿轮（自然序）
 * @param {Array<{name:string,target:object,tolerance:object}>} devices 恰好 2 台
 * @returns {object} 采购建议（详见 README 与 /api/procure 返回结构）
 */
function planProcure(existing, buyable, devices) {
  const deviceCount = devices.length;

  // 合并齿轮池并按编号自然序排列（调用方已保证跨列表编号不重复）
  const pool = [...existing, ...buyable].sort((a, b) => naturalCmp(a.id, b.id));
  const poolIndex = new Map(pool.map((g, i) => [g.id, i]));

  // 各台在完整齿轮池上的达标候选（只枚举、去重一次，子集复用时仅按掩码过滤）
  const candidateList = devices.map((d) =>
    buildCandidates(enumerateMatches(pool, d.target, d.tolerance)),
  );

  const existingMask = existing.reduce((m, g) => m | (1 << poolIndex.get(g.id)), 0);
  const buyMask = buyable.map((g) => 1 << poolIndex.get(g.id));

  // 可购齿轮子集（按下标升序枚举，2^b ≤ 16）
  const subsets = [[]];
  for (let i = 0; i < buyable.length; i++) {
    const len = subsets.length;
    for (let s = 0; s < len; s++) subsets.push([...subsets[s], i]);
  }

  let best = null;
  let checked = 0;
  let feasibleCount = 0;

  for (const indices of subsets) {
    checked++;
    let availableMask = existingMask;
    let price = 0;
    for (const bi of indices) {
      availableMask |= buyMask[bi];
      price += buyable[bi].price;
    }

    // 完整达标分配：沿用批量装配的候选分配与同一套齿轮规则
    const plan = allocateCandidates(pool, candidateList, availableMask);
    if (plan.matchedCount !== deviceCount) continue;
    feasibleCount++;

    const candidate = {
      indices,
      size: indices.length,
      price,
      availableMask,
      plan,
    };
    if (!best || subsetCmp(candidate, best) < 0) best = candidate;
  }

  // 诊断：各台在完整齿轮池（现有 + 全部可购）上是否存在任何达标候选
  const deviceHasMatch = candidateList.map((list) => list.length > 0);

  if (!best) {
    return {
      feasible: false,
      deviceCount,
      subsetsChecked: checked,
      feasibleSubsets: 0,
      deviceHasMatch,
      poolSize: pool.length,
    };
  }

  // 最优子集中两台实际占用的齿轮（allocateCandidates 的 picks 已为富对象）
  const usedIds = new Set();
  for (const pick of best.plan.picks) {
    for (const id of pick.gearIds) usedIds.add(id);
  }

  const purchased = best.indices.map((bi) => {
    const g = buyable[bi];
    return { id: g.id, teeth: g.teeth, price: g.price, used: usedIds.has(g.id) };
  });
  // 未使用齿轮：现有 + 已购中未被任一台占用者（按编号自然序）
  const unusedGears = pool
    .filter((g) => !usedIds.has(g.id) && (best.availableMask & (1 << poolIndex.get(g.id))))
    .map((g) => ({
      id: g.id,
      teeth: g.teeth,
      origin: existing.some((e) => e.id === g.id) ? 'existing' : 'purchased',
      price: g.price ?? null,
    }));

  return {
    feasible: true,
    noPurchaseNeeded: best.size === 0,
    deviceCount,
    subsetsChecked: checked,
    feasibleSubsets: feasibleCount,
    poolSize: pool.length,
    purchaseCount: best.size,
    totalPrice: best.price,
    purchasedGears: purchased,
    unusedGears,
    totalStages: best.plan.totalStages,
    errorSum: best.plan.errorSum,
    picks: best.plan.picks,
    deviceHasMatch,
  };
}

module.exports = {
  MIN_EXISTING,
  MAX_EXISTING,
  MIN_BUYABLE,
  MAX_BUYABLE,
  MAX_PRICE,
  MAX_TOTAL_GEARS: MAX_GEARS,
  validateBuyableGears,
  planProcure,
};
