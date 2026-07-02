/* ═══════════════════════════════════════════════════════════════
   NOCTURNE III · Console — same floor, new soul.
   Speaks the exact same Firebase dialect as index.html:
     eclipse/deck7/floor      { tables, splits, combinations, turnCounts, positions }
     eclipse/deck7/seatings   seat notifications (.set + nonce)
     eclipse/deck7/resets     reset notifications (.set + nonce)
     eclipse/deck7/broadcasts push feed
     eclipse/deck7/tableNotes { id: {text, by, ts} }
     eclipse/deck7/softBlocks hold-for-later groups (rendered, guarded)
     eclipse/deck7/resetTimers auto-reset countdowns (rendered)
     eclipse/deck7/_forceReload remote refresh signal
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ── Firebase ── */
const firebaseConfig = {
  apiKey:            "AIzaSyDNIpnIuJIF1guVUydbAmo_vV7OBNl3a28",
  authDomain:        "eclipse-floor.firebaseapp.com",
  databaseURL:       "https://eclipse-floor-default-rtdb.firebaseio.com",
  projectId:         "eclipse-floor",
  storageBucket:     "eclipse-floor.firebasestorage.app",
  messagingSenderId: "726505687250",
  appId:             "1:726505687250:web:4a80333510fa6308ec450b"
};
if (typeof firebase === 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const sub = document.querySelector('.veil-sub');
    if (sub) { sub.textContent = 'offline — firebase sdk failed to load'; sub.style.color = '#ff5d73'; }
  });
  throw new Error('Firebase SDK not loaded');
}
firebase.initializeApp(firebaseConfig);
const db    = firebase.database();
const FLOOR = db.ref('eclipse/deck7/floor');
const P     = (p) => db.ref('eclipse/deck7/' + p);

/* ── Identity (shared with the original app) ── */
let ME = localStorage.getItem('eclipse_user_name') || '';

/* ── Live state ── */
const S = {
  tables: {}, splits: {}, combinations: [], turnCounts: {}, positions: {},
  notes: {}, softBlocks: {}, resetTimers: {},
  dark: false, ready: false,
};

/* ── Tiny utils ── */
const $  = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const nonce = () => Math.random().toString(36).slice(2);
const fmtT = (ms) => new Date(ms).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
const elapsedStr = (t0) => {
  const m = Math.floor((Date.now() - t0) / 60000);
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
};

function splitLetters(pid) { return (S.splits[pid] && S.splits[pid].letters) || ['A', 'B']; }
function tableSeats(id) {
  const base = id.replace(/[A-D]$/, '');
  const td = TABLE_DATA.find(t => t.id === base);
  if (!td) return 2;
  if (id !== base && S.splits[base]) return Math.max(1, Math.ceil(td.seats / splitLetters(base).length));
  return td.seats;
}
function tablePos(id) {
  if (S.positions[id]) return S.positions[id];
  const base = id.replace(/[A-D]$/, '');
  if (id !== base && S.splits[base]) {
    const l = id.slice(-1);
    if (S.splits[base][l]) return S.splits[base][l];
  }
  const td = TABLE_DATA.find(t => t.id === base);
  return td ? { x: td.x, y: td.y } : { x: 50, y: 50 };
}
function combinedGroup(id) {
  const g = S.combinations.find(grp => Array.isArray(grp) && grp.includes(id) && grp.length > 1);
  return g ? g.slice() : null;
}
function heldGroupOf(id) {
  for (const gid in S.softBlocks) {
    const g = S.softBlocks[gid];
    if (g && (g.status === 'active' || g.status === 'triggered') &&
        Array.isArray(g.tableIds) && g.tableIds.includes(id)) return g;
  }
  return null;
}

/* ═══════════════ BOOT ═══════════════ */
let _veilPct = 0;
function veil(pct) { _veilPct = Math.max(_veilPct, pct); $('#veil-fill').style.width = _veilPct + '%'; }
function veilDone() {
  veil(100);
  setTimeout(() => $('#veil').classList.add('gone'), 350);
}

document.addEventListener('DOMContentLoaded', () => {
  veil(15);
  initGate();
  initCamera();
  initListeners();
  initRail();
  initClock();
  setInterval(tickUnders, 20000);
  // Failsafe: never trap users behind the veil
  setTimeout(veilDone, 7000);
});

