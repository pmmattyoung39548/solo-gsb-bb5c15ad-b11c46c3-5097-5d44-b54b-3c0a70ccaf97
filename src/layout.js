'use strict';

/**
 * 轴位装配算法
 *
 * 给定 2～4 个沿一条直线依次排列的轴心（整数坐标）、统一的正整数**模数** m
 * 与 2～12 枚现有齿轮，在每相邻两轴之间各装一级齿轮传动：
 *
 *   - 第 i 级装在第 i 轴（主动轮）与第 i+1 轴（从动轮）之间；
 *   - 中间轴上把前级从动轮与后级主动轮**同轴固定**（两枚不同实物）；
 *   - 每枚实物齿轮在整条传动链中恰好使用一次；
 *   - 每级必须满足安装距（轴距）啮合条件：
 *
 *       2 × 轴距 = 模数 × (主动齿数 + 从动齿数)
 *
 * 穷举每级满足轴距的全部**有向配对**（谁主动/谁从动都枚举），再跨级组合
 * （齿轮互不重复），以精确分数（BigInt）校核总速比与相对误差。
 *
 * 无解时区分：
 *   reason 'meshing'：任何一级都凑不出满足轴距的配对（或跨级无法不重复组合），
 *                     即“无可啮合装配”；
 *   reason 'ratio'  ：存在完整可啮合装配，但全部装配的速比相对误差都超出容差，
 *                     即“可装配但速比不达标”（返回误差最小的 closest 装配）。
 *
 * 达标方案排序：相对误差最小 → 各级 (主动轮编号, 从动轮编号) 序列自然序
 * （G2 排在 G10 之前）。
 */

const { makeFrac, cmpIdxs, validateGears, MAX_GEARS } = require('./search');

/** 轴数范围 / 模数与坐标上下限 */
const MIN_AXES = 2;
const MAX_AXES = 4;
const MIN_MODULE = 1;
const MAX_MODULE = 100000;
const MAX_COORD = 1000000;

/**
 * 解析单个整数坐标分量（接受 JSON number 或纯数字字符串，允许负号）。
 * @returns {{ok:true,value:number}|{ok:false}}
 */
function parseCoordPart(raw) {
  let v;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return { ok: false };
    v = raw;
  } else if (typeof raw === 'string' && /^\s*[+-]?\d+\s*$/.test(raw)) {
    v = Number(raw.trim());
  } else {
    return { ok: false };
  }
  if (v < -MAX_COORD || v > MAX_COORD) return { ok: false };
  return { ok: true, value: v };
}

/**
 * 校验轴心坐标列表：2～4 个整数坐标点，互不重合、严格共线且沿同一方向依次排列。
 *
 * 每个点可写成：
 *   - 单个整数（一维，y 视为 0）：0、120；
 *   - 对象 {x, y}（y 可省略，视为 0）：{"x": 0, "y": 0}。
 *
 * @param {*} input
 * @returns {{ok:true,axes:Array<{x:number,y:number}>}|{ok:false,error:string}}
 */
function parseAxes(input) {
  if (!Array.isArray(input) || input.length < MIN_AXES || input.length > MAX_AXES) {
    return { ok: false, error: `轴心数量需为 ${MIN_AXES}～${MAX_AXES} 个（当前 ${Array.isArray(input) ? input.length : 0} 个）` };
  }

  const axes = [];
  for (let i = 0; i < input.length; i++) {
    const row = input[i];
    let xRaw;
    let yRaw;
    if (row !== null && typeof row === 'object') {
      xRaw = row.x;
      yRaw = row.y ?? 0;
    } else {
      xRaw = row;
      yRaw = 0;
    }
    const px = parseCoordPart(xRaw);
    const py = parseCoordPart(yRaw);
    if (!px.ok || !py.ok) {
      return {
        ok: false,
        error: `第 ${i + 1} 个轴心坐标需为 -${MAX_COORD}～${MAX_COORD} 的整数（可写单个整数或 {x, y}）`,
      };
    }
    axes.push({ x: px.value, y: py.value });
  }

  // 相邻轴必须沿同一方向严格前进：方向向量 v_i = p_{i+1} - p_i 非零、
  // 与 v0 共线（叉积为 0）且同向（点积为正），全程整数精确判定
  const v0x = axes[1].x - axes[0].x;
  const v0y = axes[1].y - axes[0].y;
  for (let i = 0; i + 1 < axes.length; i++) {
    const vx = axes[i + 1].x - axes[i].x;
    const vy = axes[i + 1].y - axes[i].y;
    if (vx === 0 && vy === 0) {
      return { ok: false, error: `第 ${i + 1}、${i + 2} 个轴心坐标重合，轴距必须为正` };
    }
    if (i === 0) continue;
    const cross = v0x * vy - v0y * vx;
    const dot = v0x * vx + v0y * vy;
    if (cross !== 0 || dot <= 0) {
      return {
        ok: false,
        error:
          `轴心未沿一条直线依次排列：第 1 段方向 (${v0x}, ${v0y}) 与第 ${i + 1} 段方向 (${vx}, ${vy}) ` +
          '不共线或方向相反，请按输入轴到输出轴的顺序填写坐标',
      };
    }
  }

  return { ok: true, axes };
}

