'use strict';

const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MIN_SEGMENTS = 1;
const MAX_SEGMENTS = 50;

const stageRowsBox = document.getElementById('stage-rows');
const segmentRowsBox = document.getElementById('segment-rows');
const form = document.getElementById('reciprocate-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const verdictAlert = document.getElementById('verdict-alert');
const resultDetail = document.getElementById('result-detail');

const EXAMPLE_STAGES = [
  { driveTeeth: 20, drivenTeeth: 40, width: '1/4', gap: '1/8' },
  { driveTeeth: 24, drivenTeeth: 36, width: '1/6', gap: '0' },
];
const EXAMPLE_SEGMENTS = ['1', '-1', '1/2', '-3/4', '2'];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 级行（齿数 + 齿隙宽度 w + 初始间隙位置 g） ---------------- */

function addStageRow(driveTeeth = '', drivenTeeth = '', width = '', gap = '') {
  const row = el('div', 'recip-row');
  row.innerHTML = `
    <span class="stage-index"></span>
    <input class="stage-drive-input" type="number" min="1" max="100000" step="1" placeholder="主动齿数" value="${driveTeeth}" />
    <input class="stage-driven-input" type="number" min="1" max="100000" step="1" placeholder="从动齿数" value="${drivenTeeth}" />
    <input class="lash-width-input" type="text" inputmode="decimal" placeholder="如 0、1/8" value="${width}" />
    <input class="lash-gap-input" type="text" inputmode="decimal" placeholder="0 ≤ g ≤ w" value="${gap}" />
    <button type="button" class="btn danger-ghost" title="删除该级">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if (stageRowsBox.querySelectorAll('.recip-row').length <= MIN_STAGES) {
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
  const rows = [...stageRowsBox.querySelectorAll('.recip-row')];
  rows.forEach((r, i) => {
    r.querySelector('.stage-index').textContent = `第 ${i + 1} 级（轴 ${i + 1} → 轴 ${i + 2}）`;
  });
}

document.getElementById('btn-stage-add').addEventListener('click', () => {
  if (stageRowsBox.querySelectorAll('.recip-row').length >= MAX_STAGES) {
    alert(`最多 ${MAX_STAGES} 级`);
    return;
  }
  addStageRow();
});

/* ---------------- 段行（有符号输入转数） ---------------- */

function addSegmentRow(turns = '') {
  const row = el('div', 'seg-row');
  row.innerHTML = `
    <span class="seg-index"></span>
    <input class="seg-turns-input" type="text" inputmode="decimal" placeholder="如 1、-3/2、-1.5、0" value="${turns}" />
    <button type="button" class="btn danger-ghost" title="删除该段">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if (segmentRowsBox.querySelectorAll('.seg-row').length <= MIN_SEGMENTS) {
      alert(`至少保留 ${MIN_SEGMENTS} 段`);
      return;
    }
    row.remove();
    refreshSegmentIndex();
  });
  segmentRowsBox.appendChild(row);
  refreshSegmentIndex();
}

function refreshSegmentIndex() {
  const rows = [...segmentRowsBox.querySelectorAll('.seg-row')];
  rows.forEach((r, i) => {
    r.querySelector('.seg-index').textContent = `第 ${i + 1} 段`;
  });
}

document.getElementById('btn-segment-add').addEventListener('click', () => {
  if (segmentRowsBox.querySelectorAll('.seg-row').length >= MAX_SEGMENTS) {
    alert(`最多 ${MAX_SEGMENTS} 段`);
    return;
  }
  addSegmentRow();
});

document.getElementById('btn-example').addEventListener('click', () => {
  stageRowsBox.innerHTML = '';
  EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth, s.width, s.gap));
  segmentRowsBox.innerHTML = '';
  EXAMPLE_SEGMENTS.forEach((t) => addSegmentRow(t));
});

/* 初始：示例数据 */
EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth, s.width, s.gap));
EXAMPLE_SEGMENTS.forEach((t) => addSegmentRow(t));

