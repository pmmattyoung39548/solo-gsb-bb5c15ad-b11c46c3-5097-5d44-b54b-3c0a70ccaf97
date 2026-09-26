'use strict';

/**
 * 齿轮组选配核心算法（精确分数计算，基于 BigInt）
 *
 * 每级传动选一枚主动轮和一枚从动轮：
 *   实际输出/输入转速比 = ∏ (主动轮齿数 / 从动轮齿数)
 * 一枚齿轮在整套方案中至多使用一次。
 *
 * 搜索范围：1~3 级；方案排序：级数少 → 相对误差小 → 齿轮编号序列字典序（自然序）。
 */

/** 最大搜索级数 / 单次返回方案上限 / 单个齿轮库上限 */
const MAX_STAGES = 3;
const RESULT_LIMIT = 300;
const MAX_GEARS = 12;
const MIN_TEETH = 1;
const MAX_TEETH = 100000;

/* ------------------------------------------------------------------ */
/* 精确分数工具                                                        */
/* ------------------------------------------------------------------ */

function gcdBig(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function makeFrac(num, den) {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcdBig(num, den);
  return { num: num / g, den: den / g };
}

/**
 * 解析十进制数字串（允许前导符号、小数点），返回约分分数。
 * 不接受科学计数法。
 */
function parseDecimal(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^([+-]?)(?:(\d+)\.(\d+)|(\d+)\.?|\.(\d+))$/.exec(raw.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1n : 1n;
  const intPart = m[2] ?? m[4] ?? '';
  const fracPart = m[3] ?? m[5] ?? '';
  const den = 10n ** BigInt(fracPart.length);
  const num = (BigInt(intPart || '0') * den + BigInt(fracPart || '0')) * sign;
  if (num === 0n) return { num: 0n, den: 1n };
  return makeFrac(num, den);
}

/**
 * 将有限 JSON number 精确转为约分 BigInt 分数。
 *
 * Number#toString 的最短表示可能是科学计数法（如 1e-7、1.5e3），
 * 这里按指数做十进制位移构造分子 / 10 的幂分母，再统一约分，
 * 全程整数运算、不经浮点近似；故等值的 number 与十进制小数字符串
 * （如 1e-7 与 "0.0000001"）得到完全相同的分数。
 * 非 number / 非有限数值返回 null。
 * @param {*} raw
 * @returns {{num:bigint,den:bigint}|null}
 */
function numberToFrac(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(raw));
  if (!m) return null;
  const sign = m[1] === '-' ? -1n : 1n;
  const fracPart = m[3] ?? '';
  const digits = BigInt(`${m[2]}${fracPart}`);
  // 规范化指数：相对末位数字的实际小数点位移（含小数位数折算）
  const exp = (m[4] === undefined ? 0 : Number(m[4])) - fracPart.length;
  let num;
  let den;
  if (exp >= 0) {
    num = digits * 10n ** BigInt(exp);
    den = 1n;
  } else {
    num = digits;
    den = 10n ** BigInt(-exp);
  }
  if (num === 0n) return { num: 0n, den: 1n };
  return makeFrac(sign * num, den);
}

/**
 * 解析目标转速比：支持小数（12、12.5、0.0833）或形如 1/12 的分数。
 * 必须为正数。
 */
function parseTarget(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length !== 2) return null;
    const n = parseDecimal(parts[0]);
    const d = parseDecimal(parts[1]);
    if (!n || !d || n.num <= 0n || d.num <= 0n) return null;
    return makeFrac(n.num * d.den, n.den * d.num);
  }
  const v = parseDecimal(s);
  if (!v || v.num <= 0n) return null;
  return v;
}

/**
 * 解析允许相对误差：支持小数（0.01）或百分数（1%、0.5%），非负。
 * 返回分数 tol（相对误差 = |实际-目标| / 目标 <= tol）。
 */
function parseTolerance(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1).trim();
    if (!s) return null;
  }
  const v = parseDecimal(s);
  if (!v || v.num < 0n) return null;
  return percent ? makeFrac(v.num, v.den * 100n) : v;
}

/* ------------------------------------------------------------------ */
/* 编号自然序（G2 < G10）                                              */
/* ------------------------------------------------------------------ */

function naturalCmp(a, b) {
  const na = String(a);
  const nb = String(b);
  const re = /\d+|\D+/g;
  const ta = na.match(re) || [];
  const tb = nb.match(re) || [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const da = /^\d+$/.test(ta[i]);
    const db = /^\d+$/.test(tb[i]);
    if (da && db) {
      const da2 = ta[i].replace(/^0+/, '') || '0';
      const db2 = tb[i].replace(/^0+/, '') || '0';
      if (da2.length !== db2.length) return da2.length < db2.length ? -1 : 1;
      if (da2 !== db2) return da2 < db2 ? -1 : 1;
      if (ta[i] !== tb[i]) return ta[i] < tb[i] ? -1 : 1;
    } else {
      if (ta[i] !== tb[i]) return ta[i] < tb[i] ? -1 : 1;
    }
  }
  return ta.length - tb.length || (na < nb ? -1 : na > nb ? 1 : 0);
}

