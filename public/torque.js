'use strict';

const MIN_GEARS = 2;
const MAX_GEARS = 12;

const rowsBox = document.getElementById('gear-rows');
const form = document.getElementById('torque-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const resultList = document.getElementById('result-list');
const noSolution = document.getElementById('no-solution');
const truncatedNote = document.getElementById('truncated-note');

const EXAMPLE_GEARS = [
  { id: 'G1', teeth: 10, ratedTorque: 200 },
  { id: 'G2', teeth: 12, ratedTorque: 500 },
  { id: 'G3', teeth: 20, ratedTorque: 500 },
  { id: 'G4', teeth: 30, ratedTorque: 800 },
  { id: 'G5', teeth: 40, ratedTorque: 1000 },
  { id: 'G6', teeth: 50, ratedTorque: 1200 },
  { id: 'G7', teeth: 60, ratedTorque: 1500 },
];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function addGearRow(id = '', teeth = '', ratedTorque = '') {
  const row = el('div', 'rated-row');
  row.innerHTML = `
    <input class="gear-id-input" placeholder="如 G1" value="${id}" />
    <input class="gear-teeth-input" type="number" min="1" max="100000" step="1" placeholder="齿数" value="${teeth}" />
    <input class="gear-rated-input" type="number" min="1" max="1000000000000" step="1" placeholder="额定扭矩 N·m" value="${ratedTorque}" />
    <button type="button" class="btn danger-ghost" title="删除该齿轮">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (rowsBox.children.length <= MIN_GEARS) {
      alert(`至少保留 ${MIN_GEARS} 枚齿轮`);
      return;
    }
    row.remove();
  });
  rowsBox.appendChild(row);
}

document.getElementById('btn-add').addEventListener('click', () => {
  if (rowsBox.children.length >= MAX_GEARS) {
    alert(`最多 ${MAX_GEARS} 枚齿轮`);
    return;
  }
  addGearRow();
});

document.getElementById('btn-example').addEventListener('click', () => {
  rowsBox.innerHTML = '';
  EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth, g.ratedTorque));
  document.getElementById('target').value = '1/12';
  document.getElementById('tolerance').value = '5%';
  document.getElementById('input-torque').value = '100';
});

/* 初始：示例数据 */
EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth, g.ratedTorque));

function collectGears() {
  const gears = [];
  const ids = new Set();
  for (const row of rowsBox.querySelectorAll('.rated-row')) {
    const id = row.querySelector('.gear-id-input').value.trim();
    const teethRaw = row.querySelector('.gear-teeth-input').value.trim();
    const ratedRaw = row.querySelector('.gear-rated-input').value.trim();
    if (!id && !teethRaw && !ratedRaw) continue; // 空行忽略
    if (!id) throw new Error('存在未填写编号的齿轮行');
    if (ids.has(id)) throw new Error(`齿轮编号重复：${id}`);
    ids.add(id);
    const teeth = Number(teethRaw);
    if (!Number.isInteger(teeth) || teeth < 1) throw new Error(`齿轮 ${id} 的齿数需为正整数`);
    const ratedTorque = Number(ratedRaw);
    if (!Number.isInteger(ratedTorque) || ratedTorque < 1) {
      throw new Error(`齿轮 ${id} 的额定扭矩需为正整数（单位 N·m）`);
    }
    gears.push({ id, teeth, ratedTorque });
  }
  if (gears.length < MIN_GEARS) {
    throw new Error(`请至少填写 ${MIN_GEARS} 枚齿轮（最多 ${MAX_GEARS} 枚）`);
  }
  if (gears.length > MAX_GEARS) throw new Error(`齿轮数量不能超过 ${MAX_GEARS} 枚`);
  return gears;
}

/* 承受扭矩单元格：分数 + 小数 + 额定值，恰好满载时标注 */
function torqueCell(g) {
  const limit = g.atLimit ? ' <span class="badge badge-limit">满载</span>' : '';
  return `
    <div class="torque-val frac">${g.torque.num}/${g.torque.den} ≈ ${g.torque.decimal} N·m${limit}</div>
    <div class="torque-rated">额定 ${g.ratedTorque} N·m</div>`;
}

function renderSolution(r, index) {
  const card = el('div', `solution${index === 0 ? ' best' : ''}`);

  const head = el('div', 'solution-head');
  head.appendChild(el('span', 'solution-title',
    `${index === 0 ? '<span class="badge">最优</span>' : ''}方案 ${index + 1} · ${r.stages} 级传动`));
  head.appendChild(el('span', 'solution-meta',
    `实际转速比 <strong class="frac">${r.ratio.num}/${r.ratio.den}</strong>` +
    ` ≈ <strong>${r.ratio.decimal}</strong>` +
    ` &nbsp;|&nbsp; 相对误差 <strong>${r.errorPercent}%</strong>`));
  card.appendChild(head);

  const table = el('table', 'pairs torque-table');
  table.innerHTML = `
    <thead><tr>
      <th>级</th>
      <th>主动轮（编号 / 齿数）</th>
      <th>主动轮承受扭矩 / 额定</th>
      <th>从动轮（编号 / 齿数）</th>
      <th>从动轮承受扭矩 / 额定</th>
      <th>本级速比（主动/从动）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  r.pairs.forEach((p, i) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${i + 1}<div class="torque-rated">本级输入 ${p.inputTorque.decimal} N·m</div></td>
      <td><span class="gear-id">${p.drive.id}</span> · ${p.drive.teeth} 齿</td>
      <td>${torqueCell(p.drive)}</td>
      <td><span class="gear-id">${p.driven.id}</span> · ${p.driven.teeth} 齿</td>
      <td>${torqueCell(p.driven)}</td>
      <td class="frac">${p.stageRatio.num}/${p.stageRatio.den} ≈ ${p.stageRatio.decimal}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  card.appendChild(table);
  return card;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    const inputTorque = Number(document.getElementById('input-torque').value.trim());
    if (!Number.isInteger(inputTorque) || inputTorque < 1) {
      throw new Error('输入扭矩需为正整数（单位 N·m）');
    }
    payload = {
      target: document.getElementById('target').value,
      tolerance: document.getElementById('tolerance').value,
      inputTorque,
      gears: collectGears(),
    };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/torque', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '带载选配失败');

    resultPanel.hidden = false;
    resultList.innerHTML = '';
    noSolution.hidden = true;
    noSolution.className = 'alert';
    truncatedNote.hidden = true;
    resultSummary.textContent =
      `输入扭矩 ${data.inputTorque} N·m，目标比 ${data.target.num}/${data.target.den} ≈ ${data.target.decimal}，` +
      `允许误差 ${data.tolerance.decimal}，速比达标配对组 ${data.ratioMatchCount} 组、` +
      `共校核 ${data.loadCandidatesChecked} 种级次顺序`;

    if (!data.feasible) {
      // 区分“速比无解”与“全部超载”
      noSolution.className = `alert ${data.reason === 'ratio' ? 'warn' : 'error'}`;
      noSolution.textContent = data.message;
      noSolution.hidden = false;
      return;
    }

    resultSummary.textContent += `，速比与载荷均达标方案 ${data.total} 条`;

    if (data.truncated) {
      truncatedNote.textContent =
        `达标方案较多，以下仅展示按级数 / 误差 / 级次编号排序最靠前的 ${data.count} 条（共 ${data.total} 条）。`;
      truncatedNote.hidden = false;
    }
    data.results.forEach((r, i) => resultList.appendChild(renderSolution(r, i)));
  } catch (e) {
    resultPanel.hidden = false;
    resultList.innerHTML = '';
    truncatedNote.hidden = true;
    resultSummary.textContent = '';
    noSolution.hidden = false;
    noSolution.className = 'alert error';
    noSolution.textContent = `请求出错：${e.message}`;
  }
});
