'use strict';

const path = require('path');
const express = require('express');
const {
  search,
  parseTarget,
  parseTolerance,
  validateGears,
  MAX_STAGES,
  MAX_GEARS,
} = require('./search');
const { planBatch } = require('./batch');
const {
  planProcure,
  validateBuyableGears,
  MIN_EXISTING,
  MAX_EXISTING,
  MAX_TOTAL_GEARS,
} = require('./procure');
const { planDualSpeed, MIN_GEARS: MIN_DUAL_GEARS } = require('./dual');
const { validateTorqueGears, parsePositiveInt, MAX_TORQUE } = require('./torque');
const { TorqueComputeQueue, MAX_WAITING: MAX_TORQUE_WAITING, TaskCancelled } = require('./torque-queue');
const {
  planLayout,
  parseAxes,
  parseModule,
  MIN_AXES,
  MAX_AXES,
  MAX_MODULE,
} = require('./layout');
const { validateDiagnoseInput, diagnose, MAX_OBSERVATIONS } = require('./diagnose');
const {
  validatePhaseResetInput,
  phaseReset,
  MAX_STAGES: MAX_PHASE_STAGES,
} = require('./phase');
const {
  validateResonanceInput,
  planResonance,
  MAX_STAGES: MAX_RESONANCE_STAGES,
  MAX_FORBIDDEN,
  MAX_RPM: MAX_RESONANCE_RPM,
} = require('./resonance');
const {
  validateLifetimeInput,
  planLifetime,
  MAX_INPUT_TURNS,
  MAX_REMAINING,
} = require('./lifetime');
const {
  validateBacklashInput,
  planBacklash,
  MAX_STAGES: MAX_BACKLASH_STAGES,
} = require('./backlash');
const {
  validateReciprocateInput,
  planReciprocate,
  MAX_SEGMENTS,
} = require('./reciprocate');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

/** 带载计算调度器：完整枚举与级序校核在独立 worker 线程中执行，主线程不被阻塞 */
const torqueQueue = new TorqueComputeQueue();

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/** 友好访问批量装配页：/batch → /batch.html */
app.get('/batch', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'batch.html'));
});

/** 友好访问缺齿补货采购建议页：/procure → /procure.html */
app.get('/procure', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'procure.html'));
});

/** 友好访问双档换速页：/dual-speed → /dual-speed.html */
app.get('/dual-speed', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dual-speed.html'));
});

/** 友好访问带载安全选配页：/torque → /torque.html */
app.get('/torque', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'torque.html'));
});

/** 友好访问轴位装配页：/layout → /layout.html */
app.get('/layout', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'layout.html'));
});

/** 友好访问转速异常定位页：/diagnose → /diagnose.html */
app.get('/diagnose', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'diagnose.html'));
});

/** 友好访问装配校准页：/phase-reset → /phase-reset.html */
app.get('/phase-reset', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'phase-reset.html'));
});

/** 友好访问共振避让转速页：/resonance → /resonance.html */
app.get('/resonance', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'resonance.html'));
});

/** 友好访问双档寿命核算页：/lifetime → /lifetime.html */
app.get('/lifetime', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'lifetime.html'));
});

/** 友好访问反向空程预算页：/backlash → /backlash.html */
app.get('/backlash', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'backlash.html'));
});

/** 友好访问往复运动回放页：/reciprocate → /reciprocate.html */
app.get('/reciprocate', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'reciprocate.html'));
});

/** BigInt 分数安全转为有限小数（用于前端展示） */
function fracToDecimal(frac, digits = 10) {
  const neg = frac.num < 0n;
  let num = frac.num < 0n ? -frac.num : frac.num;
  const intPart = num / frac.den;
  let rem = num % frac.den;
  let out = intPart.toString();
  if (digits > 0) {
    let fracStr = '';
    for (let i = 0; i < digits && rem > 0n; i++) {
      rem *= 10n;
      fracStr += (rem / frac.den).toString();
      rem %= frac.den;
    }
    if (fracStr) out += `.${fracStr}`;
  }
  return neg ? `-${out}` : out;
}

function serializeFrac(f) {
  return { num: f.num.toString(), den: f.den.toString(), decimal: fracToDecimal(f) };
}

function serializeSolution(r) {
  return {
    stages: r.stages,
    ratio: serializeFrac(r.ratio),
    error: serializeFrac(r.error),
    errorPercent: fracToDecimal({ num: r.error.num * 100n, den: r.error.den }, 6),
    pairs: r.pairs.map((p) => ({
      drive: p.drive,
      driven: p.driven,
      stageRatio: serializeFrac(p.stageRatio),
    })),
  };
}

/** 带载方案：每级两轮的承受扭矩（分数 + 小数）与正整数额定扭矩一并序列化 */
function serializeTorqueGear(g) {
  return {
    id: g.id,
    teeth: g.teeth,
    ratedTorque: g.ratedTorque,
    torque: serializeFrac(g.torque),
    atLimit: g.torque.num === BigInt(g.ratedTorque) * g.torque.den,
  };
}

