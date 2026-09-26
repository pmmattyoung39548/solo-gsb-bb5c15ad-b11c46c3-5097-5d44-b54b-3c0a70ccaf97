'use strict';

const MAX_TEETH = 100000;
const MAX_INPUT_TURNS = 10n ** 12n;
const MAX_REMAINING = 10n ** 18n;

const form = document.getElementById('lifetime-form');
const formError = document.getElementById('form-error');
const carryNote = document.getElementById('carry-note');
const remainingBox = document.getElementById('remaining-rows');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const resultBanner = document.getElementById('result-banner');
const resultDetail = document.getElementById('result-detail');

/* 第 1 节装配输入控件 */
const stageInputs = {
  fdId: document.getElementById('fd-id'),
  fdTeeth: document.getElementById('fd-teeth'),
  fwId: document.getElementById('fw-id'),
  fwTeeth: document.getElementById('fw-teeth'),
  speeds: [1, 2].map((i) => ({
    name: document.getElementById(`s${i}-name`),
    turns: document.getElementById(`s${i}-turns`),
    aId: document.getElementById(`s${i}-a-id`),
    aTeeth: document.getElementById(`s${i}-a-teeth`),
    bId: document.getElementById(`s${i}-b-id`),
    bTeeth: document.getElementById(`s${i}-b-teeth`),
  })),
};

const EXAMPLE = {
  fixed: { drive: { id: 'G1', teeth: 10 }, driven: { id: 'G2', teeth: 60 } },
  speeds: [
    { name: '档位一', turns: '120', drive: { id: 'G3', teeth: 20 }, driven: { id: 'G4', teeth: 40 } },
    { name: '档位二', turns: '90', drive: { id: 'G3', teeth: 20 }, driven: { id: 'G5', teeth: 30 } },
  ],
  remaining: { G1: '100000', G2: '9010', G3: '9000', G4: '5000', G5: '4000' },
};

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 装配填写（示例 / 双档结果带入） ---------------- */

function fillStage(cfg) {
  stageInputs.fdId.value = cfg.fixed.drive.id;
  stageInputs.fdTeeth.value = cfg.fixed.drive.teeth;
  stageInputs.fwId.value = cfg.fixed.driven.id;
  stageInputs.fwTeeth.value = cfg.fixed.driven.teeth;
  stageInputs.speeds.forEach((sp, i) => {
    const s = cfg.speeds[i];
    sp.name.value = s.name || '';
    sp.turns.value = s.turns || '';
    sp.aId.value = s.drive.id;
    sp.aTeeth.value = s.drive.teeth;
    sp.bId.value = s.driven.id;
    sp.bTeeth.value = s.driven.teeth;
  });
}

/** 从 URL 查询参数带入双档换速结果（?fd=..&fdt=..&fw=..&fwt=..&n1=..&a1=..&a1t=..&b1=..&b1t=..&n2=..&a2=..&a2t=..&b2=..&b2t=..） */
function prefillFromQuery() {
  const q = new URLSearchParams(location.search);
  const g = (k) => (q.get(k) ?? '').trim();
  if (!g('fd') || !g('fw') || !g('a1') || !g('b1') || !g('a2') || !g('b2')) return false;
  fillStage({
    fixed: { drive: { id: g('fd'), teeth: g('fdt') }, driven: { id: g('fw'), teeth: g('fwt') } },
    speeds: [
      { name: g('n1'), turns: '', drive: { id: g('a1'), teeth: g('a1t') }, driven: { id: g('b1'), teeth: g('b1t') } },
      { name: g('n2'), turns: '', drive: { id: g('a2'), teeth: g('a2t') }, driven: { id: g('b2'), teeth: g('b2t') } },
    ],
  });
  return true;
}

function fillExample() {
  fillStage(EXAMPLE);
  syncRemainingRows();
  for (const [id, v] of Object.entries(EXAMPLE.remaining)) {
    const input = remainingBox.querySelector(`input[data-id="${id}"]`);
    if (input) input.value = v;
  }
}

document.getElementById('btn-example').addEventListener('click', fillExample);

/* ---------------- 参与齿轮清单（随装配自动刷新，保留已填数值） ---------------- */