/* ---------------- 采集与校验 ---------------- */

const NONNEG_FRAC_RE = /^(\d+|\d+\/\d+|\d*\.\d+)$/;
const SIGNED_FRAC_RE = /^[+-]?(\d+|\d+\/\d+|\d*\.\d+)$/;

function collectStages() {
  const rows = [...stageRowsBox.querySelectorAll('.recip-row')];
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
    const width = row.querySelector('.lash-width-input').value.trim();
    const gap = row.querySelector('.lash-gap-input').value.trim();
    if (!NONNEG_FRAC_RE.test(width)) {
      throw new Error(`第 ${i + 1} 级齿隙宽度 w 格式不正确：填非负分数 p/q（如 1/8）或小数（如 0.125），无齿隙填 0`);
    }
    if (!NONNEG_FRAC_RE.test(gap)) {
      throw new Error(`第 ${i + 1} 级初始间隙位置 g 格式不正确：填非负分数 p/q（如 1/8）或小数（如 0.125），需 0 ≤ g ≤ w`);
    }
    return { driveTeeth: drive, drivenTeeth: driven, backlashWidth: width, initialGap: gap };
  });
}

function collectSegments() {
  const rows = [...segmentRowsBox.querySelectorAll('.seg-row')];
  if (rows.length < MIN_SEGMENTS || rows.length > MAX_SEGMENTS) {
    throw new Error(`段数需为 ${MIN_SEGMENTS}～${MAX_SEGMENTS} 段`);
  }
  return rows.map((row, i) => {
    const turns = row.querySelector('.seg-turns-input').value.trim();
    if (!SIGNED_FRAC_RE.test(turns)) {
      throw new Error(`第 ${i + 1} 段输入转数格式不正确：填有符号分数（如 -3/2）或小数（如 -1.5），零位移填 0`);
    }
    return turns;
  });
}

/* ---------------- 结果渲染 ---------------- */

/** 分数简短写法：分母为 1 时只写分子 */
function fmtFrac(f) {
  return f.den === '1' ? f.num : `${f.num}/${f.den}`;
}

/** 分数单元格：上行精确分数，下行小数近似 */
function fracCell(f) {
  return `<span class="frac">${fmtFrac(f)}</span><br/><small class="cell-dec">≈ ${f.decimal}</small>`;
}

function renderStageTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '① 各级参数与初始齿隙状态'));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级</th><th>齿数（主动/从动）</th><th>本级速比</th><th>传递用负齿数比</th>
      <th>齿隙宽度 w（转）</th><th>初始间隙位置 g（转）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.stages.forEach((st) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>第 ${st.stage} 级</td>
      <td class="frac">${st.driveTeeth} / ${st.drivenTeeth}</td>
      <td class="frac">${fmtFrac(st.stageRatio)}</td>
      <td class="frac">−${fmtFrac(st.stageRatio)}</td>
      <td class="frac">${fracCell(st.backlashWidth)}</td>
      <td class="frac">${fracCell(st.initialGap)}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderReplayTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '② 逐段回放总览（各轴实际 / 累计位移与各级剩余间隙位置，单位：转）'));
  const scroll = el('div', 'table-scroll');
  const table = el('table', 'pairs replay-table');
  const axisHeads = data.segments[0].axes
    .map((ax) => `<th>轴 ${ax.axis} 实际</th><th>轴 ${ax.axis} 累计</th>`)
    .join('');
  const gapHeads = data.stages.map((st) => `<th>第 ${st.stage} 级间隙 g′</th>`).join('');
  table.innerHTML = `
    <thead><tr>
      <th>段</th><th>输入转数</th>${axisHeads}${gapHeads}
    </tr></thead>`;
  const tbody = el('tbody');
  data.segments.forEach((seg) => {
    const tr = el('tr');
    const axisCells = seg.axes
      .map((ax) => `<td class="frac">${fracCell(ax.actual)}</td><td class="frac">${fracCell(ax.cumulative)}</td>`)
      .join('');
    const gapCells = seg.stages.map((sd) => `<td class="frac">${fracCell(sd.gapAfter)}</td>`).join('');
    tr.innerHTML = `<td>${seg.index}</td><td class="frac">${fracCell(seg.inputTurns)}</td>${axisCells}${gapCells}`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}

function renderFinalState(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '③ 最终状态（全部段回放完成后）'));
  const table = el('table', 'pairs');
  const axisCells = data.finalCumulative
    .map((ax) => `<th>轴 ${ax.axis}（${ax.role}）累计位移</th>`)
    .join('');
  const gapCells = data.finalGaps.map((g) => `<th>第 ${g.stage} 级剩余间隙位置</th>`).join('');
  const axisVals = data.finalCumulative
    .map((ax) => `<td class="frac">${fracCell(ax.cumulative)}</td>`)
    .join('');
  const gapVals = data.finalGaps.map((g) => `<td class="frac">${fracCell(g.gap)}</td>`).join('');
  table.innerHTML = `<thead><tr>${axisCells}${gapCells}</tr></thead><tbody><tr>${axisVals}${gapVals}</tr></tbody>`;
  const scroll = el('div', 'table-scroll');
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}

