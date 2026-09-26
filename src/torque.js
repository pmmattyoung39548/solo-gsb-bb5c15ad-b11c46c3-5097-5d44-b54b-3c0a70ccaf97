'use strict';

/**
 * 带载安全选配算法
 *
 * 在单台选配（1～3 级、每枚齿轮至多使用一次、精确分数判定速比与容差）的基础上，
 * 额外输入整机的**输入扭矩**与每枚齿轮的**额定扭矩**（单位 N·m），按无损传动校核：
 *
 *   - 第 1 级主动轮承受输入扭矩 T0；
 *   - 某级从动轮承受 该级输入扭矩 × 从动齿数 / 主动齿数（齿数反比），
 *     该值同时作为下一级的输入扭矩；
 *   - 每个两轮承受值均不得超过其额定扭矩。
 *
 * 关键：**同一组有向配对在不同级次顺序下，各级承受扭矩不同**（扭矩逐级传递），
 * 因此 enumerateMatches 按主动轮归一化得到的每一组达标配对，都必须把其全部
 * k! 种级次排列分别校核，不能沿用原搜索的规范化级序，也不能只取前 300 条候选。
 * 每种通过校核的级序本身就是一条独立的“速比与载荷均达标”方案。
 *
 * 方案排序沿用单台规则：级数少 → 速比相对误差小 → 各级 (主动,从动) 编号自然序。
 */

const {
  enumerateMatches,
  enrichMatch,
  cmpSolutions,
  makeFrac,
  validateGears,
  RESULT_LIMIT,
  MAX_GEARS,
} = require('./search');

/** 输入扭矩 / 额定扭矩正整数上限（N·m） */
const MAX_TORQUE = 1_000_000_000_000;

/**
 * 解析正整数扭矩：接受 JSON number 或纯数字字符串，范围 1～MAX_TORQUE。
 * @returns {{ok:true,value:number}|{ok:false,error:string}}
 */
function parsePositiveInt(raw, label) {
  const hint = `${label}需为 1～${MAX_TORQUE.toLocaleString('en-US').replaceAll(',', '')} 的正整数（单位 N·m）`;
  let v;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return { ok: false, error: hint };
    v = raw;
  } else if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) {
    v = Number(raw.trim());
  } else {
    return { ok: false, error: hint };
  }
  if (v < 1 || v > MAX_TORQUE) return { ok: false, error: hint };
  return { ok: true, value: v };
}

/**
 * 校验齿轮列表：沿用单台规则（编号唯一、正整数齿数、2～12 枚），
 * 另要求每枚齿轮带正整数额定扭矩 ratedTorque（N·m）。
 * @returns {{ok:true,gears:Array<{id:string,teeth:number,ratedTorque:number}>}|{ok:false,error:string}}
 */
function validateTorqueGears(input) {
  const checked = validateGears(input, { label: '齿轮', min: 2, max: MAX_GEARS });
  if (!checked.ok) return checked;

  // validateGears 已逐行校验过编号/齿数，这里在同一批行数据上补校额定扭矩
  const ratedById = new Map();
  for (let i = 0; i < input.length; i++) {
    const row = input[i];
    const id = String(row.id ?? '').trim() || `第 ${i + 1} 行`;
    const r = parsePositiveInt(row.ratedTorque, `齿轮 ${id} 的额定扭矩`);
    if (!r.ok) return r;
    ratedById.set(String(row.id ?? '').trim(), r.value);
  }

  checked.gears = checked.gears.map((g) => ({ ...g, ratedTorque: ratedById.get(g.id) }));
  return checked;
}

/**
 * 枚举 0..k-1 的全部排列（k ≤ 3，即 1～6 种级序）。
 */
function* permutationsOf(k) {
  const used = new Array(k).fill(false);
  const cur = new Array(k);
  function* rec(depth) {
    if (depth === k) {
      yield cur.slice();
      return;
    }
    for (let i = 0; i < k; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur[depth] = i;
      yield* rec(depth + 1);
      used[i] = false;
    }
  }
  yield* rec(0);
}

/**
 * 按给定级次顺序逐级传递扭矩并校核额定值（无损传动，全程整数分数比较）。
 *
 * @param {Array<{driveIndex:number,drivenIndex:number}>} order 级次顺序（有向配对下标）
 * @param {Array<bigint>} teeth 各齿轮齿数
 * @param {Array<bigint>} rated 各齿轮额定扭矩
 * @param {bigint} inputTorque 第一级输入扭矩
 * @returns {boolean} 全部两轮承受值均不超过各自额定值
 */
