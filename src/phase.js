'use strict';

/**
 * 装配校准（相位回零）算法（精确有理数 → 模同余，基于 BigInt）
 *
 * 已装好的 1～3 级外啮合齿轮传动：第 k 级主动齿数 z_k、从动齿数 w_k。
 * 输入轴（轴 1）每转 1 圈，各轴的有向转数按齿数连乘（外啮合每级反向）：
 *   s_1 = 1，s_{k+1} = −s_k · z_k / w_k（全程约分分数）
 *
 * 每个轴 i 上有一个初始标记相位 φ_i = p_i/q_i（0 ≤ φ_i < 1，约分）。
 * 输入轴再转严格正整数 N 圈时，轴 i 的标记相位变为 (φ_i + N·s_i) mod 1，
 * 所有轴标记同时回到零位 ⟺ 对每个轴 i：N·s_i + φ_i ∈ ℤ。
 *
 * 写 s_i = σ_i·a_i/b_i（σ_i = ±1，gcd(a_i,b_i)=1），φ_i = p_i/q_i（gcd=1）：
 *   N·σ_i·a_i/b_i + p_i/q_i ∈ ℤ
 *   ⟺ σ_i·a_i·q_i·N ≡ −p_i·b_i (mod b_i·q_i)
 * gcd(σ_i·a_i·q_i, b_i·q_i) = q_i，故单轴可解 ⟺ q_i | p_i·b_i ⟺ q_i | b_i；
 * 可解时两边约去 q_i：σ_i·a_i·N ≡ −p_i·(b_i/q_i) (mod b_i)，即
 *   N ≡ r_i (mod b_i)，r_i = −σ_i·p_i·(b_i/q_i)·a_i^{−1} mod b_i
 * （模恰为该轴每输入圈有向转数的分母 b_i，与相位分母 q_i 无关）。
 *
 * 多轴合并：广义中国剩余定理。两同余 N≡r₁ (mod m₁)、N≡r₂ (mod m₂)
 * 兼容 ⟺ r₁≡r₂ (mod gcd(m₁,m₂))；兼容时合并为 N≡R (mod lcm(m₁,m₂))。
 * 同余方程组有解 ⟺ 任意两两兼容，故无解时必存在具体的互斥轴对。
 *
 * 全部兼容时，合并同余 N≡R (mod M)（0≤R<M）给出全部整数解；
 * 候选为严格正整数圈，故最早圈数 = R>0 ? R : M
 * （R=0 表示 0 圈本已在零位，但“再转”必须为正，取周期 M）。
 */

const { makeFrac, parseDecimal, numberToFrac, MIN_TEETH, MAX_TEETH } = require('./search');

/** 级数范围 / 相位约分后分母上限（10¹²） */
const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MAX_PHASE_DEN = 1000000000000n;

