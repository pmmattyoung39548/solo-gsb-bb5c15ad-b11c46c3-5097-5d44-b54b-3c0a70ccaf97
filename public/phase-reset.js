'use strict';

const MIN_STAGES = 1;
const MAX_STAGES = 3;

const stageRowsBox = document.getElementById('stage-rows');
const phaseRowsBox = document.getElementById('phase-rows');
const form = document.getElementById('phase-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const verdictAlert = document.getElementById('verdict-alert');
const resultDetail = document.getElementById('result-detail');

const EXAMPLE_STAGES = [
  { driveTeeth: 20, drivenTeeth: 40 },
  { driveTeeth: 24, drivenTeeth: 36 },
  { driveTeeth: 18, drivenTeeth: 54 },
];
const EXAMPLE_PHASES = ['0', '1/2', '1/3', '8/9'];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function currentAxisCount() {
  return stageRowsBox.querySelectorAll('.stage-row').length + 1;
}

/* ---------------- 级行 ---------------- */

function addStageRow(driveTeeth = '', drivenTeeth = '') {
  const row = el('div', 'stage-row');
  row.innerHTML = `
    <span class="stage-index"></span>
    <input class="stage-drive-input" type="number" min="1" max="100000" step="1" placeholder="主动齿数" value="${driveTeeth}" />
    <input class="stage-driven-input" type="number" min="1" max="100000" step="1" placeholder="从动齿数" value="${drivenTeeth}" />
    <button type="button" class="btn danger-ghost" title="删除该级">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if (stageRowsBox.querySelectorAll('.stage-row').length <= MIN_STAGES) {
      alert(`至少保留 ${MIN_STAGES} 级`);
      return;
    }
    row.remove();
    refreshStageIndex();
  });
  stageRowsBox.appendChild(row);
  refreshStageIndex();
}

function refreshStageIndex() {
  const rows = [...stageRowsBox.querySelectorAll('.stage-row')];
  rows.forEach((r, i) => {
    r.querySelector('.stage-index').textContent = `第 ${i + 1} 级（轴 ${i + 1} → 轴 ${i + 2}）`;
  });
  refreshPhaseRows();
}

/* ---------------- 各轴相位行（数量 = 级数 + 1，随级数联动） ---------------- */

function refreshPhaseRows() {
  const axisCount = currentAxisCount();
  const old = [...phaseRowsBox.querySelectorAll('.phase-input')].map((inp) => inp.value);
  phaseRowsBox.innerHTML = '';
  for (let a = 1; a <= axisCount; a++) {
    const role = a === 1 ? '输入轴' : `第 ${a - 1} 级输出轴`;
    const row = el('div', 'phase-row');
    row.innerHTML = `
      <span class="phase-axis">轴 ${a}（${role}）</span>
      <input class="phase-input" type="text" inputmode="decimal" placeholder="如 0、1/3、0.5" value="${old[a - 1] ?? '0'}" />`;
    phaseRowsBox.appendChild(row);
  }
}

function setPhaseValues(values) {
  [...phaseRowsBox.querySelectorAll('.phase-input')].forEach((inp, i) => {
    inp.value = values[i] ?? '0';
  });
}

document.getElementById('btn-stage-add').addEventListener('click', () => {
  if (stageRowsBox.querySelectorAll('.stage-row').length >= MAX_STAGES) {
    alert(`最多 ${MAX_STAGES} 级`);
    return;
  }
  addStageRow();
});

document.getElementById('btn-example').addEventListener('click', () => {
  stageRowsBox.innerHTML = '';
  EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth));
  setPhaseValues(EXAMPLE_PHASES);
});

/* 初始：示例数据 */
EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth));
setPhaseValues(EXAMPLE_PHASES);

/* ---------------- 采集与校验 ---------------- */

function collectStages() {
  const rows = [...stageRowsBox.querySelectorAll('.stage-row')];
  if (rows.length < MIN_STAGES || rows.length > MAX_STAGES) {
    throw new Error(`级数需为 ${MIN_STAGES}～${MAX_STAGES} 级`);
  }
  return rows.map((row, i) => {
    const drive = Number(row.querySelector('.stage-drive-input').value.trim());
    const driven = Number(row.querySelector('.stage-driven-input').value.trim());
    if (!Number.isInteger(drive) || drive < 1) {
      throw new Error(`第 ${i + 1} 级主动齿数需为正整数`);
    }
    if (!Number.isInteger(driven) || driven < 1) {
      throw new Error(`第 ${i + 1} 级从动齿数需为正整数`);
    }
    return { driveTeeth: drive, drivenTeeth: driven };
  });
}

function collectPhases(axisCount) {
  const inputs = [...phaseRowsBox.querySelectorAll('.phase-input')];
  if (inputs.length !== axisCount) {
    throw new Error(`需填写 ${axisCount} 个轴的初始标记相位`);
  }
  return inputs.map((inp, i) => {
    const v = inp.value.trim();
    if (!v) throw new Error(`轴 ${i + 1} 缺少初始标记相位（零位请填 0）`);
    if (!/^(\d+|\d+\/\d+|\d*\.\d+)$/.test(v)) {
      throw new Error(`轴 ${i + 1} 的相位格式不正确：填分数 p/q（如 1/3）或小数（如 0.5），且 0 ≤ 相位 < 1`);
    }
    return v;
  });
}

/* ---------------- 结果渲染 ---------------- */

function fracText(f) {
  return `${f.num}/${f.den} ≈ ${f.decimal}`;
}

function congruenceText(c) {
  if (c.modulus === '1') return 'N ≡ 0 (mod 1)（任意整数圈均可）';
  return `N ≡ ${c.residue} (mod ${c.modulus})`;
}

function renderAxisTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '① 逐轴有向转数与回零同余（按齿数连乘，外啮合逐级反向）'));
  const ratioLine = data.stages
    .map((st) => `第 ${st.stage} 级 ${st.driveTeeth}/${st.drivenTeeth} = ${st.stageRatio.num}/${st.stageRatio.den}`)
    .join('，');
  wrap.appendChild(el('p', 'muted', `各级速比（主动/从动）：${ratioLine}`));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>轴</th><th>角色</th><th>初始标记相位 φ</th>
      <th>每输入 1 圈的有向转数 s<br/>（负号 = 与输入轴反向）</th>
      <th>回零条件（N·s + φ ∈ ℤ）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.axes.forEach((ax) => {
    const tr = el('tr');
    const cond = ax.solvable
      ? `<span class="frac">${congruenceText(ax.congruence)}</span>`
      : `<span class="diag-bad">任何整数圈都无法回零</span><div class="torque-rated">${ax.unsolvableReason}</div>`;
    tr.innerHTML = `
      <td>轴 ${ax.axis}</td>
      <td>${ax.role}</td>
      <td class="frac">${fracText(ax.phase)}</td>
      <td class="frac">${fracText(ax.ratioPerInputTurn)}</td>
      <td>${cond}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderMergeSteps(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '② 模同余合并（广义中国剩余定理：非互素模按 gcd 判兼容、按 lcm 合并）'));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr><th>步骤</th><th>合并过程</th><th>判定</th><th>当前合并结果</th></tr></thead>`;
  const tbody = el('tbody');
  data.mergeSteps.forEach((st) => {
    const tr = el('tr');
    let verdict;
    if (st.action === 'start') {
      verdict = '<span class="diag-ok">起点</span>';
    } else if (st.compatible) {
      verdict = `<span class="diag-ok">兼容</span><div class="torque-rated">gcd = ${st.gcd}</div>`;
    } else {
      verdict = `<span class="diag-bad">冲突</span><div class="torque-rated">gcd = ${st.gcd}</div>`;
    }
    const merged = st.mergedModulus
      ? `<span class="frac">N ≡ ${st.mergedResidue} (mod ${st.mergedModulus})</span>`
      : '<span class="diag-bad">无共同解</span>';
    tr.innerHTML = `
      <td>${st.step}</td>
      <td style="text-align:left">${st.note}</td>
      <td>${verdict}</td>
      <td>${merged}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderSolvable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '③ 结论：最早圈数与各轴转数'));
  const box = el('div', 'solution best');
  box.innerHTML = `
    <div class="solution-head">
      <span class="solution-title">最早同时回零：输入轴再转 <span class="phase-big">${data.earliestTurns}</span> 圈</span>
      <span class="badge">可校准</span>
    </div>
    <div class="solution-meta">
      全部整数解为同余 <strong>N ≡ ${data.residue} (mod ${data.period})</strong>：
      ${data.earliestTurns} 圈为严格正整数中的最小解，之后每 ${data.period} 圈再次同时回零。
    </div>`;
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>轴</th><th>角色</th><th>有向转数 N·s<br/>（负号 = 与输入轴反向）</th><th>相位校核 φ + N·s</th><th>标记</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.axes.forEach((ax) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>轴 ${ax.axis}</td>
      <td>${ax.role}</td>
      <td class="frac">${fracText(ax.revolutions)}</td>
      <td class="frac">${ax.phase.num}/${ax.phase.den} + (${ax.revolutions.num}/${ax.revolutions.den}) = ${ax.phaseAfter.num}/${ax.phaseAfter.den} ∈ ℤ</td>
      <td><span class="diag-ok">回零 ✓</span></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);
  wrap.appendChild(box);
  return wrap;
}