function orderCarries(order, teeth, rated, inputTorque) {
  let inNum = inputTorque; // 该级输入扭矩 = inNum / inDen
  let inDen = 1n;
  for (const p of order) {
    const a = p.driveIndex;
    const b = p.drivenIndex;
    // 主动轮承受该级输入扭矩：inNum/inDen ≤ rated[a]
    if (inNum > rated[a] * inDen) return false;
    // 从动轮承受 = 输入 × 从动齿/主动齿 = inNum·tb / (inDen·ta)
    const outNum = inNum * teeth[b];
    const outDen = inDen * teeth[a];
    if (outNum > rated[b] * outDen) return false;
    // 从动轮承受值即下一级输入
    inNum = outNum;
    inDen = outDen;
  }
  return true;
}

/**
 * 展开一条通过校核的级序方案为展示用富对象（每级含两轮承受扭矩与额定值）。
 */
function buildTorqueSolution(match, perm, gears, teeth, rated, inputTorque) {
  const base = enrichMatch(match, gears);
  const pairs = [];
  let inNum = inputTorque;
  let inDen = 1n;
  for (const pos of perm) {
    const p = match.idxs[pos];
    const a = p.driveIndex;
    const b = p.drivenIndex;
    const drive = gears[a];
    const driven = gears[b];
    const outNum = inNum * teeth[b];
    const outDen = inDen * teeth[a];
    pairs.push({
      inputTorque: makeFrac(inNum, inDen),
      drive: {
        id: drive.id,
        teeth: drive.teeth,
        ratedTorque: drive.ratedTorque,
        torque: makeFrac(inNum, inDen),
      },
      driven: {
        id: driven.id,
        teeth: driven.teeth,
        ratedTorque: driven.ratedTorque,
        torque: makeFrac(outNum, outDen),
      },
      stageRatio: makeFrac(teeth[a], teeth[b]),
    });
    inNum = outNum;
    inDen = outDen;
  }
  return {
    stages: match.stages,
    ratio: match.ratio,
    error: match.error,
    pairs,
    flatIds: base.flatIds,
    gearIds: base.gearIds,
    // 排序键：实际级次顺序下的有向对下标序列
    permIdxs: perm.map((pos) => match.idxs[pos]),
  };
}

/**
 * 带载安全选配主入口。
 *
 * @param {Array<{id:string,teeth:number,ratedTorque:number}>} gears 规范化齿轮（按编号自然序）
 * @param {{num:bigint,den:bigint}} target 目标速比
 * @param {{num:bigint,den:bigint}} tolerance 允许相对误差
 * @param {bigint} inputTorque 正整数输入扭矩（N·m）
 * @returns {{ratioMatchCount:number,loadCandidatesChecked:number,total:number,truncated:boolean,results:Array}}
 */
function planTorque(gears, target, tolerance, inputTorque) {
  // 第一步：完整枚举速比达标配对组（enumerateMatches 内部按主动轮把级顺序归一化）
  const matches = enumerateMatches(gears, target, tolerance);
  const ratioMatchCount = matches.length;

  const teeth = gears.map((g) => BigInt(g.teeth));
  const rated = gears.map((g) => BigInt(g.ratedTorque));

  // 第二步：每组配对的全部 k! 种级次顺序分别做扭矩校核，
  // 不能用原搜索的规范化级序去重，也不能截断候选
  let loadCandidatesChecked = 0;
  const feasible = [];
  for (const match of matches) {
    for (const perm of permutationsOf(match.stages)) {
      loadCandidatesChecked += 1;
      const order = perm.map((pos) => match.idxs[pos]);
      if (!orderCarries(order, teeth, rated, inputTorque)) continue;
      feasible.push({ stages: match.stages, ratio: match.ratio, error: match.error, idxs: order, match, perm });
    }
  }

  // 排序：级数 → 速比误差 → 实际级次编号自然序
  feasible.sort(cmpSolutions);

  const total = feasible.length;
  return {
    ratioMatchCount,
    loadCandidatesChecked,
    overloadCount: loadCandidatesChecked - total,
    total,
    truncated: total > RESULT_LIMIT,
    results: feasible
      .slice(0, RESULT_LIMIT)
      .map((f) => buildTorqueSolution(f.match, f.perm, gears, teeth, rated, inputTorque)),
  };
}

module.exports = {
  MAX_TORQUE,
  parsePositiveInt,
  validateTorqueGears,
  planTorque,
};
