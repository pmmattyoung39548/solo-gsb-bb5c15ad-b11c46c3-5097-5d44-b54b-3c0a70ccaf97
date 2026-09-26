'use strict';

const MIN_AXES = 2;
const MAX_AXES = 4;
const MIN_GEARS = 2;
const MAX_GEARS = 12;

const axisRowsBox = document.getElementById('axis-rows');
const gearRowsBox = document.getElementById('gear-rows');
const form = document.getElementById('layout-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const noSolution = document.getElementById('no-solution');
const geometryPanel = document.getElementById('geometry-panel');
const resultDetail = document.getElementById('result-detail');

const EXAMPLE_AXES = [
  { x: 0, y: '' },
  { x: 60, y: '' },
  { x: 90, y: '' },
];
const EXAMPLE_GEARS = [
  { id: 'G1', teeth: 10 },
  { id: 'G2', teeth: 20 },
  { id: 'G3', teeth: 24 },
  { id: 'G4', teeth: 36 },
  { id: 'G5', teeth: 40 },
  { id: 'G6', teeth: 50 },
];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 轴位行 ---------------- */

function addAxisRow(x = '', y = '') {
  const row = el('div', 'axis-row');
  row.innerHTML = `
    <span class="axis-index"></span>
    <input class="axis-x-input" type="number" step="1" placeholder="如 0" value="${x}" />
    <input class="axis-y-input" type="number" step="1" placeholder="留空 = 0" value="${y}" />
    <button type="button" class="btn danger-ghost" title="删除该轴心">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if (axisRowsBox.children.length <= MIN_AXES) {
      alert(`至少保留 ${MIN_AXES} 个轴心`);
      return;
    }
    row.remove();
    refreshAxisIndex();
  });
  axisRowsBox.appendChild(row);
  refreshAxisIndex();
}

function refreshAxisIndex() {
  const rows = axisRowsBox.querySelectorAll('.axis-row');
  const nums = '①②③④';
  // 首轴固定为输入轴、末轴为输出轴，其余为中间轴
  rows[0].querySelector('.axis-index').textContent = `${nums[0]} 输入轴`;
  rows[rows.length - 1].querySelector('.axis-index').textContent =
    `${nums[rows.length - 1]} 输出轴`;
  for (let i = 1; i < rows.length - 1; i++) {
    rows[i].querySelector('.axis-index').textContent = `${nums[i]} 中间轴`;
  }
}

document.getElementById('btn-axis-add').addEventListener('click', () => {
  if (axisRowsBox.children.length >= MAX_AXES) {
    alert(`最多 ${MAX_AXES} 个轴心`);
    return;
  }
  addAxisRow();
});

/* ---------------- 齿轮行 ---------------- */

function addGearRow(id = '', teeth = '') {
  const row = el('div', 'gear-row');
  row.innerHTML = `
    <input class="gear-id-input" placeholder="如 G1" value="${id}" />
    <input class="gear-teeth-input" type="number" min="1" max="100000" step="1" placeholder="齿数" value="${teeth}" />
    <button type="button" class="btn danger-ghost" title="删除该齿轮">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if (gearRowsBox.children.length <= MIN_GEARS) {
      alert(`至少保留 ${MIN_GEARS} 枚齿轮`);
      return;
    }
    row.remove();
  });
  gearRowsBox.appendChild(row);
}

document.getElementById('btn-gear-add').addEventListener('click', () => {
  if (gearRowsBox.children.length >= MAX_GEARS) {
    alert(`最多 ${MAX_GEARS} 枚齿轮`);
    return;
  }
  addGearRow();
});

document.getElementById('btn-example').addEventListener('click', () => {
  axisRowsBox.innerHTML = '';
  EXAMPLE_AXES.forEach((a) => addAxisRow(a.x, a.y));
  gearRowsBox.innerHTML = '';
  EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth));
  document.getElementById('module').value = '2';
  document.getElementById('target').value = '1/3';
  document.getElementById('tolerance').value = '5%';
});

/* 初始：示例数据 */
EXAMPLE_AXES.forEach((a) => addAxisRow(a.x, a.y));
EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth));

