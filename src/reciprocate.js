'use strict';

/**
 * 往复运动回放算法（精确分数，基于 BigInt）
 *
 * 已装好的 1～3 级外啮合齿轮传动：第 k 级主动齿数 z_k、从动齿数 n_k（正整数），
 * 该级从动轴侧固定齿隙宽度 W_k（非负分数，单位：该级从动轴转数），
 * 初始间隙位置 g_k（0 ≤ g_k ≤ W_k）。
 *
 * 各轴累计位移初始为 0。每段给定有符号输入转数 t（分数，可正 / 可负 / 可为 0），
 * 按级传递（外啮合每级反向，上游实际位移乘负齿数比）：
 *   d   = 上游实际位移 × (−z_k / n_k)
 *   u   = g_k + d
 *   g'  = min(W_k, max(0, u))          —— 间隙位置始终夹在 [0, W_k]
 *   本级实际位移（该级从动轴）= u − g'
 * 更新 g_k ← g' 并传给下一级；各级间隙位置与各轴累计位移跨段保留。
 *
 * 零齿隙（W_k = 0，此时 g_k 必为 0）时 g' 恒为 0，实际位移 = d，即无空程直传；
 * 零位移段（t = 0）时各级 d = 0、u = g_k，各轴实际位移全为 0，状态保持不变。
 */

const { makeFrac, parseDecimal, numberToFrac, MAX_TEETH } = require('./search');

/** 级数范围 / 段数范围 / 分数约分后分母上限（10¹²）/ 转数与齿隙取值上限（10¹² 转） */
const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MIN_SEGMENTS = 1;
const MAX_SEGMENTS = 50;
const MAX_FRAC_DEN = 1000000000000n;
const MAX_TURNS = 1000000000000n;

function addFrac(a, b) {
  return makeFrac(a.num * b.den + b.num * a.den, a.den * b.den);
}

function mulFrac(a, b) {
  return makeFrac(a.num * b.num, a.den * b.den);
}

function subFrac(a, b) {
  return makeFrac(a.num * b.den - b.num * a.den, a.den * b.den);
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
 * 解析非负分数字段（齿隙宽度 w / 初始间隙位置 g）：接受 JSON number 或字符串。
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
 * 解析有符号分数字段（每段输入转数）：接受 JSON number 或字符串。
 * JSON number 按其十进制写法（含科学计数法，如 -1.5e3）精确构造约分分数；
 * 字符串支持带符号分数 ±p/q（如 -3/2）或带符号小数（如 -1.5、+2）。
 * 约分后分母 ≤ 10¹²，绝对值 ≤ 10¹² 转；允许 0（零位移段）。
 * @returns {{ok:true,frac:object}|{ok:false,error:string}}
 */
function parseSignedFrac(raw, label) {
  let frac;
  if (typeof raw === 'number') {
    frac = numberToFrac(raw);
    if (!frac) return { ok: false, error: `${label}需为有限数值` };
  } else if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return { ok: false, error: `${label}不能为空（零位移请填 0）` };

    if (s.includes('/')) {
      const m = /^([+-]?)\s*(\d+)\s*\/\s*(\d+)$/.exec(s);
      if (!m) {
        return { ok: false, error: `${label}格式不正确：分数写法为 ±p/q（p、q 为非负整数，如 -3/2、7/2）` };
      }
      const sign = m[1] === '-' ? -1n : 1n;
      const p = BigInt(m[2]);
      const q = BigInt(m[3]);
      if (q < 1n) return { ok: false, error: `${label}的分母需为正整数（当前 ${s}）` };
      frac = makeFrac(sign * p, q);
    } else {
      frac = parseDecimal(s);
    }
    if (!frac) {
      return { ok: false, error: `${label}格式不正确：请填有符号分数 p/q（如 -3/2）或小数（如 -1.5）` };
    }
  } else {
    return { ok: false, error: `${label}格式不正确：请填有符号分数 p/q（如 -3/2）或小数（如 -1.5）` };
  }
  if (frac.den > MAX_FRAC_DEN) {
    return { ok: false, error: `${label}约分后的分母不能超过 10¹²` };
  }
  const absNum = frac.num < 0n ? -frac.num : frac.num;
  if (absNum > MAX_TURNS * frac.den) {
    return { ok: false, error: `${label}的绝对值不能超过 10¹² 转` };
  }
  return { ok: true, frac };
}

/**
 * 校验全部请求参数：级数与齿数、各级齿隙宽度 w 与初始间隙位置 g（0 ≤ g ≤ w）、
 * 1～50 段有符号输入转数。
 * @param {*} body
 * @returns {{ok:true,stages:Array,segments:Array}|{ok:false,error:string}}
 */
