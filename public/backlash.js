'use strict';

const MIN_STAGES = 1;
const MAX_STAGES = 3;

const stageRowsBox = document.getElementById('stage-rows');
const form = document.getElementById('backlash-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const verdictAlert = document.getElementById('verdict-alert');
const resultDetail = document.getElementById('result-detail');
const expectedInput = document.getElementById('expected-turns');

const EXAMPLE_STAGES = [
  { driveTeeth: 20, drivenTeeth: 40, low: '1/8', high: '1/4' },
  { driveTeeth: 24, drivenTeeth: 36, low: '1/12', high: '1/6' },
];
const EXAMPLE_EXPECTED = '5';

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 级行（齿数 + 从动轴侧齿隙区间） ---------------- */

function addStageRow(driveTeeth = '', drivenTeeth = '', low = '', high = '') {
  const row = el('div', 'lash-row');
  row.innerHTML = `
    <span class="stage-index"></span>
    <input class="stage-drive-input" type="number" min="1" max="100000" step="1" placeholder="主动齿数" value="${driveTeeth}" />
    <input class="stage-driven-input" type="number" min="1" max="100000" step="1" placeholder="从动齿数" value="${drivenTeeth}" />
    <input class="lash-low-input" type="text" inputmode="decimal" placeholder="如 0、1/8" value="${low}" />
    <input class="lash-high-input" type="text" inputmode="decimal" placeholder="如 1/4、0.25" value="${high}" />
    <button type="button" class="btn danger-ghost" title="删除该级">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if (stageRowsBox.querySelectorAll('.lash-row').length <= MIN_STAGES) {
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
  const rows = [...stageRowsBox.querySelectorAll('.lash-row')];
  rows.forEach((r, i) => {
    r.querySelector('.stage-index').textContent = `第 ${i + 1} 级（轴 ${i + 1} → 轴 ${i + 2}）`;
  });
}

document.getElementById('btn-stage-add').addEventListener('click', () => {
  if (stageRowsBox.querySelectorAll('.lash-row').length >= MAX_STAGES) {
    alert(`最多 ${MAX_STAGES} 级`);
    return;
  }
  addStageRow();
});

document.getElementById('btn-example').addEventListener('click', () => {
  stageRowsBox.innerHTML = '';
  EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth, s.low, s.high));
  expectedInput.value = EXAMPLE_EXPECTED;
});

/* 初始：示例数据 */
EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth, s.low, s.high));
expectedInput.value = EXAMPLE_EXPECTED;

/* ---------------- 采集与校验 ---------------- */

const FRAC_RE = /^(\d+|\d+\/\d+|\d*\.\d+)$/;

function collectStages() {
  const rows = [...stageRowsBox.querySelectorAll('.lash-row')];
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
    const low = row.querySelector('.lash-low-input').value.trim();
    const high = row.querySelector('.lash-high-input').value.trim();
    if (!FRAC_RE.test(low)) {
      throw new Error(`第 ${i + 1} 级齿隙下限格式不正确：填非负分数 p/q（如 1/8）或小数（如 0.125），无齿隙填 0`);
    }
    if (!FRAC_RE.test(high)) {
      throw new Error(`第 ${i + 1} 级齿隙上限格式不正确：填非负分数 p/q（如 1/8）或小数（如 0.125），无齿隙填 0`);
    }
    return { driveTeeth: drive, drivenTeeth: driven, backlash: { low, high } };
  });
}

function collectExpected() {
  const v = expectedInput.value.trim();
  if (!v) throw new Error('请填写期望输出转数（正分数）');
  if (!FRAC_RE.test(v)) {
    throw new Error('期望输出转数格式不正确：填正分数 p/q（如 7/2）或小数（如 2.5）');
  }
  return v;
}

/* ---------------- 结果渲染 ---------------- */

function fracText(f) {
  return `${f.num}/${f.den} ≈ ${f.decimal}`;
}

function intervalText(iv) {
  return `[${iv.low.num}/${iv.low.den}, ${iv.high.num}/${iv.high.den}]`;
}

function intervalFullText(iv) {
  return `[${iv.low.num}/${iv.low.den}, ${iv.high.num}/${iv.high.den}] ≈ [${iv.low.decimal}, ${iv.high.decimal}]`;
}

function renderStageTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '① 各级速比与折算空程（齿隙 × 后续级速比，精确分数）'));
  const ratioLine = data.stages
    .map((st) => `第 ${st.stage} 级 ${st.driveTeeth}/${st.drivenTeeth} = ${st.stageRatio.num}/${st.stageRatio.den}`)
    .join('，');
  wrap.appendChild(el('p', 'muted', `各级速比（主动/从动）：${ratioLine}`));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级</th><th>齿数（主动/从动）</th><th>本级速比</th>
      <th>从动轴侧齿隙区间（转）</th><th>后续级速比</th><th>折算输出轴空程区间（转）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.stages.forEach((st) => {
    const tr = el('tr');
    const suffixNote =
      st.stage === data.stageCount
        ? '1（本级从动轴即输出轴）'
        : `${st.suffixRatio.num}/${st.suffixRatio.den}`;
    tr.innerHTML = `
      <td>第 ${st.stage} 级</td>
      <td class="frac">${st.driveTeeth} / ${st.drivenTeeth}</td>
      <td class="frac">${fracText(st.stageRatio)}</td>
      <td class="frac">${intervalText(st.backlash)}</td>
      <td class="frac">${suffixNote}</td>
      <td class="frac">${intervalFullText(st.converted)}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderTotal(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '② 总速比与输出轴总空程区间（各级折算空程逐级相加）'));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>总速比 R = ∏(主动/从动)</th><th>输出轴总空程区间 [B_lo, B_hi]（转）</th>
      <th>期望输出转数 E（转）</th><th>达标所需理想转数 E + B_hi（转）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  const tr = el('tr');
  tr.innerHTML = `
    <td class="frac">${fracText(data.totalRatio)}</td>
    <td class="frac">${intervalFullText(data.totalBacklash)}</td>
    <td class="frac">${fracText(data.expectedTurns)}</td>
    <td class="frac">${fracText(data.requiredMargin)}</td>`;
  tbody.appendChild(tr);
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderMinTurns(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '③ 保证达标的最少输入圈数与该圈数下的输出区间'));
  const box = el('div', 'solution best');
  box.innerHTML = `
    <div class="solution-head">
      <span class="solution-title">输入轴最少反转 <span class="phase-big">${data.minInputTurns}</span> 圈</span>
      <span class="badge">保证达标</span>
    </div>
    <div class="solution-meta">
      最坏情况（空程取上界 ${data.totalBacklash.high.num}/${data.totalBacklash.high.den} 转）下输出仍 ≥
      期望 ${data.expectedTurns.num}/${data.expectedTurns.den} 转：N = ⌈(${data.requiredMargin.num}/${data.requiredMargin.den})
      ÷ (${data.totalRatio.num}/${data.totalRatio.den})⌉ = ${data.minInputTurns}。
      少转 1 圈（${data.prevTurns} 圈）时保证下界仅
      <strong>${data.prevGuaranteed.num}/${data.prevGuaranteed.den}</strong> 转，低于期望转数。
    </div>`;
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>输入反转圈数 N</th><th>理想输出 N × R（转）</th>
      <th>实际输出转数区间<br/>[max(0, N·R − B_hi), max(0, N·R − B_lo)]（转）</th><th>标记</th>
    </tr></thead>`;
  const tbody = el('tbody');
  const tr = el('tr');
  tr.innerHTML = `
    <td class="frac">${data.minInputTurns}</td>
    <td class="frac">${fracText(data.idealOutput)}</td>
    <td class="frac">${intervalFullText(data.outputAtMin)}</td>
    <td><span class="diag-ok">下界达标 ✓</span></td>`;
  tbody.appendChild(tr);
  table.appendChild(tbody);
  box.appendChild(table);
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
    payload = { stages: collectStages(), expectedTurns: collectExpected() };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/backlash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '空程预算计算失败');

    resultPanel.hidden = false;
    resultDetail.innerHTML = '';

    resultSummary.textContent =
      `${data.stageCount} 级传动 / ${data.axisCount} 个轴 · 总速比 ` +
      `${data.totalRatio.num}/${data.totalRatio.den} · 总空程 ${intervalText(data.totalBacklash)} 转`;

    verdictAlert.hidden = false;
    verdictAlert.className = 'alert ok';
    verdictAlert.innerHTML = `<strong>最少反转 ${data.minInputTurns} 圈：</strong>${data.message}`;

    resultDetail.appendChild(renderStageTable(data));
    resultDetail.appendChild(renderTotal(data));
    resultDetail.appendChild(renderMinTurns(data));
  } catch (e) {
    resultPanel.hidden = false;
    resultDetail.innerHTML = '';
    resultSummary.textContent = '';
    verdictAlert.hidden = false;
    verdictAlert.className = 'alert error';
    verdictAlert.textContent = `请求出错：${e.message}`;
  }
});