/**
 * 校验模数：统一的正整数（1～100000）。
 * @param {*} raw
 * @returns {{ok:true,value:number}|{ok:false,error:string}}
 */
function parseModule(raw) {
  const hint = `模数需为 ${MIN_MODULE}～${MAX_MODULE} 的正整数`;
  let v;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return { ok: false, error: hint };
    v = raw;
  } else if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) {
    v = Number(raw.trim());
  } else {
    return { ok: false, error: hint };
  }
  if (v < MIN_MODULE || v > MAX_MODULE) return { ok: false, error: hint };
  return { ok: true, value: v };
}

/**
 * 计算整数平方根：n 为完全平方数时返回 sqrt(n)，否则返回 null。
 * 坐标差 ≤ 2×10⁶，平方 ≤ 4×10¹²，远小于 Number.MAX_SAFE_INTEGER。
 */
function integerSqrt(n) {
  const r = Math.round(Math.sqrt(n));
  for (const c of [r, r - 1, r + 1]) {
    if (c >= 0 && c * c === n) return c;
  }
  return null;
}

/** 两条达标装配的排序：相对误差最小 → 各级 (主动,从动) 下标序列自然序 */
function cmpLayoutMatches(a, b) {
  const ea = a.error.num * b.error.den;
  const eb = b.error.num * a.error.den;
  if (ea !== eb) return ea < eb ? -1 : 1;
  return cmpIdxs(a.idxs, b.idxs);
}

/**
 * 把一条轻量装配（仅含齿轮下标）展开为逐轴安装明细。
 *
 * @param {{idxs:Array<{driveIndex:number,drivenIndex:number}>,ratio:object,error:object}} m
 * @param {Array<{id:string,teeth:number}>} gears 已按编号自然序排序
 * @param {Array} stageDefs 每级几何信息（distance / requiredSum）
 * @param {Array<{x:number,y:number}>} axes 轴心坐标
 */
function enrichLayoutSolution(m, gears, stageDefs, axes) {
  const axisCount = axes.length;

  const pairs = m.idxs.map((p, i) => {
    const d = gears[p.driveIndex];
    const w = gears[p.drivenIndex];
    return {
      stage: i + 1,
      fromAxis: i + 1,
      toAxis: i + 2,
      dx: axes[i + 1].x - axes[i].x,
      dy: axes[i + 1].y - axes[i].y,
      axisDistance: stageDefs[i].distance,
      requiredTeethSum: stageDefs[i].requiredSum,
      drive: { id: d.id, teeth: d.teeth },
      driven: { id: w.id, teeth: w.teeth },
      stageRatio: makeFrac(BigInt(d.teeth), BigInt(w.teeth)),
    };
  });

  // 逐轴安装明细：首轴 1 枚主动轮、末轴 1 枚从动轮、中间轴同轴固定 2 枚
  const shafts = [];
  for (let a = 0; a < axisCount; a++) {
    const mounts = [];
    if (a === 0) {
      mounts.push({ stage: 1, role: '第 1 级主动轮（输入轴）', gear: pairs[0].drive });
    } else if (a === axisCount - 1) {
      const s = pairs.length;
      mounts.push({ stage: s, role: `第 ${s} 级从动轮（输出轴）`, gear: pairs[s - 1].driven });
    } else {
      mounts.push({ stage: a, role: `第 ${a} 级从动轮（同轴固定）`, gear: pairs[a - 1].driven });
      mounts.push({ stage: a + 1, role: `第 ${a + 1} 级主动轮（同轴固定）`, gear: pairs[a].drive });
    }
    shafts.push({ axis: a + 1, x: axes[a].x, y: axes[a].y, mounts });
  }

  const used = new Set();
  for (const p of m.idxs) {
    used.add(p.driveIndex);
    used.add(p.drivenIndex);
  }
  const unusedGears = gears.filter((_, gi) => !used.has(gi));

  return { stages: pairs.length, ratio: m.ratio, error: m.error, pairs, shafts, unusedGears };
}

