// ═══════════════════════════════════════════════════════════════════════════
// server/db.js — SQLite Database Layer
// ═══════════════════════════════════════════════════════════════════════════

const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(__dirname, 'orders.db');
let db;

function persist() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ── Schema ────────────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workstations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    type       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number  TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL,
    drawing_url   TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS work_plan_steps (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id        INTEGER NOT NULL,
    step_number     REAL    NOT NULL,
    step_name       TEXT    NOT NULL DEFAULT '',
    workstation_id  INTEGER,
    process         TEXT    NOT NULL DEFAULT '',
    start_date      TEXT,
    start_time      TEXT,
    end_date        TEXT,
    end_time        TEXT
  );
`;

// ── Initialize Database ────────────────────────────────────────────────────────────────
async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run(SCHEMA);
  persist();
  console.log(`  Database ready: ${DB_PATH}`);
}

// ── Query helpers ─────────────────────────────────────────────────────────
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const results = [];
  stmt.bind(params);
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}
function queryOne(sql, params = []) { return query(sql, params)[0] || null; }
function run(sql, params = [])      { db.run(sql, params); persist(); }
function lastInsertId()             { return Number(queryOne('SELECT last_insert_rowid() AS id').id); }

function nextOrderNumber() {
  const row  = queryOne('SELECT order_number FROM orders ORDER BY CAST(order_number AS INTEGER) DESC LIMIT 1');
  const last = row ? parseInt(row.order_number, 10) : 0;
  const num = last < 10001 ? 10001 : last + 1;
  return String(num);
}

// ── Attach work plan steps to an order ───────────────────────────────────
function attachSteps(order) {
  const steps = query(`
    SELECT s.*, w.name AS workstation_name, w.type AS workstation_type
    FROM work_plan_steps s
    LEFT JOIN workstations w ON w.id = s.workstation_id
    WHERE s.order_id = ?
    ORDER BY s.step_number ASC
  `, [order.id]);
  return { ...order, steps };
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKSTATIONS
// ═══════════════════════════════════════════════════════════════════════════
function getAllWorkstations() {
  return query('SELECT * FROM workstations ORDER BY name ASC');
}

function getWorkstationById(id) {
  return queryOne('SELECT * FROM workstations WHERE id = ?', [id]);
}

function createWorkstation(name, type) {
  run('INSERT INTO workstations (name, type) VALUES (?, ?)', [name, type || '']);
  return getWorkstationById(lastInsertId());
}

function updateWorkstation(id, fields) {
  const allowed = ['name', 'type'];
  const keys    = Object.keys(fields).filter(k => allowed.includes(k));
  if (!keys.length) return getWorkstationById(id);
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  run(`UPDATE workstations SET ${setClause} WHERE id = ?`, [...keys.map(k => fields[k]), id]);
  return getWorkstationById(id);
}

function deleteWorkstation(id) {
  run('DELETE FROM workstations WHERE id = ?', [id]);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════
function getAllOrders() {
  return query('SELECT * FROM orders ORDER BY id ASC').map(attachSteps);
}

function getOrderById(id) {
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return null;
  return attachSteps(order);
}

function createOrder(name) {
  const order_number = nextOrderNumber();
  run('INSERT INTO orders (order_number, name) VALUES (?, ?)', [order_number, name]);
  const order = queryOne('SELECT * FROM orders WHERE order_number = ?', [order_number]);
  if (!order) return null;
  return attachSteps(order);
}

function deleteOrder(id) {
  run('DELETE FROM work_plan_steps WHERE order_id = ?', [id]);
  run('DELETE FROM orders WHERE id = ?', [id]);
  return true;
}

function updateOrder(id, fields) {
  const allowed = ['name', 'drawing_url'];
  const keys    = Object.keys(fields).filter(k => allowed.includes(k));
  if (!keys.length) return getOrderById(id);
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  run(`UPDATE orders SET ${setClause} WHERE id = ?`, [...keys.map(k => fields[k]), id]);
  return getOrderById(id);
}

// ═══════════════════════════════════════════════════════════════════════════
// WORK PLAN STEPS
// ═══════════════════════════════════════════════════════════════════════════

// Replace all steps for an order at once (used when saving edited work plan)
// steps: [{ step_number, step_name, workstation_id, process }]
function setWorkPlanSteps(orderId, steps) {
  const existingIds = query(
    'SELECT id FROM work_plan_steps WHERE order_id = ?', [orderId]
  ).map(r => Number(r.id));

  const incomingIds = steps.filter(s => s.id).map(s => Number(s.id));

  // Delete rows the user removed from the work plan
  for (const eid of existingIds) {
    if (!incomingIds.includes(eid)) {
      run('DELETE FROM work_plan_steps WHERE id = ?', [eid]);
    }
  }

  for (const s of steps) {
    if (s.id && existingIds.includes(Number(s.id))) {
      // UPDATE: keep the row (and its start/end times), only change editable fields
      run(`
        UPDATE work_plan_steps
        SET step_number = ?, step_name = ?, workstation_id = ?, process = ?
        WHERE id = ?
      `, [
        s.step_number,
        s.step_name || '',
        s.workstation_id || null,
        s.process || '',
        Number(s.id),
      ]);
    } else {
      // INSERT: brand-new step, no time data yet
      run(`
        INSERT INTO work_plan_steps
          (order_id, step_number, step_name, workstation_id, process, start_date, start_time, end_date, end_time)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
      `, [
        orderId,
        s.step_number,
        s.step_name || '',
        s.workstation_id || null,
        s.process || '',
      ]);
    }
  }
  return getOrderById(orderId);
}

// Log RFID enter/exit by matching workstation_id to a step (predefined steps mode)
function logStepEvent(orderId, workstationId, event, date, time) {
  // Alle Schritte dieser Workstation in dieser Order, aufsteigend sortiert
  const allSteps = query(`
    SELECT id, start_time, end_time FROM work_plan_steps
    WHERE order_id = ? AND workstation_id = ?
    ORDER BY step_number ASC
  `, [orderId, workstationId]);

  if (!allSteps.length) throw new Error(`No work plan step found for workstation ${workstationId} in order ${orderId}`);

  let targetStep = null;

  if (event === 'enter') {
    // Nimm den ersten Schritt der noch keine Startzeit hat
    targetStep = allSteps.find(s => !s.start_time) || null;
    if (!targetStep) throw new Error('No station with free time slots found');
    run(`UPDATE work_plan_steps SET start_date=?, start_time=?, end_date=NULL, end_time=NULL WHERE id=?`,
      [date, time, targetStep.id]);

  } else if (event === 'exit') {
    // Nimm den ersten Schritt der gestartet aber noch nicht beendet ist
    targetStep = allSteps.find(s => s.start_time && !s.end_time) || null;
    if (!targetStep) throw new Error('No station with free time slots found');
    run(`UPDATE work_plan_steps SET end_date=?, end_time=? WHERE id=?`,
      [date, time, targetStep.id]);

  } else {
    throw new Error(`Unknown event type: ${event}`);
  }
  return getOrderById(orderId);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-TRACKING: Log enter/exit by automatically creating steps if none exist
// Used when an order has no predefined work plan steps.
// On ENTER:  a new step is inserted with start_date/start_time set.
// On EXIT:   the most recent open step for this workstation is closed.
// ─────────────────────────────────────────────────────────────────────────────
function logStepEventAuto(orderId, workstationId, event, date, time) {
  if (event === 'enter') {
    // Calculate the next step number (max existing + 1, minimum 1)
    const maxRow = queryOne(
      'SELECT MAX(step_number) AS m FROM work_plan_steps WHERE order_id = ?', [orderId]
    );
    const nextStep = maxRow && maxRow.m != null ? Math.floor(Number(maxRow.m)) + 1 : 1;

    // Get workstation name for the step label
    const ws = queryOne('SELECT name FROM workstations WHERE id = ?', [workstationId]);
    const stepName = ws ? ws.name : `Auto Step`;

    run(`
      INSERT INTO work_plan_steps
        (order_id, step_number, step_name, workstation_id, process, start_date, start_time, end_date, end_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `, [orderId, nextStep, stepName, workstationId,'', date, time]);

  } else if (event === 'exit') {
    // Find the most recent open step for this workstation (started, not yet ended)
    const openStep = queryOne(`
      SELECT id FROM work_plan_steps
      WHERE order_id = ? AND workstation_id = ? AND start_time IS NOT NULL AND end_time IS NULL
      ORDER BY step_number DESC
      LIMIT 1
    `, [orderId, workstationId]);

    if (!openStep) {
      // No open step: silently ignore exit (tag may have entered before system started)
      console.warn(`[DB] Auto-exit ignored: no open step for order ${orderId} @ workstation ${workstationId}`);
      return getOrderById(orderId);
    }
    run(`UPDATE work_plan_steps SET end_date=?, end_time=? WHERE id=?`,
      [date, time, openStep.id]);

  } else {
    throw new Error(`Unknown event type: ${event}`);
  }
  return getOrderById(orderId);
}

// Check whether an order has ANY predefined steps assigned to a specific workstation
function hasStepsForWorkstation(orderId, workstationId) {
  const row = queryOne(
    'SELECT COUNT(*) AS c FROM work_plan_steps WHERE order_id = ? AND workstation_id = ?',
    [orderId, workstationId]
  );
  return row && Number(row.c) > 0;
}

// Returns true if there is a predefined step with a free slot for this event type:
// enter → step has no start_time yet
// exit  → step has start_time but no end_time yet
function hasFreeSlotForWorkstation(orderId, workstationId, event) {
  let row;
  if (event === 'enter') {
    row = queryOne(
      'SELECT COUNT(*) AS c FROM work_plan_steps WHERE order_id = ? AND workstation_id = ? AND start_time IS NULL',
      [orderId, workstationId]
    );
  } else {
    row = queryOne(
      'SELECT COUNT(*) AS c FROM work_plan_steps WHERE order_id = ? AND workstation_id = ? AND start_time IS NOT NULL AND end_time IS NULL',
      [orderId, workstationId]
    );
  }
  return row && Number(row.c) > 0;
}

module.exports = {
  init,
  getAllWorkstations, getWorkstationById, createWorkstation, updateWorkstation, deleteWorkstation,
  getAllOrders, getOrderById, createOrder, deleteOrder, updateOrder,
  setWorkPlanSteps, logStepEvent, logStepEventAuto, hasStepsForWorkstation, hasFreeSlotForWorkstation,
};