/* ═══════════════ IDENTITY GATE ═══════════════ */
function initGate() {
  if (ME) { $('#rail-user').textContent = ME; return; }
  const gate = $('#gate'), input = $('#gate-input'), go = $('#gate-go');
  gate.hidden = false;
  input.addEventListener('input', () => { go.disabled = input.value.trim().length < 2; });
  const enter = () => {
    const v = input.value.trim();
    if (v.length < 2) return;
    ME = v;
    localStorage.setItem('eclipse_user_name', v);
    $('#rail-user').textContent = v;
    gate.hidden = true;
  };
  go.addEventListener('click', enter);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });
}

/* ═══════════════ FIREBASE LISTENERS ═══════════════ */
let _skipSeatN = null, _skipResetN = null, _skipCastK = null, _loadReloadV;

function initListeners() {
  db.ref('.info/connected').on('value', s => {
    $('#rail-sync').classList.toggle('off', !s.val());
  });

  FLOOR.on('value', snap => {
    const v = snap.val() || {};
    S.tables       = v.tables       || {};
    S.splits       = v.splits       || {};
    S.combinations = Array.isArray(v.combinations) ? v.combinations : Object.values(v.combinations || {});
    S.turnCounts   = v.turnCounts   || {};
    S.positions    = v.positions    || {};
    if (!S.ready) { S.ready = true; veilDone(); fitMap(); }
    render();
  });
  veil(40);

  P('tableNotes').on('value', s => { S.notes = s.val() || {}; render(); });
  P('softBlocks').on('value', s => { S.softBlocks = s.val() || {}; render(); });
  P('resetTimers').on('value', s => { S.resetTimers = s.val() || {}; render(); });

  P('seatings').once('value').then(s => {
    _skipSeatN = s.val()?.nonce || null;
    P('seatings').on('value', s2 => {
      const d = s2.val();
      if (!d?.nonce || d.nonce === _skipSeatN) return;
      _skipSeatN = d.nonce;
      if (d.deviceId === deviceKey()) return;
      if (Date.now() - (d.ts || 0) > 30000) return;
      toast(`<b>${esc(d.sender || '?')}</b> seated table <b>${esc(d.tableId)}</b> · ${d.covers || '?'} covers`);
      tick(`<b>${esc(d.tableId)}</b> seated · ${esc(d.sender || '')}`);
    });
  });

  P('resets').once('value').then(s => {
    _skipResetN = s.val()?.nonce || null;
    P('resets').on('value', s2 => {
      const d = s2.val();
      if (!d?.nonce || d.nonce === _skipResetN) return;
      _skipResetN = d.nonce;
      if (d.deviceId === deviceKey()) return;
      if (Date.now() - (d.ts || 0) > 30000) return;
      toast(`table <b>${esc(d.tableId)}</b> reset by <b>${esc(d.sender || '?')}</b>`, 'warn');
      tick(`<b>${esc(d.tableId)}</b> reset`, true);
    });
  });

  P('broadcasts').limitToLast(1).once('value').then(s => {
    s.forEach(c => { _skipCastK = c.key; });
    P('broadcasts').limitToLast(1).on('child_added', c => {
      if (c.key === _skipCastK) return;
      _skipCastK = c.key;
      const d = c.val();
      if (!d?.msg) return;
      toast(`<b>${esc(d.sender || '?')}</b> — ${esc(d.msg)}`, d.type === 'holdWarning' ? 'warn' : '');
      tick(`✦ ${esc(d.msg).slice(0, 60)}`);
    });
  });

  P('_forceReload').on('value', s => {
    const v = s.val();
    if (_loadReloadV === undefined) { _loadReloadV = v; return; }
    if (v !== _loadReloadV) location.reload();
  });
  veil(70);
}
function deviceKey() { return ME || ''; }