/** 宽松读取当前装配中的参与齿轮（仅收集编号非空且齿数合法的齿轮位） */
function currentParticipants() {
  const g = (idInput, teethInput) => {
    const id = idInput.value.trim();
    const teeth = Number(teethInput.value.trim());
    if (!id || !Number.isInteger(teeth) || teeth < 1 || teeth > MAX_TEETH) return null;
    return { id, teeth };
  };
  const map = new Map(); // id -> {id, teeth, roles[]}
  const add = (gear, role) => {
    if (!gear) return;
    if (!map.has(gear.id)) map.set(gear.id, { id: gear.id, teeth: gear.teeth, roles: [] });
    const entry = map.get(gear.id);
    if (!entry.roles.includes(role)) entry.roles.push(role);
  };
  add(g(stageInputs.fdId, stageInputs.fdTeeth), '固定级主动轮（两档）');
  add(g(stageInputs.fwId, stageInputs.fwTeeth), '固定级从动轮（两档）');
  stageInputs.speeds.forEach((sp, i) => {
    const label = `档${'一二'[i]}`;
    add(g(sp.aId, sp.aTeeth), `${label}换装主动轮`);
    add(g(sp.bId, sp.bTeeth), `${label}换装从动轮`);
  });
  return [...map.values()];
}

function syncRemainingRows() {
  const prev = new Map();
  for (const inp of remainingBox.querySelectorAll('input.remaining-input')) {
    prev.set(inp.dataset.id, inp.value);
  }
  remainingBox.innerHTML = '';
  const parts = currentParticipants();
  if (parts.length === 0) {
    remainingBox.appendChild(el('p', 'muted', '请先在第 1 节填写完整的双档装配。'));
    return;
  }
  for (const p of parts) {
    const row = el('div', 'life-row');
    row.innerHTML = `
      <span><span class="gear-id">${p.id}</span> · ${p.teeth} 齿</span>
      <span class="life-roles">${p.roles.join('＋')}</span>
      <input class="remaining-input" data-id="${p.id}" type="text" inputmode="numeric"
             placeholder="非负整数（转）" value="${prev.get(p.id) ?? ''}" />`;
    remainingBox.appendChild(row);
  }
}

[
  stageInputs.fdId,
  stageInputs.fdTeeth,
  stageInputs.fwId,
  stageInputs.fwTeeth,
  ...stageInputs.speeds.flatMap((sp) => [sp.aId, sp.aTeeth, sp.bId, sp.bTeeth]),
].forEach((inp) => inp.addEventListener('input', syncRemainingRows));

/* ---------------- 采集与校验 ---------------- */

function readGear(idInput, teethInput, label) {
  const id = idInput.value.trim();
  if (!id) throw new Error(`${label}缺少编号`);
  const teethRaw = teethInput.value.trim();
  if (!/^\d+$/.test(teethRaw)) throw new Error(`${label} ${id} 的齿数需为正整数`);
  const teeth = Number(teethRaw);
  if (teeth < 1 || teeth > MAX_TEETH) {
    throw new Error(`${label} ${id} 的齿数需为 1～${MAX_TEETH} 的整数`);
  }
  return { id, teeth };
}

