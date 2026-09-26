'use strict';

/**
 * 转速异常定位算法（精确分数计算，基于 BigInt）
 *
 * 录入已装好的 1～3 级齿轮传动（每级主动 / 从动齿数）与多次观测：
 * 每次观测在**同一时段**记录若干轴的转数与每个读数的绝对误差（读数值 ± 误差），
 * 每次至少包含输入轴（轴 1）与输出轴（轴 n+1），允许缺少中间轴，同一观测内
 * 同一轴不得重复记录。
 *
 * 由齿数精确计算理论速比（输出 / 输入 = ∏ 主动齿 / 从动齿），再把每个读数的
 * 绝对误差区间通过分数四则运算转换为任意两观测轴之间轴段的**实测速比区间**：
 *
 *   轴 a → 轴 b：理论速比 T = P[b-1] / P[a-1]（P 为逐级累积分率）
 *   实测区间 L = (N_b−e_b)/(N_a+e_a)，H = (N_b+e_b)/(N_a−e_a)
 *
 * 诊断假设：**至多一级**存在跨观测恒定的倍率偏差 m（实测 = m × 理论，m 为正）。
 * 逐级求可行倍率区间：
 *   - 包含第 k 级的轴段：要求 m ∈ [L/T, H/T]，跨全部观测取交集；
 *   - 不包含第 k 级的轴段：必须与理论速比相符（T ∈ [L,H]），即交叉核对。
 * 只要还有一个轴段的实测区间覆盖理论值，正常倍率 m = 1 就不能被排除，
 * 此时保留不确定性，按“传动正常”处理，不凭首末轴读数指认任何级位。
 *
 * 结论区分：
 *   verdict 'normal'      ：全部轴段区间覆盖理论值，传动正常（保留误差不确定性）；
 *   verdict 'suspect'     ：恰好一级可行，给出该级与跨观测恒定倍率区间；
 *   verdict 'ambiguous'   ：多级均可单独解释全部观测，现有数据无法区分
 *                           （仅有首末轴读数时各级区间完全相同，绝不强行指认）；
 *   verdict 'inconsistent'：没有任何一级能以恒定倍率解释全部观测，
 *                           与“单级恒定偏差”假设不符。
 */

const { makeFrac, parseDecimal, numberToFrac, MIN_TEETH, MAX_TEETH } = require('./search');

/** 级数 / 观测次数范围 */
const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MIN_OBSERVATIONS = 1;
const MAX_OBSERVATIONS = 20;
/** 转数 / 误差的上限（正数，10¹²） */
const MAX_AMOUNT = 1000000000000n;

