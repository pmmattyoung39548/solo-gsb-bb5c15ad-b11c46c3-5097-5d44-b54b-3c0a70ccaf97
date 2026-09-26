'use strict';

/**
 * 共振避让转速算法（精确分数反推，基于 BigInt）
 *
 * 已装好的 1～3 级齿轮传动：第 k 级主动齿数 z_k、从动齿数 w_k。
 * 输入轴（轴 1）以整数转速 n（rpm）转动时，轴 a 的转速为
 *   n · f_a，f_1 = 1，f_{k+1} = f_k · z_k / w_k
 * 各轴倍率 f_a 全部以约分分数（BigInt）表示，无浮点误差。
 *
 * 每条禁用记录给出轴号 a 与该轴上的禁用转速闭区间 [lo, hi]（正整数端点，rpm）。
 * 该轴转速落入禁用带 ⟺ lo ≤ n·p/q ≤ hi（f_a = p/q，p、q 互素）：
 *   q·lo ≤ p·n ≤ q·hi
 *   ⟺ ceil(q·lo/p) ≤ n ≤ floor(q·hi/p)
 * 即反推出会触发该禁用带的整数输入转速闭区间；再裁剪到允许输入范围 [L, R]，
 * 把全部触发区间按整数闭区间合并（首尾相邻 [.,x]、[x+1,.] 也合并，
 * 因为它们覆盖的整数集连续），其补集即全部安全输入转速闭区间。
 *
 * 推荐：在全部连续安全闭区间中取整数转速个数（端点数 end−start+1）最多者，
 * 并列时取起点较小者；无安全转速时给出明确提示。
 */

const { makeFrac, MAX_TEETH } = require('./search');

/** 级数范围 / 禁用区间条数上限 / 转速端点范围（rpm） */
const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MAX_FORBIDDEN = 10;
const MIN_RPM = 1;
const MAX_RPM = 1000000000000; // 10¹²

/** 正整数向上取整除法：ceil(a / b)，a、b 均为非负 BigInt、b > 0 */
function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

/**
 * 解析正整数字段：接受 JSON number 或纯数字字符串。
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
 * 校验全部请求参数：级数与齿数、输入转速闭区间、各轴禁用转速闭区间。
 * @param {*} body
 * @returns {{ok:true,stages:Array,inputMin:number,inputMax:number,forbidden:Array}|{ok:false,error:string}}
 */
function validateResonanceInput(body) {
  const input = body && typeof body === 'object' ? body : {};

  // ---- 级数与齿数 ----
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
    stages.push({ stage: i + 1, driveTeeth: drive.value, drivenTeeth: driven.value });
  }

  // ---- 输入转速闭区间（正整数端点） ----
  const range = input.inputRange;
  if (!range || typeof range !== 'object') {
    return { ok: false, error: '输入转速闭区间（inputRange）格式不正确' };
  }
  const minChecked = parsePositiveInt(range.min, '输入转速下限', MAX_RPM);
  if (!minChecked.ok) return { ok: false, error: minChecked.error };
  const maxChecked = parsePositiveInt(range.max, '输入转速上限', MAX_RPM);
  if (!maxChecked.ok) return { ok: false, error: maxChecked.error };
  if (minChecked.value > maxChecked.value) {
    return {
      ok: false,
      error: `输入转速闭区间下限不能大于上限（当前 ${minChecked.value} ～ ${maxChecked.value} rpm）`,
    };
  }

  // ---- 禁用转速闭区间（0～10 条；轴号从输入轴到输出轴编号） ----
  const axisCount = stages.length + 1;
  const rawList = input.forbidden;
  if (rawList === undefined || rawList === null) {
    // 允许省略：不设任何禁用带
    return { ok: true, stages, inputMin: minChecked.value, inputMax: maxChecked.value, forbidden: [] };
  }
  if (!Array.isArray(rawList)) {
    return { ok: false, error: '禁用转速区间列表（forbidden）格式不正确' };
  }
  if (rawList.length > MAX_FORBIDDEN) {
    return { ok: false, error: `禁用转速区间最多 ${MAX_FORBIDDEN} 条（当前 ${rawList.length} 条）` };
  }
  const forbidden = [];
  for (let i = 0; i < rawList.length; i++) {
    const row = rawList[i];
    if (!row || typeof row !== 'object') {
      return { ok: false, error: `第 ${i + 1} 条禁用区间数据格式不正确` };
    }
    const axis = parsePositiveInt(row.axis, `第 ${i + 1} 条禁用区间的轴号`, axisCount);
    if (!axis.ok) return { ok: false, error: axis.error };
    const low = parsePositiveInt(row.low, `第 ${i + 1} 条禁用区间（轴 ${axis.value}）下限`, MAX_RPM);
    if (!low.ok) return { ok: false, error: low.error };
    const high = parsePositiveInt(row.high, `第 ${i + 1} 条禁用区间（轴 ${axis.value}）上限`, MAX_RPM);
    if (!high.ok) return { ok: false, error: high.error };
    if (low.value > high.value) {
      return {
        ok: false,
        error: `第 ${i + 1} 条禁用区间（轴 ${axis.value}）下限不能大于上限（当前 ${low.value} ～ ${high.value} rpm）`,
      };
    }
    forbidden.push({ index: i + 1, axis: axis.value, low: low.value, high: high.value });
  }

  return {
    ok: true,
    stages,
    inputMin: minChecked.value,
    inputMax: maxChecked.value,
    forbidden,
  };
}