function collectPayload() {
  const fd = readGear(stageInputs.fdId, stageInputs.fdTeeth, '固定第一级主动轮');
  const fw = readGear(stageInputs.fwId, stageInputs.fwTeeth, '固定第一级从动轮');
  if (fd.id === fw.id) throw new Error('固定第一级主动轮与从动轮不能是同一枚齿轮');

  const speeds = stageInputs.speeds.map((sp, i) => {
    const name = sp.name.value.trim() || `档位 ${i + 1}`;
    const turnsRaw = sp.turns.value.trim();
    if (!/^\d+$/.test(turnsRaw)) throw new Error(`${name}的每轮计划输入圈数需为正整数`);
    const turns = BigInt(turnsRaw);
    if (turns < 1n || turns > MAX_INPUT_TURNS) {
      throw new Error(`${name}的每轮计划输入圈数需为 1～${MAX_INPUT_TURNS.toString()} 的正整数`);
    }
    const sa = readGear(sp.aId, sp.aTeeth, `${name}换装级主动轮`);
    const sb = readGear(sp.bId, sp.bTeeth, `${name}换装级从动轮`);
    const ids = [fd.id, fw.id, sa.id, sb.id];
    if (new Set(ids).size !== ids.length) {
      throw new Error(`${name}内固定级与换装级的 4 枚齿轮不得重复（当前：${ids.join('、')}）`);
    }
    return { name, inputTurns: turnsRaw, swapStage: { drive: sa, driven: sb } };
  });

  // 同一编号在任何位置必须对应同一齿数
  const teethById = new Map();
  const ordered = [
    fd,
    fw,
    speeds[0].swapStage.drive,
    speeds[0].swapStage.driven,
    speeds[1].swapStage.drive,
    speeds[1].swapStage.driven,
  ];
  for (const g of ordered) {
    const prev = teethById.get(g.id);
    if (prev !== undefined && prev !== g.teeth) {
      throw new Error(`齿轮 ${g.id} 在不同位置填写了不同齿数（${prev} 与 ${g.teeth}）`);
    }
    teethById.set(g.id, g.teeth);
  }

  // 剩余允许转数：清单应与第 1 节装配一致（自动刷新），逐枚校验非负整数
  const inputs = [...remainingBox.querySelectorAll('input.remaining-input')];
  const expectIds = [...teethById.keys()];
  const actualIds = inputs.map((inp) => inp.dataset.id);
  if (
    actualIds.length !== expectIds.length ||
    expectIds.some((id) => !actualIds.includes(id))
  ) {
    throw new Error('参与齿轮清单与第 1 节装配不一致，请检查装配填写（清单会随装配自动刷新）');
  }
  const remaining = inputs.map((inp) => {
    const id = inp.dataset.id;
    const raw = inp.value.trim();
    if (!/^\d+$/.test(raw)) throw new Error(`齿轮 ${id} 的剩余允许转数需为非负整数`);
    if (BigInt(raw) > MAX_REMAINING) {
      throw new Error(`齿轮 ${id} 的剩余允许转数不能超过 ${MAX_REMAINING.toString()}`);
    }
    return { id, turns: raw };
  });

  return { fixedStage: { drive: fd, driven: fw }, speeds, remaining };
}

/* ---------------- 结果渲染 ---------------- */

function fracText(f) {
  return `${f.num}/${f.den} ≈ ${f.decimal}`;
}

function pairText(p) {
  return `<span class="gear-id">${p.drive.id}</span>（${p.drive.teeth} 齿）→ ` +
    `<span class="gear-id">${p.driven.id}</span>（${p.driven.teeth} 齿）`;
}