/* ═══════════════ RENDER ═══════════════ */
function render() {
  const layer = $('#chips');
  if (!layer) return;
  const img = $('#map');
  if (!img.naturalWidth) { img.addEventListener('load', render, { once: true }); return; }
  const W = img.naturalWidth, H = img.naturalHeight;
  layer.innerHTML = '';

  const drawChip = (id, pos, seats) => {
    const ts   = S.tables[id];
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.id = id;
    chip.style.left = (pos.x / 100 * W) + 'px';
    chip.style.top  = (pos.y / 100 * H) + 'px';

    let under = '';
    if (ts?.occupied) {
      chip.classList.add('occ' + Math.min(ts.seating || 1, 4));
      under = elapsedStr(ts.seatedAt || Date.now());
      if (Date.now() - (ts.seatedAt || 0) > 90 * 60000) chip.classList.add('overtime');
    } else if (ts?.blocked) {
      chip.classList.add(ts.holdGroupId ? 'held' : 'blocked');
    } else if (heldGroupOf(id) && !ts?.occupied) {
      chip.classList.add('held');
    }

    chip.innerHTML = `<span>${esc(id)}</span>` +
      (S.notes[id] ? '<span class="corner">✎</span>' : '') +
      (S.resetTimers[id] && !S.resetTimers[id].claimed ? '<div class="timer-ring"></div>' : '') +
      (under ? `<div class="under" data-t0="${ts.seatedAt || ''}">${under}</div>` : '');

    chip.addEventListener('click', () => { if (!_camMoved) openSheet(id); });
    layer.appendChild(chip);
  };

  TABLE_DATA.forEach(td => {
    if (S.splits[td.id]) {
      splitLetters(td.id).forEach(l => drawChip(td.id + l, tablePos(td.id + l), tableSeats(td.id + l)));
    } else {
      drawChip(td.id, tablePos(td.id), td.seats);
    }
  });

  drawLinks(W, H);
  applySearch();
  updateStats();
}

function drawLinks(W, H) {
  const svg = $('#links');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';
  S.combinations.forEach(grp => {
    if (!Array.isArray(grp) || grp.length < 2) return;
    for (let i = 0; i < grp.length - 1; i++) {
      const a = tablePos(grp[i]), b = tablePos(grp[i + 1]);
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', a.x / 100 * W); ln.setAttribute('y1', a.y / 100 * H);
      ln.setAttribute('x2', b.x / 100 * W); ln.setAttribute('y2', b.y / 100 * H);
      svg.appendChild(ln);
    }
  });
}

function tickUnders() {
  document.querySelectorAll('.chip .under[data-t0]').forEach(u => {
    const t0 = parseInt(u.dataset.t0, 10);
    if (t0) u.textContent = elapsedStr(t0);
  });
}

function updateStats() {
  let free = 0, seated = 0, covers = 0, total = 0;
  TABLE_DATA.forEach(td => {
    const ids = S.splits[td.id] ? splitLetters(td.id).map(l => td.id + l) : [td.id];
    ids.forEach(id => {
      total++;
      const ts = S.tables[id];
      if (ts?.occupied) { seated++; covers += ts.covers || 0; }
      else free++;
    });
  });
  setStat('rs-avail', free); setStat('rs-seated', seated); setStat('rs-covers', covers);
  setStat('rs-occ', total ? Math.round(seated / total * 100) + '%' : '—');
}
function setStat(id, val) {
  const el = document.getElementById(id), b = el?.querySelector('b');
  if (!b) return;
  const prev = b.textContent;
  b.textContent = val;
  if (prev !== String(val) && prev !== '—') {
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 300);
  }
}

/* ═══════════════ CAMERA — pan / pinch / wheel ═══════════════ */
const CAM = { x: 0, y: 0, z: 1 };
let _camMoved = false;

function applyCam() {
  $('#world').style.transform = `translate(${CAM.x}px, ${CAM.y}px) scale(${CAM.z})`;
}
function fitMap() {
  const img = $('#map'), stage = $('#stage');
  if (!img.naturalWidth) { img.addEventListener('load', fitMap, { once: true }); return; }
  const z = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight);
  CAM.z = z;
  CAM.x = (stage.clientWidth  - img.naturalWidth  * z) / 2;
  CAM.y = (stage.clientHeight - img.naturalHeight * z) / 2;
  applyCam();
}
function zoomAt(nz, cx, cy) {
  nz = Math.max(0.35, Math.min(4.5, nz));
  const k = nz / CAM.z;
  CAM.x = cx - (cx - CAM.x) * k;
  CAM.y = cy - (cy - CAM.y) * k;
  CAM.z = nz;
  applyCam();
}