function serializeTorqueSolution(r) {
  return {
    stages: r.stages,
    ratio: serializeFrac(r.ratio),
    error: serializeFrac(r.error),
    errorPercent: fracToDecimal({ num: r.error.num * 100n, den: r.error.den }, 6),
    pairs: r.pairs.map((p) => ({
      inputTorque: serializeFrac(p.inputTorque),
      drive: serializeTorqueGear(p.drive),
      driven: serializeTorqueGear(p.driven),
      stageRatio: serializeFrac(p.stageRatio),
    })),
  };
}

/** 轴位装配：逐轴安装的单个齿轮位（含同轴固定的角色说明） */
function serializeShaftMount(m) {
  return {
    stage: m.stage,
    role: m.role,
    gear: { id: m.gear.id, teeth: m.gear.teeth },
  };
}

/** 轴位装配方案：逐级啮合明细 + 逐轴安装明细 */
function serializeLayoutSolution(r) {
  return {
    stages: r.stages,
    ratio: serializeFrac(r.ratio),
    error: serializeFrac(r.error),
    errorPercent: fracToDecimal({ num: r.error.num * 100n, den: r.error.den }, 6),
    pairs: r.pairs.map((p) => ({
      stage: p.stage,
      fromAxis: p.fromAxis,
      toAxis: p.toAxis,
      dx: p.dx,
      dy: p.dy,
      axisDistance: p.axisDistance,
      requiredTeethSum: p.requiredTeethSum,
      drive: p.drive,
      driven: p.driven,
      stageRatio: serializeFrac(p.stageRatio),
    })),
    shafts: r.shafts.map((s) => ({
      axis: s.axis,
      x: s.x,
      y: s.y,
      mounts: s.mounts.map(serializeShaftMount),
    })),
    unusedGears: r.unusedGears,
  };
}

/** 装配校准：逐轴同余 / 转数序列化（BigInt → 字符串，分数 → num/den/decimal） */
function serializePhaseAxis(ax) {
  return {
    axis: ax.axis,
    role: ax.axis === 1 ? '输入轴' : `第 ${ax.axis - 1} 级输出轴`,
    phase: serializeFrac(ax.phase),
    ratioPerInputTurn: serializeFrac(ax.ratio),
    solvable: ax.solvable,
    unsolvableReason: ax.unsolvableReason,
    congruence: ax.solvable
      ? { residue: ax.residue.toString(), modulus: ax.modulus.toString() }
      : null,
    revolutions: ax.revolutions ? serializeFrac(ax.revolutions) : null,
    phaseAfter: ax.phaseAfter ? serializeFrac(ax.phaseAfter) : null,
  };
}

/** 装配校准：同余合并步骤序列化（BigInt → 字符串） */
function serializeMergeStep(st) {
  return {
    step: st.step,
    axis: st.axis,
    action: st.action,
    residue: st.residue.toString(),
    modulus: st.modulus.toString(),
    priorResidue: st.priorResidue != null ? st.priorResidue.toString() : null,
    priorModulus: st.priorModulus != null ? st.priorModulus.toString() : null,
    gcd: st.gcd != null ? st.gcd.toString() : null,
    diff: st.diff != null ? st.diff.toString() : null,
    compatible: st.compatible ?? null,
    mergedResidue: st.mergedResidue != null ? st.mergedResidue.toString() : null,
    mergedModulus: st.mergedModulus != null ? st.mergedModulus.toString() : null,
    note: st.note,
  };
}

/**
 * 校验装置/档位参数列表（目标速比 / 容差 / 名称）。
 * @param {*} input
 * @param {{min?:number,max?:number,unit?:string,defaultNamePrefix?:string}} [opts]
 * @returns {{ok:true,devices:Array}|{ok:false,status?:number,error:string}}
 */
function parseDevices(input, { min = 2, max = 3, unit = '台装置', defaultNamePrefix = '装置' } = {}) {
  if (!Array.isArray(input) || input.length < min || input.length > max) {
    return { ok: false, error: `需输入 ${min}${min === max ? '' : `～${max}`} ${unit}` };
  }
  const devices = [];
  for (let i = 0; i < input.length; i++) {
    const row = input[i];
    if (!row || typeof row !== 'object') {
      return { ok: false, error: `第 ${i + 1} ${unit}数据格式不正确` };
    }
    const target = parseTarget(String(row.target ?? ''));
    if (!target) {
      return {
        ok: false,
        error: `第 ${i + 1} ${unit}的目标输出转速比格式不正确：请输入正数（如 0.0833、1/12）`,
      };
    }
    const tolerance = parseTolerance(String(row.tolerance ?? ''));
    if (!tolerance) {
      return {
        ok: false,
        error: `第 ${i + 1} ${unit}的允许相对误差格式不正确：请输入非负数（如 0.05 或 5%）`,
      };
    }
    const name = String(row.name ?? '').trim() || `${defaultNamePrefix} ${i + 1}`;
    if (name.length > 30) {
      return { ok: false, error: `第 ${i + 1} ${unit}名称不能超过 30 个字符` };
    }
    devices.push({ name, target, tolerance });
  }
  return { ok: true, devices };
}