/**
 * 轴位装配主入口：穷举每级满足轴距的有向配对并跨级组合（齿轮不重复），
 * 精确分数校核总速比与相对误差。
 *
 * @param {Array<{id:string,teeth:number}>} gears 已校验、按编号自然序排序的齿轮
 * @param {Array<{x:number,y:number}>} axes 2～4 个依次共线的轴心
 * @param {number} mod 正整数模数
 * @param {{num:bigint,den:bigint}} target 目标输出速比（正分数）
 * @param {{num:bigint,den:bigint}} tolerance 允许相对误差（非负分数）
 */
function planLayout(gears, axes, mod, target, tolerance) {
  const teeth = gears.map((g) => BigInt(g.teeth));

  // 第一步：由坐标与模数求每级啮合条件 2d/m（须为 ≥2 的整数）
  const stageDefs = [];
  for (let i = 0; i + 1 < axes.length; i++) {
    const dx = axes[i + 1].x - axes[i].x;
    const dy = axes[i + 1].y - axes[i].y;
    const distSq = dx * dx + dy * dy;
    const distance = integerSqrt(distSq);
    let requiredSum = null;
    if (distance !== null) {
      const twice = 2 * distance;
      if (twice % mod === 0) {
        const s = twice / mod;
        if (s >= 2) requiredSum = s;
      }
    }
    stageDefs.push({ stage: i + 1, dx, dy, distance, requiredSum });
  }

  // 第二步：每级枚举满足“主动齿数 + 从动齿数 = 2d/m”的全部有向配对
  const candidates = stageDefs.map((def) => {
    /** @type {Array<{driveIndex:number,drivenIndex:number}>} */
    const list = [];
    if (def.requiredSum === null) return list;
    for (let a = 0; a < gears.length; a++) {
      for (let b = 0; b < gears.length; b++) {
        if (a === b) continue;
        if (gears[a].teeth + gears[b].teeth === def.requiredSum) {
          list.push({ driveIndex: a, drivenIndex: b });
        }
      }
    }
    return list;
  });

  // 第三步：跨级组合（每枚齿轮全程只用一次），叶节点校核总速比
  const stageCount = stageDefs.length;
  const used = new Array(gears.length).fill(false);
  const chosen = new Array(stageCount);
  let assemblyCount = 0;
  /** @type {Array<{idxs:Array,ratio:object,error:object}>} */
  const matches = [];
  /** @type {{idxs:Array,ratio:object,error:object}|null} */
  let closest = null;

  function considerLeaf(rn, rd) {
    assemblyCount += 1;
    const lhs = rn * target.den - target.num * rd;
    const diff = lhs < 0n ? -lhs : lhs;
    const ratio = makeFrac(rn, rd);
    const error = makeFrac(diff, rd * target.num);
    const leaf = { idxs: chosen.map((p) => ({ ...p })), ratio, error };

    // 无论是否达标，都保留误差最小（并列按编号自然序）的一条装配
    if (!closest || cmpLayoutMatches(leaf, closest) < 0) closest = leaf;

    // 达标判定：diff/(rd·tn) ≤ tol，全程整数乘法
    if (diff * tolerance.den <= tolerance.num * target.num * rd) {
      matches.push(leaf);
    }
  }

  function dfs(s, rn, rd) {
    if (s === stageCount) {
      considerLeaf(rn, rd);
      return;
    }
    let extended = false;
    for (const p of candidates[s]) {
      if (used[p.driveIndex] || used[p.drivenIndex]) continue;
      extended = true;
      used[p.driveIndex] = true;
      used[p.drivenIndex] = true;
      chosen[s] = p;
      dfs(s + 1, rn * teeth[p.driveIndex], rd * teeth[p.drivenIndex]);
      used[p.driveIndex] = false;
      used[p.drivenIndex] = false;
    }
    // extended=false 时该分支无完整装配，自然剪枝（不计入 assemblyCount）
  }

  dfs(0, 1n, 1n);

  // 达标方案排序：误差最小 → 各级编号序列自然序
  matches.sort(cmpLayoutMatches);
  if (closest) closest = enrichLayoutSolution(closest, gears, stageDefs, axes);

  return {
    stages: stageDefs,
    candidateCounts: candidates.map((list) => list.length),
    assemblyCount,
    total: matches.length,
    best: matches.length
      ? enrichLayoutSolution(matches[0], gears, stageDefs, axes)
      : null,
    closest,
  };
}

module.exports = {
  MIN_AXES,
  MAX_AXES,
  MAX_MODULE,
  MAX_COORD,
  parseAxes,
  parseModule,
  validateGears,
  planLayout,
};