/* ---------------- 采集与校验 ---------------- */

function collectAxes() {
  const rows = [...axisRowsBox.querySelectorAll('.axis-row')];
  if (rows.length < MIN_AXES || rows.length > MAX_AXES) {
    throw new Error(`轴心数量需为 ${MIN_AXES}～${MAX_AXES} 个`);
  }
  return rows.map((row, i) => {
    const xRaw = row.querySelector('.axis-x-input').value.trim();
    const yRaw = row.querySelector('.axis-y-input').value.trim();
    if (!xRaw) throw new Error(`第 ${i + 1} 个轴心缺少 X 坐标（整数）`);
    const x = Number(xRaw);
    if (!Number.isInteger(x)) throw new Error(`第 ${i + 1} 个轴心的 X 坐标需为整数`);
    let y = 0;
    if (yRaw) {
      y = Number(yRaw);
      if (!Number.isInteger(y)) throw new Error(`第 ${i + 1} 个轴心的 Y 坐标需为整数（或留空表示 0）`);
    }
    return { x, y };
  });
}

function collectGears() {
  const gears = [];
  const ids = new Set();
  for (const row of gearRowsBox.querySelectorAll('.gear-row')) {
    const id = row.querySelector('.gear-id-input').value.trim();
    const teethRaw = row.querySelector('.gear-teeth-input').value.trim();
    if (!id && !teethRaw) continue;
    if (!id) throw new Error('存在未填写编号的齿轮行');
    if (ids.has(id)) throw new Error(`齿轮编号重复：${id}`);
    ids.add(id);
    const teeth = Number(teethRaw);
    if (!Number.isInteger(teeth) || teeth < 1) throw new Error(`齿轮 ${id} 的齿数需为正整数`);
    gears.push({ id, teeth });
  }
  if (gears.length < MIN_GEARS) throw new Error(`请至少填写 ${MIN_GEARS} 枚齿轮（最多 ${MAX_GEARS} 枚）`);
  if (gears.length > MAX_GEARS) throw new Error(`齿轮数量不能超过 ${MAX_GEARS} 枚`);
  return gears;
}

/* ---------------- 结果渲染 ---------------- */

