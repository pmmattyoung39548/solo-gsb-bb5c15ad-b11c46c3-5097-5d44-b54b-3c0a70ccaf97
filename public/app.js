'use strict';

const rowsBox = document.getElementById('gear-rows');
const form = document.getElementById('search-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const resultList = document.getElementById('result-list');
const noSolution = document.getElementById('no-solution');
const truncatedNote = document.getElementById('truncated-note');

const EXAMPLE_GEARS = [
  { id: 'G1', teeth: 10 },
  { id: 'G2', teeth: 12 },
  { id: 'G3', teeth: 15 },
  { id: 'G4', teeth: 20 },
  { id: 'G5', teeth: 30 },
  { id: 'G6', teeth: 40 },
  { id: 'G7', teeth: 50 },
  { id: 'G8', teeth: 60 },
];

function addGearRow(id = '', teeth = '') {
  const row = document.createElement('div');
  row.className = 'gear-row';
  row.innerHTML = `
    <input class="gear-id-input" placeholder="如 G1" value="${id}" />
    <input class="gear-teeth-input" type="number" min="1" max="100000" step="1" placeholder="齿数" value="${teeth}" />
    <button type="button" class="btn danger-ghost" title="删除该齿轮">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (rowsBox.children.length <= 2) {
      alert('至少保留 2 枚齿轮');
      return;
    }
    row.remove();
  });
  rowsBox.appendChild(row);
}

document.getElementById('btn-add').addEventListener('click', () => addGearRow());
document.getElementById('btn-example').addEventListener('click', () => {
  rowsBox.innerHTML = '';
  EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth));
  document.getElementById('target').value = '1/12';
  document.getElementById('tolerance').value = '5%';
});

/* 初始两行 */
addGearRow('G1', 10);
addGearRow('G2', 60);

function collectGears() {
  const gears = [];
  const ids = new Set();
  for (const row of rowsBox.querySelectorAll('.gear-row')) {
    const id = row.querySelector('.gear-id-input').value.trim();
    const teethRaw = row.querySelector('.gear-teeth-input').value.trim();
    if (!id && !teethRaw) continue; // 空行忽略
    if (!id) throw new Error('存在未填写编号的齿轮行');
    if (ids.has(id)) throw new Error(`齿轮编号重复：${id}`);
    ids.add(id);
    const teeth = Number(teethRaw);
    if (!Number.isInteger(teeth) || teeth < 1) throw new Error(`齿轮 ${id} 的齿数需为正整数`);
    gears.push({ id, teeth });
  }
  if (gears.length < 2) throw new Error('请至少填写 2 枚齿轮（最多 12 枚）');
  if (gears.length > 12) throw new Error('齿轮数量不能超过 12 枚');
  return gears;
}

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
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

  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级</th><th>主动轮（编号 / 齿数）</th><th>从动轮（编号 / 齿数）</th><th>本级速比（主动/从动）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  r.pairs.forEach((p, i) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><span class="gear-id">${p.drive.id}</span> · ${p.drive.teeth} 齿</td>
      <td><span class="gear-id">${p.driven.id}</span> · ${p.driven.teeth} 齿</td>
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
    payload = {
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
    const resp = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '搜索失败');

    resultPanel.hidden = false;
    resultList.innerHTML = '';
    noSolution.hidden = true;
    noSolution.className = 'alert warn';
    truncatedNote.hidden = true;

    resultSummary.textContent =
      `目标比 ${data.target.num}/${data.target.den} ≈ ${data.target.decimal}，` +
      `允许误差 ${data.tolerance.decimal}（即 ${parseFloat((Number(data.tolerance.decimal) * 100).toPrecision(6))}%），` +
      `达标方案 ${data.total} 条`;

    if (data.total === 0) {
      noSolution.textContent =
        '未找到满足条件的方案：在 1～3 级传动、每枚齿轮至多使用一次的限制下，' +
        '所有组合的实际转速比相对误差均超出允许范围。可尝试放宽误差或增加齿轮。';
      noSolution.hidden = false;
      return;
    }

    if (data.truncated) {
      truncatedNote.textContent = `达标方案较多，以下仅展示排序最靠前的 ${data.count} 条（共 ${data.total} 条）。`;
      truncatedNote.hidden = false;
    }
    data.results.forEach((r, i) => resultList.appendChild(renderSolution(r, i)));
  } catch (e) {
    resultPanel.hidden = false;
    resultList.innerHTML = '';
    noSolution.hidden = false;
    truncatedNote.hidden = true;
    resultSummary.textContent = '';
    noSolution.textContent = `请求出错：${e.message}`;
    noSolution.className = 'alert error';
  }
});
