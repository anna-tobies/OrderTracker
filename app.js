// ═══════════════════════════════════════════════════════════════════════════
// app.js — ProdTrack Frontend Logic
// ═══════════════════════════════════════════════════════════════════════════

const API = 'http://10.24.151.173:3000/api'; // Change localhost to IP adress of computer for testing with multiple devices (uni: 10.24.151.173)

// ── Runtime state ─────────────────────────────────────────────────────────
let currentOrderId    = null;
let ordersCache       = [];
let workstationsCache = [];
let editMode          = false;
let editingWsId       = null;   // which workstation is being edited in modal
let wsEditMode        = false;

// ── Create-order step counter ─────────────────────────────────────────────
let coStepCounter = 0;

// ═══════════════════════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  document.getElementById('live-clock').textContent =
    now.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' })
    + ' · ' + now.toLocaleTimeString('en-GB');
}
setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════════════════════════════════════
// ERROR BANNER
// ═══════════════════════════════════════════════════════════════════════════
function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  document.getElementById('error-banner').classList.add('show');
  setTimeout(() => document.getElementById('error-banner').classList.remove('show'), 6000);
}

// ═══════════════════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════════════════
async function apiGet(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(API + path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `POST ${path} → ${res.status}`);
  return data;
}
async function apiPut(path, body) {
  const res = await fetch(API + path, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `PUT ${path} → ${res.status}`);
  return data;
}
async function apiPatch(path, body) {
  const res = await fetch(API + path, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `PATCH ${path} → ${res.status}`);
  return data;
}
async function apiDelete(path) {
  const res = await fetch(API + path, { method:'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════
function showView(name, id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  editMode = false;
  currentOrderId = null;
  stopPolling();
  stopOrdersPolling();

  if (name === 'home') {
    setBreadcrumb();
  } else if (name === 'orders') {
    setBreadcrumb([{ label:'Orders' }]);
    loadAndRenderOrders();
    startOrdersPolling();
  } else if (name === 'order' && id) {
    currentOrderId = id;
    startPolling(id);
    const o = ordersCache.find(x => x.id == id);
    setBreadcrumb([
      { label:'Orders', onclick:"showView('orders')" },
      { label: o ? `${o.order_number} — ${h(o.name)}` : `Order ${id}` }
    ]);
    loadAndRenderOrderDetail(id);
  } else if (name === 'workstations') {
    wsEditMode = false;
    setBreadcrumb([{ label:'Workstations' }]);
    loadAndRenderWorkstations();
  }
}

function setBreadcrumb(items = []) {
  const bc = document.getElementById('breadcrumb');
  const parts = [{ label:'Home', onclick:"showView('home')" }, ...items];
  bc.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    const cls    = isLast ? 'bc-item active' : 'bc-item';
    const click  = p.onclick ? `onclick="${p.onclick}"` : '';
    return (i > 0 ? '<span class="bc-sep">›</span>' : '')
      + `<span class="${cls}" ${click}>${p.label}</span>`;
  }).join('');
}

function switchTab(key) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-btn-' + key).classList.add('active');
  document.getElementById('tab-panel-' + key).classList.add('active');
  const editBtn = document.getElementById('btn-edit');
  const delBtn  = document.getElementById('btn-delete-cancel');
  if (editMode && key === 'wp') {
    editBtn.style.display = 'none';
    delBtn.style.display  = 'none';
  } else {
    editBtn.style.display = '';
    delBtn.style.display  = '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKSTATIONS
// ═══════════════════════════════════════════════════════════════════════════
async function loadAndRenderWorkstations() {
  try {
    workstationsCache = await apiGet('/workstations');
    renderWorkstations();
  } catch (e) { showError('Cannot load workstations: ' + e.message); }
}

function renderWorkstations() {
  const list = document.getElementById('ws-list');
  if (!workstationsCache.length) {
    list.innerHTML = `<div class="empty-state">🏭<p>No workstations yet. Click Edit to add one.</p></div>`;
  } else {
    list.innerHTML = workstationsCache.map(ws => `
      <div class="ws-card">
        <div>
          <div class="ws-name">${h(ws.name)}</div>
          ${ws.type ? `<div class="ws-type">${h(ws.type)}</div>` : ''}
        </div>
        <div class="ws-actions" style="display:${wsEditMode ? 'flex' : 'none'}">
          <button class="btn btn-secondary btn-sm btn-icon" onclick="openEditWsModal(${ws.id})" title="Edit">✏</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteWorkstation(${ws.id},'${h(ws.name)}')" title="Delete">✕</button>
        </div>
      </div>`).join('');
  }

  const btnArea = document.getElementById('ws-header-buttons');
  if (wsEditMode) {
    btnArea.innerHTML = `
      <button class="btn btn-primary" onclick="openCreateWsModal()">+ New Workstation</button>
      <button class="btn btn-secondary" onclick="exitWsEditMode()">✕ Cancel</button>`;
  } else {
    btnArea.innerHTML = `
      <button class="btn btn-secondary" onclick="enterWsEditMode()">✏ Edit</button>`;
  }
}

function enterWsEditMode() {
  wsEditMode = true;
  renderWorkstations();
}

function exitWsEditMode() {
  wsEditMode = false;
  renderWorkstations();
}

function openCreateWsModal() {
  editingWsId = null;
  document.getElementById('ws-modal-title').textContent = 'New Workstation';
  document.getElementById('ws-name').value = '';
  document.getElementById('ws-type').value = '';
  openModal('modal-ws');
  setTimeout(() => document.getElementById('ws-name').focus(), 100);
}

function openEditWsModal(id) {
  const ws = workstationsCache.find(w => w.id == id);
  if (!ws) return;
  editingWsId = id;
  document.getElementById('ws-modal-title').textContent = 'Edit Workstation';
  document.getElementById('ws-name').value = ws.name;
  document.getElementById('ws-type').value = ws.type || '';
  openModal('modal-ws');
}

async function submitWs() {
  const name = document.getElementById('ws-name').value.trim();
  const type = document.getElementById('ws-type').value.trim();
  if (!name) { showError('Name is required.'); return; }
  try {
    if (editingWsId) {
      await apiPatch(`/workstations/${editingWsId}`, { name, type });
    } else {
      await apiPost('/workstations', { name, type });
    }
    closeModal('modal-ws');
    await loadAndRenderWorkstations();
  } catch (e) { showError(e.message); }
}

async function deleteWorkstation(id, name) {
  if (!confirm(`Delete workstation "${name}"? This cannot be undone.`)) return;
  try {
    await apiDelete(`/workstations/${id}`);
    await loadAndRenderWorkstations();
  } catch (e) { showError(e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORDERS LIST
// ═══════════════════════════════════════════════════════════════════════════
async function loadAndRenderOrders() {
  try {
    ordersCache = await apiGet('/orders');
    filterOrders();
  } catch (e) {
    showError('Cannot reach server. Make sure npm start is running.');
    document.getElementById('orders-list').innerHTML =
      `<div class="empty-state">⚠️<p>Server not reachable. Start <code>npm start</code> and reload.</p></div>`;
  }
}

function filterOrders() {
  const q        = (document.getElementById('orders-search')?.value  || '').toLowerCase();
  const status   =  document.getElementById('orders-status-filter')?.value || '';
  const dateFrom =  document.getElementById('orders-date-from')?.value     || '';
  const dateTo   =  document.getElementById('orders-date-to')?.value       || '';

  const clearBtn = document.getElementById('btn-clear-dates');
  if (clearBtn) clearBtn.style.display = (dateFrom || dateTo) ? '' : 'none';

  const filtered = ordersCache.filter(o => {
    const matchesSearch = o.order_number.toLowerCase().includes(q) || o.name.toLowerCase().includes(q);
    const matchesStatus = !status   || getOrderStatus(o) === status;
    const createdDay    = o.created_at ? o.created_at.slice(0, 10) : '';
    const matchesFrom   = !dateFrom || createdDay >= dateFrom;
    const matchesTo     = !dateTo   || createdDay <= dateTo;
    return matchesSearch && matchesStatus && matchesFrom && matchesTo;
  });
  renderOrders(filtered);
}

function clearDateFilter() {
  const df = document.getElementById('orders-date-from');
  const dt = document.getElementById('orders-date-to');
  if (df) df.value = '';
  if (dt) dt.value = '';
  filterOrders();
}

function getOrderStatus(order) {
  const steps = order.steps || [];
  if (!steps.length) return 'ns';
  const anyStarted = steps.some(s => s.start_time);
  if (!anyStarted) return 'ns';

  // If any step started AFTER the last Quality Control end → back to in progress
  const lastQC = steps
    .filter(s => s.workstation_name === 'Quality Control' && s.end_time)
    .sort((a, b) => b.step_number - a.step_number)[0];

  if (!lastQC) return 'ip';

  // Check if any step was started OR just exists after QC (even if not started yet)
  const lastStep = steps.sort((a, b) => b.step_number - a.step_number)[0];
  if (lastStep.workstation_name !== 'Quality Control') return 'ip';
  if (!lastStep.end_time) return 'ip';
  return 'done';
}

function renderOrders(orders) {
  const list = document.getElementById('orders-list');
  if (!orders.length) {
    list.innerHTML = `<div class="empty-state">📋<p>No orders found.</p></div>`;
    return;
  }

  const renderCard = (o) => {
    const st = getOrderStatus(o);
    const pillCls = st === 'done' ? 'pill-done' : st === 'ip' ? 'pill-ip' : 'pill-ns';
    const pillTxt = st === 'done' ? 'Complete'   : st === 'ip' ? 'In Progress' : 'Not Started';
    const stepCount = (o.steps || []).length;
    return `
      <div class="order-card" data-order-id="${o.id}" data-snapshot="${h(JSON.stringify(o))}" onclick="showView('order',${o.id})">
        <div class="order-num">${h(o.order_number)}</div>
        <div class="order-dash">—</div>
        <div class="order-name">${h(o.name)}</div>
        <div class="order-steps-count">${stepCount} step${stepCount !== 1 ? 's' : ''}</div>
        <div class="pill ${pillCls}">${pillTxt}</div>
        <div class="order-arrow">›</div>
      </div>`;
  };

  const existingIds = Array.from(list.children).map(el => el.dataset.orderId);
  const newIds       = orders.map(o => String(o.id));
  const sameSet = existingIds.length === newIds.length && existingIds.every((id, i) => id === newIds[i]);

  if (!sameSet) {
    list.innerHTML = orders.map(renderCard).join('');
    return;
  }

  orders.forEach(o => {
    const el = list.querySelector(`[data-order-id="${o.id}"]`);
    if (!el) return;
    const snapshot = h(JSON.stringify(o));
    if (el.dataset.snapshot !== snapshot) {
      el.dataset.snapshot = snapshot;
      const st = getOrderStatus(o);
      const pillCls = st === 'done' ? 'pill-done' : st === 'ip' ? 'pill-ip' : 'pill-ns';
      const pillTxt = st === 'done' ? 'Complete'   : st === 'ip' ? 'In Progress' : 'Not Started';
      const stepCount = (o.steps || []).length;
      el.innerHTML = `
        <div class="order-num">${h(o.order_number)}</div>
        <div class="order-dash">—</div>
        <div class="order-name">${h(o.name)}</div>
        <div class="order-steps-count">${stepCount} step${stepCount !== 1 ? 's' : ''}</div>
        <div class="pill ${pillCls}">${pillTxt}</div>
        <div class="order-arrow">›</div>`;
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE ORDER MODAL
// ═══════════════════════════════════════════════════════════════════════════
async function openCreateOrderModal() {
  // Ensure workstations are loaded
  try { workstationsCache = await apiGet('/workstations'); } catch (e) { showError('Cannot load workstations: ' + e.message); return; }
  coStepCounter = 0;
  document.getElementById('co-name').value = '';
  document.getElementById('co-steps').innerHTML = '';
  openModal('modal-create-order');
  setTimeout(() => document.getElementById('co-name').focus(), 100);
}

function addCreateStep() {
  coStepCounter++;
  const id  = `step-${coStepCounter}`;
  const num = coStepCounter;
  const row = document.createElement('div');
  row.id = id;
  row.style.cssText = 'display:grid;grid-template-columns:70px 1fr 1fr 32px;gap:8px;margin-bottom:8px;align-items:start;';
  row.innerHTML = `
    <div>
      ${coStepCounter === 1 ? '<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-bottom:4px;">STEP #</div>' : ''}
      <input type="number" min="0.1" step="0.1" placeholder="${num}" value="${num}" style="background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:12px;padding:7px 10px;border-radius:var(--radius);outline:none;width:100%;" class="step-num-input"/>
    </div>
    <div>
      ${coStepCounter === 1 ? '<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-bottom:4px;">STEP NAME</div>' : ''}
      <input type="text" placeholder="Step name" style="background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:12px;padding:7px 10px;border-radius:var(--radius);outline:none;width:100%;" class="step-name-input"/>
    </div>
    <div>
      ${coStepCounter === 1 ? '<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-bottom:4px;">WORKSTATION</div>' : ''}
      <select style="background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:12px;padding:7px 10px;border-radius:var(--radius);outline:none;width:100%;" class="step-ws-select">
        <option value="">— none —</option>
        ${workstationsCache.map(ws => `<option value="${ws.id}">${h(ws.name)}${ws.type ? ` (${h(ws.type)})` : ''}</option>`).join('')}
      </select>
    </div>
    <div style="${coStepCounter === 1 ? 'margin-top:18px;' : ''}">
      <button class="btn btn-danger btn-icon btn-sm" onclick="document.getElementById('${id}').remove()" title="Remove">✕</button>
    </div>`;
  document.getElementById('co-steps').appendChild(row);
}

async function submitCreateOrder() {
  const name = document.getElementById('co-name').value.trim();
  if (!name) { showError('Order name is required.'); return; }

  // Collect steps
  const stepRows = document.getElementById('co-steps').querySelectorAll('[id^="step-"]');
  const steps = [];
  for (const row of stepRows) {
    const num   = parseFloat(row.querySelector('.step-num-input').value);
    const sname = row.querySelector('.step-name-input').value.trim();
    const wsId  = row.querySelector('.step-ws-select').value;
    if (isNaN(num)) { showError('All step numbers must be valid numbers.'); return; }
    steps.push({ step_number: num, step_name: sname, workstation_id: wsId || null, process: '' });
  }

  // Sort by step_number ascending
  steps.sort((a, b) => a.step_number - b.step_number);

  try {
    const order = await apiPost('/orders', { name });
    if (!order || !order.id) throw new Error('Invalid response from server when creating order.');
    if (steps.length) await apiPut(`/orders/${order.id}/steps`, { steps });
    closeModal('modal-create-order');
    await loadAndRenderOrders();
  } catch (e) { showError(e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORDER DETAIL
// ═══════════════════════════════════════════════════════════════════════════
async function loadAndRenderOrderDetail(id) {
  try {
    const order = await apiGet(`/orders/${id}`);
    const idx = ordersCache.findIndex(o => o.id == id);
    if (idx >= 0) ordersCache[idx] = order; else ordersCache.push(order);

    const o = ordersCache.find(x => x.id == id);
    setBreadcrumb([
      { label:'Orders', onclick:"showView('orders')" },
      { label:`${o.order_number} — ${h(o.name)}` }
    ]);
    renderOrderDetail(order);
  } catch (e) { showError('Failed to load order: ' + e.message); }
}

function renderOrderDetail(order) {
  document.getElementById('detail-title').textContent = `${order.order_number} — ${order.name}`;
  const header = document.getElementById('detail-header');
  const editBtn = document.getElementById('btn-edit');
  const activeTab = document.querySelector('.tab-btn.active')?.id?.replace('tab-btn-','') || 'wp';
  if (editMode && activeTab === 'wp') {
    header.classList.add('is-editing');
    editBtn.style.display = 'none';
    document.getElementById('btn-delete-cancel').style.display = 'none';
  } else if (editMode) {
    header.classList.add('is-editing');
    editBtn.style.display = '';
    editBtn.textContent = '✓ Save';
    editBtn.className = 'btn btn-primary btn-sm';
    document.getElementById('btn-delete-cancel').style.display = '';
    document.getElementById('btn-delete-cancel').textContent = 'Cancel';
    document.getElementById('btn-delete-cancel').className = 'btn btn-secondary btn-sm';
  } else {
    header.classList.remove('is-editing');
    editBtn.style.display = '';
    editBtn.textContent = '✏ Edit';
    editBtn.className = 'btn btn-secondary btn-sm';
    document.getElementById('btn-delete-cancel').style.display = '';
    document.getElementById('btn-delete-cancel').textContent = '✕ Delete';
    document.getElementById('btn-delete-cancel').className = 'btn btn-danger btn-sm';
  }

    document.getElementById('tab-panel-wp').innerHTML  = renderWorkplan(order);
    document.getElementById('tab-panel-bom').innerHTML = `<div class="placeholder"><div class="ph-ico">🗂</div><p>Coming soon</p></div>`;
    document.getElementById('tab-panel-td').innerHTML  = renderTechDrawing(order);
}

function toggleSection(key) {
  document.getElementById('sec-' + key).classList.toggle('open');
}

function toggleEditMode() {
  editMode = !editMode;
  const order = ordersCache.find(o => o.id == currentOrderId);
  if (order) renderOrderDetail(order);
}

function deleteCancelClick() {
  if (editMode) {
    editMode = false;
    loadAndRenderOrderDetail(currentOrderId);
  } else {
    openDeleteConfirm();
  }
}

// ── Technical Drawing ─────────────────────────────────────────────────────
function renderTechDrawing(order) {
  const url = order.drawing_url || '';
  const view = url
    ? `<div class="td-view">🔗 <a href="${h(url)}" target="_blank" rel="noopener">${h(url)}</a></div>`
    : `<div class="td-view"><span class="td-no-link">No link added${editMode ? ' — add one below.' : '.'}</span></div>`;
  const edit = editMode ? `
    <div class="td-edit">
      <input type="url" id="td-url" placeholder="https://…" value="${h(url)}"/>
      <button class="btn btn-primary btn-sm" onclick="saveTechDrawing()">Save</button>
    </div>` : '';
  return view + edit;
}

async function saveTechDrawing() {
  const url = document.getElementById('td-url').value.trim();
  try {
    await apiPatch(`/orders/${currentOrderId}`, { drawing_url: url });
    await loadAndRenderOrderDetail(currentOrderId);
    switchTab('td');
  } catch (e) { showError(e.message); }
}

// ── Work Plan (layout, etc.) ─────────────────────────────────────────────────────────────
function renderWorkplan(order) {
  const steps   = (order.steps || []).sort((a, b) => a.step_number - b.step_number);
  const started = steps.filter(s => s.start_time).length;
  const done    = steps.filter(s => s.end_time).length;

  const rows = steps.map(s => {
    const hasStart = s.start_date && s.start_time;
    const hasEnd   = s.end_date   && s.end_time;
    const dur      = calcDuration(s);
    let statusHtml;
    if (hasEnd)        statusHtml = `<div class="status-dot"><div class="dot dot-done"></div><span class="badge-done">Done</span></div>`;
    else if (hasStart) statusHtml = `<div class="status-dot"><div class="dot dot-active"></div><span class="badge-active">Active</span></div>`;
    else               statusHtml = `<div class="status-dot"><div class="dot dot-wait"></div><span class="badge-wait">Waiting</span></div>`;
    return `<tr>
      <td class="td-step-num">${s.step_number}</td>
      <td>${h(s.step_name || '')}</td>
      <td><div class="td-station-name">${h(s.workstation_name || '—')}</div>${s.workstation_type ? `<div class="td-station-type">${h(s.workstation_type)}</div>` : ''}</td>
      <td style="white-space:pre-wrap;max-width:220px;min-width:120px;line-height:1.5;">${h(s.process || '')}</td>
      <td>${statusHtml}</td>
      <td class="tc ${hasStart ? 'filled':'empty'}">${hasStart ? s.start_date : ''}</td>
      <td class="tc ${hasStart ? 'filled':'empty'}">${hasStart ? s.start_time : ''}</td>
      <td class="tc ${hasEnd   ? 'filled':'empty'}">${hasEnd   ? s.end_date   : ''}</td>
      <td class="tc ${hasEnd   ? 'filled':'empty'}">${hasEnd   ? s.end_time   : ''}</td>
      <td class="dur ${dur ? '':'empty'}">${dur || ''}</td>
      <td>${hasStart && !hasEnd ? `<button class="btn-edit-step" onclick="openEditStepModal(${s.id})" title="Edit step">✏</button>` : ''}</td>
    </tr>`;
  }).join('');

  const table = steps.length ? `
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Step #</th><th>Step Name</th><th>Workstation</th><th>Notes</th><th>Status</th>
          <th>Start Date</th><th>Start Time</th><th>End Date</th><th>End Time</th><th>Duration</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : `<div class="placeholder"><div class="ph-ico">📋</div><p>No steps defined yet.</p></div>`;

 
  
  const injectBtn = `<button class="btn-inject" onclick="openInjectModal(${order.id})">⚡ Inject RFID / MQTT Event</button>`;

  // Im Edit Modus: nur den Editor anzeigen, keine Tabelle
  if (editMode) {
    return renderWpEditor(steps);
  }

  // Normaler Modus: Tabelle + Inject Button
  return `
    <div class="wp-stats">
      <div><div class="wp-stat-label">Steps</div><div class="wp-stat-val">${steps.length}</div></div>
      <div><div class="wp-stat-label">Active</div><div class="wp-stat-val" style="color:var(--warn)">${started - done}</div></div>
      <div><div class="wp-stat-label">Done</div><div class="wp-stat-val" style="color:var(--green)">${done}</div></div>
    </div>
    ${table}
    ${injectBtn}`;
}

// ── Work Plan Editor ──────────────────────────────────────────────────────
function renderWpEditor(existingSteps) {
  const wsOptions = workstationsCache.map(ws =>
    `<option value="${ws.id}">${h(ws.name)}${ws.type ? ` (${h(ws.type)})` : ''}</option>`
  ).join('');

  const stepRows = existingSteps.map((s, i) => `
    <div class="wp-step-row" id="edit-step-${i}" data-step-id="${s.id || ''}">
      <input type="number" min="0.1" step="0.1" value="${s.step_number}" class="es-num" title="Step number"/>
      <input type="text" value="${h(s.step_name || '')}" class="es-name" placeholder="Step name"/>
      <select class="es-ws">
        <option value="">— none —</option>
        ${workstationsCache.map(ws => `<option value="${ws.id}" ${ws.id == s.workstation_id ? 'selected' : ''}>${h(ws.name)}${ws.type ? ` (${h(ws.type)})` : ''}</option>`).join('')}
      </select>
      <input type="text" value="${h(s.process || '')}" class="es-process" placeholder="Process description / Notes"/>
      <button class="btn btn-danger btn-icon btn-sm" onclick="removeEditorStep('edit-step-${i}')" title="Remove">✕</button>
    </div>`).join('');

  return `
    <div class="wp-editor" id="wp-editor">
      <div class="wp-editor-head">
        <span class="wp-editor-title">Edit Work Plan</span>
        <button class="btn btn-primary btn-sm" onclick="addEditorStep()">+ Add Step</button>
      </div>
      <div class="wp-col-labels">
        <span class="wp-col-label">Step #</span>
        <span class="wp-col-label">Step Name</span>
        <span class="wp-col-label">Workstation</span>
        <span class="wp-col-label">Notes</span>
        <span></span>
      </div>
      <div id="editor-steps">${stepRows}</div>
      <div class="wp-add-row">
        <div class="wp-editor-actions">
          <button class="btn btn-primary btn-sm" onclick="saveWorkPlan()">Save Work Plan</button>
          <button class="btn btn-secondary btn-sm" onclick="toggleEditMode()">Cancel</button>
        </div>
      </div>
    </div>`;
}

let editorStepCounter = 1000;
function addEditorStep() {
  editorStepCounter++;
  const id = `edit-step-${editorStepCounter}`;
  const container = document.getElementById('editor-steps');
  const row = document.createElement('div');
  row.className = 'wp-step-row';
  row.id = id;

  // Suggest next step number
  const existing = getEditorSteps();
  const maxNum   = existing.length ? Math.max(...existing.map(s => s.step_number)) : 0;
  const nextNum  = Math.round(maxNum) + 1;

  const wsOptions = workstationsCache.map(ws =>
    `<option value="${ws.id}">${h(ws.name)}${ws.type ? ` (${h(ws.type)})` : ''}</option>`
  ).join('');

  row.innerHTML = `
    <input type="number" min="0.1" step="0.1" value="${nextNum}" class="es-num" title="Step number"/>
    <input type="text" value="" class="es-name" placeholder="Step name"/>
    <select class="es-ws"><option value="">— none —</option>${wsOptions}</select>
    <input type="text" value="" class="es-process" placeholder="Process description / Notes"/>
    <button class="btn btn-danger btn-icon btn-sm" onclick="removeEditorStep('${id}')" title="Remove">✕</button>`;
  container.appendChild(row);
}

function removeEditorStep(id) {
  document.getElementById(id)?.remove();
}

function getEditorSteps() {
  const rows = document.querySelectorAll('#editor-steps .wp-step-row');
  return Array.from(rows).map(row => ({
    id: row.dataset.stepId ? Number(row.dataset.stepId) : null,
    step_number:    parseFloat(row.querySelector('.es-num').value) || 0,
    step_name:      row.querySelector('.es-name').value.trim(),
    workstation_id: row.querySelector('.es-ws').value || null,
    process:        row.querySelector('.es-process').value.trim(),
  }));
}

async function saveWorkPlan() {
  const steps = getEditorSteps();
  // Sort ascending by step_number
  steps.sort((a, b) => a.step_number - b.step_number);

  if (steps.some(s => isNaN(s.step_number))) { showError('All step numbers must be valid.'); return; }
  try {
    await apiPut(`/orders/${currentOrderId}/steps`, { steps });
    editMode = false;
    await loadAndRenderOrderDetail(currentOrderId);
    switchTab('wp');
  } catch (e) { showError(e.message); }
}

function calcDuration(s) {
  if (!s.start_date || !s.start_time || !s.end_date || !s.end_time) return null;
  const diff = Math.max(0, new Date(`${s.end_date}T${s.end_time}`) - new Date(`${s.start_date}T${s.start_time}`));
  const h2 = Math.floor(diff / 3600000);
  const m  = Math.floor((diff % 3600000) / 60000);
  const sc = Math.floor((diff % 60000) / 1000);
  if (h2 > 0) return `${h2}h ${m}m`;
  if (m  > 0) return `${m}m ${sc}s`;
  return `${sc}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DELETE ORDER
// ═══════════════════════════════════════════════════════════════════════════
function openDeleteConfirm() {
  const o = ordersCache.find(x => x.id == currentOrderId);
  if (!o) return;
  document.getElementById('delete-order-text').textContent =
    `"${o.order_number} — ${o.name}" and all its data will be permanently deleted.`;
  openModal('modal-delete-order');
}

async function submitDeleteOrder() {
  try {
    await apiDelete(`/orders/${currentOrderId}`);
    closeModal('modal-delete-order');
    showView('orders');
  } catch (e) { showError(e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// INJECT MODAL
// ═══════════════════════════════════════════════════════════════════════════
async function openInjectModal(preselectedOrderId) {
  try { workstationsCache = await apiGet('/workstations'); } catch {}
  try { ordersCache = await apiGet('/orders'); } catch {}

  const selOrder = document.getElementById('inj-order');
  selOrder.innerHTML = ordersCache.map(o =>
    `<option value="${o.id}" ${o.id == preselectedOrderId ? 'selected' : ''}>${h(o.order_number)} — ${h(o.name)}</option>`
  ).join('');

  const selWs = document.getElementById('inj-ws');
  selWs.innerHTML = '<option value="">— select —</option>' +
    workstationsCache.map(ws => `<option value="${ws.id}">${h(ws.name)}</option>`).join('');

  const now = new Date();
  document.getElementById('inj-date').value = now.toISOString().slice(0, 10);
  document.getElementById('inj-time').value = now.toTimeString().slice(0, 8);
  openModal('modal-inject');
}

async function submitInject() {
  const orderId = document.getElementById('inj-order').value;
  const wsId    = document.getElementById('inj-ws').value;
  const event   = document.getElementById('inj-event').value;
  const date    = document.getElementById('inj-date').value;
  const time    = document.getElementById('inj-time').value;
  if (!wsId) { showError('Please select a workstation.'); return; }
  if (!date || !time) { showError('Date and time are required.'); return; }
  try {
    await apiPost(`/orders/${orderId}/workstations/${wsId}/event`, { event, date, time });
    closeModal('modal-inject');
    document.getElementById('last-update').textContent =
      `Last update: ${new Date().toLocaleTimeString('en-GB')} via manual inject`;
    if (currentOrderId == orderId) {
      await loadAndRenderOrderDetail(orderId);
      switchTab('wp');
    }
    ordersCache = await apiGet('/orders');
  } catch (e) {
    if (e.message.includes('free time slots')) {
      alert('⚠ ' + e.message);
    } else {
      showError(e.message);
    }
  }
}


// ── EDIT ACTIVE STEP MODAL ──────────────────────────────────────────────────────

let editingStepId = null;

function openEditStepModal(stepId) {
  const order = ordersCache.find(o => o.id == currentOrderId);
  if (!order) return;
  const step = order.steps.find(s => s.id == stepId);
  if (!step) return;
  editingStepId = stepId;
  document.getElementById('edit-step-modal-sub').textContent = `Step ${step.step_number}${step.step_name ? ' — ' + step.step_name : ''}`;
  document.getElementById('edit-step-name').value = step.step_name || '';
  document.getElementById('edit-step-process').value = step.process || '';
  openModal('modal-edit-step');
  setTimeout(() => document.getElementById('edit-step-name').focus(), 100);
}

async function submitEditStep() {
  if (!editingStepId || !currentOrderId) return;
  const name    = document.getElementById('edit-step-name').value.trim();
  const process = document.getElementById('edit-step-process').value.trim();
  try {
    // Fetch current order steps, update the matching one, re-save the whole plan
    const order = ordersCache.find(o => o.id == currentOrderId);
    if (!order) return;
    const updatedSteps = order.steps.map(s =>
      s.id == editingStepId
        ? { ...s, step_name: name, process }
        : s
    );
    await apiPut(`/orders/${currentOrderId}/steps`, { steps: updatedSteps });
    closeModal('modal-edit-step');
    await loadAndRenderOrderDetail(currentOrderId);
    switchTab('wp');
  } catch (e) { showError(e.message); }
}


// ── MQTT HOOK ──────────────────────────────────────────────────────

/**
 * processRfidEvent(payload)
 * { tagId, zone, event, timestamp }
 * tagId = order_number, zone = workstation name
 */
window.processRfidEvent = async function({ tagId, zone, event, timestamp }) {
  const order = ordersCache.find(o => o.order_number === tagId);
  if (!order) { console.warn(`[RFID] Unknown tagId: ${tagId}`); return; }
  const ws = workstationsCache.find(w => w.name === zone);
  if (!ws) { console.warn(`[RFID] Unknown zone: ${zone}`); return; }
  const ts   = new Date(timestamp || Date.now());
  const date = ts.toISOString().slice(0, 10);
  const time = ts.toTimeString().slice(0, 8);
  try {
    await apiPost(`/orders/${order.id}/workstations/${ws.id}/event`, { event, date, time });
    document.getElementById('mqtt-dot').classList.add('on');
    document.getElementById('mqtt-label').textContent = 'MQTT: Connected';
    document.getElementById('last-update').textContent =
      `Last update: ${ts.toLocaleTimeString('en-GB')} · ${order.order_number} @ ${ws.name}`;
    if (currentOrderId == order.id) await loadAndRenderOrderDetail(order.id);
    ordersCache = await apiGet('/orders');
  } catch (e) { console.error('[RFID]', e.message); }
};

// ═══════════════════════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});
document.getElementById('co-name').addEventListener('keydown', e => { if (e.key === 'Enter') submitCreateOrder(); });
document.getElementById('ws-name').addEventListener('keydown', e => { if (e.key === 'Enter') submitWs(); });

// ═══════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════
function h(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════
setBreadcrumb();

// ═══════════════════════════════════════════════════════════════════════════
// LIVE POLLING — auto-refresh order detail every 5s when a detail is open
// ═══════════════════════════════════════════════════════════════════════════
let pollingInterval = null;

function startPolling(orderId) {
  stopPolling();
  pollingInterval = setInterval(async () => {
    if (!currentOrderId) return stopPolling();
    try {
      const fresh = await apiGet(`/orders/${orderId}`);
      const cached = ordersCache.find(o => o.id == orderId);
      // Only re-render if data actually changed (compare steps stringified)
      if (JSON.stringify(fresh.steps) !== JSON.stringify(cached?.steps)) {
        const idx = ordersCache.findIndex(o => o.id == orderId);
        if (idx >= 0) ordersCache[idx] = fresh; else ordersCache.push(fresh);
        // Remember active tab before re-render
        const activeTab = document.querySelector('.tab-btn.active')?.id?.replace('tab-btn-','') || 'wp';
        renderOrderDetail(fresh);
        switchTab(activeTab);
        document.getElementById('last-update').textContent =
          `Last update: ${new Date().toLocaleTimeString('en-GB')} · live`;
      }
    } catch {}
  }, 2000);
}

function stopPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
}

// Polling for orders list (to keep it updated if we navigate back to the list view)
let ordersPollingInterval = null;

function startOrdersPolling() {
  stopOrdersPolling();
  ordersPollingInterval = setInterval(async () => {
    try {
      const fresh = await apiGet('/orders');
      if (JSON.stringify(fresh) !== JSON.stringify(ordersCache)) {
        ordersCache = fresh;
        filterOrders();
      }
    } catch {}
  }, 2000);
}

function stopOrdersPolling() {
  if (ordersPollingInterval) { clearInterval(ordersPollingInterval); ordersPollingInterval = null; }
}

// Pre-load caches silently
apiGet('/workstations').then(d => workstationsCache = d).catch(() => {});
apiGet('/orders').then(d => ordersCache = d).catch(() => {});