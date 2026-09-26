'use strict';

/**
 * 反向空程预算算法（精确分数，基于 BigInt）
 *
 * 已装好的 1～3 级齿轮传动：第 k 级主动齿数 z_k、从动齿数 w_k，
 * 本级速比 r_k = z_k / w_k，总速比 R = ∏ r_k（输出轴转数 / 输入轴转数）。
 *
 * 第 k 级从动轴侧的反转齿隙为非负分数闭区间 [lo_k, hi_k]（单位：该级从动轴转数）。
 * 折算到输出轴：该级齿隙 × 后续级速比 P_k = ∏_{j>k} r_j（最后一级 P = 1），
 * 各级相加合成输出轴总空程区间
 *   B = [Σ lo_k·P_k, Σ hi_k·P_k] = [B_lo, B_hi]
 *
 * 输入轴反转 N 圈（正整数）后，输出轴先吃掉空程再传动，实际输出转数区间：
 *   [max(0, N·R − B_hi), max(0, N·R − B_lo)]
 *
 * 保证输出至少达到期望转数 E（正分数）的最少正整数圈数：
 * 最坏情况取下界，需 max(0, N·R − B_hi) ≥ E ⟺ N·R ≥ E + B_hi，故
 *   N_min = ⌈(E + B_hi) / R⌉
 * （E > 0、B_hi ≥ 0、R > 0，故 N_min ≥ 1 恒成立）。
 */

const { makeFrac, parseDecimal, numberToFrac, MAX_TEETH } = require('./search');

/** 级数范围 / 分数约分后分母上限（10¹²）/ 齿隙与期望转数取值上限（10¹² 转） */
const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MAX_FRAC_DEN = 1000000000000n;
const MAX_TURNS = 1000000000000n;

/** 非负 BigInt 向上取整除法：ceil(a / b)，a ≥ 0、b > 0 */
function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

function addFrac(a, b) {
  return makeFrac(a.num * b.den + b.num * a.den, a.den * b.den);
}

function mulFrac(a, b) {
  return makeFrac(a.num * b.num, a.den * b.den);
}

function subFrac(a, b) {
  return makeFrac(a.num * b.den - b.num * a.den, a.den * b.den);
}

/** 分数截断到非负：max(0, f) */
function clampNonNeg(f) {
  return f.num < 0n ? { num: 0n, den: 1n } : f;
}

/** 分数比较：a ≤ b */
function fracLe(a, b) {
  return a.num * b.den <= b.num * a.den;
}

/**
 * 解析正整数字段（齿数）：接受 JSON number 或纯数字字符串。
 * @returns {{ok:true,value:number}|{ok:false,error:string}}
 */
function parsePositiveInt(raw, label, max) {
  let v;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      return { ok: false, error: `${label}需为正整数` };
    }
    v = raw;
  } else if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) {
    v = Number(raw.trim());
  } else {
    return { ok: false, error: `${label}需为正整数` };
  }
  if (v < 1 || v > max) {
    return { ok: false, error: `${label}需为 1～${max} 的正整数` };
  }
  return { ok: true, value: v };
}

/**
 * 解析非负分数字段（齿隙端点 / 期望转数）：接受 JSON number 或字符串。
 * JSON number 按其十进制写法（含科学计数法，如 1e-7）精确构造约分分数；
 * 字符串支持分数 p/q（p、q 为非负整数，q ≥ 1）或十进制小数。
 * 约分后分母 ≤ 10¹²，取值 ≤ 10¹² 转。
 * @returns {{ok:true,frac:object}|{ok:false,error:string}}
 */
