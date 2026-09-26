'use strict';

const MIN_EXISTING = 2;
const MAX_EXISTING = 8;
const MIN_BUYABLE = 1;
const MAX_BUYABLE = 4;
const MAX_TOTAL = 12;

const existingRowsBox = document.getElementById('existing-rows');
const buyableRowsBox = document.getElementById('buyable-rows');
const deviceRowsBox = document.getElementById('device-rows');
const form = document.getElementById('procure-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const resultBanner = document.getElementById('result-banner');
const purchasePanel = document.getElementById('purchase-panel');
const purchaseCountEl = document.getElementById('purchase-count');
const purchasePriceEl = document.getElementById('purchase-price');
const purchaseList = document.getElementById('purchase-list');
const deviceResults = document.getElementById('device-results');
const unusedPanel = document.getElementById('unused-panel');
const unusedCount = document.getElementById('unused-count');
const unusedList = document.getElementById('unused-list');

/* 示例：现有 4 枚不足以同时装配 2 台；仅购买 P2（30 齿）即可，P1（48 齿）单独购入无解 */
const EXAMPLE_EXISTING = [
  { id: 'G1', teeth: 10 },
  { id: 'G2', teeth: 60 },
  { id: 'G3', teeth: 20 },
  { id: 'G4', teeth: 25 },
];
const EXAMPLE_BUYABLE = [
  { id: 'P1', teeth: 48, price: 80 },
  { id: 'P2', teeth: 30, price: 260 },
];
const EXAMPLE_DEVICES = [
  { name: '装置 1', target: '1/6', tolerance: '5%' },
  { name: '装置 2', target: '2/3', tolerance: '5%' },
];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 现有齿轮 ---------------- */

function addExistingRow(id = '', teeth = '') {
  const row = el('div', 'gear-row');
  row.innerHTML = `
    <input class="gear-id-input" placeholder="如 G1" value="${id}" />
    <input class="gear-teeth-input" type="number" min="1" max="100000" step="1" placeholder="齿数" value="${teeth}" />
    <button type="button" class="btn danger-ghost" title="删除该齿轮">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (existingRowsBox.children.length <= MIN_EXISTING) {
      alert(`至少保留 ${MIN_EXISTING} 枚现有齿轮`);
      return;
    }
    row.remove();
  });
  existingRowsBox.appendChild(row);
}

document.getElementById('btn-add-existing').addEventListener('click', () => addExistingRow());

/* ---------------- 可购齿轮 ---------------- */

function addBuyableRow(id = '', teeth = '', price = '') {
  const row = el('div', 'buyable-row');
  row.innerHTML = `
    <input class="buyable-id-input" placeholder="如 P1" value="${id}" />
    <input class="buyable-teeth-input" type="number" min="1" max="100000" step="1" placeholder="齿数" value="${teeth}" />
    <input class="buyable-price-input" type="number" min="0" step="1" placeholder="非负整数价格" value="${price}" />
    <button type="button" class="btn danger-ghost" title="删除该可购齿轮">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (buyableRowsBox.children.length <= MIN_BUYABLE) {
      alert(`至少保留 ${MIN_BUYABLE} 枚可购齿轮`);
      return;
    }
    row.remove();
  });
  buyableRowsBox.appendChild(row);
}

document.getElementById('btn-add-buyable').addEventListener('click', () => {
  if (buyableRowsBox.children.length >= MAX_BUYABLE) {
    alert(`最多 ${MAX_BUYABLE} 枚可购齿轮`);
    return;
  }
  addBuyableRow();
});

/* ---------------- 装置（固定 2 台） ---------------- */

function addDeviceRow(name = '', target = '', tolerance = '') {
  const row = el('div', 'device-row');
  row.innerHTML = `
    <input class="device-name-input" placeholder="如 装置甲（可空）" value="${name}" maxlength="30" />
    <input class="device-target-input" placeholder="目标速比，如 1/12" value="${target}" />
    <input class="device-tolerance-input" placeholder="容差，如 5%" value="${tolerance}" />
    <span></span>
  `;
  deviceRowsBox.appendChild(row);
}

/* ---------------- 采集与校验 ---------------- */

function collectRows(box, cls) {
  const rows = [];
  for (const row of box.querySelectorAll(cls)) {
    const fields = [...row.querySelectorAll('input')].map((i) => i.value.trim());
    rows.push({ row, fields });
  }
  return rows;
}