/** 每级几何 / 啮合条件核对表（无论是否有解都展示） */
function renderGeometry(data) {
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级（轴间）</th><th>坐标差 (Δx, Δy)</th><th>轴距</th>
      <th>需求齿数和<br/>2d / m</th><th>本级有向配对数</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.stages.forEach((st) => {
    const tr = el('tr');
    const sumCell = st.meshingPossible
      ? `<strong>${st.requiredTeethSum}</strong>`
      : '<span class="meshing-no">无法满足</span>';
    const candCell = st.meshingPossible
      ? `${st.candidateCount} 对`
      : '<span class="meshing-no">—</span>';
    tr.innerHTML = `
      <td>第 ${st.stage} 级<br/><span class="torque-rated">轴 ${st.stage} → 轴 ${st.stage + 1}</span></td>
      <td class="frac">(${st.dx}, ${st.dy})</td>
      <td>${st.distance === null ? `√${st.distanceSquared}` : st.distance}</td>
      <td>${sumCell}</td>
      <td>${candCell}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderShafts(sol) {
  const wrap = el('div', 'shafts-panel');
  wrap.appendChild(el('h3', 'block-title', '逐轴安装明细'));
  const table = el('table', 'pairs shaft-table');
  table.innerHTML = `
    <thead><tr>
      <th>轴</th><th>轴心坐标</th><th>安装齿轮（编号 / 齿数 / 角色）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  sol.shafts.forEach((s) => {
    const tr = el('tr');
    const mounts = s.mounts.map((m) =>
      `<div class="mount-item"><span class="gear-id">${m.gear.id}</span> · ${m.gear.teeth} 齿
        <span class="torque-rated">${m.role}（第 ${m.stage} 级）</span></div>`).join('');
    tr.innerHTML = `
      <td>轴 ${s.axis}</td>
      <td class="frac">(${s.x}, ${s.y})</td>
      <td class="mount-cell">${mounts}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderPairs(sol) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '逐级啮合配对'));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级</th><th>主动轮（编号 / 齿数）</th><th>从动轮（编号 / 齿数）</th>
      <th>齿数和<br/>(= 2d/m)</th><th>本级速比（主动/从动）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  sol.pairs.forEach((p) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>第 ${p.stage} 级<div class="torque-rated">轴 ${p.fromAxis} → 轴 ${p.toAxis}</div></td>
      <td><span class="gear-id">${p.drive.id}</span> · ${p.drive.teeth} 齿</td>
      <td><span class="gear-id">${p.driven.id}</span> · ${p.driven.teeth} 齿</td>
      <td>${p.drive.teeth + p.driven.teeth}<div class="torque-rated">轴距 ${p.axisDistance}，m 见上</div></td>
      <td class="frac">${p.stageRatio.num}/${p.stageRatio.den} ≈ ${p.stageRatio.decimal}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderSolutionCard(sol, { best }) {
  const card = el('div', `solution${best ? ' best' : ' best-warn'}`);
  const head = el('div', 'solution-head');
  const badge = best ? '<span class="badge">最优达标方案</span>' : '<span class="badge badge-warn">误差最小（不达标）</span>';
  head.appendChild(el('span', 'solution-title',
    `${badge}${sol.stages} 级传动`));
  head.appendChild(el('span', 'solution-meta',
    `实际转速比 <strong class="frac">${sol.ratio.num}/${sol.ratio.den}</strong>` +
    ` ≈ <strong>${sol.ratio.decimal}</strong>` +
    ` &nbsp;|&nbsp; 相对误差 <strong>${sol.errorPercent}%</strong>`));
  card.appendChild(head);
  card.appendChild(renderPairs(sol));
  card.appendChild(renderShafts(sol));
  if (sol.unusedGears.length) {
    const unused = el('p', 'muted',
      `未使用齿轮：${sol.unusedGears.map((g) => `${g.id}(${g.teeth} 齿)`).join('、')}`);
    card.appendChild(unused);
  }
  return card;
}

/* ---------------- 提交 ---------------- */

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    const mod = Number(document.getElementById('module').value.trim());
    if (!Number.isInteger(mod) || mod < 1) throw new Error('模数需为正整数');
    payload = {
      axes: collectAxes(),
      module: mod,
      target: document.getElementById('target').value,
      tolerance: document.getElementById('tolerance').value,
      gears: collectGears(),
    };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '轴位装配计算失败');

    resultPanel.hidden = false;
    geometryPanel.innerHTML = '';
    resultDetail.innerHTML = '';
    noSolution.hidden = true;
    noSolution.className = 'alert';

    resultSummary.textContent =
      `目标比 ${data.target.num}/${data.target.den} ≈ ${data.target.decimal}，` +
      `允许误差 ${data.tolerance.decimal}，模数 m = ${data.module}，` +
      `${data.stageCount} 级传动，共枚举 ${data.assemblyCount} 种满足全部轴距的完整装配`;

    geometryPanel.appendChild(renderGeometry(data));

    if (!data.feasible) {
      // 区分“无可啮合装配”（meshing）与“可装配但速比不达标”（ratio）
      noSolution.className = `alert ${data.reason === 'meshing' ? 'error' : 'warn'}`;
      noSolution.textContent = data.message;
      noSolution.hidden = false;
      if (data.reason === 'ratio' && data.closest) {
        resultDetail.appendChild(renderSolutionCard(data.closest, { best: false }));
      }
      return;
    }

    resultSummary.textContent += `，达标方案共 ${data.total} 种（下列为最优）`;
    resultDetail.appendChild(renderSolutionCard(data.best, { best: true }));
  } catch (e) {
    resultPanel.hidden = false;
    geometryPanel.innerHTML = '';
    resultDetail.innerHTML = '';
    resultSummary.textContent = '';
    noSolution.hidden = false;
    noSolution.className = 'alert error';
    noSolution.textContent = `请求出错：${e.message}`;
  }
});
