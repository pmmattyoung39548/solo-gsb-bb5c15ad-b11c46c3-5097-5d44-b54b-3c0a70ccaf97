'use strict';

const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MAX_OBSERVATIONS = 20;

const stageRowsBox = document.getElementById('stage-rows');
const obsList = document.getElementById('obs-list');
const form = document.getElementById('diagnose-form');
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
const EXAMPLE_OBSERVATIONS = [
  {
    name: '观测一（全轴同测）',
    readings: [
      { axis: 1, revolutions: 3600, error: 5 },
      { axis: 2, revolutions: 1800, error: 4 },
      { axis: 3, revolutions: 1320, error: 3 },
      { axis: 4, revolutions: 440, error: 2 },
    ],
  },
  {
    name: '观测二（缺第 3 轴）',
    readings: [
      { axis: 1, revolutions: 3000, error: 5 },
      { axis: 2, revolutions: 1500, error: 4 },
      { axis: 4, revolutions: 366.67, error: 2 },
    ],
  },
];

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
  // 轴数变化后刷新各观测读数行的轴号提示
  const axisCount = rows.length + 1;
  obsList.querySelectorAll('.obs-card').forEach((card) => {
    card.querySelectorAll('.reading-axis-input').forEach((inp) => {
      inp.max = axisCount;
      inp.placeholder = `轴号 1～${axisCount}`;
    });
    card.querySelector('.obs-axis-hint').textContent =
      `轴 1 = 输入轴，轴 ${axisCount} = 输出轴，二者必填，中间轴可缺`;
  });
}

document.getElementById('btn-stage-add').addEventListener('click', () => {
  if (stageRowsBox.querySelectorAll('.stage-row').length >= MAX_STAGES) {
    alert(`最多 ${MAX_STAGES} 级`);
    return;
  }
  addStageRow();
});

/* ---------------- 观测卡片 ---------------- */