function gcdBig(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/** 非负剩余：x mod m ∈ [0, m) */
function mod(x, m) {
  const r = x % m;
  return r < 0n ? r + m : r;
}

/** 模逆元：gcd(a, m) = 1 且 m > 1 时返回 a⁻¹ mod m ∈ [0, m) */
function modInverse(a, m) {
  let [oldR, r] = [mod(a, m), m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS, m);
}

function addFrac(a, b) {
  return makeFrac(a.num * b.den + b.num * a.den, a.den * b.den);
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
 * 解析初始标记相位：接受 JSON number 或字符串。JSON number 按其十进制写法
 * （含科学计数法，如 1e-7）精确构造约分分数；字符串支持分数 p/q
 * （p、q 为非负整数，q ≥ 1）或十进制小数。必须满足 0 ≤ 相位 < 1，
 * 约分后分母 ≤ 10¹²。
 * @returns {{ok:true,frac:object}|{ok:false,error:string}}
 */
function parsePhase(raw, label) {
  let frac;
  if (typeof raw === 'number') {
    frac = numberToFrac(raw);
    if (!frac) return { ok: false, error: `${label}需为有限数值` };
  } else if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return { ok: false, error: `${label}不能为空（零位请填 0）` };

    if (s.includes('/')) {
      const parts = s.split('/');
      if (parts.length !== 2 || !/^\d+$/.test(parts[0].trim()) || !/^\d+$/.test(parts[1].trim())) {
        return { ok: false, error: `${label}格式不正确：分数写法为 p/q（p、q 为非负整数，如 1/3）` };
      }
      const p = BigInt(parts[0].trim());
      const q = BigInt(parts[1].trim());
      if (q < 1n) return { ok: false, error: `${label}的分母需为正整数（当前 ${s}）` };
      if (p >= q) return { ok: false, error: `${label}需满足 0 ≤ p/q < 1（当前 ${s}）` };
      frac = makeFrac(p, q);
    } else {
      frac = parseDecimal(s);
      if (!frac) {
        return { ok: false, error: `${label}格式不正确：请填分数 p/q（如 1/3）或小数（如 0.5）` };
      }
      if (frac.num < 0n || frac.num >= frac.den) {
        return { ok: false, error: `${label}需满足 0 ≤ 相位 < 1（当前 ${s}）` };
      }
    }
  } else {
    return { ok: false, error: `${label}格式不正确：请填分数 p/q（如 1/3）或小数（如 0.5）` };
  }
  if (frac.num < 0n || frac.num >= frac.den) {
    return { ok: false, error: `${label}需满足 0 ≤ 相位 < 1` };
  }
  if (frac.den > MAX_PHASE_DEN) {
    return { ok: false, error: `${label}约分后的分母不能超过 10¹²` };
  }
  return { ok: true, frac };
}

/**
 * 校验全部请求参数：级数与齿数、各轴初始标记相位（级数+1 项）。
 * @param {*} body
 * @returns {{ok:true,stages:Array,phases:Array}|{ok:false,error:string}}
 */
function validatePhaseResetInput(body) {
  const input = body && typeof body === 'object' ? body : {};

  // ---- 级数与齿数 ----
  if (!Array.isArray(input.stages)) {
    return { ok: false, error: '级列表（stages）格式不正确' };
  }
  if (input.stages.length < MIN_STAGES || input.stages.length > MAX_STAGES) {
    return { ok: false, error: `级数需为 ${MIN_STAGES}～${MAX_STAGES} 级（当前 ${Array.isArray(input.stages) ? input.stages.length : 0} 级）` };
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

  // ---- 各轴初始标记相位（输入轴 + 各级输出轴） ----
  const axisCount = stages.length + 1;
  if (!Array.isArray(input.phases) || input.phases.length !== axisCount) {
    return {
      ok: false,
      error:
        `相位列表（phases）需恰好 ${axisCount} 项（输入轴 + ${stages.length} 级输出轴，` +
        `当前 ${Array.isArray(input.phases) ? input.phases.length : 0} 项）`,
    };
  }
  const phases = [];
  for (let i = 0; i < axisCount; i++) {
    const label = i === 0 ? '输入轴（轴 1）的初始标记相位' : `第 ${i} 级输出轴（轴 ${i + 1}）的初始标记相位`;
    const parsed = parsePhase(input.phases[i], label);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    phases.push(parsed.frac);
  }

  return { ok: true, stages, phases };
}

/**
 * 校准主入口：逐轴化模同余 → 广义 CRT 合并 → 最早圈数 / 冲突轴。
 *
 * @param {Array<{stage:number,driveTeeth:number,drivenTeeth:number}>} stages 已校验级列表
 * @param {Array<{num:bigint,den:bigint}>} phases 已校验相位（级数+1 项，0 ≤ φ < 1）
 */
function phaseReset(stages, phases) {
  const stageCount = stages.length;
  const axisCount = stageCount + 1;

  // 各级速比与各轴每输入 1 圈的有向转数（外啮合逐级反向）
  const stageRatios = stages.map((st) => makeFrac(BigInt(st.driveTeeth), BigInt(st.drivenTeeth)));
  const ratios = [makeFrac(1n, 1n)];
  for (const r of stageRatios) {
    const prev = ratios[ratios.length - 1];
    ratios.push(makeFrac(-prev.num * r.num, prev.den * r.den));
  }

  // 逐轴把“N·s + φ ∈ ℤ”化为模同余 N ≡ r (mod b)
  const axes = ratios.map((s, i) => {
    const phase = phases[i];
    const sigma = s.num < 0n ? -1n : 1n;
    const a = s.num < 0n ? -s.num : s.num;
    const b = s.den;
    const p = phase.num;
    const q = phase.den;
    const ax = {
      axis: i + 1,
      phase,
      ratio: s,
      solvable: false,
      residue: 0n,
      modulus: b,
      unsolvableReason: null,
      revolutions: null,
      phaseAfter: null,
    };
    // gcd(σ·a·q, b·q) = q，可解 ⟺ q | p·b ⟺ q | b（gcd(p,q)=1）
    if (b % q !== 0n) {
      ax.unsolvableReason =
        `初始相位分母 q=${q} 不能整除该轴每输入圈有向转数的分母 b=${b}` +
        `（同余 σ·a·q·N ≡ −p·b (mod b·q) 中 gcd(σ·a·q, b·q) = q = ${q} 不整除右端 −p·b），` +
        '任何整数圈都无法回零';
      return ax;
    }
    if (b === 1n) {
      // 每输入圈恰好转整数圈：任何 N 都满足（此时 q | 1，相位必为 0）
      ax.residue = 0n;
      ax.modulus = 1n;
    } else {
      // 约去 q：σ·a·N ≡ −p·(b/q) (mod b)，a 与 b 互素可逆
      const inv = modInverse(a, b);
      ax.residue = mod(-sigma * p * (b / q) * inv, b);
      ax.modulus = b;
    }
    ax.solvable = true;
    return ax;
  });

  // 合并全部单轴同余（非互素模按 gcd 判兼容、按 lcm 合并），逐步记录过程
  const mergeSteps = [];
  /** @type {{residue:bigint,modulus:bigint}|null} */
  let merged = null;
  for (const ax of axes) {
    if (!ax.solvable) continue;
    if (merged === null) {
      merged = { residue: ax.residue, modulus: ax.modulus };
      mergeSteps.push({
        step: 1,
        axis: ax.axis,
        action: 'start',
        residue: ax.residue,
        modulus: ax.modulus,
        mergedResidue: merged.residue,
        mergedModulus: merged.modulus,
        note: `轴 ${ax.axis} 的回零同余 N ≡ ${ax.residue} (mod ${ax.modulus})，作为合并起点`,
      });
      continue;
    }
    const g = gcdBig(merged.modulus, ax.modulus);
    const diff = ax.residue - merged.residue;
    const compatible = diff % g === 0n;
    const stepNo = mergeSteps.length + 1;
    if (!compatible) {
      mergeSteps.push({
        step: stepNo,
        axis: ax.axis,
        action: 'merge',
        residue: ax.residue,
        modulus: ax.modulus,
        priorResidue: merged.residue,
        priorModulus: merged.modulus,
        gcd: g,
        diff,
        compatible: false,
        mergedResidue: null,
        mergedModulus: null,
        note:
          `并入轴 ${ax.axis}：N ≡ ${ax.residue} (mod ${ax.modulus})；` +
          `与当前 N ≡ ${merged.residue} (mod ${merged.modulus}) 的模最大公约数 ` +
          `gcd(${merged.modulus}, ${ax.modulus}) = ${g}，余数差 ${diff} 不能被 ${g} 整除，` +
          `两同余互斥（轴 ${ax.axis} 与已合并轴的回零条件冲突）`,
      });
      break;
    }
    // N = R + M·t，(M/g)·t ≡ (r−R)/g (mod m/g)；合并模为 lcm = M·(m/g)
    const m2g = ax.modulus / g;
    let t = 0n;
    if (m2g !== 1n) {
      t = mod((diff / g) * modInverse(merged.modulus / g, m2g), m2g);
    }
    const lcm = merged.modulus * m2g;
    const next = { residue: mod(merged.residue + merged.modulus * t, lcm), modulus: lcm };
    mergeSteps.push({
      step: stepNo,
      axis: ax.axis,
      action: 'merge',
      residue: ax.residue,
      modulus: ax.modulus,
      priorResidue: merged.residue,
      priorModulus: merged.modulus,
      gcd: g,
      diff,
      compatible: true,
      mergedResidue: next.residue,
      mergedModulus: next.modulus,
      note:
        `并入轴 ${ax.axis}：N ≡ ${ax.residue} (mod ${ax.modulus})；` +
        `gcd(${merged.modulus}, ${ax.modulus}) = ${g}，余数差 ${diff} 可被 ${g} 整除，兼容；` +
        `按 lcm 合并为 N ≡ ${next.residue} (mod ${next.modulus})`,
    });
    merged = next;
  }

  // 全部两两互斥轴对（同余组有解 ⟺ 任意两两兼容，用于无解时定位冲突轴）
  const solvableAxes = axes.filter((ax) => ax.solvable);
  const conflictPairs = [];
  for (let i = 0; i < solvableAxes.length; i++) {
    for (let j = i + 1; j < solvableAxes.length; j++) {
      const A = solvableAxes[i];
      const B = solvableAxes[j];
      const g = gcdBig(A.modulus, B.modulus);
      if ((A.residue - B.residue) % g !== 0n) {
        conflictPairs.push({
          axisA: A.axis,
          axisB: B.axis,
          residueA: A.residue,
          modulusA: A.modulus,
          residueB: B.residue,
          modulusB: B.modulus,
          gcd: g,
        });
      }
    }
  }

  const unsolvableAxes = axes.filter((ax) => !ax.solvable).map((ax) => ax.axis);
  const conflictSet = new Set(unsolvableAxes);
  for (const cp of conflictPairs) {
    conflictSet.add(cp.axisA);
    conflictSet.add(cp.axisB);
  }
  const conflictAxes = [...conflictSet].sort((x, y) => x - y);

  const solvable = unsolvableAxes.length === 0 && conflictPairs.length === 0;

  let reason;
  let earliestTurns = null;
  let period = null;
  let residue = null;
  if (solvable) {
    reason = 'ok';
    residue = merged.residue;
    period = merged.modulus;
    // 候选为严格正整数圈：余数为 0 时取周期本身
    earliestTurns = residue === 0n ? period : residue;
    for (const ax of axes) {
      ax.revolutions = makeFrac(earliestTurns * ax.ratio.num, ax.ratio.den);
      ax.phaseAfter = addFrac(ax.phase, ax.revolutions); // 必为整数（分母 1）
    }
  } else if (unsolvableAxes.length > 0 && conflictPairs.length > 0) {
    reason = 'mixed';
  } else if (unsolvableAxes.length > 0) {
    reason = 'axis';
  } else {
    reason = 'conflict';
  }

  const message = buildMessage({
    solvable,
    earliestTurns,
    period,
    residue,
    unsolvableAxes,
    conflictPairs,
  });

  return {
    stageCount,
    axisCount,
    stages,
    stageRatios,
    axes,
    mergeSteps,
    solvable,
    reason,
    earliestTurns,
    period,
    residue,
    unsolvableAxes,
    conflictPairs,
    conflictAxes,
    message,
  };
}

function buildMessage(ctx) {
  const { solvable, earliestTurns, period, residue, unsolvableAxes, conflictPairs } = ctx;

  if (solvable) {
    const extra =
      residue === 0n
        ? '各轴同余合并后余数为 0（0 圈本已在零位），按“再转严格正整数圈”取最小正解即周期本身。'
        : '';
    return (
      `全部轴可同时回零：合并同余为 N ≡ ${residue} (mod ${period})，` +
      `严格正整数圈中的最早解为 ${earliestTurns} 圈——输入轴再转 ${earliestTurns} 圈时，` +
      `各轴标记相位均回到零位；之后每 ${period} 圈再次同时回零。${extra}`
    );
  }

  const parts = [];
  if (unsolvableAxes.length > 0) {
    const list = unsolvableAxes.map((a) => `轴 ${a}`).join('、');
    parts.push(
      `${list} 在任何整数圈下都无法回零：其初始相位分母不能整除该轴每输入圈有向转数的分母（详见逐轴同余表）`,
    );
  }
  if (conflictPairs.length > 0) {
    const list = conflictPairs.map((cp) => `轴 ${cp.axisA} 与轴 ${cp.axisB}`).join('、');
    parts.push(
      `${list} 的回零同余互斥（模不互素且余数在模 gcd 下不同），不存在同时满足的整数圈数`,
    );
  }
  return (
    `无法同时回零：${parts.join('；')}。` +
    '可重新调整相关轴的初始标记相位（装配时对零）或更换齿数后再校准。'
  );
}

module.exports = {
  MIN_STAGES,
  MAX_STAGES,
  MAX_PHASE_DEN,
  validatePhaseResetInput,
  phaseReset,
};