app.post('/api/search', (req, res) => {
  const body = req.body || {};

  const target = parseTarget(String(body.target ?? ''));
  if (!target) {
    return res.status(400).json({ error: '目标输出转速比格式不正确：请输入正数（如 0.0833、1/12）' });
  }

  const tolerance = parseTolerance(String(body.tolerance ?? ''));
  if (!tolerance) {
    return res.status(400).json({ error: '允许相对误差格式不正确：请输入非负数（如 0.05 或 5%）' });
  }

  const checked = validateGears(body.gears);
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  const { total, truncated, results } = search(checked.gears, target, tolerance);

  res.json({
    target: serializeFrac(target),
    tolerance: serializeFrac(tolerance),
    maxStages: MAX_STAGES,
    total,
    truncated,
    count: results.length,
    results: results.map(serializeSolution),
  });
});

app.post('/api/batch', (req, res) => {
  const body = req.body || {};

  const checked = validateGears(body.gears);
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  const parsed = parseDevices(body.devices, { min: 2, max: 3 });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const devices = parsed.devices;

  // 基于全部达标方案分配（不截断 300 条）
  const plan = planBatch(checked.gears, devices);

  const usedIds = new Set();
  for (const pick of plan.picks) {
    if (pick) for (const id of pick.gearIds) usedIds.add(id);
  }
  const unusedGears = checked.gears.filter((g) => !usedIds.has(g.id));

  res.json({
    maxStages: MAX_STAGES,
    deviceCount: devices.length,
    matchedCount: plan.matchedCount,
    totalStages: plan.totalStages,
    errorSum: serializeFrac(plan.errorSum),
    errorSumPercent: fracToDecimal({ num: plan.errorSum.num * 100n, den: plan.errorSum.den }, 6),
    unusedGears,
    devices: devices.map((d, i) => ({
      name: d.name,
      target: serializeFrac(d.target),
      tolerance: serializeFrac(d.tolerance),
      totalMatches: plan.totalMatches[i],
      candidateCount: plan.candidateCounts[i],
      matched: !!plan.picks[i],
      solution: plan.picks[i] ? serializeSolution(plan.picks[i]) : null,
    })),
  });
});

app.post('/api/procure', (req, res) => {
  const body = req.body || {};

  // 现有齿轮：2～8 枚
  const existingChecked = validateGears(body.existingGears, {
    label: '现有齿轮',
    min: MIN_EXISTING,
    max: MAX_EXISTING,
  });
  if (!existingChecked.ok) return res.status(400).json({ error: existingChecked.error });

  // 可购实物齿轮：1～4 枚，带非负整数价格
  const buyableChecked = validateBuyableGears(body.buyableGears);
  if (!buyableChecked.ok) return res.status(400).json({ error: buyableChecked.error });

  // 跨列表编号不得重复；合计不超过 12 枚
  const existingIds = new Set(existingChecked.gears.map((g) => g.id));
  for (const g of buyableChecked.gears) {
    if (existingIds.has(g.id)) {
      return res.status(400).json({ error: `现有齿轮与可购齿轮编号重复：${g.id}` });
    }
  }
  const totalGearCount = existingChecked.gears.length + buyableChecked.gears.length;
  if (totalGearCount > MAX_TOTAL_GEARS) {
    return res.status(400).json({
      error: `现有齿轮与可购齿轮合计不能超过 ${MAX_TOTAL_GEARS} 枚（当前 ${totalGearCount} 枚）`,
    });
  }

  // 固定 2 台装置（各自速比与容差）
  const parsed = parseDevices(body.devices, { min: 2, max: 2 });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const devices = parsed.devices;

  const result = planProcure(existingChecked.gears, buyableChecked.gears, devices);

  const base = {
    maxStages: MAX_STAGES,
    deviceCount: result.deviceCount,
    subsetsChecked: result.subsetsChecked,
    feasibleSubsets: result.feasibleSubsets,
    devices: devices.map((d, i) => ({
      name: d.name,
      target: serializeFrac(d.target),
      tolerance: serializeFrac(d.tolerance),
      hasMatchInPool: result.deviceHasMatch[i],
    })),
    existingGears: existingChecked.gears,
    buyableGears: buyableChecked.gears,
  };

  if (!result.feasible) {
    return res.json({
      ...base,
      feasible: false,
      purchaseCount: 0,
      totalPrice: 0,
      purchasedGears: [],
      unusedGears: [],
      message:
        '枚举全部可购齿轮子集后，两台装置仍无法在齿轮不复用的前提下同时达标装配。' +
        '请考虑增加可购齿轮、放宽容差或调整目标速比。',
    });
  }

  res.json({
    ...base,
    feasible: true,
    noPurchaseNeeded: result.noPurchaseNeeded,
    purchaseCount: result.purchaseCount,
    totalPrice: result.totalPrice,
    totalStages: result.totalStages,
    errorSum: serializeFrac(result.errorSum),
    errorSumPercent: fracToDecimal({ num: result.errorSum.num * 100n, den: result.errorSum.den }, 6),
    purchasedGears: result.purchasedGears,
    unusedGears: result.unusedGears,
    devices: base.devices.map((d, i) => ({
      ...d,
      solution: serializeSolution(result.picks[i]),
    })),
  });
});

