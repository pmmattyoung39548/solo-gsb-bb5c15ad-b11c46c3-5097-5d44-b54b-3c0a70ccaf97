'use strict';

/**
 * 双档换速寿命核算算法
 *
 * 输入：一套双档装配（两档共用的固定第一级 + 每档各自的换装第二级）、
 * 每档每轮计划输入圈数（正整数）、每枚参与齿轮的剩余允许转数（非负整数）。
 *
 * 每轮负荷（精确分数，BigInt）——按各级齿数比逐级传递：
 *   - 输入轴（固定级主动轮）：该档每轮实际转 N_s 圈；
 *   - 中间轴（固定级从动轮、各档换装级主动轮）：该档每轮实际转
 *     N_s × 固定主动齿 / 固定从动齿 圈；
 *   - 输出轴（各档换装级从动轮）：该档每轮实际转
 *     N_s × (固定主动齿 / 固定从动齿) × (换装主动齿 / 换装从动齿) 圈。
 * 固定级两枚齿轮两档都在工作，累计两档负荷；跨档重复使用的换装齿轮同样累计；
 * 未装入某档的齿轮该档负荷为 0。
 *
 * 全部齿轮均不超限的最多完整轮数 R = min_g ⌊剩余允许转数_g / 每轮消耗_g⌋
 * （恰好达到限额视为可执行）；取得该最小值的全部齿轮为共同限制齿轮；
 * R = 0 时给出连一轮都承受不起的受限齿轮清单。
 */

const { makeFrac } = require('./search');

/** 每档每轮计划输入圈数上限（正整数） */
const MAX_INPUT_TURNS = 10n ** 12n;
/** 每枚参与齿轮剩余允许转数上限（非负整数） */
const MAX_REMAINING = 10n ** 18n;
const MIN_TEETH = 1;
const MAX_TEETH = 100000;

/* ------------------------------------------------------------------ */
/* 输入校验                                                            */
/* ------------------------------------------------------------------ */

/**
 * 解析整数（JSON number 或纯数字字符串）为 BigInt。
 * @param {*} raw
 * @param {string} label 字段名（用于错误提示）
 * @param {bigint} max 上限
 * @param {boolean} allowZero 是否允许 0
 * @returns {{ok:true,value:bigint}|{ok:false,error:string}}
 */
function parseUint(raw, label, max, allowZero) {
  const hint = `${label}需为${allowZero ? '非负' : '正'}整数（${allowZero ? '0' : '1'}～${max.toString()}）`;
  let s;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) return { ok: false, error: hint };
    s = String(raw);
  } else if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) {
    s = raw.trim();
  } else {
    return { ok: false, error: hint };
  }
  const v = BigInt(s);
  if ((!allowZero && v < 1n) || v > max) return { ok: false, error: hint };
  return { ok: true, value: v };
}

/**
 * 解析一枚齿轮 {id, teeth}。
 * @returns {{ok:true,gear:{id:string,teeth:number}}|{ok:false,error:string}}
 */
function parseGear(row, label) {
  if (!row || typeof row !== 'object') {
    return { ok: false, error: `缺少${label}：需填写编号与齿数` };
  }
  const id = String(row.id ?? '').trim();
  if (!id) return { ok: false, error: `${label}缺少编号` };
  if (id.length > 30) return { ok: false, error: `${label}编号不能超过 30 个字符` };
  const teeth = Number(row.teeth);
  if (!Number.isInteger(teeth) || teeth < MIN_TEETH || teeth > MAX_TEETH) {
    return { ok: false, error: `${label} ${id} 的齿数需为 ${MIN_TEETH}~${MAX_TEETH} 的整数` };
  }
  return { ok: true, gear: { id, teeth } };
}

/**
 * 校验并规范化寿命核算输入。
 *
 * @param {*} body 请求体
 * @returns {{ok:true, config:object}|{ok:false,error:string}}
 */
function validateLifetimeInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求体格式不正确' };

  // 固定第一级（两档共用的有向齿轮对）
  const fixed = body.fixedStage;
  if (!fixed || typeof fixed !== 'object') {
    return { ok: false, error: '缺少固定第一级：需给出 fixedStage.drive / fixedStage.driven' };
  }
  const fd = parseGear(fixed.drive, '固定第一级主动轮');
  if (!fd.ok) return fd;
  const fw = parseGear(fixed.driven, '固定第一级从动轮');
  if (!fw.ok) return fw;
  if (fd.gear.id === fw.gear.id) {
    return { ok: false, error: '固定第一级主动轮与从动轮不能是同一枚齿轮' };
  }

  // 恰好两个档位：名称（可空）、每轮计划输入圈数（正整数）、换装第二级（有向齿轮对）
  if (!Array.isArray(body.speeds) || body.speeds.length !== 2) {
    return { ok: false, error: '需恰好输入 2 个档位（speeds）' };
  }
  const speeds = [];
  for (let i = 0; i < 2; i++) {
    const row = body.speeds[i];
    if (!row || typeof row !== 'object') return { ok: false, error: `第 ${i + 1} 档数据格式不正确` };
    const name = String(row.name ?? '').trim() || `档位 ${i + 1}`;
    if (name.length > 30) return { ok: false, error: `第 ${i + 1} 档名称不能超过 30 个字符` };
    const turns = parseUint(row.inputTurns, `${name}的每轮计划输入圈数`, MAX_INPUT_TURNS, false);
    if (!turns.ok) return turns;
    const swap = row.swapStage;
    if (!swap || typeof swap !== 'object') {
      return { ok: false, error: `${name}缺少换装第二级：需给出 swapStage.drive / swapStage.driven` };
    }
    const sa = parseGear(swap.drive, `${name}换装级主动轮`);
    if (!sa.ok) return sa;
    const sb = parseGear(swap.driven, `${name}换装级从动轮`);
    if (!sb.ok) return sb;
    // 档内 4 枚齿轮（固定级 2 枚 + 换装级 2 枚）不得重复
    const ids = [fd.gear.id, fw.gear.id, sa.gear.id, sb.gear.id];
    if (new Set(ids).size !== ids.length) {
      return { ok: false, error: `${name}内固定级与换装级的 4 枚齿轮不得重复（当前：${ids.join('、')}）` };
    }
    speeds.push({ name, inputTurns: turns.value, swapDrive: sa.gear, swapDriven: sb.gear });
  }

  // 同一编号在任何位置必须对应同一齿数；按首次出现顺序收集参与齿轮
  const teethById = new Map();
  const ordered = [
    fd.gear,
    fw.gear,
    speeds[0].swapDrive,
    speeds[0].swapDriven,
    speeds[1].swapDrive,
    speeds[1].swapDriven,
  ];
  for (const g of ordered) {
    const prev = teethById.get(g.id);
    if (prev !== undefined) {
      if (prev !== g.teeth) {
        return { ok: false, error: `齿轮 ${g.id} 在不同位置填写了不同齿数（${prev} 与 ${g.teeth}）` };
      }
    } else {
      teethById.set(g.id, g.teeth);
    }
  }
  const participants = [...teethById].map(([id, teeth]) => ({ id, teeth }));

  // 每枚参与齿轮的剩余允许转数（非负整数），必须恰好覆盖参与清单
  if (!Array.isArray(body.remaining)) {
    return { ok: false, error: '缺少每枚参与齿轮的剩余允许转数（remaining 数组）' };
  }
  const remaining = new Map();
  for (let i = 0; i < body.remaining.length; i++) {
    const row = body.remaining[i];
    if (!row || typeof row !== 'object') {
      return { ok: false, error: `剩余允许转数第 ${i + 1} 行格式不正确` };
    }
    const id = String(row.id ?? '').trim();
    if (!id) return { ok: false, error: `剩余允许转数第 ${i + 1} 行缺少齿轮编号` };
    if (remaining.has(id)) return { ok: false, error: `剩余允许转数中齿轮编号重复：${id}` };
    const turns = parseUint(row.turns, `齿轮 ${id} 的剩余允许转数`, MAX_REMAINING, true);
    if (!turns.ok) return turns;
    remaining.set(id, turns.value);
  }
  const missing = participants.filter((p) => !remaining.has(p.id)).map((p) => p.id);
  if (missing.length) {
    return { ok: false, error: `缺少以下参与齿轮的剩余允许转数：${missing.join('、')}` };
  }
  const extra = [...remaining.keys()].filter((id) => !teethById.has(id));
  if (extra.length) {
    return { ok: false, error: `以下齿轮未参与该双档装配，无需填写剩余允许转数：${extra.join('、')}` };
  }

  return {
    ok: true,
    config: { fixedDrive: fd.gear, fixedDriven: fw.gear, speeds, participants, remaining },
  };
}

/* ------------------------------------------------------------------ */
/* 寿命核算                                                            */
/* ------------------------------------------------------------------ */

/** 分数相加（结果约分） */
function addFrac(a, b) {
  return makeFrac(a.num * b.den + b.num * a.den, a.den * b.den);
}

/** 分数乘非负整数（结果约分） */
function scaleFrac(f, k) {
  return makeFrac(f.num * k, f.den);
}

/** 向下取整 L / c（L 非负整数，c 正分数；BigInt 截断除法对非负值即向下取整） */
function floorDivFrac(L, c) {
  return (L * c.den) / c.num;
}

/** 分数的紧凑文本（分母为 1 时只写整数），用于结论说明 */
function fmtFrac(f) {
  return f.den === 1n ? f.num.toString() : `${f.num}/${f.den}`;
}