function initCamera() {
  const stage = $('#stage');
  const pts = new Map();
  let start = null, pinch0 = null;

  // NOTE: no setPointerCapture here — capturing would retarget the derived
  // click event to the stage and table chips would never receive taps.
  stage.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    _camMoved = false;
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, cx: CAM.x, cy: CAM.y };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: CAM.z };
      start = null;
    }
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1 && start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 6) { _camMoved = true; stage.classList.add('dragging'); }
      if (_camMoved) { CAM.x = start.cx + dx; CAM.y = start.cy + dy; applyCam(); }
    } else if (pts.size === 2 && pinch0) {
      _camMoved = true;
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = stage.getBoundingClientRect();
      zoomAt(pinch0.z * (d / pinch0.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    }
  });
  const lift = e => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = null;
    if (pts.size === 1) { const [p] = [...pts.values()]; start = { x: p.x, y: p.y, cx: CAM.x, cy: CAM.y }; }
    if (pts.size === 0) { start = null; stage.classList.remove('dragging'); setTimeout(() => { _camMoved = false; }, 50); }
  };
  // Window-level release — the finger can lift outside the stage
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);

  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(CAM.z * (e.deltaY < 0 ? 1.13 : 0.885), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  stage.addEventListener('dblclick', e => {
    const r = stage.getBoundingClientRect();
    if (CAM.z < 1.4) zoomAt(2, e.clientX - r.left, e.clientY - r.top);
    else fitMap();
  });

  window.addEventListener('resize', () => { if (S.ready) fitMap(); });
}

/* ═══════════════ BOTTOM SHEET ═══════════════ */
let _sheetId = null, _covers = 2, _staterooms = [];

function openSheet(id) {
  _sheetId = id;
  const ts = S.tables[id];
  const held = heldGroupOf(id);
  if (ts?.occupied)                buildOccupied(id, ts);
  else if (ts?.blocked || held)    buildHeldOrBlocked(id, ts, held);
  else                             buildSeat(id);
  $('#sheet').hidden = false;
  $('#sheet-scrim').hidden = false;
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-scrim').hidden = true;
  _sheetId = null;
}
document.addEventListener('DOMContentLoaded', () => {
  $('#sheet-scrim').addEventListener('click', closeSheet);
});

/* ── FREE TABLE → seat flow ── */
function buildSeat(id) {
  const seats = tableSeats(id);
  _covers = Math.min(seats, 2); _staterooms = [];
  $('#sheet-body').innerHTML = `
    <div class="sh-head"><div class="sh-num">${esc(id)}</div><div class="sh-tag free">AVAILABLE</div></div>
    <div class="sh-sub">${seats} seats · station ${esc(TABLE_TO_STATION[id.replace(/[A-D]$/, '')] || '—')}</div>
    <div class="cov-line">
      <button class="cbtn" id="cv-minus">−</button>
      <div class="cov-num" id="cv-num">${_covers}</div>
      <button class="cbtn" id="cv-plus">+</button>
    </div>
    <div class="cov-cap">COVERS</div>
    <div class="sr-line">
      <input id="sh-stateroom" type="tel" inputmode="numeric" placeholder="stateroom…">
      <button class="sr-add" id="sr-add">ADD</button>
    </div>
    <div class="sr-chips" id="sr-chips"></div>
    <div class="sh-actions">
      <button class="shb primary" id="do-seat">SEAT GUESTS</button>
      <button class="shb ghost-warn" id="do-block">BLOCK</button>
      <button class="shb" id="do-close">CLOSE</button>
    </div>`;
  $('#cv-minus').onclick = () => setCovers(_covers - 1);
  $('#cv-plus').onclick  = () => setCovers(_covers + 1);
  $('#sr-add').onclick   = addStateroom;
  $('#sh-stateroom').addEventListener('keydown', e => { if (e.key === 'Enter') addStateroom(); });
  $('#do-seat').onclick  = () => doSeat(id);
  $('#do-block').onclick = () => buildBlockConfirm(id);
  $('#do-close').onclick = closeSheet;
}
function setCovers(n) { _covers = Math.max(1, Math.min(30, n)); $('#cv-num').textContent = _covers; }
function addStateroom() {
  const inp = $('#sh-stateroom');
  const v = inp.value.trim();
  if (!v) return;
  if (!_staterooms.includes(v)) _staterooms.push(v);
  inp.value = '';
  $('#sr-chips').innerHTML = _staterooms.map((s, i) =>
    `<span class="sr-chip" data-i="${i}">${esc(s)} ✕</span>`).join('');
  document.querySelectorAll('.sr-chip').forEach(ch =>
    ch.addEventListener('click', () => { _staterooms.splice(parseInt(ch.dataset.i, 10), 1); addStateroomRefresh(); }));
}
function addStateroomRefresh() {
  $('#sr-chips').innerHTML = _staterooms.map((s, i) =>
    `<span class="sr-chip" data-i="${i}">${esc(s)} ✕</span>`).join('');
  document.querySelectorAll('.sr-chip').forEach(ch =>
    ch.addEventListener('click', () => { _staterooms.splice(parseInt(ch.dataset.i, 10), 1); addStateroomRefresh(); }));
}