app.post('/api/dual-speed', (req, res) => {
  const body = req.body || {};

  // 齿轮：4～12 枚（固定级 2 枚 + 每档换装级 2 枚），沿用现有输入校验
  const checked = validateGears(body.gears, {
    label: '齿轮',
    min: MIN_DUAL_GEARS,
    max: MAX_GEARS,
  });
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  // 固定 2 个档位（各自目标速比与容差）
  const parsed = parseDevices(body.speeds, {
    min: 2,
    max: 2,
    unit: '个档位',
    defaultNamePrefix: '档位',
  });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const speeds = parsed.devices;

  // 基于完整候选枚举分配（不截断）：需更换轴位最少 → 误差之和最小 → 编号自然序
  const result = planDualSpeed(checked.gears, speeds);

  const base = {
    gearCount: checked.gears.length,
    candidateCount: result.candidateCount,
    speeds: speeds.map((sp, i) => ({
      name: sp.name,
      target: serializeFrac(sp.target),
      tolerance: serializeFrac(sp.tolerance),
      hasCandidate: result.hasCandidate[i],
    })),
  };

  if (!result.feasible) {
    return res.json({
      ...base,
      feasible: false,
      changeCount: null,
      changedPositions: [],
      fixedStage: null,
      errorSum: null,
      message:
        '未找到满足条件的双档装配方案：两个档位必须共用同一个有向齿轮对作为固定第一级，' +
        '且每档恰好两级、档内 4 枚齿轮不得复用。可尝试放宽容差、调整目标速比或增加齿轮。',
    });
  }

  // 级内分数（BigInt）统一序列化
  const serStage = (st) => ({
    drive: st.drive,
    driven: st.driven,
    stageRatio: serializeFrac(st.stageRatio),
  });
  const fixedStage = serStage(result.fixedStage);

  res.json({
    ...base,
    feasible: true,
    fixedStage,
    changeCount: result.changeCount,
    changedPositions: result.changedPositions,
    errorSum: serializeFrac(result.errorSum),
    errorSumPercent: fracToDecimal({ num: result.errorSum.num * 100n, den: result.errorSum.den }, 6),
    speeds: base.speeds.map((sp, i) => {
      const plan = result.speeds[i];
      return {
        ...sp,
        solution: {
          stages: 2,
          ratio: serializeFrac(plan.ratio),
          error: serializeFrac(plan.error),
          errorPercent: fracToDecimal({ num: plan.error.num * 100n, den: plan.error.den }, 6),
          pairs: [fixedStage, serStage(plan.swapStage)],
        },
      };
    }),
  });
});