function collectPayload() {
  const existingGears = [];
  const existingIds = new Set();
  for (const { fields } of collectRows(existingRowsBox, '.gear-row')) {
    const [id, teethRaw] = fields;
    if (!id && !teethRaw) continue; // 空行忽略
    if (!id) throw new Error('存在未填写编号的现有齿轮行');
    if (existingIds.has(id)) throw new Error(`现有齿轮编号重复：${id}`);
    existingIds.add(id);
    const teeth = Number(teethRaw);
    if (!Number.isInteger(teeth) || teeth < 1) throw new Error(`现有齿轮 ${id} 的齿数需为正整数`);
    existingGears.push({ id, teeth });
  }
  if (existingGears.length < MIN_EXISTING || existingGears.length > MAX_EXISTING) {
    throw new Error(`现有齿轮需填写 ${MIN_EXISTING}～${MAX_EXISTING} 枚（当前 ${existingGears.length} 枚）`);
  }

  const buyableGears = [];
  const buyableIds = new Set();
  for (const { fields } of collectRows(buyableRowsBox, '.buyable-row')) {
    const [id, teethRaw, priceRaw] = fields;
    if (!id && !teethRaw && !priceRaw) continue; // 空行忽略
    if (!id) throw new Error('存在未填写编号的可购齿轮行');
    if (buyableIds.has(id)) throw new Error(`可购齿轮编号重复：${id}`);
    if (existingIds.has(id)) throw new Error(`可购齿轮编号与现有齿轮重复：${id}`);
    buyableIds.add(id);
    const teeth = Number(teethRaw);
    if (!Number.isInteger(teeth) || teeth < 1) throw new Error(`可购齿轮 ${id} 的齿数需为正整数`);
    if (priceRaw === '') throw new Error(`可购齿轮 ${id} 未填写价格`);
    const price = Number(priceRaw);
    if (!Number.isInteger(price) || price < 0) throw new Error(`可购齿轮 ${id} 的价格需为非负整数`);
    buyableGears.push({ id, teeth, price });
  }
  if (buyableGears.length < MIN_BUYABLE || buyableGears.length > MAX_BUYABLE) {
    throw new Error(`可购齿轮需填写 ${MIN_BUYABLE}～${MAX_BUYABLE} 枚（当前 ${buyableGears.length} 枚）`);
  }

  if (existingGears.length + buyableGears.length > MAX_TOTAL) {
    throw new Error(`现有齿轮与可购齿轮合计不能超过 ${MAX_TOTAL} 枚`);
  }

  const devices = [];
  for (const { fields } of collectRows(deviceRowsBox, '.device-row')) {
    const [name, target, tolerance] = fields;
    if (!target) throw new Error(`第 ${devices.length + 1} 台装置未填写目标输出转速比`);
    if (!tolerance) throw new Error(`第 ${devices.length + 1} 台装置未填写允许相对误差`);
    devices.push({ name, target, tolerance });
  }
  if (devices.length !== 2) throw new Error('缺齿补货固定针对 2 台装置');

  return { existingGears, buyableGears, devices };
}

document.getElementById('btn-example').addEventListener('click', () => {
  existingRowsBox.innerHTML = '';
  EXAMPLE_EXISTING.forEach((g) => addExistingRow(g.id, g.teeth));
  buyableRowsBox.innerHTML = '';
  EXAMPLE_BUYABLE.forEach((g) => addBuyableRow(g.id, g.teeth, g.price));
  deviceRowsBox.innerHTML = '';
  EXAMPLE_DEVICES.forEach((d) => addDeviceRow(d.name, d.target, d.tolerance));
});

/* 初始：示例数据 */
EXAMPLE_EXISTING.forEach((g) => addExistingRow(g.id, g.teeth));
EXAMPLE_BUYABLE.forEach((g) => addBuyableRow(g.id, g.teeth, g.price));
EXAMPLE_DEVICES.forEach((d) => addDeviceRow(d.name, d.target, d.tolerance));

/* ---------------- 结果渲染 ---------------- */