function renderAssembly(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '① 双档装配与各轴转速比（按齿数连乘，精确分数）'));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级 / 档位</th><th>有向配对</th><th>每轮计划输入圈数</th><th>相对输入轴转速比</th>
    </tr></thead>`;
  const tbody = el('tbody');

  const trFixed = el('tr');
  trFixed.innerHTML = `
    <td>固定第一级（两档共用）</td>
    <td>${pairText(data.fixedStage)}</td>
    <td>—</td>
    <td class="frac">${fracText(data.fixedStage.stageRatio)}<div class="torque-rated">中间轴（固定级从动轮 / 换装级主动轮）</div></td>`;
  tbody.appendChild(trFixed);

  data.speeds.forEach((sp, i) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${sp.name} · 换装第二级</td>
      <td>${pairText(sp.swapStage)}</td>
      <td class="frac">${sp.inputTurns}</td>
      <td class="frac">${fracText(sp.outputRatio)}<div class="torque-rated">输出轴（换装级从动轮）</div></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderConsumption(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '② 逐轮消耗（每枚齿轮每轮实际转数，按档拆分后累计）'));
  const table = el('table', 'pairs');
  const s1 = data.speeds[0].name;
  const s2 = data.speeds[1].name;
  table.innerHTML = `
    <thead><tr>
      <th>齿轮</th><th>${s1}负荷（转/轮）</th><th>${s2}负荷（转/轮）</th>
      <th>每轮合计消耗（转/轮）</th><th>剩余允许转数</th><th>单齿轮可执行轮数</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.gears.forEach((g) => {
    const tr = el('tr', g.limiting ? 'life-limit' : '');
    const loadCells = g.loads
      .map((l) => {
        if (!l) return '<td class="muted">未装入</td>';
        return `<td class="frac">${fracText(l.revolutions)}` +
          `<div class="torque-rated">${l.role} · ${l.shaft}</div></td>`;
      })
      .join('');
    tr.innerHTML = `
      <td><span class="gear-id">${g.id}</span> · ${g.teeth} 齿</td>
      ${loadCells}
      <td class="frac"><strong>${fracText(g.perRound)}</strong></td>
      <td class="frac">${g.remaining}</td>
      <td class="frac">${g.limiting ? `<span class="diag-bad">${g.maxRounds}</span>` : g.maxRounds}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  wrap.appendChild(el('p', 'muted',
    '单齿轮可执行轮数 = ⌊剩余允许转数 ÷ 每轮合计消耗⌋；最多完整轮数取全部齿轮的最小值（恰好达到限额视为可执行）。'));
  return wrap;
}

function renderOutcome(data) {
  const wrap = el('div');
  const zero = data.rounds === '0';
  wrap.appendChild(el('h3', 'block-title', '③ 可完整执行轮数与执行后余量'));

  const box = el('div', `solution ${zero ? 'miss' : 'best'}`);
  const chips = data.limitingGears.map((id) => `<span class="chip chip-buy">${id}</span>`).join(' ');
  box.innerHTML = `
    <div class="solution-head">
      <span class="solution-title">最多可完整执行 <span class="phase-big">${data.rounds}</span> 轮计划</span>
      <span class="badge ${zero ? 'badge-warn' : ''}">${zero ? '零轮受限' : '核算完成'}</span>
    </div>
    <div class="solution-meta">共同限制的齿轮（再执行 1 轮将超限）：</div>
    <div class="chip-list" style="margin-top:6px">${chips}</div>`;
  wrap.appendChild(box);

  if (zero) {
    const blockers = data.gears.filter((g) => g.maxRounds === '0');
    const zeroBox = el('div', 'solution miss');
    zeroBox.innerHTML = `
      <div class="solution-head">
        <span class="solution-title">受限原因：以下齿轮每轮消耗已超过其剩余允许转数，连 1 轮都无法完整执行</span>
      </div>`;
    blockers.forEach((g) => {
      zeroBox.appendChild(el('div', 'solution-meta',
        `齿轮 <span class="gear-id">${g.id}</span>：每轮消耗 <strong class="frac">${fracText(g.perRound)}</strong> 转，` +
        `剩余允许转数仅 <strong>${g.remaining}</strong> 转`));
    });
    wrap.appendChild(zeroBox);
  }

  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>齿轮</th><th>累计消耗（${data.rounds} 轮）</th><th>执行后余量（转）</th><th>标记</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.gears.forEach((g) => {
    const tr = el('tr', g.limiting ? 'life-limit' : '');
    const marks = [
      g.limiting ? '<span class="badge">限制齿轮</span>' : '',
      g.atLimit ? '<span class="badge badge-limit">恰好用尽</span>' : '',
    ].filter(Boolean).join(' ');
    tr.innerHTML = `
      <td><span class="gear-id">${g.id}</span> · ${g.teeth} 齿</td>
      <td class="frac">${fracText(g.consumed)}</td>
      <td class="frac">${fracText(g.margin)}</td>
      <td>${marks || '—'}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/* ---------------- 提交 ---------------- */

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
    const resp = await fetch('/api/lifetime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '寿命核算失败');

    resultPanel.hidden = false;
    resultDetail.innerHTML = '';

    const zero = data.rounds === '0';
    resultSummary.textContent = `参与齿轮 ${data.gearCount} 枚 · 最多可完整执行 ${data.rounds} 轮`;
    resultBanner.hidden = false;
    resultBanner.className = `alert ${zero ? 'error' : 'ok'}`;
    resultBanner.innerHTML = `<strong>${zero ? '零轮受限' : '核算完成'}：</strong>${data.message}`;

    resultDetail.appendChild(renderAssembly(data));
    resultDetail.appendChild(renderConsumption(data));
    resultDetail.appendChild(renderOutcome(data));
  } catch (e) {
    resultPanel.hidden = false;
    resultDetail.innerHTML = '';
    resultSummary.textContent = '';
    resultBanner.hidden = false;
    resultBanner.className = 'alert error';
    resultBanner.textContent = `请求出错：${e.message}`;
  }
});

/* 初始：优先带入双档换速结果，否则填入示例 */
if (prefillFromQuery()) {
  carryNote.hidden = false;
  syncRemainingRows();
} else {
  fillExample();
}