function renderConflicts(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '③ 结论：无法同时回零（冲突轴）'));
  const box = el('div', 'solution miss');
  const chips = data.conflictAxes.map((a) => `<span class="chip">轴 ${a}</span>`).join('');
  box.innerHTML = `
    <div class="solution-head">
      <span class="solution-title">不存在使全部轴同时回零的整数圈数</span>
      <span class="badge badge-miss">冲突</span>
    </div>
    <div class="solution-meta">涉及冲突的轴：</div>
    <div class="chip-list">${chips}</div>`;

  const badAxes = data.axes.filter((ax) => !ax.solvable);
  if (badAxes.length) {
    box.appendChild(el('h3', 'block-title', '任何整数圈都无法回零的轴（相位分母不整除转数分母）'));
    const table = el('table', 'pairs');
    table.innerHTML = `
      <thead><tr><th>轴</th><th>初始相位 φ</th><th>每输入 1 圈有向转数 s</th><th>不可解原因</th></tr></thead>`;
    const tbody = el('tbody');
    badAxes.forEach((ax) => {
      const tr = el('tr');
      tr.innerHTML = `
        <td>轴 ${ax.axis}</td>
        <td class="frac">${fracText(ax.phase)}</td>
        <td class="frac">${fracText(ax.ratioPerInputTurn)}</td>
        <td style="text-align:left"><span class="diag-bad">${ax.unsolvableReason}</span></td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    box.appendChild(table);
  }

  if (data.conflictPairs.length) {
    box.appendChild(el('h3', 'block-title', '回零条件互斥的轴对（模不互素且余数在模 gcd 下不同）'));
    const table = el('table', 'pairs');
    table.innerHTML = `
      <thead><tr><th>轴对</th><th>同余一</th><th>同余二</th><th>gcd</th><th>说明</th></tr></thead>`;
    const tbody = el('tbody');
    data.conflictPairs.forEach((cp) => {
      const tr = el('tr');
      tr.innerHTML = `
        <td>轴 ${cp.axisA} × 轴 ${cp.axisB}</td>
        <td class="frac">N ≡ ${cp.residueA} (mod ${cp.modulusA})</td>
        <td class="frac">N ≡ ${cp.residueB} (mod ${cp.modulusB})</td>
        <td class="frac">${cp.gcd}</td>
        <td style="text-align:left"><span class="diag-bad">${cp.residueA} ≢ ${cp.residueB} (mod ${cp.gcd})</span>，两同余无共同解</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    box.appendChild(table);
  }

  wrap.appendChild(box);
  return wrap;
}

/* ---------------- 提交 ---------------- */

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    const stages = collectStages();
    payload = { stages, phases: collectPhases(stages.length + 1) };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/phase-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '校准计算失败');

    resultPanel.hidden = false;
    resultDetail.innerHTML = '';

    resultSummary.textContent = `${data.stageCount} 级传动 / ${data.axisCount} 个轴`;

    verdictAlert.hidden = false;
    verdictAlert.className = `alert ${data.solvable ? 'ok' : 'error'}`;
    verdictAlert.innerHTML = `<strong>${data.solvable ? '可同时回零' : '无法同时回零'}：</strong>${data.message}`;

    resultDetail.appendChild(renderAxisTable(data));
    resultDetail.appendChild(renderMergeSteps(data));
    resultDetail.appendChild(data.solvable ? renderSolvable(data) : renderConflicts(data));
  } catch (e) {
    resultPanel.hidden = false;
    resultDetail.innerHTML = '';
    resultSummary.textContent = '';
    verdictAlert.hidden = false;
    verdictAlert.className = 'alert error';
    verdictAlert.textContent = `请求出错：${e.message}`;
  }
});