/* ------------------------------------------------------------------ */
/* 组合枚举：从 n 枚齿轮中选 2k 枚的全部组合（按索引升序）              */
/* ------------------------------------------------------------------ */

function* combinations(n, k) {
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  yield idx.slice();
  while (true) {
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    yield idx.slice();
  }
}

/**
 * 在给定 2k 枚齿轮（subset 为按索引升序的下标数组）上枚举全部“有向配对”。
 * 每枚齿轮恰好出现一次；每对按 (最小未用轮, 其它未用轮) 锚定，两个朝向
 * （谁主动/谁从动）都枚举，保证不重不漏。
 *
 * gears 已按编号自然序排序，因此锚点直接取剩余中的最小下标即可。
 *
 * 返回 [{ driveIndex, drivenIndex }] × k
 */
function* pairings(gears, subset) {
  const pair = new Array(subset.length / 2);

  function* rec(remaining, depth) {
    if (remaining.size === 0) {
      yield pair.slice();
      return;
    }
    // 剩余中下标最小者作为锚点（gears 已按编号自然序排列），
    // 消除“同一组对”的排列重复
    let anchor = -1;
    for (const gi of remaining) {
      if (anchor < 0 || gi < anchor) anchor = gi;
    }
    for (const partner of remaining) {
      if (partner === anchor) continue;
      const next = new Set(remaining);
      next.delete(anchor);
      next.delete(partner);
      pair[depth] = { driveIndex: anchor, drivenIndex: partner };
      yield* rec(next, depth + 1);
      pair[depth] = { driveIndex: partner, drivenIndex: anchor };
      yield* rec(next, depth + 1);
    }
  }

  yield* rec(new Set(subset), 0);
}

/* ------------------------------------------------------------------ */
/* 方案比较                                                            */
/* ------------------------------------------------------------------ */

/** 比较级序列 [[driveIndex, drivenIndex], ...]（索引序即齿轮编号自然序） */
function cmpIdxs(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x.driveIndex !== y.driveIndex) return x.driveIndex - y.driveIndex;
    if (x.drivenIndex !== y.drivenIndex) return x.drivenIndex - y.drivenIndex;
  }
  return 0;
}

/** 单台方案排序：级数最少 → 误差最小 → 齿轮编号序列自然序 */
function cmpSolutions(a, b) {
  if (a.stages !== b.stages) return a.stages - b.stages;
  const ea = a.error.num * b.error.den;
  const eb = b.error.num * a.error.den;
  if (ea !== eb) return ea < eb ? -1 : 1;
  return cmpIdxs(a.idxs, b.idxs);
}

/**
 * 将轻量方案（仅含齿轮下标）展开为带编号/齿数的富对象，供接口与前端展示。
 */
function enrichMatch(m, gears) {
  const pairs = m.idxs.map((p) => {
    const d = gears[p.driveIndex];
    const w = gears[p.drivenIndex];
    return {
      drive: { id: d.id, teeth: d.teeth },
      driven: { id: w.id, teeth: w.teeth },
      stageRatio: makeFrac(BigInt(d.teeth), BigInt(w.teeth)),
    };
  });
  // idxs 中每枚齿轮恰好出现一次（pairings 保证）；按下标升序收集，
  // 而 gears 已按编号自然序排列，即占用齿轮集合的自然序
  const gearIds = m.idxs
    .flatMap((p) => [p.driveIndex, p.drivenIndex])
    .sort((a, b) => a - b)
    .map((gi) => gears[gi].id);
  return {
    stages: m.stages,
    ratio: m.ratio,
    error: m.error,
    pairs,
    flatIds: pairs.map((p) => [p.drive.id, p.driven.id]),
    gearIds,
  };
}

/* ------------------------------------------------------------------ */
/* 主搜索                                                              */
/* ------------------------------------------------------------------ */

/**
 * 枚举全部达标方案（不截断、不排序）。
 * 批量装配必须基于完整枚举结果分配，不能使用 search() 截断后的前 300 条。
 *
 * @param {Array<{id:string,teeth:number}>} gears 现有齿轮（2~12 枚，编号唯一）
 * @param {{num:bigint,den:bigint}} target 目标输出转速比（正分数）
 * @param {{num:bigint,den:bigint}} tolerance 允许相对误差（非负分数）
 * @returns {Array<{stages:number,ratio:{num:bigint,den:bigint},error:object,idxs:Array<{driveIndex:number,drivenIndex:number}>}>}
 */
