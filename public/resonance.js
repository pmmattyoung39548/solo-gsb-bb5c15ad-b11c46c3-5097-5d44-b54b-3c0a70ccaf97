'use strict';

const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MAX_RULES = 10;
const MAX_RPM = 1000000000000;

const stageRowsBox = document.getElementById('stage-rows');
const ruleRowsBox = document.getElementById('rule-rows');
const form = document.getElementById('resonance-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const verdictAlert = document.getElementById('verdict-alert');
const resultDetail = document.getElementById('result-detail');

const EXAMPLE_STAGES = [
  { driveTeeth: 20, drivenTeeth: 40 },
  { driveTeeth: 24, drivenTeeth: 36 },
];
const EXAMPLE_RULES = [
  { axis: 2, low: 600, high: 660 },
  { axis: 3, low: 440, high: 450 },
];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 齿轮级行 ---------------- */

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
}

document.getElementById('btn-stage-add').addEventListener('click', () => {
  if (stageRowsBox.querySelectorAll('.stage-row').length >= MAX_STAGES) {
    alert(`最多 ${MAX_STAGES} 级`);
    return;
  }
  addStageRow();
});

/* ---------------- 禁用区间行 ---------------- */

function addRuleRow(axis = '', low = '', high = '') {
  const row = el('div', 'forbid-row');
  row.innerHTML = `
    <input class="rule-axis-input" type="number" min="1" step="1" placeholder="轴号" value="${axis}" />
    <input class="rule-low-input" type="number" min="1" max="${MAX_RPM}" step="1" placeholder="禁用下限" value="${low}" />
    <input class="rule-high-input" type="number" min="1" max="${MAX_RPM}" step="1" placeholder="禁用上限" value="${high}" />
    <button type="button" class="btn danger-ghost" title="删除该条">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    row.remove();
    refreshRuleIndex();
  });
  ruleRowsBox.appendChild(row);
  refreshRuleIndex();
}

function refreshRuleIndex() {
  const rows = [...ruleRowsBox.querySelectorAll('.forbid-row')];
  rows.forEach((r, i) => {
    r.querySelector('.rule-axis-input').title = `第 ${i + 1} 条：轴号从输入轴（轴 1）起算`;
  });
}

document.getElementById('btn-rule-add').addEventListener('click', () => {
  if (ruleRowsBox.querySelectorAll('.forbid-row').length >= MAX_RULES) {
    alert(`最多 ${MAX_RULES} 条禁用区间`);
    return;
  }
  addRuleRow();
});

document.getElementById('btn-example').addEventListener('click', () => {
  stageRowsBox.innerHTML = '';
  EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth));
  ruleRowsBox.innerHTML = '';
  EXAMPLE_RULES.forEach((r) => addRuleRow(r.axis, r.low, r.high));
  document.getElementById('input-min').value = '1000';
  document.getElementById('input-max').value = '3000';
});

/* 初始：示例数据 */
EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth));
EXAMPLE_RULES.forEach((r) => addRuleRow(r.axis, r.low, r.high));

/* ---------------- 采集与校验 ---------------- */

function parsePosInt(v, label, max) {
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) throw new Error(`${label}需为正整数`);
  const n = Number(s);
  if (n < 1 || n > max) throw new Error(`${label}需为 1～${max} 的正整数`);
  return n;
}

function collectStages() {
  const rows = [...stageRowsBox.querySelectorAll('.stage-row')];
  if (rows.length < MIN_STAGES || rows.length > MAX_STAGES) {
    throw new Error(`级数需为 ${MIN_STAGES}～${MAX_STAGES} 级`);
  }
  return rows.map((row, i) => {
    const driveRaw = row.querySelector('.stage-drive-input').value.trim();
    const drivenRaw = row.querySelector('.stage-driven-input').value.trim();
    if (!/^\d+$/.test(driveRaw)) throw new Error(`第 ${i + 1} 级主动齿数需为正整数`);
    if (!/^\d+$/.test(drivenRaw)) throw new Error(`第 ${i + 1} 级从动齿数需为正整数`);
    const drive = Number(driveRaw);
    const driven = Number(drivenRaw);
    if (drive < 1) throw new Error(`第 ${i + 1} 级主动齿数需为正整数`);
    if (driven < 1) throw new Error(`第 ${i + 1} 级从动齿数需为正整数`);
    return { driveTeeth: drive, drivenTeeth: driven };
  });
}

function collectRules(axisCount) {
  const rows = [...ruleRowsBox.querySelectorAll('.forbid-row')];
  const rules = [];
  rows.forEach((row, i) => {
    const axisRaw = row.querySelector('.rule-axis-input').value.trim();
    const lowRaw = row.querySelector('.rule-low-input').value.trim();
    const highRaw = row.querySelector('.rule-high-input').value.trim();
    // 三格全空：视为未填写
    if (!axisRaw && !lowRaw && !highRaw) return;
    const label = `第 ${rules.length + 1} 条禁用区间（第 ${i + 1} 行）`;
    const axis = parsePosInt(axisRaw, `${label}的轴号`, axisCount);
    if (axis > axisCount) {
      throw new Error(`${label}的轴号需为 1～${axisCount}（输入轴 = 1，输出轴 = ${axisCount}）`);
    }
    const low = parsePosInt(lowRaw, `${label}（轴 ${axis}）下限`, MAX_RPM);
    const high = parsePosInt(highRaw, `${label}（轴 ${axis}）上限`, MAX_RPM);
    if (low > high) throw new Error(`${label}（轴 ${axis}）下限不能大于上限`);
    rules.push({ axis, low, high });
  });
  if (rules.length > MAX_RULES) throw new Error(`禁用转速区间最多 ${MAX_RULES} 条`);
  return rules;
}

/* ---------------- 结果渲染 ---------------- */

function fracText(f) {
  return `${f.num}/${f.den} ≈ ${f.decimal}`;
}

function renderShaftTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '① 各轴转速倍率（按齿数连乘，精确分数）'));
  const ratioLine = data.stages
    .map((st) => `第 ${st.stage} 级 ${st.driveTeeth}/${st.drivenTeeth} = ${st.stageRatio.num}/${st.stageRatio.den}`)
    .join('，');
  wrap.appendChild(el('p', 'muted', `各级速比（主动/从动）：${ratioLine}`));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr><th>轴</th><th>角色</th><th>转速倍率 f = 该轴转速 / 输入转速</th><th>连乘式</th></tr></thead>`;
  const tbody = el('tbody');
  data.shafts.forEach((s, i) => {
    const tr = el('tr');
    const chain =
      i === 0
        ? '1（输入轴）'
        : data.stages
            .slice(0, i)
            .map((st) => `${st.driveTeeth}/${st.drivenTeeth}`)
            .join(' × ');
    tr.innerHTML = `
      <td>轴 ${s.axis}</td>
      <td>${s.role}</td>
      <td class="frac">${fracText(s.multiplier)}</td>
      <td class="frac" style="text-align:left">${chain}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

const STATUS_TEXT = {
  'in-range': ['区间内触发', 'diag-bad'],
  'out-of-range': ['范围外不触发', 'diag-ok'],
  'no-integer': ['无整数转速触发', 'diag-ok'],
};

function renderRulesTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '② 禁用区间反推（每条禁用带 → 会触发的整数输入转速区间）'));
  if (data.rules.length === 0) {
    wrap.appendChild(el('p', 'muted', '未设置任何禁用转速区间，允许范围内全部整数转速均安全。'));
    return wrap;
  }
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>序号</th><th>轴号</th><th>该轴倍率</th><th>禁用转速带 [lo, hi]（rpm）</th>
      <th>反推整数输入区间<br/>⌈q·lo/p⌉ ≤ n ≤ ⌊q·hi/p⌋</th><th>裁剪到允许范围</th><th>状态</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.rules.forEach((r) => {
    const tr = el('tr');
    const [statusText, statusCls] = STATUS_TEXT[r.status];
    const mapped = r.mapped ? `[${r.mapped.from}, ${r.mapped.to}]` : '—';
    tr.innerHTML = `
      <td>#${r.index}</td>
      <td>轴 ${r.axis}</td>
      <td class="frac">${r.multiplier.num}/${r.multiplier.den}</td>
      <td class="frac">[${r.low}, ${r.high}]</td>
      <td class="frac">[${r.rawFrom}, ${r.rawTo}]</td>
      <td class="frac">${mapped}</td>
      <td><span class="${statusCls}">${statusText}</span><div class="torque-rated">${r.note}</div></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderExcludedTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '③ 合并后的被排除输入转速区间（端点相邻也合并，附禁用来源）'));
  if (data.excluded.length === 0) {
    wrap.appendChild(el('p', 'muted', '允许范围内没有任何会触发禁用带的整数输入转速。'));
    return wrap;
  }
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr><th>被排除闭区间（输入转速 rpm）</th><th>整数个数</th><th>触发来源（禁用区间序号）</th></tr></thead>`;
  const tbody = el('tbody');
  data.excluded.forEach((e) => {
    const tr = el('tr');
    const sources = e.sources
      .map((idx) => {
        const r = data.rules.find((x) => x.index === idx);
        return `<span class="chip">#${idx} 轴${r.axis} [${r.low},${r.high}]</span>`;
      })
      .join(' ');
    tr.innerHTML = `
      <td class="frac">[${e.from}, ${e.to}]</td>
      <td class="frac">${e.count}</td>
      <td><div class="chip-list">${sources}</div></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  wrap.appendChild(el('p', 'muted', `被排除整数转速共 ${data.excludedCount} 个。`));
  return wrap;
}

function renderSafe(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '④ 全部安全输入转速闭区间与推荐'));

  if (!data.hasSafe) {
    const box = el('div', 'solution miss');
    box.innerHTML = `
      <div class="solution-head">
        <span class="solution-title">无安全输入转速：允许范围 [${data.inputRange.min}, ${data.inputRange.max}] rpm 内的每个整数转速都会触发至少一条禁用区间</span>
      </div>
      <div class="solution-meta">请放宽输入转速允许范围，或调整 / 删除部分禁用转速区间后重新计算。</div>`;
    wrap.appendChild(box);
    return wrap;
  }

  if (data.recommendation) {
    const rec = data.recommendation;
    const box = el('div', 'solution best');
    box.innerHTML = `
      <div class="solution-head">
        <span class="solution-title">推荐工作区间：[${rec.from}, ${rec.to}] rpm</span>
        <span class="badge">推荐</span>
      </div>
      <div class="solution-meta">
        含 <strong>${rec.count}</strong> 个可选整数输入转速，为全部连续安全区间中个数最多者
        （个数并列时取起点较小者）。
      </div>`;
    wrap.appendChild(box);
  }

  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr><th>序号</th><th>安全闭区间（输入转速 rpm）</th><th>整数转速个数</th><th>标记</th></tr></thead>`;
  const tbody = el('tbody');
  data.safe.forEach((s, i) => {
    const isRec =
      data.recommendation && s.from === data.recommendation.from && s.to === data.recommendation.to;
    const tr = el('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="frac">[${s.from}, ${s.to}]</td>
      <td class="frac">${s.count}</td>
      <td>${isRec ? '<span class="diag-ok">推荐 ✓</span>' : ''}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  wrap.appendChild(
    el('p', 'muted', `安全整数转速共 ${data.safeCount} 个，分布在 ${data.safe.length} 个连续闭区间中。`),
  );
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
    const axisCount = stages.length + 1;
    const min = parsePosInt(document.getElementById('input-min').value, '输入转速下限', MAX_RPM);
    const max = parsePosInt(document.getElementById('input-max').value, '输入转速上限', MAX_RPM);
    if (min > max) throw new Error(`输入转速下限不能大于上限（当前 ${min} ～ ${max} rpm）`);
    payload = { stages, inputRange: { min, max }, forbidden: collectRules(axisCount) };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/resonance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '安全区间计算失败');

    resultPanel.hidden = false;
    resultDetail.innerHTML = '';

    resultSummary.textContent =
      `${data.stageCount} 级传动 / ${data.axisCount} 个轴 · 允许范围 ` +
      `[${data.inputRange.min}, ${data.inputRange.max}] rpm 共 ${data.totalCount} 个整数转速`;

    verdictAlert.hidden = false;
    verdictAlert.className = `alert ${data.hasSafe ? 'ok' : 'error'}`;
    verdictAlert.innerHTML = `<strong>${data.hasSafe ? '存在安全转速' : '无安全转速'}：</strong>${data.message}`;

    resultDetail.appendChild(renderShaftTable(data));
    resultDetail.appendChild(renderRulesTable(data));
    resultDetail.appendChild(renderExcludedTable(data));
    resultDetail.appendChild(renderSafe(data));
  } catch (e) {
    resultPanel.hidden = false;
    resultDetail.innerHTML = '';
    resultSummary.textContent = '';
    verdictAlert.hidden = false;
    verdictAlert.className = 'alert error';
    verdictAlert.textContent = `请求出错：${e.message}`;
  }
});