app.post('/api/torque', async (req, res) => {
  const body = req.body || {};

  const target = parseTarget(String(body.target ?? ''));
  if (!target) {
    return res.status(400).json({ error: '目标输出转速比格式不正确：请输入正数（如 0.0833、1/12）' });
  }

  const tolerance = parseTolerance(String(body.tolerance ?? ''));
  if (!tolerance) {
    return res.status(400).json({ error: '允许相对误差格式不正确：请输入非负数（如 0.05 或 5%）' });
  }

  const checkedTorque = parsePositiveInt(body.inputTorque, '输入扭矩');
  if (!checkedTorque.ok) return res.status(400).json({ error: checkedTorque.error });
  const inputTorque = BigInt(checkedTorque.value);

  const checked = validateTorqueGears(body.gears);
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  // 完整枚举速比配对组与全部级次顺序的扭矩校核（不截断）在独立计算线程中执行，
  // 主线程继续响应页面与其他 API；请求按到达顺序逐个计算，最多 2 个排队等待
  const submitted = torqueQueue.submit({
    gears: checked.gears,
    target,
    tolerance,
    inputTorque,
  });
  if (!submitted.accepted) {
    return res.status(503).json({
      error:
        `带载计算繁忙：当前已有 1 个计算在执行、${MAX_TORQUE_WAITING} 个请求排队等待，` +
        '请稍后重试',
    });
  }

  // 连接在结果返回前关闭（用户重新提交 / 离开页面中止了请求）：排队任务立即
  // 移出队列释放名额，计算中的任务终止 worker 并重建；响应已发出后的 close
  // 不再触发取消（cancel 本身幂等）
  res.on('close', () => {
    if (!res.writableEnded) submitted.cancel();
  });

  let plan;
  try {
    plan = await submitted.result;
  } catch (err) {
    // 本请求放弃任务（连接已关闭）：静默结束，不向已关闭的响应写任何内容
    if (err instanceof TaskCancelled || res.writableEnded || res.destroyed) return;
    // 计算线程异常（含线程崩溃重建）只让当前请求失败，队列中其余请求不受影响
    return res.status(500).json({ error: `带载计算失败：${err.message}` });
  }
  if (res.writableEnded || res.destroyed) return;

  const base = {
    target: serializeFrac(target),
    tolerance: serializeFrac(tolerance),
    maxStages: MAX_STAGES,
    inputTorque: checkedTorque.value,
    maxTorque: MAX_TORQUE,
    ratioMatchCount: plan.ratioMatchCount,
    loadCandidatesChecked: plan.loadCandidatesChecked,
  };

  // 区分“速比无解”与“速比有解但全部超载”
  if (plan.ratioMatchCount === 0) {
    return res.json({
      ...base,
      feasible: false,
      reason: 'ratio',
      total: 0,
      truncated: false,
      count: 0,
      results: [],
      message:
        '速比无解：在 1～3 级传动、每枚齿轮至多使用一次的限制下，' +
        '所有组合的实际转速比相对误差均超出允许范围，未进入扭矩校核。' +
        '可尝试放宽误差、调整目标速比或增加齿轮。',
    });
  }

  if (plan.total === 0) {
    return res.json({
      ...base,
      feasible: false,
      reason: 'overload',
      total: 0,
      truncated: false,
      count: 0,
      results: [],
      message:
        `全部超载：共有 ${plan.ratioMatchCount} 组速比达标的配对，其全部 ${plan.loadCandidatesChecked} 种级次顺序` +
        '（同一组配对的各级排列已分别校核）都至少有一枚齿轮的承受扭矩超过其额定值。' +
        '可尝试降低输入扭矩、提高相关齿轮的额定扭矩或增加可选齿轮。',
    });
  }

  res.json({
    ...base,
    feasible: true,
    reason: 'ok',
    total: plan.total,
    truncated: plan.truncated,
    count: plan.results.length,
    results: plan.results.map(serializeTorqueSolution),
  });
});

app.post('/api/layout', (req, res) => {
  const body = req.body || {};

  // 轴心：2～4 个沿直线依次排列的整数坐标点
  const axesChecked = parseAxes(body.axes);
  if (!axesChecked.ok) return res.status(400).json({ error: axesChecked.error });
  const axes = axesChecked.axes;

  // 模数：统一正整数
  const moduleChecked = parseModule(body.module);
  if (!moduleChecked.ok) return res.status(400).json({ error: moduleChecked.error });
  const mod = moduleChecked.value;

  const target = parseTarget(String(body.target ?? ''));
  if (!target) {
    return res.status(400).json({ error: '目标输出转速比格式不正确：请输入正数（如 0.0833、1/12）' });
  }

  const tolerance = parseTolerance(String(body.tolerance ?? ''));
  if (!tolerance) {
    return res.status(400).json({ error: '允许相对误差格式不正确：请输入非负数（如 0.05 或 5%）' });
  }

  // 现有齿轮：2～12 枚，沿用统一校验；轴数 n 需要恰好 2(n-1) 枚不同实物
  const stageCount = axes.length - 1;
  const minGears = 2 * stageCount;
  const checked = validateGears(body.gears, { label: '齿轮', min: 2, max: MAX_GEARS });
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  if (checked.gears.length < minGears) {
    return res.status(400).json({
      error: `${axes.length} 个轴共 ${stageCount} 级传动，至少需要 ${minGears} 枚齿轮（当前 ${checked.gears.length} 枚）`,
    });
  }

  // 穷举每级满足 2×轴距=模数×(主+从) 的有向配对并跨级组合，精确分数校核总速比
  const plan = planLayout(checked.gears, axes, mod, target, tolerance);

  const geometryStages = plan.stages.map((st) => {
    let meshingReason;
    if (st.distance === null) {
      meshingReason = '轴距不是整数，整数模数与整数齿数无法满足 2×轴距=模数×齿数和';
    } else if (st.requiredSum === null) {
      meshingReason = `2×轴距=${2 * st.distance} 不能被模数 ${mod} 整除（或齿数和 < 2），无整数齿数解`;
    }
    return {
      stage: st.stage,
      dx: st.dx,
      dy: st.dy,
      distanceSquared: st.dx * st.dx + st.dy * st.dy,
      distance: st.distance,
      requiredTeethSum: st.requiredSum,
      meshingPossible: st.requiredSum !== null,
      meshingReason,
      candidateCount: plan.candidateCounts[st.stage - 1],
    };
  });

  const base = {
    axes,
    module: mod,
    stageCount,
    target: serializeFrac(target),
    tolerance: serializeFrac(tolerance),
    stages: geometryStages,
    gearCount: checked.gears.length,
    assemblyCount: plan.assemblyCount,
  };

  // 第一类无解：几何/齿数层面就不存在完整可啮合装配
  const impossibleStage = geometryStages.find((st) => !st.meshingPossible);
  if (impossibleStage) {
    return res.json({
      ...base,
      feasible: false,
      reason: 'meshing',
      total: 0,
      best: null,
      message:
        `无可啮合装配：第 ${impossibleStage.stage} 级（第 ${impossibleStage.stage}～${impossibleStage.stage + 1} 轴）` +
        `${impossibleStage.meshingReason}。请调整轴心坐标或模数。`,
    });
  }

  const emptyStage = geometryStages.find((st) => st.candidateCount === 0);
  if (emptyStage) {
    return res.json({
      ...base,
      feasible: false,
      reason: 'meshing',
      total: 0,
      best: null,
      message:
        `无可啮合装配：第 ${emptyStage.stage} 级（第 ${emptyStage.stage}～${emptyStage.stage + 1} 轴）要求主动齿数 + 从动齿数 = ` +
        `${emptyStage.requiredTeethSum}，但现有齿轮中不存在满足该齿数和的两枚齿轮。` +
        '请补充齿数互补的齿轮，或调整轴位 / 模数。',
    });
  }

  if (plan.assemblyCount === 0) {
    return res.json({
      ...base,
      feasible: false,
      reason: 'meshing',
      total: 0,
      best: null,
      message:
        '无可啮合装配：虽然每级各自存在满足轴距的齿轮对，但跨级组合无法做到每枚齿轮全程只用一次。' +
        '请增加齿轮（补足齿数互补的型号）或调整轴位、模数。',
    });
  }

  // 第二类无解：存在完整可啮合装配，但全部速比相对误差超出容差
  if (plan.total === 0) {
    return res.json({
      ...base,
      feasible: false,
      reason: 'ratio',
      total: 0,
      best: null,
      closest: serializeLayoutSolution(plan.closest),
      message:
        `可装配但速比不达标：共枚举 ${plan.assemblyCount} 种满足全部轴距的完整装配，` +
        '其实际总速比的相对误差均超出允许范围。下列为误差最小的一种（不达标，仅供参考）；' +
        '可尝试放宽容差、调整目标速比、轴位 / 模数或更换齿轮。',
    });
  }

  res.json({
    ...base,
    feasible: true,
    reason: 'ok',
    total: plan.total,
    best: serializeLayoutSolution(plan.best),
  });
});