function addReadingRow(card, axis = '', revolutions = '', error = '') {
  const rowsBox = card.querySelector('.reading-rows');
  const row = el('div', 'reading-row');
  row.innerHTML = `
    <input class="reading-axis-input" type="number" min="1" step="1" placeholder="轴号" value="${axis}" />
    <input class="reading-rev-input" type="text" inputmode="decimal" placeholder="转数（如 3600）" value="${revolutions}" />
    <input class="reading-err-input" type="text" inputmode="decimal" placeholder="绝对误差（如 5）" value="${error}" />
    <button type="button" class="btn danger-ghost" title="删除该读数">✕</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  rowsBox.appendChild(row);
}

function addObservationCard(obs = {}) {
  const card = el('div', 'obs-card');
  const head = el('div', 'obs-head');
  head.innerHTML = `
    <input class="obs-name-input" type="text" maxlength="30" placeholder="观测名称（可空）" value="${obs.name ?? ''}" />
    <span class="obs-axis-hint muted"></span>
    <div class="btn-row">
      <button type="button" class="btn ghost btn-reading-add">＋ 添加读数</button>
      <button type="button" class="btn danger-ghost btn-obs-del" title="删除该次观测">删除观测</button>
    </div>`;
  const rowsBox = el('div', 'reading-rows');
  const headRow = el('div', 'reading-grid-head');
  headRow.innerHTML = '<span>轴号</span><span>该时段转数</span><span>读数绝对误差</span><span></span>';
  card.appendChild(head);
  card.appendChild(rowsBox);
  head.querySelector('.btn-reading-add').addEventListener('click', () => addReadingRow(card));
  head.querySelector('.btn-obs-del').addEventListener('click', () => {
    if (obsList.querySelectorAll('.obs-card').length <= 1) {
      alert('至少保留 1 次观测');
      return;
    }
    card.remove();
  });
  (obs.readings || []).forEach((rd) => addReadingRow(card, rd.axis, rd.revolutions, rd.error));
  obsList.appendChild(card);
  refreshStageIndex();
}

document.getElementById('btn-obs-add').addEventListener('click', () => {
  if (obsList.querySelectorAll('.obs-card').length >= MAX_OBSERVATIONS) {
    alert(`最多 ${MAX_OBSERVATIONS} 次观测`);
    return;
  }
  const axisCount = currentAxisCount();
  addObservationCard({
    readings: [
      { axis: 1, revolutions: '', error: '' },
      { axis: axisCount, revolutions: '', error: '' },
    ],
  });
});

document.getElementById('btn-example').addEventListener('click', () => {
  stageRowsBox.innerHTML = '';
  EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth));
  obsList.innerHTML = '';
  EXAMPLE_OBSERVATIONS.forEach((o) => addObservationCard(o));
});

/* 初始：示例数据 */
EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth));
EXAMPLE_OBSERVATIONS.forEach((o) => addObservationCard(o));

/* ---------------- 采集与校验 ---------------- */

function collectStages() {
  const stages = [];
  const rows = [...stageRowsBox.querySelectorAll('.stage-row')];
  if (rows.length < MIN_STAGES || rows.length > MAX_STAGES) {
    throw new Error(`级数需为 ${MIN_STAGES}～${MAX_STAGES} 级`);
  }
  rows.forEach((row, i) => {
    const drive = Number(row.querySelector('.stage-drive-input').value.trim());
    const driven = Number(row.querySelector('.stage-driven-input').value.trim());
    if (!Number.isInteger(drive) || drive < 1) {
      throw new Error(`第 ${i + 1} 级主动齿数需为正整数`);
    }
    if (!Number.isInteger(driven) || driven < 1) {
      throw new Error(`第 ${i + 1} 级从动齿数需为正整数`);
    }
    stages.push({ driveTeeth: drive, drivenTeeth: driven });
  });
  return stages;
}

function collectObservations(axisCount) {
  const cards = [...obsList.querySelectorAll('.obs-card')];
  if (cards.length < 1) throw new Error('至少需要 1 次观测');
  if (cards.length > MAX_OBSERVATIONS) throw new Error(`观测次数不能超过 ${MAX_OBSERVATIONS}`);
  return cards.map((card, oi) => {
    const tag = `第 ${oi + 1} 次观测`;
    const name = card.querySelector('.obs-name-input').value.trim();
    const readings = [];
    const seen = new Set();
    for (const row of card.querySelectorAll('.reading-row')) {
      const axisRaw = row.querySelector('.reading-axis-input').value.trim();
      const revRaw = row.querySelector('.reading-rev-input').value.trim();
      const errRaw = row.querySelector('.reading-err-input').value.trim();
      if (!axisRaw && !revRaw && !errRaw) continue;
      if (!axisRaw) throw new Error(`${tag}存在未填轴号的读数行`);
      const axis = Number(axisRaw);
      if (!Number.isInteger(axis) || axis < 1 || axis > axisCount) {
        throw new Error(`${tag}读数轴号需为 1～${axisCount} 的整数`);
      }
      if (seen.has(axis)) throw new Error(`${tag}轴 ${axis} 的读数重复：同一观测中每个轴只能记录一次`);
      seen.add(axis);
      if (!revRaw) throw new Error(`${tag}轴 ${axis} 缺少转数`);
      const rev = Number(revRaw);
      if (!Number.isFinite(rev) || rev <= 0) throw new Error(`${tag}轴 ${axis} 的转数必须为正数（当前 ${revRaw}）`);
      if (!errRaw) throw new Error(`${tag}轴 ${axis} 缺少绝对误差（无误差请填 0）`);
      const err = Number(errRaw);
      if (!Number.isFinite(err) || err < 0) throw new Error(`${tag}轴 ${axis} 的绝对误差不能为负数（当前 ${errRaw}）`);
      if (err >= rev) {
        throw new Error(`${tag}轴 ${axis} 的绝对误差不小于转数本身，真实转数区间覆盖零值，无法计算速比区间`);
      }
      readings.push({ axis, revolutions: revRaw, error: errRaw });
    }
    if (readings.length < 2) throw new Error(`${tag}至少需要输入轴与输出轴两条读数`);
    if (!seen.has(1)) throw new Error(`${tag}缺少输入轴（轴 1）同一时段的转数读数`);
    if (!seen.has(axisCount)) {
      throw new Error(`${tag}缺少输出轴（轴 ${axisCount}）同一时段的转数读数`);
    }
    return { name, readings };
  });
}

/* ---------------- 结果渲染 ---------------- */

const VERDICT_META = {
  normal: { cls: 'ok', label: '传动正常' },
  suspect: { cls: 'warn', label: '可疑级位' },
  ambiguous: { cls: 'warn', label: '多个级位无法区分' },
  inconsistent: { cls: 'error', label: '与单级恒定偏差假设不符' },
};

function fracText(f) {
  return `${f.num}/${f.den} ≈ ${f.decimal}`;
}

function renderTheoryTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '理论速比（按齿数精确计算）'));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级 / 轴</th><th>主动齿</th><th>从动齿</th><th>本级速比（主动/从动）</th>
      <th>该轴相对输入轴<br/>理论转速比</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.stages.forEach((st, i) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>第 ${st.stage} 级<div class="torque-rated">轴 ${st.stage} → 轴 ${st.stage + 1}</div></td>
      <td>${st.driveTeeth}</td>
      <td>${st.drivenTeeth}</td>
      <td class="frac">${fracText(st.stageRatio)}</td>
      <td class="frac">轴 ${st.stage + 1}：${fracText(data.shaftRatios[st.stage])}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderCandidateTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '逐级恒定倍率可行性（假设至多一级存在跨观测恒定倍率偏差）'));
  const table = el('table', 'pairs diag-cand-table');
  table.innerHTML = `
    <thead><tr>
      <th>级位</th><th>含该级轴段要求的<br/>恒定倍率 m 区间</th>
      <th>区间含正常倍率 1</th>
      <th>不含该级轴段<br/>交叉核对</th><th>判定</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.candidates.forEach((c) => {
    const tr = el('tr');
    const st = data.stages[c.stage - 1];
    let verdictCell;
    if (!data.normal && c.feasible && data.suspectStage === c.stage) {
      verdictCell = '<span class="diag-tag diag-tag-suspect">★ 唯一可疑级位</span>';
    } else if (c.feasible) {
      verdictCell = '<span class="diag-tag diag-tag-amb">可行候选</span>';
    } else if (!c.intersectionNonEmpty) {
      verdictCell = '<span class="diag-tag diag-tag-out">倍率区间无交集（排除）</span>';
    } else {
      verdictCell = '<span class="diag-tag diag-tag-out">交叉核对失败（排除）</span>';
    }
    const cross = c.crossCheckFailed.length === 0
      ? '<span class="diag-ok">全部相符</span>'
      : `<span class="diag-bad">${c.crossCheckFailed.length} 个轴段偏离理论</span>` +
        `<div class="torque-rated">${c.crossCheckFailed
          .map((s) => `第 ${s.observation} 次：轴 ${s.fromAxis}→${s.toAxis}`)
          .join('<br/>')}</div>`;
    const range = c.intersectionNonEmpty
      ? `<span class="frac">[${fracText(c.factorLow)}]</span><br/>～<br/><span class="frac">[${fracText(c.factorHigh)}]</span>`
      : '<span class="diag-bad">区间无交集</span>';
    tr.innerHTML = `
      <td>第 ${c.stage} 级<div class="torque-rated">主动 ${st.driveTeeth} / 从动 ${st.drivenTeeth}</div></td>
      <td>${range}</td>
      <td>${c.containsUnity ? '<span class="diag-ok">是（倍率 1 不可排除）</span>' : '<span class="diag-bad">否</span>'}</td>
      <td>${cross}</td>
      <td>${verdictCell}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderObservation(ob, oi) {
  const wrap = el('div', 'obs-result');
  wrap.appendChild(el('h3', 'block-title', `第 ${oi + 1} 次观测：${ob.name}（记录轴 ${ob.axes.join('、')}）`));

  const readTable = el('table', 'pairs');
  readTable.innerHTML = `
    <thead><tr><th>轴</th><th>转数读数 N</th><th>绝对误差 e</th><th>真实转数区间 [N−e, N+e]</th></tr></thead>`;
  const readBody = el('tbody');
  ob.readings.forEach((rd) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>轴 ${rd.axis}</td>
      <td class="frac">${rd.revolutions.decimal}</td>
      <td class="frac">±${rd.error.decimal}</td>
      <td class="frac">[${subDec(rd, true)}, ${subDec(rd, false)}]</td>`;
    readBody.appendChild(tr);
  });
  readTable.appendChild(readBody);
  wrap.appendChild(readTable);

  const segTable = el('table', 'pairs');
  segTable.innerHTML = `
    <thead><tr>
      <th>轴段</th><th>实测速比区间（由误差区间精确换算）</th>
      <th>理论速比</th><th>是否相符<br/>（区间覆盖理论值）</th>
    </tr></thead>`;
  const segBody = el('tbody');
  ob.segments.forEach((s) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>轴 ${s.fromAxis} → 轴 ${s.toAxis}</td>
      <td class="frac">[${fracText(s.low)}]<br/>～<br/>[${fracText(s.high)}]</td>
      <td class="frac">${fracText(s.theory)}</td>
      <td>${s.normal ? '<span class="diag-ok">相符</span>' : '<span class="diag-bad">偏离</span>'}</td>`;
    segBody.appendChild(tr);
  });
  segTable.appendChild(segBody);
  wrap.appendChild(segTable);
  return wrap;
}

/** 读数 N±e 的区间端点小数（减法/加法在序列化分数上做展示级近似） */
function subDec(rd, lower) {
  const n = Number(rd.revolutions.num) / Number(rd.revolutions.den);
  const e = Number(rd.error.num) / Number(rd.error.den);
  const v = lower ? n - e : n + e;
  return String(Number(v.toFixed(6)));
}

/* ---------------- 提交 ---------------- */

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    const stages = collectStages();
    payload = { stages, observations: collectObservations(stages.length + 1) };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '诊断失败');

    resultPanel.hidden = false;
    resultDetail.innerHTML = '';

    resultSummary.textContent =
      `${data.stageCount} 级传动 / ${data.axisCount} 个轴，共 ${data.observationCount} 次观测`;

    const meta = VERDICT_META[data.verdict];
    verdictAlert.hidden = false;
    verdictAlert.className = `alert ${meta.cls}`;
    verdictAlert.innerHTML = `<strong>${meta.label}：</strong>${data.message}`;

    resultDetail.appendChild(renderTheoryTable(data));
    resultDetail.appendChild(renderCandidateTable(data));
    data.observations.forEach((ob, oi) => {
      resultDetail.appendChild(renderObservation(ob, oi));
    });
  } catch (e) {
    resultPanel.hidden = false;
    resultDetail.innerHTML = '';
    resultSummary.textContent = '';
    verdictAlert.hidden = false;
    verdictAlert.className = 'alert error';
    verdictAlert.textContent = `请求出错：${e.message}`;
  }
});