/** 构造 {from,to,count} 整数闭区间（端点为 BigInt） */
function intv(from, to) {
  return { from, to, count: to - from + 1n };
}

/**
 * 主入口：各轴倍率 → 逐条反推 → 裁剪合并 → 安全区间与推荐。
 *
 * @param {Array<{stage:number,driveTeeth:number,drivenTeeth:number}>} stages 已校验级列表
 * @param {number} inputMin 允许输入转速下限（正整数）
 * @param {number} inputMax 允许输入转速上限（正整数）
 * @param {Array<{index:number,axis:number,low:number,high:number}>} forbidden 已校验禁用区间
 */
function planResonance(stages, inputMin, inputMax, forbidden) {
  const stageCount = stages.length;
  const axisCount = stageCount + 1;
  const L = BigInt(inputMin);
  const R = BigInt(inputMax);

  // 各级速比（主动/从动）与各轴相对输入轴的转速倍率（齿数连乘，精确分数）
  const stageRatios = stages.map((st) => makeFrac(BigInt(st.driveTeeth), BigInt(st.drivenTeeth)));
  const multipliers = [makeFrac(1n, 1n)];
  for (const r of stageRatios) {
    const prev = multipliers[multipliers.length - 1];
    multipliers.push(makeFrac(prev.num * r.num, prev.den * r.den));
  }

  const stageRows = stages.map((st, i) => ({
    stage: st.stage,
    driveTeeth: st.driveTeeth,
    drivenTeeth: st.drivenTeeth,
    stageRatio: stageRatios[i],
  }));

  const shafts = multipliers.map((multiplier, i) => ({
    axis: i + 1,
    role: i === 0 ? '输入轴' : `第 ${i} 级输出轴`,
    multiplier,
  }));

  // 逐条把禁用闭区间反推为会触发的整数输入转速闭区间，并裁剪到 [L, R]
  const rules = forbidden.map((rule) => {
    const f = multipliers[rule.axis - 1];
    const lo = BigInt(rule.low);
    const hi = BigInt(rule.high);
    // lo ≤ n·p/q ≤ hi ⟺ ceil(q·lo/p) ≤ n ≤ floor(q·hi/p)
    const rawFrom = ceilDiv(f.den * lo, f.num);
    const rawTo = (f.den * hi) / f.num;

    let status;
    let mapped = null;
    if (rawFrom > rawTo) {
      // 禁用带过窄：带内不存在 n·p/q 的整数值，任何整数输入转速都不会触发
      status = 'no-integer';
    } else {
      const from = rawFrom > L ? rawFrom : L;
      const to = rawTo < R ? rawTo : R;
      if (from > to) {
        // 触发区间存在但与允许输入范围不相交
        status = 'out-of-range';
      } else {
        status = 'in-range';
        mapped = intv(from, to);
      }
    }

    const out = {
      index: rule.index,
      axis: rule.axis,
      low: lo,
      high: hi,
      multiplier: f,
      rawFrom,
      rawTo,
      status,
      mapped,
      note: '',
    };
    out.note = ruleNote(out, L, R);
    return out;
  });

  // 合并裁剪后的触发区间（端点相邻也合并：其覆盖的整数集连续）
  const active = rules
    .filter((r) => r.mapped)
    .slice()
    .sort((a, b) => {
      if (a.mapped.from < b.mapped.from) return -1;
      if (a.mapped.from > b.mapped.from) return 1;
      if (a.mapped.to < b.mapped.to) return -1;
      if (a.mapped.to > b.mapped.to) return 1;
      return a.index - b.index;
    });

  const excluded = [];
  for (const r of active) {
    const last = excluded[excluded.length - 1];
    if (last && r.mapped.from <= last.to + 1n) {
      if (r.mapped.to > last.to) last.to = r.mapped.to;
      last.sources.push(r.index);
    } else {
      excluded.push({ from: r.mapped.from, to: r.mapped.to, sources: [r.index] });
    }
  }
  const excludedIntv = excluded.map((e) => ({
    ...intv(e.from, e.to),
    sources: e.sources.sort((a, b) => a - b),
  }));

  // 被合并区间在 [L, R] 中的补集 = 全部安全整数输入转速闭区间
  const safe = [];
  let cursor = L;
  for (const e of excludedIntv) {
    if (cursor < e.from) safe.push(intv(cursor, e.from - 1n));
    cursor = e.to + 1n;
  }
  if (cursor <= R) safe.push(intv(cursor, R));

  const safeCount = safe.reduce((sum, s) => sum + s.count, 0n);
  const excludedCount = excludedIntv.reduce((sum, e) => sum + e.count, 0n);
  const hasSafe = safe.length > 0;

  // 整数转速个数最多 → 起点最小（safe 已按起点升序，严格大于即可保留最小起点）
  let recommendation = null;
  for (const s of safe) {
    if (!recommendation || s.count > recommendation.count) recommendation = s;
  }

  const message = buildMessage({
    L,
    R,
    rules,
    safe,
    safeCount,
    hasSafe,
    recommendation,
  });

  return {
    stageCount,
    axisCount,
    stages: stageRows,
    shafts,
    inputMin: L,
    inputMax: R,
    totalCount: R - L + 1n,
    rules,
    excluded: excludedIntv,
    excludedCount,
    safe,
    safeCount,
    hasSafe,
    recommendation,
    message,
  };
}