app.post('/api/diagnose', (req, res) => {
  const body = req.body || {};

  const checked = validateDiagnoseInput(body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const { stages, observations } = checked;

  // 按齿数精确计算理论速比；读数误差区间转为实测速比区间；逐级求恒定倍率可行区间
  const result = diagnose(stages, observations);

  res.json({
    stageCount: result.stageCount,
    axisCount: result.axisCount,
    observationCount: result.observationCount,
    maxObservations: MAX_OBSERVATIONS,
    stages: result.stages.map((st) => ({
      stage: st.stage,
      driveTeeth: st.driveTeeth,
      drivenTeeth: st.drivenTeeth,
      stageRatio: serializeFrac(result.stageRatios[st.stage - 1]),
    })),
    shaftRatios: result.shaftRatios.map(serializeFrac),
    observations: result.observations.map((ob, oi) => ({
      name: ob.name || `观测 ${oi + 1}`,
      axes: ob.axes,
      readings: ob.readings.map((rd) => ({
        axis: rd.axis,
        revolutions: serializeFrac(rd.revolutions),
        error: serializeFrac(rd.error),
      })),
      segments: ob.segments.map((s) => ({
        fromAxis: s.fromAxis,
        toAxis: s.toAxis,
        low: serializeFrac(s.low),
        high: serializeFrac(s.high),
        theory: serializeFrac(s.theory),
        normal: s.normal,
      })),
    })),
    verdict: result.verdict,
    normal: result.normal,
    endAxesOnly: result.endAxesOnly,
    abnormalSegments: result.abnormalSegments,
    candidates: result.candidates.map((c) => ({
      stage: c.stage,
      feasible: c.feasible,
      intersectionNonEmpty: c.intersectionNonEmpty,
      factorLow: serializeFrac(c.factorLow),
      factorHigh: serializeFrac(c.factorHigh),
      containsUnity: c.containsUnity,
      direction: c.direction,
      crossCheckFailed: c.crossCheckFailed,
    })),
    feasibleStages: result.feasibleStages,
    suspectStage: result.suspectStage,
    message: result.message,
  });
});

app.post('/api/phase-reset', (req, res) => {
  const checked = validatePhaseResetInput(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const { stages, phases } = checked;

  // 逐轴把“标记回零”化为模同余，再按广义 CRT 合并（非互素模 gcd 判兼容、lcm 合并）
  const result = phaseReset(stages, phases);

  const base = {
    stageCount: result.stageCount,
    axisCount: result.axisCount,
    maxStages: MAX_PHASE_STAGES,
    stages: result.stages.map((st, i) => ({
      stage: st.stage,
      driveTeeth: st.driveTeeth,
      drivenTeeth: st.drivenTeeth,
      stageRatio: serializeFrac(result.stageRatios[i]),
    })),
    axes: result.axes.map(serializePhaseAxis),
    mergeSteps: result.mergeSteps.map(serializeMergeStep),
    solvable: result.solvable,
    reason: result.reason,
    message: result.message,
  };

  if (!result.solvable) {
    return res.json({
      ...base,
      earliestTurns: null,
      residue: null,
      period: null,
      unsolvableAxes: result.unsolvableAxes,
      conflictAxes: result.conflictAxes,
      conflictPairs: result.conflictPairs.map((cp) => ({
        axisA: cp.axisA,
        axisB: cp.axisB,
        residueA: cp.residueA.toString(),
        modulusA: cp.modulusA.toString(),
        residueB: cp.residueB.toString(),
        modulusB: cp.modulusB.toString(),
        gcd: cp.gcd.toString(),
      })),
    });
  }

  res.json({
    ...base,
    earliestTurns: result.earliestTurns.toString(),
    residue: result.residue.toString(),
    period: result.period.toString(),
    unsolvableAxes: [],
    conflictAxes: [],
    conflictPairs: [],
  });
});

/** 共振避让：区间端点 / 个数均为 BigInt，统一序列化为字符串 */
function serializeInterval(itv) {
  return { from: itv.from.toString(), to: itv.to.toString(), count: itv.count.toString() };
}

app.post('/api/resonance', (req, res) => {
  const checked = validateResonanceInput(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const { stages, inputMin, inputMax, forbidden } = checked;

  // 各轴倍率按齿数连乘（精确分数）；逐条禁用区间反推整数输入转速区间，裁剪合并后求安全区间
  const result = planResonance(stages, inputMin, inputMax, forbidden);

  res.json({
    stageCount: result.stageCount,
    axisCount: result.axisCount,
    maxStages: MAX_RESONANCE_STAGES,
    maxForbidden: MAX_FORBIDDEN,
    maxRpm: MAX_RESONANCE_RPM,
    stages: result.stages.map((st) => ({
      stage: st.stage,
      driveTeeth: st.driveTeeth,
      drivenTeeth: st.drivenTeeth,
      stageRatio: serializeFrac(st.stageRatio),
    })),
    shafts: result.shafts.map((s) => ({
      axis: s.axis,
      role: s.role,
      multiplier: serializeFrac(s.multiplier),
    })),
    inputRange: { min: result.inputMin.toString(), max: result.inputMax.toString() },
    totalCount: result.totalCount.toString(),
    rules: result.rules.map((r) => ({
      index: r.index,
      axis: r.axis,
      low: r.low.toString(),
      high: r.high.toString(),
      multiplier: serializeFrac(r.multiplier),
      rawFrom: r.rawFrom.toString(),
      rawTo: r.rawTo.toString(),
      status: r.status,
      mapped: r.mapped ? serializeInterval(r.mapped) : null,
      note: r.note,
    })),
    excluded: result.excluded.map((e) => ({
      ...serializeInterval(e),
      sources: e.sources,
    })),
    excludedCount: result.excludedCount.toString(),
    safe: result.safe.map(serializeInterval),
    safeCount: result.safeCount.toString(),
    hasSafe: result.hasSafe,
    recommendation: result.recommendation ? serializeInterval(result.recommendation) : null,
    message: result.message,
  });
});

app.post('/api/lifetime', (req, res) => {
  const checked = validateLifetimeInput(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  // 精确分数逐轮消耗 → 全部齿轮均不超限的最多完整轮数（恰好达到限额视为可执行）
  const result = planLifetime(checked.config);

  res.json({
    fixedStage: {
      drive: result.fixedStage.drive,
      driven: result.fixedStage.driven,
      stageRatio: serializeFrac(result.fixedStage.stageRatio),
    },
    speeds: result.speeds.map((sp) => ({
      name: sp.name,
      inputTurns: sp.inputTurns.toString(),
      swapStage: {
        drive: sp.swapDrive,
        driven: sp.swapDriven,
        stageRatio: serializeFrac(sp.swapRatio),
      },
      outputRatio: serializeFrac(sp.outputRatio),
    })),
    maxInputTurns: MAX_INPUT_TURNS.toString(),
    maxRemaining: MAX_REMAINING.toString(),
    gearCount: result.gears.length,
    rounds: result.rounds.toString(),
    limitingGears: result.limitingGears,
    gears: result.gears.map((g) => ({
      id: g.id,
      teeth: g.teeth,
      loads: g.loads.map((l, i) =>
        l
          ? {
              speed: i + 1,
              speedName: result.speeds[i].name,
              role: l.role,
              shaft: l.shaft,
              shaftRatio: serializeFrac(l.ratio),
              revolutions: serializeFrac(l.revolutions),
            }
          : null,
      ),
      perRound: serializeFrac(g.perRound),
      remaining: g.remaining.toString(),
      maxRounds: g.maxRounds.toString(),
      consumed: serializeFrac(g.consumed),
      margin: serializeFrac(g.margin),
      atLimit: g.atLimit,
      limiting: g.limiting,
    })),
    message: result.message,
  });
});

app.post('/api/backlash', (req, res) => {
  const checked = validateBacklashInput(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const { stages, expected } = checked;

  // 精确分数：各级齿隙 × 后续级速比合成输出轴总空程区间；
  // 保证输出达标的最少圈数 N = ⌈(期望 + 空程上界) / 总速比⌉
  const result = planBacklash(stages, expected);

  res.json({
    stageCount: result.stageCount,
    axisCount: result.axisCount,
    maxStages: MAX_BACKLASH_STAGES,
    stages: result.stages.map((st) => ({
      stage: st.stage,
      driveTeeth: st.driveTeeth,
      drivenTeeth: st.drivenTeeth,
      stageRatio: serializeFrac(st.stageRatio),
      backlash: {
        low: serializeFrac(st.backlashLow),
        high: serializeFrac(st.backlashHigh),
      },
      suffixRatio: serializeFrac(st.suffixRatio),
      converted: {
        low: serializeFrac(st.convertedLow),
        high: serializeFrac(st.convertedHigh),
      },
    })),
    totalRatio: serializeFrac(result.totalRatio),
    totalBacklash: {
      low: serializeFrac(result.totalLow),
      high: serializeFrac(result.totalHigh),
    },
    expectedTurns: serializeFrac(result.expected),
    requiredMargin: serializeFrac(result.requiredMargin),
    minInputTurns: result.minInputTurns.toString(),
    idealOutput: serializeFrac(result.idealOutput),
    outputAtMin: {
      low: serializeFrac(result.outputLow),
      high: serializeFrac(result.outputHigh),
    },
    prevTurns: result.prevTurns.toString(),
    prevGuaranteed: serializeFrac(result.prevGuaranteed),
    message: result.message,
  });
});

app.post('/api/reciprocate', (req, res) => {
  const checked = validateReciprocateInput(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const { stages, segments } = checked;

  // 精确分数逐段回放：上游实际位移 × 负齿数比得 d，u = g + d，
  // g' = min(w, max(0, u))，本级实际位移 = u − g'；间隙位置与累计位移跨段保留
  const result = planReciprocate(stages, segments);

  res.json({
    stageCount: result.stageCount,
    axisCount: result.axisCount,
    segmentCount: result.segmentCount,
    maxSegments: MAX_SEGMENTS,
    stages: result.stages.map((st) => ({
      stage: st.stage,
      driveTeeth: st.driveTeeth,
      drivenTeeth: st.drivenTeeth,
      stageRatio: serializeFrac(st.stageRatio),
      backlashWidth: serializeFrac(st.width),
      initialGap: serializeFrac(st.initialGap),
    })),
    segments: result.segments.map((seg) => ({
      index: seg.index,
      inputTurns: serializeFrac(seg.inputTurns),
      axes: seg.axes.map((ax) => ({
        axis: ax.axis,
        role: ax.axis === 1 ? '输入轴' : `第 ${ax.axis - 1} 级输出轴`,
        actual: serializeFrac(ax.actual),
        cumulative: serializeFrac(ax.cumulative),
      })),
      stages: seg.stages.map((sd) => ({
        stage: sd.stage,
        upstream: serializeFrac(sd.upstream),
        d: serializeFrac(sd.d),
        gapBefore: serializeFrac(sd.gapBefore),
        u: serializeFrac(sd.u),
        gapAfter: serializeFrac(sd.gapAfter),
        actual: serializeFrac(sd.actual),
      })),
    })),
    finalGaps: result.finalGaps.map((g, i) => ({ stage: i + 1, gap: serializeFrac(g) })),
    finalCumulative: result.finalCumulative.map((c, a) => ({
      axis: a + 1,
      role: a === 0 ? '输入轴' : `第 ${a} 级输出轴`,
      cumulative: serializeFrac(c),
    })),
    message: result.message,
  });
});

app.listen(PORT, () => {
  console.log(`齿轮组选配服务已启动： http://localhost:${PORT}`);
  console.log(`  单台选配： http://localhost:${PORT}/`);
  console.log(`  批量装配： http://localhost:${PORT}/batch`);
  console.log(`  缺齿补货： http://localhost:${PORT}/procure`);
  console.log(`  双档换速： http://localhost:${PORT}/dual-speed`);
  console.log(`  寿命核算： http://localhost:${PORT}/lifetime`);
  console.log(`  带载安全： http://localhost:${PORT}/torque`);
  console.log(`  轴位装配： http://localhost:${PORT}/layout`);
  console.log(`  转速异常定位： http://localhost:${PORT}/diagnose`);
  console.log(`  装配校准： http://localhost:${PORT}/phase-reset`);
  console.log(`  共振避让： http://localhost:${PORT}/resonance`);
  console.log(`  反向空程预算： http://localhost:${PORT}/backlash`);
  console.log(`  往复运动回放： http://localhost:${PORT}/reciprocate`);
});