function doSeat(id) {
  const seating = Math.min((S.turnCounts[id] || 0) + 1, 4);
  const entry = {
    occupied: true, seating,
    staterooms: _staterooms.slice(),
    covers: _covers, sharing: false,
    seatedAt: Date.now(), seatedBy: ME || '',
  };
  FLOOR.update({ ['tables/' + id]: entry, ['turnCounts/' + id]: seating }).catch(() => {});
  P('seatings').set({
    tableId: id, ts: Date.now(), deviceId: deviceKey(), sender: ME || '',
    covers: _covers, seating, nonce: nonce(),
  }).catch(() => {});
  S.tables[id] = entry; S.turnCounts[id] = seating;
  closeSheet(); render();
  tick(`<b>${esc(id)}</b> seated · you`);
}

/* ── OCCUPIED TABLE → info + swipe reset ── */
function buildOccupied(id, ts) {
  const note = S.notes[id];
  const grp = combinedGroup(id);
  $('#sheet-body').innerHTML = `
    <div class="sh-head"><div class="sh-num">${esc(id)}</div>
      <div class="sh-tag t${Math.min(ts.seating || 1, 4)}">TURN ${Math.min(ts.seating || 1, 4)}</div></div>
    <div class="sh-sub">seated ${ts.seatedAt ? 'at ' + fmtT(ts.seatedAt) : ''}${ts.seatedBy ? ' · by ' + esc(ts.seatedBy) : ''}</div>
    ${note ? `<div class="sh-note">📝 ${esc(note.text)} <i>— ${esc(note.by || '')}</i></div>` : ''}
    <div class="sh-rows">
      <div class="sh-row">covers <b>${ts.covers || '—'}</b></div>
      <div class="sh-row">staterooms <b>${(ts.staterooms || []).join(', ') || '—'}</b></div>
      <div class="sh-row">elapsed <b class="live" id="sh-elapsed">${ts.seatedAt ? elapsedStr(ts.seatedAt) : '—'}</b></div>
      ${grp ? `<div class="sh-row">combined <b>${grp.join(' + ')}</b></div>` : ''}
    </div>
    <div class="sh-actions">
      <button class="shb ghost-mint" id="do-note">📝 NOTE</button>
      <button class="shb" id="do-close">CLOSE</button>
    </div>
    <div class="swipe-wrap">
      <div class="swipe-track" id="swipe-track">
        <div class="swipe-label">SLIDE TO RESET</div>
        <div class="swipe-knob" id="swipe-knob">≫</div>
      </div>
    </div>`;
  $('#do-note').onclick  = () => buildNote(id);
  $('#do-close').onclick = closeSheet;
  initSwipe(id, grp);
}

function initSwipe(id, grp) {
  const track = $('#swipe-track'), knob = $('#swipe-knob');
  let startX = null;
  knob.addEventListener('pointerdown', e => {
    knob.setPointerCapture(e.pointerId);
    startX = e.clientX;
  });
  knob.addEventListener('pointermove', e => {
    if (startX === null) return;
    const max = track.clientWidth - knob.offsetWidth - 8;
    const x = Math.max(0, Math.min(max, e.clientX - startX));
    knob.style.left = (4 + x) + 'px';
    track.classList.toggle('armed', x > max * 0.6);
    if (x >= max * 0.96) {
      startX = null;
      track.classList.add('done');
      knob.style.left = (4 + max) + 'px';
      setTimeout(() => doReset(id, grp), 180);
    }
  });
  const drop = () => {
    if (startX === null) return;
    startX = null;
    knob.style.left = '4px';
    track.classList.remove('armed');
  };
  knob.addEventListener('pointerup', drop);
  knob.addEventListener('pointercancel', drop);
}