function validateReciprocateInput(body) {
  const input = body && typeof body === 'object' ? body : {};

  // ---- 级数与齿数、各级齿隙宽度 / 初始间隙位置 ----
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

    const width = parseNonNegFrac(row.backlashWidth, `第 ${i + 1} 级从动轴侧齿隙宽度 w`);
    if (!width.ok) return { ok: false, error: width.error };
    const gap = parseNonNegFrac(row.initialGap, `第 ${i + 1} 级初始间隙位置 g`);
    if (!gap.ok) return { ok: false, error: gap.error };
    if (!fracLe(gap.frac, width.frac)) {
      return {
        ok: false,
        error: `第 ${i + 1} 级初始间隙位置 g 不能大于齿隙宽度 w（需满足 0 ≤ g ≤ w）`,
      };
    }
    stages.push({
      stage: i + 1,
      driveTeeth: drive.value,
      drivenTeeth: driven.value,
      width: width.frac,
      initialGap: gap.frac,
    });
  }

  // ---- 逐段有符号输入转数 ----
  if (!Array.isArray(input.segments)) {
    return { ok: false, error: '段列表（segments）格式不正确' };
  }
  if (input.segments.length < MIN_SEGMENTS || input.segments.length > MAX_SEGMENTS) {
    return {
      ok: false,
      error: `段数需为 ${MIN_SEGMENTS}～${MAX_SEGMENTS} 段（当前 ${Array.isArray(input.segments) ? input.segments.length : 0} 段）`,
    };
  }
  const segments = [];
  for (let i = 0; i < input.segments.length; i++) {
    const t = parseSignedFrac(input.segments[i], `第 ${i + 1} 段输入转数`);
    if (!t.ok) return { ok: false, error: t.error };
    segments.push(t.frac);
  }

  return { ok: true, stages, segments };
}

/** 分数简短写法：分母为 1 时只写分子（用于结论文字） */
function fmt(f) {
  return f.den === 1n ? f.num.toString() : `${f.num}/${f.den}`;
}

/**
 * 主入口：逐段回放——上游实际位移乘负齿数比，经齿隙吸收后得本级实际位移，
 * 间隙位置与各轴累计位移跨段保留。
 *
 * @param {Array<{stage:number,driveTeeth:number,drivenTeeth:number,width:object,initialGap:object}>} stages 已校验级列表
 * @param {Array<{num:bigint,den:bigint}>} segments 已校验逐段有符号输入转数
 */
function planReciprocate(stages, segments) {
  const stageCount = stages.length;
  const axisCount = stageCount + 1;

  // 各级速比 r_k = 主动齿 / 从动齿；传递用负齿数比 −r_k（外啮合反向）
  const stageRatios = stages.map((st) => makeFrac(BigInt(st.driveTeeth), BigInt(st.drivenTeeth)));
  const negRatios = stageRatios.map((r) => ({ num: -r.num, den: r.den }));

  // 跨段保留的状态：各级间隙位置 g_k、各轴累计位移
  const gaps = stages.map((st) => st.initialGap);
  const cumulative = Array.from({ length: axisCount }, () => ({ num: 0n, den: 1n }));

  const segmentRows = segments.map((turns, idx) => {
    const actuals = new Array(axisCount);
    actuals[0] = turns; // 输入轴实际位移即该段输入转数
    const stageDetails = stages.map((st, k) => {
      const upstream = actuals[k];
      const d = mulFrac(upstream, negRatios[k]);
      const gapBefore = gaps[k];
      const u = addFrac(gapBefore, d);
      // g' = min(w, max(0, u))
      let gapAfter = u;
      if (gapAfter.num < 0n) gapAfter = { num: 0n, den: 1n };
      else if (!fracLe(gapAfter, st.width)) gapAfter = st.width;
      const actual = subFrac(u, gapAfter);
      gaps[k] = gapAfter;
      actuals[k + 1] = actual;
      return { stage: k + 1, upstream, d, gapBefore, u, gapAfter, actual };
    });
    for (let a = 0; a < axisCount; a++) {
      cumulative[a] = addFrac(cumulative[a], actuals[a]);
    }
    return {
      index: idx + 1,
      inputTurns: turns,
      axes: actuals.map((actual, a) => ({ axis: a + 1, actual, cumulative: cumulative[a] })),
      stages: stageDetails,
    };
  });

  const axisParts = cumulative.map((c, a) => `轴 ${a + 1} 累计位移 ${fmt(c)} 转`).join('，');
  const gapParts = gaps
    .map((g, k) => `第 ${k + 1} 级剩余间隙位置 ${fmt(g)} 转（齿隙宽度 ${fmt(stages[k].width)} 转）`)
    .join('，');
  const message =
    `共回放 ${segments.length} 段（${stageCount} 级传动、${axisCount} 个轴），` +
    `各轴累计位移初始为 0、逐级经齿隙吸收传递。最终状态：${axisParts}；${gapParts}。`;

  return {
    stageCount,
    axisCount,
    segmentCount: segments.length,
    stages: stages.map((st, i) => ({ ...st, stageRatio: stageRatios[i] })),
    segments: segmentRows,
    finalGaps: gaps.slice(),
    finalCumulative: cumulative.slice(),
    message,
  };
}

module.exports = {
  MIN_STAGES,
  MAX_STAGES,
  MIN_SEGMENTS,
  MAX_SEGMENTS,
  MAX_FRAC_DEN,
  MAX_TURNS,
  validateReciprocateInput,
  planReciprocate,
};