/** 分数比较：a<b → -1，a=b → 0，a>b → 1 */
function cmpFrac(a, b) {
  const lhs = a.num * b.den;
  const rhs = b.num * a.den;
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

function addFrac(a, b) {
  return makeFrac(a.num * b.den + b.num * a.den, a.den * b.den);
}

function subFrac(a, b) {
  return makeFrac(a.num * b.den - b.num * a.den, a.den * b.den);
}

/** a / b（均为正分数） */
function divFrac(a, b) {
  return makeFrac(a.num * b.den, a.den * b.num);
}

/**
 * 解析正整数字段（齿数 / 轴号）：接受 JSON number 或纯数字字符串。
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
 * 解析非负 / 正的十进制数量（转数、绝对误差）：接受有限 JSON number 或
 * 十进制字符串。JSON number 按其十进制写法（含科学计数法，如 1e-7）
 * 精确构造约分分数；字符串仅接受十进制小数（不接受科学计数法 / 分数）。
 * @returns {{ok:true,frac:object}|{ok:false,error:string}}
 */
function parseAmount(raw, label, { positive }) {
  let frac;
  let display;
  if (typeof raw === 'number') {
    frac = numberToFrac(raw);
    if (!frac) return { ok: false, error: `${label}需为有限数值` };
    display = String(raw);
  } else if (typeof raw === 'string') {
    const s = raw.trim();
    frac = parseDecimal(s);
    display = s;
    if (!frac) return { ok: false, error: `${label}格式不正确：请输入十进制数值（如 3600、12.5）` };
  } else {
    return { ok: false, error: `${label}需为正数（可带小数）` };
  }
  if (positive ? frac.num <= 0n : frac.num < 0n) {
    return { ok: false, error: positive ? `${label}必须为正数（当前为 ${display}）` : `${label}不能为负数（当前为 ${display}）` };
  }
  if (frac.num > MAX_AMOUNT * frac.den) {
    return { ok: false, error: `${label}不能超过 10¹²` };
  }
  return { ok: true, frac };
}

/**
 * 校验全部请求参数：级数与齿数、多次观测的轴号 / 转数 / 绝对误差。
 * @param {*} body
 * @returns {{ok:true,stages:Array,observations:Array}|{ok:false,error:string}}
 */
function validateDiagnoseInput(body) {
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

  // ---- 观测 ----
  const axisCount = stages.length + 1;
  if (!Array.isArray(input.observations)) {
    return { ok: false, error: '观测列表（observations）格式不正确' };
  }
  if (input.observations.length < MIN_OBSERVATIONS || input.observations.length > MAX_OBSERVATIONS) {
    return { ok: false, error: `观测次数需为 ${MIN_OBSERVATIONS}～${MAX_OBSERVATIONS} 次（当前 ${Array.isArray(input.observations) ? input.observations.length : 0} 次）` };
  }

  const observations = [];
  for (let oi = 0; oi < input.observations.length; oi++) {
    const ob = input.observations[oi];
    const tag = `第 ${oi + 1} 次观测`;
    if (!ob || typeof ob !== 'object') {
      return { ok: false, error: `${tag}数据格式不正确` };
    }
    const name = String(ob.name ?? '').trim();
    if (name.length > 30) {
      return { ok: false, error: `${tag}名称不能超过 30 个字符` };
    }
    if (!Array.isArray(ob.readings) || ob.readings.length === 0) {
      return { ok: false, error: `${tag}至少需要输入轴与输出轴两条读数` };
    }

    const readings = [];
    const seenAxes = new Set();
    for (let ri = 0; ri < ob.readings.length; ri++) {
      const row = ob.readings[ri];
      if (!row || typeof row !== 'object') {
        return { ok: false, error: `${tag}第 ${ri + 1} 条读数格式不正确` };
      }
      const axis = parsePositiveInt(row.axis, `${tag}读数的轴号`, axisCount);
      if (!axis.ok) {
        return { ok: false, error: `${tag}第 ${ri + 1} 条读数的轴号需为 1～${axisCount} 的整数` };
      }
      if (seenAxes.has(axis.value)) {
        return { ok: false, error: `${tag}轴 ${axis.value} 的转数重复记录：同一观测中每个轴只能记录一次` };
      }
      seenAxes.add(axis.value);

      const rev = parseAmount(row.revolutions, `${tag}轴 ${axis.value} 的转数`, { positive: true });
      if (!rev.ok) return { ok: false, error: rev.error };

      const err = parseAmount(row.error, `${tag}轴 ${axis.value} 读数的绝对误差`, { positive: false });
      if (!err.ok) return { ok: false, error: err.error };

      // 误差区间 [N−e, N+e] 覆盖零值（含恰好到 0）时无法计算正的速比区间
      if (cmpFrac(err.frac, rev.frac) >= 0) {
        return {
          ok: false,
          error:
            `${tag}轴 ${axis.value} 的绝对误差不小于转数本身` +
            `（转数区间下沿 ≤ 0，覆盖零值），无法计算速比区间：请核对读数与误差`,
        };
      }
      readings.push({ axis: axis.value, revolutions: rev.frac, error: err.frac });
    }

    if (!seenAxes.has(1)) {
      return { ok: false, error: `${tag}缺少输入轴（轴 1）同一时段的转数读数` };
    }
    if (!seenAxes.has(axisCount)) {
      return { ok: false, error: `${tag}缺少输出轴（轴 ${axisCount}）同一时段的转数读数` };
    }

    readings.sort((a, b) => a.axis - b.axis);
    observations.push({ name, readings });
  }

  return { ok: true, stages, observations };
}

/**
 * 诊断主入口。
 *
 * @param {Array<{stage:number,driveTeeth:number,drivenTeeth:number}>} stages 已校验级列表
 * @param {Array<{name:string,readings:Array<{axis:number,revolutions:object,error:object}>}>} observations 已校验观测
 */
function diagnose(stages, observations) {
  const stageCount = stages.length;
  const axisCount = stageCount + 1;
  const ONE = makeFrac(1n, 1n);

  // 逐级理论速比与累积分率 P[k] = 轴 k+1 相对轴 1 的理论转速比，P[0] = 1
  const stageRatios = stages.map((st) =>
    makeFrac(BigInt(st.driveTeeth), BigInt(st.drivenTeeth)));
  const prefix = [ONE];
  for (const r of stageRatios) {
    const prev = prefix[prefix.length - 1];
    prefix.push(makeFrac(prev.num * r.num, prev.den * r.den));
  }
  const theoryOf = (a, b) =>
    makeFrac(prefix[b - 1].num * prefix[a - 1].den, prefix[b - 1].den * prefix[a - 1].num);

  // 每次观测内对全部“已记录轴对”生成轴段实测速比区间（不限于相邻轴，
  // 以便用不含某级的轴段交叉核对该级）
  const obsData = observations.map((ob, oi) => {
    const byAxis = new Map(ob.readings.map((rd) => [rd.axis, rd]));
    const axes = ob.readings.map((rd) => rd.axis); // 已按轴号升序
    const segments = [];
    for (let ii = 0; ii < axes.length; ii++) {
      for (let jj = ii + 1; jj < axes.length; jj++) {
        const a = axes[ii];
        const b = axes[jj];
        const ra = byAxis.get(a);
        const rb = byAxis.get(b);
        // L = (N_b−e_b)/(N_a+e_a)，H = (N_b+e_b)/(N_a−e_a)
        const low = divFrac(subFrac(rb.revolutions, rb.error), addFrac(ra.revolutions, ra.error));
        const high = divFrac(addFrac(rb.revolutions, rb.error), subFrac(ra.revolutions, ra.error));
        const theory = theoryOf(a, b);
        const normal = cmpFrac(low, theory) <= 0 && cmpFrac(theory, high) <= 0;
        segments.push({
          observationIndex: oi,
          fromAxis: a,
          toAxis: b,
          low,
          high,
          theory,
          normal,
        });
      }
    }
    return { name: ob.name, readings: ob.readings, axes, segments };
  });

  const allSegments = obsData.flatMap((o) => o.segments);
  const segRef = (s) => ({
    observation: s.observationIndex + 1,
    observationName: obsData[s.observationIndex].name,
    fromAxis: s.fromAxis,
    toAxis: s.toAxis,
  });
  const normalOverall = allSegments.every((s) => s.normal);
  const endAxesOnly = obsData.every((o) => o.axes.length === 2);

  // 逐级求恒定倍率 m 的可行区间
  const candidates = stages.map((st, k) => {
    const stageNo = k + 1;
    /** @type {object|null} */
    let lo = null;
    /** @type {object|null} */
    let hi = null;
    /** @type {Array} */
    const crossCheckFailed = [];

    for (const s of allSegments) {
      // 轴段 a→b 包含第 k 级当且仅当 a ≤ k < b（级编号 1..n，轴 a 与轴 a+1 之间）
      const includes = s.fromAxis <= stageNo && stageNo < s.toAxis;
      if (includes) {
        // m ∈ [L/T, H/T]
        const mLo = divFrac(s.low, s.theory);
        const mHi = divFrac(s.high, s.theory);
        if (lo === null || cmpFrac(mLo, lo) > 0) lo = mLo;
        if (hi === null || cmpFrac(mHi, hi) < 0) hi = mHi;
      } else if (!s.normal) {
        crossCheckFailed.push(segRef(s));
      }
    }

    // 每次观测都含首末轴，故整体轴段必然包含每一级，lo/hi 必非空
    const intersectionNonEmpty = cmpFrac(lo, hi) <= 0;
    const containsUnity =
      intersectionNonEmpty && cmpFrac(lo, ONE) <= 0 && cmpFrac(ONE, hi) <= 0;
    let direction = null;
    if (intersectionNonEmpty) {
      if (cmpFrac(hi, ONE) < 0) direction = 'below';
      else if (cmpFrac(lo, ONE) > 0) direction = 'above';
    }
    return {
      stage: stageNo,
      feasible: intersectionNonEmpty && crossCheckFailed.length === 0,
      intersectionNonEmpty,
      factorLow: lo,
      factorHigh: hi,
      containsUnity,
      direction,
      crossCheckFailed,
    };
  });

  // 汇总结论
  let verdict;
  let suspectStage = null;
  const feasibleStages = candidates.filter((c) => c.feasible).map((c) => c.stage);

  if (normalOverall) {
    verdict = 'normal';
  } else if (feasibleStages.length === 0) {
    verdict = 'inconsistent';
  } else if (feasibleStages.length === 1) {
    verdict = 'suspect';
    suspectStage = feasibleStages[0];
  } else {
    verdict = 'ambiguous';
  }

  const abnormalSegments = allSegments.filter((s) => !s.normal).map(segRef);
  const message = buildMessage({
    verdict,
    stages,
    stageCount,
    axisCount,
    observationCount: observations.length,
    candidates,
    feasibleStages,
    suspectStage,
    endAxesOnly,
    abnormalSegments,
  });

  return {
    stageCount,
    axisCount,
    observationCount: observations.length,
    stages,
    stageRatios,
    shaftRatios: prefix,
    observations: obsData,
    segments: allSegments,
    verdict,
    normal: normalOverall,
    candidates,
    feasibleStages,
    suspectStage,
    endAxesOnly,
    abnormalSegments,
    message,
  };
}

function stageLabel(stages, stageNo) {
  const st = stages[stageNo - 1];
  return `第 ${stageNo} 级（主动 ${st.driveTeeth} 齿 / 从动 ${st.drivenTeeth} 齿，理论本级速比 ${st.driveTeeth}/${st.drivenTeeth}）`;
}

function buildMessage(ctx) {
  const {
    verdict,
    axisCount,
    observationCount,
    candidates,
    feasibleStages,
    suspectStage,
    endAxesOnly,
    abnormalSegments,
    stages,
  } = ctx;

  if (verdict === 'normal') {
    return (
      `传动正常：${observationCount} 次观测中全部轴段的实测速比区间` +
      '（由“读数 ± 绝对误差”精确换算）均覆盖按齿数算出的理论速比。' +
      '即使某级存在倍率偏差，其取值仍与正常倍率 1 无法区分，按传动正常处理并保留该不确定性；' +
      '不凭单次首末轴读数指认具体级位。'
    );
  }

  if (verdict === 'suspect') {
    const c = candidates[suspectStage - 1];
    const dir =
      c.direction === 'above'
        ? '区间整体大于正常倍率 1，该级实测转速相对理论偏快'
        : c.direction === 'below'
          ? '区间整体小于正常倍率 1，该级实测转速相对理论偏慢'
          : '区间仍包含正常倍率 1，不能确认为异常，仅保留倍率范围的不确定性';
    return (
      `可疑级位：${stageLabel(stages, suspectStage)}。` +
      '不含该级的其余轴段实测区间均与理论速比相符（交叉核对通过），' +
      `而含该级的轴段跨 ${observationCount} 次观测共同要求恒定倍率 m ∈ [下限, 上限]（见下表）；${dir}。` +
      '其余级位均因倍率区间无交集或交叉核对失败而被排除。'
    );
  }

  if (verdict === 'ambiguous') {
    const list = feasibleStages.map((s) => `第 ${s} 级`).join('、');
    let extra = '';
    if (endAxesOnly) {
      extra =
        `各次观测均只记录了输入轴与输出轴（轴 1 与轴 ${axisCount}），` +
        '所有级位的倍率区间必然完全相同——不能仅凭首末轴读数指认具体级位。';
    }
    return (
      `多个级位无法区分：${list}均能以各自跨观测恒定的倍率区间单独解释全部观测数据，` +
      '现有观测不足以唯一定位异常级位（各级可行倍率范围见下表）。' +
      extra +
      '建议在同一时段补测相关中间轴（尤其是区间重叠各级之间的轴）的转数与误差后再诊断。'
    );
  }

  // inconsistent
  const refs = abnormalSegments
    .map((s) => `第 ${s.observation} 次观测轴 ${s.fromAxis}→${s.toAxis}`)
    .join('、');
  return (
    '与单级恒定偏差假设不符：不存在任何一级，能以一个跨观测恒定的倍率同时满足全部轴段的实测区间。' +
    `共 ${abnormalSegments.length} 个轴段实测区间偏离理论值（${refs}），` +
    '且逐级倍率区间或交叉核对均无法兼容——异常可能同时分布在多级、倍率随工况（观测）变化，' +
    '或部分读数的绝对误差被低估。请补测 / 复核同一时段各轴转数后再判断。'
  );
}

module.exports = {
  MIN_STAGES,
  MAX_STAGES,
  MIN_OBSERVATIONS,
  MAX_OBSERVATIONS,
  validateDiagnoseInput,
  diagnose,
};