function doReset(id, grp) {
  const ids = grp || [id];
  const ops = {};
  ids.forEach(t => { ops['tables/' + t] = null; delete S.tables[t]; });
  FLOOR.update(ops).catch(() => {});
  P('resets').set({ tableId: id, ts: Date.now(), deviceId: deviceKey(), sender: ME || '', nonce: nonce() }).catch(() => {});
  ids.forEach(t => { if (S.notes[t]) { delete S.notes[t]; P('tableNotes/' + t).remove().catch(() => {}); } });
  closeSheet(); render();
  tick(`<b>${esc(id)}</b> reset · you`, true);
}

/* ── NOTES ── */
function buildNote(id) {
  const existing = S.notes[id];
  $('#sheet-body').innerHTML = `
    <div class="sh-head"><div class="sh-num">${esc(id)}</div><div class="sh-tag free">NOTE</div></div>
    <div class="sh-sub">visible on every device</div>
    <textarea class="sh-ta" id="note-ta" maxlength="90" placeholder="birthday · allergy · VIP…">${esc(existing ? existing.text : '')}</textarea>
    <div class="sh-actions">
      <button class="shb primary" id="note-save">SAVE</button>
      ${existing ? '<button class="shb ghost-red" id="note-del">REMOVE</button>' : ''}
      <button class="shb" id="note-back">BACK</button>
    </div>`;
  $('#note-save').onclick = () => {
    const text = $('#note-ta').value.trim();
    if (text) {
      S.notes[id] = { text, by: ME || '', ts: Date.now() };
      P('tableNotes/' + id).set(S.notes[id]).catch(() => {});
    } else {
      delete S.notes[id];
      P('tableNotes/' + id).remove().catch(() => {});
    }
    render(); openSheet(id);
  };
  const del = $('#note-del');
  if (del) del.onclick = () => {
    delete S.notes[id];
    P('tableNotes/' + id).remove().catch(() => {});
    render(); openSheet(id);
  };
  $('#note-back').onclick = () => openSheet(id);
}

/* ── BLOCK / HELD ── */
function buildBlockConfirm(id) {
  $('#sheet-body').innerHTML = `
    <div class="sh-head"><div class="sh-num">${esc(id)}</div><div class="sh-tag blk">BLOCK</div></div>
    <div class="sh-sub">held out of service — other devices must ask you to release it</div>
    <textarea class="sh-ta" id="blk-reason" maxlength="60" placeholder="reason (optional)"></textarea>
    <div class="sh-actions">
      <button class="shb ghost-warn" id="blk-go">⊘ BLOCK TABLE</button>
      <button class="shb" id="blk-back">BACK</button>
    </div>`;
  $('#blk-go').onclick = () => {
    const entry = {
      occupied: false, blocked: true,
      blockedBy: ME || '', blockedAt: Date.now(),
      blockReason: $('#blk-reason').value.trim() || '',
    };
    FLOOR.update({ ['tables/' + id]: entry }).catch(() => {});
    S.tables[id] = entry;
    closeSheet(); render();
    tick(`<b>${esc(id)}</b> blocked`, true);
  };
  $('#blk-back').onclick = () => openSheet(id);
}

function buildHeldOrBlocked(id, ts, held) {
  const isHold = !!held || !!(ts && ts.holdGroupId);
  const g = held || (ts && ts.holdGroupId ? S.softBlocks[ts.holdGroupId] : null);
  const rows = [];
  if (ts?.blocked) {
    rows.push(`<div class="sh-row">blocked by <b>${esc(ts.blockedBy || '?')}</b></div>`);
    if (ts.blockReason) rows.push(`<div class="sh-row">reason <b>${esc(ts.blockReason)}</b></div>`);
  }
  if (g) {
    rows.push(`<div class="sh-row">reservation <b>${esc(g.note || '—')}</b></div>`);
    rows.push(`<div class="sh-row">needed at <b>${g.targetTime ? fmtT(g.targetTime) : '—'}</b></div>`);
    rows.push(`<div class="sh-row">group <b>${(g.tableIds || []).join(', ')}</b></div>`);
  }
  $('#sheet-body').innerHTML = `
    <div class="sh-head"><div class="sh-num">${esc(id)}</div>
      <div class="sh-tag ${isHold ? 'hld' : 'blk'}">${isHold ? 'HELD' : 'BLOCKED'}</div></div>
    <div class="sh-sub">${isHold ? 'reserved for later — manage it from the main console' : 'out of service'}</div>
    <div class="sh-rows">${rows.join('')}</div>
    <div class="sh-actions">
      ${!isHold ? '<button class="shb ghost-mint" id="unblk">🔓 RELEASE</button>' : ''}
      <button class="shb" id="hb-close">CLOSE</button>
    </div>`;
  const un = $('#unblk');
  if (un) un.onclick = () => {
    FLOOR.update({ ['tables/' + id]: null }).catch(() => {});
    delete S.tables[id];
    closeSheet(); render();
  };
  $('#hb-close').onclick = closeSheet;
}