/**
 * 寿命核算主入口。
 *
 * @param {object} config validateLifetimeInput 规范化后的配置
 * @returns {object} 见 README 与 /api/lifetime 返回结构
 */
function planLifetime(config) {
  const { fixedDrive, fixedDriven, speeds, participants, remaining } = config;

  // 中间轴（固定级从动轮 / 换装级主动轮所在轴）相对输入轴的转速比
  const midRatio = makeFrac(BigInt(fixedDrive.teeth), BigInt(fixedDriven.teeth));
  // 各档：换装级速比与输出轴相对输入轴的转速比（齿数连乘，精确分数）
  const speedPlans = speeds.map((sp) => {
    const swapRatio = makeFrac(BigInt(sp.swapDrive.teeth), BigInt(sp.swapDriven.teeth));
    const outputRatio = makeFrac(midRatio.num * swapRatio.num, midRatio.den * swapRatio.den);
    return { ...sp, swapRatio, outputRatio };
  });

  // 每档内每枚参与齿轮的角色 / 所在轴 / 该轴转速比
  // （校验已保证档内 4 枚不重复，故同一档内每枚齿轮至多一个角色）
  const roles = new Map(); // id -> [档一角色|null, 档二角色|null]
  const setRole = (id, speedIdx, info) => {
    if (!roles.has(id)) roles.set(id, [null, null]);
    roles.get(id)[speedIdx] = info;
  };
  for (let s = 0; s < 2; s++) {
    setRole(fixedDrive.id, s, { role: '固定级主动轮', shaft: '输入轴', ratio: { num: 1n, den: 1n } });
    setRole(fixedDriven.id, s, { role: '固定级从动轮', shaft: '中间轴', ratio: midRatio });
    setRole(speedPlans[s].swapDrive.id, s, { role: '换装级主动轮', shaft: '中间轴', ratio: midRatio });
    setRole(speedPlans[s].swapDriven.id, s, {
      role: '换装级从动轮',
      shaft: '输出轴',
      ratio: speedPlans[s].outputRatio,
    });
  }

  // 逐枚核算：每轮消耗（按档拆分 + 合计）与单齿轮可执行轮数
  const gears = participants.map((p) => {
    const roleList = roles.get(p.id);
    const loads = speedPlans.map((sp, s) => {
      const info = roleList[s];
      if (!info) return null; // 未装入该档，不计
      // 该档每轮实际转数 = 每轮计划输入圈数 × 所在轴转速比（精确分数）
      return { ...info, revolutions: scaleFrac(info.ratio, sp.inputTurns) };
    });
    const perRound = loads.reduce((acc, l) => (l ? addFrac(acc, l.revolutions) : acc), {
      num: 0n,
      den: 1n,
    });
    const limit = remaining.get(p.id);
    return {
      id: p.id,
      teeth: p.teeth,
      loads,
      perRound,
      remaining: limit,
      maxRounds: floorDivFrac(limit, perRound),
    };
  });

  // 全部齿轮均不超限的最多完整轮数（恰好达到限额视为可执行）
  let rounds = null;
  for (const g of gears) {
    if (rounds === null || g.maxRounds < rounds) rounds = g.maxRounds;
  }
  const limitingGears = gears.filter((g) => g.maxRounds === rounds).map((g) => g.id);

  // 执行 R 轮后的累计消耗与余量（余量必为非负分数）
  for (const g of gears) {
    g.consumed = scaleFrac(g.perRound, rounds);
    g.margin = makeFrac(g.remaining * g.consumed.den - g.consumed.num, g.consumed.den);
    g.atLimit = g.margin.num === 0n; // 恰好达到限额（视为可执行）
    g.limiting = g.maxRounds === rounds;
  }

  // 结论说明
  let message;
  if (rounds === 0n) {
    const blockers = gears
      .filter((g) => g.maxRounds === 0n)
      .map(
        (g) =>
          `齿轮 ${g.id}（每轮消耗 ${fmtFrac(g.perRound)} 转，剩余允许转数仅 ${g.remaining.toString()} 转）`,
      );
    message =
      '连 1 轮计划都无法完整执行：' +
      blockers.join('；') +
      '。请更换剩余允许转数更长的齿轮，或降低每档每轮计划输入圈数。';
  } else {
    message =
      `最多可完整执行 ${rounds.toString()} 轮计划；共同限制齿轮：${limitingGears.join('、')}` +
      '（再执行 1 轮这些齿轮将超出剩余允许转数）。';
  }

  return {
    fixedStage: { drive: fixedDrive, driven: fixedDriven, stageRatio: midRatio },
    speeds: speedPlans,
    gears,
    rounds,
    limitingGears,
    message,
  };
}

module.exports = {
  MAX_INPUT_TURNS,
  MAX_REMAINING,
  validateLifetimeInput,
  planLifetime,
};