function enumerateMatches(gears, target, tolerance) {
  /** 规范化配对索引序列的去重集合（同一配对集合+朝向，仅级顺序不同，只保留一条） */
  const seen = new Set();
  /** @type {Array<{stages:number,error:{num:bigint,den:bigint}}>} */
  const matches = [];

  for (let k = 1; k <= MAX_STAGES; k++) {
    if (2 * k > gears.length) break;

    for (const subset of combinations(gears.length, 2 * k)) {
      for (const idxs of pairings(gears, subset)) {
        // 实际速比 = ∏ (主动齿/从动齿)，先用未约分的整数分子分母累计，
        // 达标判定全部走整数乘法不等式，避免对海量候选做 BigInt gcd
        let rn = 1n;
        let rd = 1n;
        for (const p of idxs) {
          rn *= BigInt(gears[p.driveIndex].teeth);
          rd *= BigInt(gears[p.drivenIndex].teeth);
        }

        // 相对误差 |r - t|/t = |rn*td - tn*rd| / (rd*tn)，达标条件
        // |...| * tolDen <= tolNum * tn * rd，全程整数乘法，无需约分
        const lhs = rn * target.den - target.num * rd;
        const abs = lhs < 0n ? -lhs : lhs;
        if (abs * tolerance.den > tolerance.num * target.num * rd) continue;

        // 至此方案达标：规范化级顺序（按主动轮下标升序，即编号自然序），
        // 使“仅级顺序不同”的方案归一
        idxs.sort((a, b) => a.driveIndex - b.driveIndex);

        // Number 位编码的去重键（k 前缀 + 每个级各占 4 位下标），
        // 齿轮 ≤ 12 枚，索引 < 16；无 BigInt 装箱与字符串开销
        let key = k;
        for (const p of idxs) key = (key << 4 | p.driveIndex) << 4 | p.drivenIndex;
        if (seen.has(key)) continue;
        seen.add(key);

        // 只对达标方案做约分；内部方案保持轻量（下标+分数），
        // 富对象延迟到最终展示前构造，降低 GC 压力。
        // 相对误差 = diff / (rd * tn)（makeFrac 内部约分）
        const ratio = makeFrac(rn, rd);
        const error = makeFrac(abs, rd * target.num);

        matches.push({ stages: k, ratio, error, idxs });
      }
    }
  }

  return matches;
}

/**
 * 单台搜索：枚举全部达标方案，按 级数 → 误差 → 编号序列 排序，最多返回前 RESULT_LIMIT 条。
 * @param {Array<{id:string,teeth:number}>} gears 现有齿轮（2~12 枚，编号唯一）
 * @param {{num:bigint,den:bigint}} target 目标输出转速比（正分数）
 * @param {{num:bigint,den:bigint}} tolerance 允许相对误差（非负分数）
 * @returns {{results:Array,total:number,truncated:boolean}}
 */
function search(gears, target, tolerance) {
  const matches = enumerateMatches(gears, target, tolerance);

  // 排序：级数最少 → 误差最小 → 齿轮编号序列（各级 主动,从动 依次比较）
  matches.sort(cmpSolutions);

  const total = matches.length;
  return {
    total,
    truncated: total > RESULT_LIMIT,
    // 仅展开实际返回的前若干条为富对象
    results: matches.slice(0, RESULT_LIMIT).map((m) => enrichMatch(m, gears)),
  };
}

/**
 * 校验并规范化输入齿轮列表。
 * @param {*} input
 * @param {{label?:string,min?:number,max?:number}} [opts]
 *        label 为齿轮类别名（用于错误提示），min/max 覆盖数量限制
 * @returns {{ok:true, gears:Array}|{ok:false,error:string}}
 */
function validateGears(input, opts = {}) {
  const label = opts.label || '齿轮';
  const min = opts.min ?? 2;
  const max = opts.max ?? MAX_GEARS;
  if (!Array.isArray(input)) return { ok: false, error: `${label}列表格式不正确` };
  if (input.length < min || input.length > max) {
    return { ok: false, error: `${label}数量需在 ${min}~${max} 枚之间（当前 ${input.length} 枚）` };
  }
  const gears = [];
  const ids = new Set();
  for (let i = 0; i < input.length; i++) {
    const row = input[i];
    if (!row || typeof row !== 'object') return { ok: false, error: `第 ${i + 1} 行${label}数据格式不正确` };
    const id = String(row.id ?? '').trim();
    if (!id) return { ok: false, error: `第 ${i + 1} 行缺少${label}编号` };
    if (ids.has(id)) return { ok: false, error: `${label}编号重复：${id}` };
    ids.add(id);
    const teeth = Number(row.teeth);
    if (!Number.isInteger(teeth) || teeth < MIN_TEETH || teeth > MAX_TEETH) {
      return { ok: false, error: `${label} ${id} 的齿数需为 ${MIN_TEETH}~${MAX_TEETH} 的整数` };
    }
    gears.push({ id, teeth });
  }
  // 按编号自然序排列，保证枚举与结果稳定
  gears.sort((a, b) => naturalCmp(a.id, b.id));
  return { ok: true, gears };
}

module.exports = {
  MAX_STAGES,
  MAX_GEARS,
  MIN_TEETH,
  MAX_TEETH,
  RESULT_LIMIT,
  search,
  enumerateMatches,
  enrichMatch,
  cmpSolutions,
  cmpIdxs,
  naturalCmp,
  makeFrac,
  parseDecimal,
  numberToFrac,
  parseTarget,
  parseTolerance,
  validateGears,
};
