'use strict';

const MIN_GEARS = 4;
const MAX_GEARS = 12;

const gearRowsBox = document.getElementById('gear-rows');
const speedRowsBox = document.getElementById('speed-rows');
const form = document.getElementById('dual-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const resultBanner = document.getElementById('result-banner');
const noSolutionDetail = document.getElementById('no-solution-detail');
const resultBody = document.getElementById('result-body');
const fixedPanel = document.getElementById('fixed-panel');
const speedResults = document.getElementById('speed-results');
const changePanel = document.getElementById('change-panel');

const EXAMPLE_GEARS = [
  { id: 'G1', teeth: 10 },
  { id: 'G2', teeth: 60 },
  { id: 'G3', teeth: 20 },
  { id: 'G4', teeth: 40 },
  { id: 'G5', teeth: 30 },
];
const EXAMPLE_SPEEDS = [
  { name: '档位一', target: '1/12', tolerance: '5%' },
  { name: '档位二', target: '1/9', tolerance: '5%' },
];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 齿轮清单编辑（4～12 枚） ---------------- */

function addGearRow(id = '', teeth = '') {
  const row = el('div', 'gear-row');
  row.innerHTML = `
    <input class="gear-id-input" placeholder="如 G1" value="${id}" />
    <input class="gear-teeth-input" type="number" min="1" max="100000" step="1" placeholder="齿数" value="${teeth}" />
    <button type="button" class="btn danger-ghost" title="删除该齿轮">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (gearRowsBox.children.length <= MIN_GEARS) {
      alert(`双档换速至少保留 ${MIN_GEARS} 枚齿轮`);
      return;
    }
    row.remove();
  });
  gearRowsBox.appendChild(row);
}

document.getElementById('btn-add-gear').addEventListener('click', () => {
  if (gearRowsBox.children.length >= MAX_GEARS) {
    alert(`最多 ${MAX_GEARS} 枚齿轮`);
    return;
  }
  addGearRow();
});

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
  if (gears.length < MIN_GEARS) throw new Error(`双档换速需填写 ${MIN_GEARS}～${MAX_GEARS} 枚齿轮（当前 ${gears.length} 枚）`);
  if (gears.length > MAX_GEARS) throw new Error(`齿轮数量不能超过 ${MAX_GEARS} 枚`);
  return gears;
}

/* ---------------- 档位（固定 2 个） ---------------- */

function addSpeedRow(name = '', target = '', tolerance = '') {
  const row = el('div', 'device-row');
  row.innerHTML = `
    <input class="speed-name-input" placeholder="如 档位一（可空）" value="${name}" maxlength="30" />
    <input class="speed-target-input" placeholder="目标速比，如 1/12" value="${target}" />
    <input class="speed-tolerance-input" placeholder="容差，如 5%" value="${tolerance}" />
    <span></span>
  `;
  speedRowsBox.appendChild(row);
}

function collectSpeeds() {
  const speeds = [];
  for (const row of speedRowsBox.querySelectorAll('.device-row')) {
    const name = row.querySelector('.speed-name-input').value.trim();
    const target = row.querySelector('.speed-target-input').value.trim();
    const tolerance = row.querySelector('.speed-tolerance-input').value.trim();
    if (!target) throw new Error(`第 ${speeds.length + 1} 个档位未填写目标输出转速比`);
    if (!tolerance) throw new Error(`第 ${speeds.length + 1} 个档位未填写允许相对误差`);
    speeds.push({ name, target, tolerance });
  }
  if (speeds.length !== 2) throw new Error('双档换速固定针对 2 个档位');
  return speeds;
}

document.getElementById('btn-example').addEventListener('click', () => {
  gearRowsBox.innerHTML = '';
  EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth));
  speedRowsBox.innerHTML = '';
  EXAMPLE_SPEEDS.forEach((sp) => addSpeedRow(sp.name, sp.target, sp.tolerance));
});

/* 初始：示例数据 */
EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth));
EXAMPLE_SPEEDS.forEach((sp) => addSpeedRow(sp.name, sp.target, sp.tolerance));

/* ---------------- 结果渲染 ---------------- */

function pairText(p) {
  return `<span class="gear-id">${p.drive.id}</span>（${p.drive.teeth} 齿）→ ` +
    `<span class="gear-id">${p.driven.id}</span>（${p.driven.teeth} 齿）`;
}

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
      <td>${i + 1}${i === 0 ? '（固定）' : '（换装）'}</td>
      <td><span class="gear-id">${p.drive.id}</span> · ${p.drive.teeth} 齿</td>
      <td><span class="gear-id">${p.driven.id}</span> · ${p.driven.teeth} 齿</td>
      <td class="frac">${p.stageRatio.num}/${p.stageRatio.den} ≈ ${p.stageRatio.decimal}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderSpeedCard(sp, index) {
  const card = el('div', 'solution best');

  const head = el('div', 'solution-head');
  const title = el('span', 'solution-title');
  title.appendChild(el('span', 'badge badge-ok', '达标'));
  title.appendChild(document.createTextNode(`${sp.name}（第 ${index + 1} 档）`));
  head.appendChild(title);
  head.appendChild(el('span', 'solution-meta',
    `目标比 <strong class="frac">${sp.target.num}/${sp.target.den}</strong>` +
    ` ≈ <strong>${sp.target.decimal}</strong>` +
    ` &nbsp;|&nbsp; 容差 <strong>${sp.tolerance.decimal}</strong>`));
  card.appendChild(head);

  const s = sp.solution;
  card.appendChild(el('div', 'solution-meta',
    `第二级换装 ${pairText({ drive: s.pairs[1].drive, driven: s.pairs[1].driven })}` +
    ` &nbsp;|&nbsp; 实际总速比 <strong class="frac">${s.ratio.num}/${s.ratio.den}</strong>` +
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
    payload = { gears: collectGears(), speeds: collectSpeeds() };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/dual-speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '双档选配失败');

    resultPanel.hidden = false;
    resultBanner.hidden = true;
    fixedPanel.innerHTML = '';
    speedResults.innerHTML = '';
    changePanel.innerHTML = '';
    noSolutionDetail.innerHTML = '';

    if (!data.feasible) {
      resultBody.hidden = true;
      resultSummary.textContent = '';
      showBanner('error', data.message);
      data.speeds.forEach((sp, i) => {
        if (!sp.hasCandidate) {
          noSolutionDetail.appendChild(el('p', 'alert warn',
            `${sp.name}（第 ${i + 1} 档）在“任意固定第一级 + 恰好两级”的组合下都不存在误差达标的装配，` +
            '可考虑放宽容差、调整目标速比或增加齿轮。'));
        }
      });
      return;
    }

    resultBody.hidden = false;
    resultSummary.textContent =
      `达标完整候选 ${data.candidateCount} 个 · 需更换轴位 ${data.changeCount} 个 · 两档相对误差之和 ${data.errorSum.decimal}（${data.errorSumPercent}%）`;
    showBanner('ok',
      '已按“需更换轴位最少 → 两档相对误差之和最小 → 齿轮编号自然序”在全部达标候选中选出唯一方案。');

    // 固定第一级
    const fixed = data.fixedStage;
    const fixedCard = el('div', 'solution best');
    fixedCard.appendChild(el('div', 'solution-head',
      `<span class="solution-title"><span class="badge">两档共用 · 固定第一级</span>` +
      `${pairText(fixed)}</span>` +
      `<span class="solution-meta">本级速比 <strong class="frac">${fixed.stageRatio.num}/${fixed.stageRatio.den}</strong>` +
      ` ≈ <strong>${fixed.stageRatio.decimal}</strong>（换档时保持不动）</span>`));
    fixedPanel.appendChild(fixedCard);

    // 两档换装级
    data.speeds.forEach((sp, i) => speedResults.appendChild(renderSpeedCard(sp, i)));

    // 需更换的轴位
    const labels = { drive: '第二级主动轴', driven: '第二级从动轴' };
    const posText = data.changedPositions.map((p) => labels[p]).join('、') || '无';
    changePanel.appendChild(el('h3', null,
      `换档时需更换的轴位：${data.changeCount} 个（${posText}）`));
    const chipList = el('div', 'chip-list');
    for (const p of ['drive', 'driven']) {
      const s1 = data.speeds[0].solution.pairs[1][p];
      const s2 = data.speeds[1].solution.pairs[1][p];
      const changed = data.changedPositions.includes(p);
      const chip = el('span', `chip${changed ? ' chip-buy' : ''}`);
      chip.textContent = changed
        ? `${labels[p]}：${s1.id}（${s1.teeth} 齿）⇄ ${s2.id}（${s2.teeth} 齿）需更换`
        : `${labels[p]}：两档均为 ${s1.id}（${s1.teeth} 齿），无需更换`;
      chipList.appendChild(chip);
    }
    changePanel.appendChild(chipList);

    // 寿命核算入口：把选中的固定一级与两档换装一级带入核算页
    const p1 = data.speeds[0].solution.pairs[1];
    const p2 = data.speeds[1].solution.pairs[1];
    const qs = new URLSearchParams({
      fd: fixed.drive.id,
      fdt: String(fixed.drive.teeth),
      fw: fixed.driven.id,
      fwt: String(fixed.driven.teeth),
      n1: data.speeds[0].name,
      a1: p1.drive.id,
      a1t: String(p1.drive.teeth),
      b1: p1.driven.id,
      b1t: String(p1.driven.teeth),
      n2: data.speeds[1].name,
      a2: p2.drive.id,
      a2t: String(p2.drive.teeth),
      b2: p2.driven.id,
      b2t: String(p2.driven.teeth),
    });
    const lifeEntry = el('div', 'life-entry');
    lifeEntry.innerHTML =
      `<a class="btn primary" href="/lifetime?${qs.toString()}">⏳ 前往寿命核算：带入该方案的固定一级与两档换装一级</a>` +
      '<p class="muted">在核算页填写每档每轮计划输入圈数与各参与齿轮的剩余允许转数，' +
      '按精确分数逐轮消耗，求全部齿轮均不超限的最多完整轮数。</p>';
    changePanel.appendChild(lifeEntry);
  } catch (e) {
    resultPanel.hidden = false;
    resultBody.hidden = true;
    resultSummary.textContent = '';
    showBanner('error', `请求出错：${e.message}`);
  }
});