/* ═══════════════ RAIL ═══════════════ */
function initRail() {
  $('#ra-fit').onclick = fitMap;

  $('#ra-map').onclick = () => {
    S.dark = !S.dark;
    $('#map').src = S.dark ? 'map_dark.jpg' : 'map.jpg';
    $('#ra-map').classList.toggle('on', S.dark);
  };

  $('#ra-search').onclick = () => {
    const bar = $('#searchbar');
    bar.hidden = !bar.hidden;
    $('#ra-search').classList.toggle('on', !bar.hidden);
    if (!bar.hidden) setTimeout(() => $('#search-in').focus(), 60);
    else { $('#search-in').value = ''; applySearch(); }
  };
  $('#search-in').addEventListener('input', applySearch);
  $('#search-x').onclick = () => {
    $('#search-in').value = '';
    $('#searchbar').hidden = true;
    $('#ra-search').classList.remove('on');
    applySearch();
  };

  $('#ra-cast').onclick = buildBroadcast;
}

function applySearch() {
  const q = ($('#search-in')?.value || '').trim().toLowerCase();
  document.querySelectorAll('.chip').forEach(chip => {
    chip.classList.remove('dim', 'hit');
    if (!q) return;
    const id = chip.dataset.id;
    const ts = S.tables[id];
    const match = id.toLowerCase().includes(q) ||
      (ts?.staterooms || []).some(s => String(s).includes(q)) ||
      (ts?.occupied && String(ts.covers) === q);
    chip.classList.add(match ? 'hit' : 'dim');
  });
}

function buildBroadcast() {
  _sheetId = null;
  $('#sheet-body').innerHTML = `
    <div class="sh-head"><div class="sh-num">✦</div><div class="sh-tag free">BROADCAST</div></div>
    <div class="sh-sub">sends to every connected tablet — including the classic console</div>
    <textarea class="sh-ta" id="cast-ta" maxlength="200" placeholder="message the floor…"></textarea>
    <div class="sh-actions">
      <button class="shb primary" id="cast-go">SEND</button>
      <button class="shb" id="cast-x">CANCEL</button>
    </div>`;
  $('#sheet').hidden = false;
  $('#sheet-scrim').hidden = false;
  setTimeout(() => $('#cast-ta').focus(), 60);
  let sending = false;
  $('#cast-go').onclick = () => {
    if (sending) return;
    const msg = $('#cast-ta').value.trim();
    if (!msg) return;
    sending = true;
    P('broadcasts').push({
      msg, sender: ME || 'Console III', ts: Date.now(),
      deviceId: deviceKey(), mentions: null,
      replyTo: null, replyToMsg: null, replyToSender: null,
    }).then(() => { closeSheet(); toast('message sent to the floor'); })
      .catch(() => { sending = false; toast('send failed — check connection', 'red'); });
  };
  $('#cast-x').onclick = closeSheet;
}

/* ═══════════════ TICKER / TOASTS / CLOCK ═══════════════ */
const _tickerItems = [];
function tick(html, warn) {
  _tickerItems.unshift(`<span class="tk${warn ? ' warn' : ''}">${fmtT(Date.now())} · ${html}</span>`);
  if (_tickerItems.length > 6) _tickerItems.pop();
  $('#ticker-track').innerHTML = _tickerItems.join('');
}

function toast(html, kind) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.innerHTML = html;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('bye'); setTimeout(() => t.remove(), 400); }, 5200);
}

function initClock() {
  const f = () => { $('#rail-clock').textContent = fmtT(Date.now()); };
  f(); setInterval(f, 15000);

  // Live elapsed inside an open occupied sheet
  setInterval(() => {
    const el = $('#sh-elapsed');
    if (el && _sheetId && S.tables[_sheetId]?.seatedAt) {
      el.textContent = elapsedStr(S.tables[_sheetId].seatedAt);
    }
  }, 20000);
}