function ruleNote(r, L, R) {
  const { num, den } = r.multiplier;
  const head = `轴 ${r.axis} 倍率 ${num}/${den}：该轴转速 = n·${num}/${den}`;
  if (r.status === 'in-range') {
    return (
      `${head}；由 ${den}×${r.low} ≤ ${num}·n ≤ ${den}×${r.high} 反推 ` +
      `n ∈ [${r.rawFrom}, ${r.rawTo}]，裁剪到允许范围 [${L}, ${R}] 后为 ` +
      `[${r.mapped.from}, ${r.mapped.to}]`
    );
  }
  if (r.status === 'out-of-range') {
    return (
      `${head}；反推触发区间 n ∈ [${r.rawFrom}, ${r.rawTo}]，与允许范围 ` +
      `[${L}, ${R}] 不相交，范围内不会触发`
    );
  }
  return (
    `${head}；反推需 ceil(${den}×${r.low}/${num}) = ${r.rawFrom} ≤ n ≤ ` +
    `floor(${den}×${r.high}/${num}) = ${r.rawTo}，下界大于上界：禁用带内不存在任何整数输入转速`
  );
}

function buildMessage(ctx) {
  const { L, R, rules, safe, safeCount, hasSafe, recommendation } = ctx;
  const span = `允许输入转速闭区间 [${L}, ${R}] rpm`;

  if (rules.length === 0) {
    return (
      `未设置任何禁用转速区间，${span}内的全部整数转速均安全（共 ${safeCount} 个），` +
      `推荐直接使用起点最低的 [${recommendation.from}, ${recommendation.to}] rpm。`
    );
  }
  if (!hasSafe) {
    return (
      `无安全输入转速：${span}内的每一个整数转速都会触发至少一条轴上的禁用区间，` +
      '请放宽输入转速范围，或调整 / 删除部分禁用转速区间后重试。'
    );
  }
  const tieNote =
    safe.length > 1
      ? `（在 ${safe.length} 段连续安全区间中整数转速个数最多；个数并列时取起点较小者）`
      : '';
  return (
    `${span}内共有 ${safeCount} 个安全整数输入转速，分布在 ${safe.length} 个连续闭区间中；` +
    `推荐工作区间为 [${recommendation.from}, ${recommendation.to}] rpm，` +
    `含 ${recommendation.count} 个可选整数转速${tieNote}。`
  );
}

module.exports = {
  MIN_STAGES,
  MAX_STAGES,
  MAX_FORBIDDEN,
  MIN_RPM,
  MAX_RPM,
  validateResonanceInput,
  planResonance,
};