function parseNonNegFrac(raw, label) {
  let frac;
  if (typeof raw === 'number') {
    frac = numberToFrac(raw);
    if (!frac) return { ok: false, error: `${label}需为有限数值` };
  } else if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return { ok: false, error: `${label}不能为空（无齿隙请填 0）` };

    if (s.includes('/')) {
      const parts = s.split('/');
      if (parts.length !== 2 || !/^\d+$/.test(parts[0].trim()) || !/^\d+$/.test(parts[1].trim())) {
        return { ok: false, error: `${label}格式不正确：分数写法为 p/q（p、q 为非负整数，如 1/8）` };
      }
      const p = BigInt(parts[0].trim());
      const q = BigInt(parts[1].trim());
      if (q < 1n) return { ok: false, error: `${label}的分母需为正整数（当前 ${s}）` };
      frac = makeFrac(p, q);
    } else {
      frac = parseDecimal(s);
    }
    if (!frac) {
      return { ok: false, error: `${label}格式不正确：请填非负分数 p/q（如 1/8）或小数（如 0.125）` };
    }
  } else {
    return { ok: false, error: `${label}格式不正确：请填分数 p/q（如 1/8）或小数（如 0.125）` };
  }
  if (frac.num < 0n) {
    return { ok: false, error: `${label}格式不正确：请填非负分数 p/q（如 1/8）或小数（如 0.125）` };
  }
  if (frac.den > MAX_FRAC_DEN) {
    return { ok: false, error: `${label}约分后的分母不能超过 10¹²` };
  }
  if (frac.num > MAX_TURNS * frac.den) {
    return { ok: false, error: `${label}不能超过 10¹² 转` };
  }
  return { ok: true, frac };
}

/**
 * 校验全部请求参数：级数与齿数、各级从动轴侧齿隙闭区间、期望输出转数。
 * @param {*} body
 * @returns {{ok:true,stages:Array,expected:object}|{ok:false,error:string}}
 */
function validateBacklashInput(body) {
  const input = body && typeof body === 'object' ? body : {};

  // ---- 级数与齿数、各级从动轴侧齿隙区间 ----
  if (!Array.isArray(input.stages)) {
    return { ok: false, error: '级列表（stages）格式不正确' };
  }
  if (input.stages.length < MIN_STAGES || input.stages.length > MAX_STAGES) {
    return {
      ok: false,
      error: `级数需为 ${MIN_STAGES}～${MAX_STAGES} 级（当前 ${Array.isArray(input.stages) ? input.stages.length : 0} 级）`,
    };
  }
  const stages = [];
  for (let i = 0; i < input.stages.length; i++) {
    const row = input.stages[i];
    if (!row || typeof row !== 'object') {
      return { ok: false, error: `第 ${i + 1} 级数据格式不正确` };
    }
    const drive = parsePositiveInt(row.driveTeeth, `第 ${i + 1} 级主动齿数`, MAX_TEETH);
    if (!drive.ok) return { ok: false, error: drive.error };
    const driven = parsePositiveInt(row.drivenTeeth, `第 ${i + 1} 级从动齿数`, MAX_TEETH);
    if (!driven.ok) return { ok: false, error: driven.error };

    const backlash = row.backlash;
    if (!backlash || typeof backlash !== 'object') {
      return {
        ok: false,
        error: `第 ${i + 1} 级齿隙区间（backlash）格式不正确：需含 low / high 两个非负分数端点`,
      };
    }
    const low = parseNonNegFrac(backlash.low, `第 ${i + 1} 级从动轴侧齿隙下限`);
    if (!low.ok) return { ok: false, error: low.error };
    const high = parseNonNegFrac(backlash.high, `第 ${i + 1} 级从动轴侧齿隙上限`);
    if (!high.ok) return { ok: false, error: high.error };
    if (!fracLe(low.frac, high.frac)) {
      return { ok: false, error: `第 ${i + 1} 级齿隙下限不能大于上限` };
    }
    stages.push({
      stage: i + 1,
      driveTeeth: drive.value,
      drivenTeeth: driven.value,
      backlashLow: low.frac,
      backlashHigh: high.frac,
    });
  }

  // ---- 期望输出转数（正分数） ----
  const expected = parseNonNegFrac(input.expectedTurns, '期望输出转数');
  if (!expected.ok) return { ok: false, error: expected.error };
  if (expected.frac.num === 0n) {
    return { ok: false, error: '期望输出转数需为正分数（大于 0）' };
  }

  return { ok: true, stages, expected: expected.frac };
}

/** 分数简短写法：分母为 1 时只写分子（用于结论文字） */
function fmt(f) {
  return f.den === 1n ? f.num.toString() : `${f.num}/${f.den}`;
}

/**
 * 主入口：各级齿隙 × 后续级速比 → 输出轴总空程区间 → 保证达标的最少圈数。
 *
 * @param {Array<{stage:number,driveTeeth:number,drivenTeeth:number,backlashLow:object,backlashHigh:object}>} stages 已校验级列表
 * @param {{num:bigint,den:bigint}} expected 已校验期望输出转数（正分数）
 */
