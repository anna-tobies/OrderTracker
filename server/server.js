// ═══════════════════════════════════════════════════════════════════════════
// server/server.js — Express REST API
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// WORKSTATIONS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/workstations', (req, res) => {
  try { res.json(db.getAllWorkstations()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/workstations', (req, res) => {
  try {
    const { name, type } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
    res.status(201).json(db.createWorkstation(name.trim(), type || ''));
  } catch (e) {
    const msg = e.message.includes('UNIQUE') ? 'A workstation with this name already exists.' : e.message;
    res.status(400).json({ error: msg });
  }
});

app.patch('/api/workstations/:id', (req, res) => {
  try {
    const ws = db.getWorkstationById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workstation not found' });
    res.json(db.updateWorkstation(req.params.id, req.body));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/workstations/:id', (req, res) => {
  try {
    db.deleteWorkstation(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/orders', (req, res) => {
  try { res.json(db.getAllOrders()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/:id', (req, res) => {
  try {
    const order = db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Order name is required.' });
    res.status(201).json(db.createOrder(name.trim()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/orders/:id', (req, res) => {
  try {
    db.deleteOrder(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/orders/:id', (req, res) => {
  try {
    const order = db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(db.updateOrder(req.params.id, req.body));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Work Plan Steps ───────────────────────────────────────────────────────
// PUT replaces the entire work plan for an order
// Body: { steps: [{ step_number, step_name, workstation_id, process }] }
app.put('/api/orders/:id/steps', (req, res) => {
  try {
    const order = db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const { steps } = req.body;
    if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps must be an array' });
    res.json(db.setWorkPlanSteps(req.params.id, steps));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RFID/MQTT Event ───────────────────────────────────────────────────────
// Supports two modes automatically:
//   1. Predefined steps mode: order has steps for this workstation → use logStepEvent()
//   2. Auto-tracking mode:    no predefined steps               → use logStepEventAuto()
app.post('/api/orders/:id/workstations/:workstationId/event', (req, res) => {
  try {
    const { event, date, time } = req.body;
    if (!['enter', 'exit'].includes(event)) return res.status(400).json({ error: 'event must be enter or exit' });
    if (!date || !time) return res.status(400).json({ error: 'date and time are required' });
    const order = db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Choose mode: predefined steps vs. auto-tracking
    const hasFreeSlot = db.hasFreeSlotForWorkstation(req.params.id, req.params.workstationId, event);
    if (hasFreeSlot) {
      res.json(db.logStepEvent(req.params.id, req.params.workstationId, event, date, time));
    } else {
      res.json(db.logStepEventAuto(req.params.id, req.params.workstationId, event, date, time));
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────
db.init().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║   ProdTrack Server — Running         ║');
    console.log(`  ║   http://localhost:${PORT}              ║`);
    console.log('  ║   Database: server/orders.db         ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