function renderPairsTable(solution) {
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级</th><th>主动轮（编号 / 齿数）</th><th>从动轮（编号 / 齿数）</th><th>本级速比（主动/从动）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  solution.pairs.forEach((p, i) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><span class="gear-id">${p.drive.id}</span> · ${p.drive.teeth} 齿</td>
      <td><span class="gear-id">${p.driven.id}</span> · ${p.driven.teeth} 齿</td>
      <td class="frac">${p.stageRatio.num}/${p.stageRatio.den} ≈ ${p.stageRatio.decimal}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderDeviceCard(d, index) {
  const card = el('div', 'solution best');

  const head = el('div', 'solution-head');
  const title = el('span', 'solution-title');
  const badge = el('span', 'badge badge-ok');
  badge.textContent = '可同时装配';
  title.appendChild(badge);
  title.appendChild(document.createTextNode(`${d.name}（第 ${index + 1} 台）`));
  head.appendChild(title);

  head.appendChild(el('span', 'solution-meta',
    `目标比 <strong class="frac">${d.target.num}/${d.target.den}</strong>` +
    ` ≈ <strong>${d.target.decimal}</strong>` +
    ` &nbsp;|&nbsp; 容差 <strong>${d.tolerance.decimal}</strong>`));
  card.appendChild(head);

  const s = d.solution;
  card.appendChild(el('div', 'solution-meta',
    `${s.stages} 级传动 · 实际转速比 ` +
    `<strong class="frac">${s.ratio.num}/${s.ratio.den}</strong>` +
    ` ≈ <strong>${s.ratio.decimal}</strong>` +
    ` &nbsp;|&nbsp; 相对误差 <strong>${s.errorPercent}%</strong>`));
  card.appendChild(renderPairsTable(s));
  return card;
}

function showBanner(kind, text) {
  resultBanner.hidden = false;
  resultBanner.className = `alert ${kind}`;
  resultBanner.textContent = text;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    payload = collectPayload();
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/procure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '生成采购建议失败');

    resultPanel.hidden = false;
    deviceResults.innerHTML = '';
    purchaseList.innerHTML = '';
    unusedList.innerHTML = '';
    resultBanner.hidden = true;

    resultSummary.textContent =
      `共枚举 ${data.subsetsChecked} 个可购齿轮子集，其中 ${data.feasibleSubsets} 个可使两台同时达标`;

    if (!data.feasible) {
      purchasePanel.hidden = true;
      unusedPanel.hidden = true;
      showBanner('error', data.message);
      data.devices.forEach((d, i) => {
        if (!d.hasMatchInPool) {
          deviceResults.appendChild(el('p', 'alert warn',
            `${d.name}（第 ${i + 1} 台）即使把全部可购齿轮买下，在 1～3 级传动内也不存在任何误差达标的配对，` +
            '可考虑放宽容差、调整目标速比或增加更多可购齿轮。'));
        }
      });
      return;
    }

    if (data.noPurchaseNeeded) {
      purchasePanel.hidden = true;
      showBanner('ok', '现有库存齿轮已可让两台装置在齿轮不复用的前提下同时达标装配，无需采购：采购清单为空。');
    } else {
      purchasePanel.hidden = false;
      purchaseCountEl.textContent = data.purchaseCount;
      purchasePriceEl.textContent = `¥${data.totalPrice}`;
      data.purchasedGears.forEach((g) => {
        const chip = el('span', 'chip chip-buy');
        chip.textContent = `${g.id} · ${g.teeth} 齿 · ¥${g.price}`;
        purchaseList.appendChild(chip);
      });
      showBanner('ok',
        `建议购买上述 ${data.purchaseCount} 枚齿轮（合计 ¥${data.totalPrice}）即可完成两台装配；` +
        '该建议在全部可行子集中按“购买枚数最少 → 总价最低 → 购买编号自然序”唯一确定。');
    }

    data.devices.forEach((d, i) => deviceResults.appendChild(renderDeviceCard(d, i)));

    unusedPanel.hidden = false;
    unusedCount.textContent = data.unusedGears.length;
    if (data.unusedGears.length === 0) {
      unusedList.appendChild(el('span', 'muted', '可用齿轮均已用于两台装配'));
    } else {
      data.unusedGears.forEach((g) => {
        const chip = el('span', `chip${g.origin === 'purchased' ? ' chip-buy' : ''}`);
        chip.textContent = `${g.id} · ${g.teeth} 齿 · ${g.origin === 'purchased' ? '已购未用' : '现有'}`;
        unusedList.appendChild(chip);
      });
    }
  } catch (e) {
    resultPanel.hidden = false;
    purchasePanel.hidden = true;
    unusedPanel.hidden = true;
    deviceResults.innerHTML = '';
    resultSummary.textContent = '';
    showBanner('error', `请求出错：${e.message}`);
  }
});