function planBacklash(stages, expected) {
  const stageCount = stages.length;
  const axisCount = stageCount + 1;

  // 各级速比 r_k = 主动齿 / 从动齿；后续级速比 P_k = ∏_{j>k} r_j（末级为 1）
  const stageRatios = stages.map((st) => makeFrac(BigInt(st.driveTeeth), BigInt(st.drivenTeeth)));
  const suffixRatios = new Array(stageCount);
  suffixRatios[stageCount - 1] = makeFrac(1n, 1n);
  for (let i = stageCount - 2; i >= 0; i--) {
    suffixRatios[i] = mulFrac(suffixRatios[i + 1], stageRatios[i + 1]);
  }
  // 总速比 R = r_1 × P_1 = ∏ r_k
  const totalRatio = mulFrac(stageRatios[0], suffixRatios[0]);

  // 各级齿隙折算到输出轴（× 后续级速比），逐级相加合成总空程区间
  let totalLow = { num: 0n, den: 1n };
  let totalHigh = { num: 0n, den: 1n };
  const stageRows = stages.map((st, i) => {
    const convertedLow = mulFrac(st.backlashLow, suffixRatios[i]);
    const convertedHigh = mulFrac(st.backlashHigh, suffixRatios[i]);
    totalLow = addFrac(totalLow, convertedLow);
    totalHigh = addFrac(totalHigh, convertedHigh);
    return {
      stage: st.stage,
      driveTeeth: st.driveTeeth,
      drivenTeeth: st.drivenTeeth,
      stageRatio: stageRatios[i],
      backlashLow: st.backlashLow,
      backlashHigh: st.backlashHigh,
      suffixRatio: suffixRatios[i],
      convertedLow,
      convertedHigh,
    };
  });

  // 保证输出 ≥ E ⟺ N·R − B_hi ≥ E ⟺ N ≥ (E + B_hi) / R（E > 0，故 N ≥ 1 恒成立）
  const requiredMargin = addFrac(expected, totalHigh);
  const minInputTurns = ceilDiv(requiredMargin.num * totalRatio.den, requiredMargin.den * totalRatio.num);

  // 该圈数下的实际输出转数区间 [max(0, N·R − B_hi), max(0, N·R − B_lo)]
  const idealOutput = mulFrac({ num: minInputTurns, den: 1n }, totalRatio);
  const outputLow = clampNonNeg(subFrac(idealOutput, totalHigh));
  const outputHigh = clampNonNeg(subFrac(idealOutput, totalLow));

  // 少转 1 圈时的保证下界（用于说明 N 的最少性；N = 1 时为 0 圈）
  const prevTurns = minInputTurns - 1n;
  const prevIdeal = mulFrac({ num: prevTurns, den: 1n }, totalRatio);
  const prevGuaranteed = clampNonNeg(subFrac(prevIdeal, totalHigh));

  const message =
    `总速比 ${fmt(totalRatio)}，输出轴总空程区间 [${fmt(totalLow)}, ${fmt(totalHigh)}] 转。` +
    `要保证输出至少 ${fmt(expected)} 转，需 N×${fmt(totalRatio)} − ${fmt(totalHigh)} ≥ ${fmt(expected)}，` +
    `即 N ≥ ${fmt(requiredMargin)} ÷ ${fmt(totalRatio)}，最少正整数圈数为 ${minInputTurns} 圈；` +
    `此时输出转数区间为 [${fmt(outputLow)}, ${fmt(outputHigh)}] 转，下界已达标。` +
    `少转 1 圈（${prevTurns} 圈）时最坏情况输出仅 ${fmt(prevGuaranteed)} 转，低于期望转数，` +
    `故 ${minInputTurns} 圈为保证达标的最少输入圈数。`;

  return {
    stageCount,
    axisCount,
    stages: stageRows,
    totalRatio,
    totalLow,
    totalHigh,
    expected,
    requiredMargin,
    minInputTurns,
    idealOutput,
    outputLow,
    outputHigh,
    prevTurns,
    prevGuaranteed,
    message,
  };
}

module.exports = {
  MIN_STAGES,
  MAX_STAGES,
  MAX_FRAC_DEN,
  MAX_TURNS,
  validateBacklashInput,
  planBacklash,
};