function renderSegmentDetails(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '④ 逐段传递明细（d = 上游实际位移 × 负齿数比；u = g + d；g′ = min(w, max(0, u))；本级实际位移 = u − g′）'));
  data.segments.forEach((seg) => {
    const det = el('details', 'seg-detail');
    const axisBrief = seg.axes.map((ax) => `轴 ${ax.axis} ${fmtFrac(ax.actual)}`).join('，');
    det.appendChild(el('summary', '', `第 ${seg.index} 段：输入 ${fmtFrac(seg.inputTurns)} 转 → ${axisBrief}`));
    const scroll = el('div', 'table-scroll');
    const table = el('table', 'pairs replay-table');
    table.innerHTML = `
      <thead><tr>
        <th>级</th><th>上游实际位移</th><th>d = 上游 × 负齿数比</th>
        <th>g（段前）</th><th>u = g + d</th><th>g′（段后）</th><th>本级实际位移 = u − g′</th>
      </tr></thead>`;
    const tbody = el('tbody');
    seg.stages.forEach((sd) => {
      const tr = el('tr');
      tr.innerHTML = `
        <td>第 ${sd.stage} 级</td>
        <td class="frac">${fracCell(sd.upstream)}</td>
        <td class="frac">${fracCell(sd.d)}</td>
        <td class="frac">${fracCell(sd.gapBefore)}</td>
        <td class="frac">${fracCell(sd.u)}</td>
        <td class="frac">${fracCell(sd.gapAfter)}</td>
        <td class="frac">${fracCell(sd.actual)}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    det.appendChild(scroll);
    wrap.appendChild(det);
  });
  return wrap;
}

/* ---------------- 提交 ---------------- */

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    payload = { stages: collectStages(), segments: collectSegments() };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/reciprocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '往复回放计算失败');

    resultPanel.hidden = false;
    resultDetail.innerHTML = '';

    resultSummary.textContent =
      `${data.stageCount} 级传动 / ${data.axisCount} 个轴 · 共 ${data.segmentCount} 段`;

    verdictAlert.hidden = false;
    verdictAlert.className = 'alert ok';
    verdictAlert.innerHTML = `<strong>回放完成：</strong>${data.message}`;

    resultDetail.appendChild(renderStageTable(data));
    resultDetail.appendChild(renderReplayTable(data));
    resultDetail.appendChild(renderFinalState(data));
    resultDetail.appendChild(renderSegmentDetails(data));
  } catch (e) {
    resultPanel.hidden = false;
    resultDetail.innerHTML = '';
    resultSummary.textContent = '';
    verdictAlert.hidden = false;
    verdictAlert.className = 'alert error';
    verdictAlert.textContent = `请求出错：${e.message}`;
  }
});
