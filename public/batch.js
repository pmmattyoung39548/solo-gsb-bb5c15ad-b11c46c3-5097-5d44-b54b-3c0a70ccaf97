'use strict';

const MIN_DEVICES = 2;
const MAX_DEVICES = 3;

const gearRowsBox = document.getElementById('gear-rows');
const deviceRowsBox = document.getElementById('device-rows');
const form = document.getElementById('batch-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const deviceResults = document.getElementById('device-results');
const unusedCount = document.getElementById('unused-count');
const unusedList = document.getElementById('unused-list');

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

const EXAMPLE_DEVICES = [
  { name: '装置甲', target: '1/12', tolerance: '5%' },
  { name: '装置乙', target: '1/6', tolerance: '5%' },
  { name: '装置丙', target: '3/10', tolerance: '5%' },
];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 齿轮清单编辑 ---------------- */

function addGearRow(id = '', teeth = '') {
  const row = el('div', 'gear-row');
  row.innerHTML = `
    <input class="gear-id-input" placeholder="如 G1" value="${id}" />
    <input class="gear-teeth-input" type="number" min="1" max="100000" step="1" placeholder="齿数" value="${teeth}" />
    <button type="button" class="btn danger-ghost" title="删除该齿轮">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (gearRowsBox.children.length <= 2) {
      alert('至少保留 2 枚齿轮');
      return;
    }
    row.remove();
  });
  gearRowsBox.appendChild(row);
}

document.getElementById('btn-add-gear').addEventListener('click', () => addGearRow());

function collectGears() {
  const gears = [];
  const ids = new Set();
  for (const row of gearRowsBox.querySelectorAll('.gear-row')) {
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

/* ---------------- 装置列表编辑 ---------------- */

function addDeviceRow(name = '', target = '', tolerance = '') {
  const row = el('div', 'device-row');
  row.innerHTML = `
    <input class="device-name-input" placeholder="如 装置甲（可空）" value="${name}" maxlength="30" />
    <input class="device-target-input" placeholder="目标速比，如 1/12" value="${target}" />
    <input class="device-tolerance-input" placeholder="容差，如 5%" value="${tolerance}" />
    <button type="button" class="btn danger-ghost" title="删除该装置">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (deviceRowsBox.children.length <= MIN_DEVICES) {
      alert(`批量装配至少保留 ${MIN_DEVICES} 台装置`);
      return;
    }
    row.remove();
  });
  deviceRowsBox.appendChild(row);
}

document.getElementById('btn-add-device').addEventListener('click', () => {
  if (deviceRowsBox.children.length >= MAX_DEVICES) {
    alert(`批量装配最多 ${MAX_DEVICES} 台装置`);
    return;
  }
  addDeviceRow();
});

function collectDevices() {
  const devices = [];
  for (const row of deviceRowsBox.querySelectorAll('.device-row')) {
    const name = row.querySelector('.device-name-input').value.trim();
    const target = row.querySelector('.device-target-input').value.trim();
    const tolerance = row.querySelector('.device-tolerance-input').value.trim();
    if (!target) throw new Error(`第 ${devices.length + 1} 台装置未填写目标输出转速比`);
    if (!tolerance) throw new Error(`第 ${devices.length + 1} 台装置未填写允许相对误差`);
    devices.push({ name, target, tolerance });
  }
  if (devices.length < MIN_DEVICES || devices.length > MAX_DEVICES) {
    throw new Error(`批量装配需输入 ${MIN_DEVICES}～${MAX_DEVICES} 台装置`);
  }
  return devices;
}

document.getElementById('btn-example').addEventListener('click', () => {
  gearRowsBox.innerHTML = '';
  EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth));
  deviceRowsBox.innerHTML = '';
  EXAMPLE_DEVICES.forEach((d) => addDeviceRow(d.name, d.target, d.tolerance));
});

/* 初始：4 枚齿轮 + 2 台装置 */
addGearRow('G1', 10);
addGearRow('G2', 60);
addGearRow('G3', 20);
addGearRow('G4', 30);
addDeviceRow('装置 1', '1/6', '5%');
addDeviceRow('装置 2', '2/3', '5%');

/* ---------------- 结果渲染 ---------------- */

function renderPairsTable(r) {
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
  return table;
}

function renderDeviceCard(d, index) {
  const card = el('div', `solution ${d.matched ? 'best' : 'miss'}`);

  const head = el('div', 'solution-head');
  const title = el('span', 'solution-title');
  const badge = el('span', `badge ${d.matched ? 'badge-ok' : 'badge-miss'}`);
  badge.textContent = d.matched ? '已分配' : '未满足';
  title.appendChild(badge);
  title.appendChild(document.createTextNode(`${d.name}（第 ${index + 1} 台）`));
  head.appendChild(title);

  const targetText =
    `目标比 <strong class="frac">${d.target.num}/${d.target.den}</strong>` +
    ` ≈ <strong>${d.target.decimal}</strong>` +
    ` &nbsp;|&nbsp; 容差 <strong>${d.tolerance.decimal}</strong>`;
  head.appendChild(el('span', 'solution-meta', targetText));
  card.appendChild(head);

  const note = el(
    'p',
    'muted',
    `该台全部达标方案 ${d.totalMatches} 条（按占用齿轮集合去重后候选 ${d.candidateCount} 个，均参与整批分配）`,
  );
  card.appendChild(note);

  if (d.matched) {
    const meta = el('div', 'solution-meta',
      `${d.solution.stages} 级传动 · 实际转速比 ` +
      `<strong class="frac">${d.solution.ratio.num}/${d.solution.ratio.den}</strong>` +
      ` ≈ <strong>${d.solution.ratio.decimal}</strong>` +
      ` &nbsp;|&nbsp; 相对误差 <strong>${d.solution.errorPercent}%</strong>`);
    card.appendChild(meta);
    card.appendChild(renderPairsTable(d.solution));
  } else if (d.totalMatches === 0) {
    card.appendChild(el('p', 'alert warn',
      '该台在 1～3 级传动范围内不存在任何误差达标的配对方案，可尝试放宽容差或增加齿轮。'));
  } else {
    card.appendChild(el('p', 'alert warn',
      '该台单独选配时存在达标配对，但为保证整批达标台数最多、总级数与误差最优，' +
      '其所需齿轮被优先分配给其他装置，故本台未满足。'));
  }
  return card;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    payload = { gears: collectGears(), devices: collectDevices() };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '批量装配失败');

    resultPanel.hidden = false;
    deviceResults.innerHTML = '';
    unusedList.innerHTML = '';

    resultSummary.textContent =
      `达标 ${data.matchedCount}/${data.deviceCount} 台 · 总级数 ${data.totalStages} · ` +
      `相对误差之和 ${data.errorSum.decimal}（${data.errorSumPercent}%）`;

    data.devices.forEach((d, i) => deviceResults.appendChild(renderDeviceCard(d, i)));

    unusedCount.textContent = data.unusedGears.length;
    if (data.unusedGears.length === 0) {
      unusedList.appendChild(el('span', 'muted', '全部齿轮均已分配'));
    } else {
      data.unusedGears.forEach((g) => {
        const chip = el('span', 'chip');
        chip.textContent = `${g.id} · ${g.teeth} 齿`;
        unusedList.appendChild(chip);
      });
    }
  } catch (e) {
    resultPanel.hidden = false;
    deviceResults.innerHTML = '';
    unusedList.innerHTML = '';
    unusedCount.textContent = '0';
    resultSummary.textContent = '';
    const err = el('p', 'alert error');
    err.textContent = `请求出错：${e.message}`;
    deviceResults.appendChild(err);
  }
});
