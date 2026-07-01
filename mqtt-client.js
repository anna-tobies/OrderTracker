// ═══════════════════════════════════════════════════════════════════════════
// mqtt-client.js — Pozyx MQTT Connection
// Start with: node mqtt-client.js (start separat of npm )
// ═══════════════════════════════════════════════════════════════════════════

const mqtt = require('mqtt');

// ── Pozyx Zugangsdaten ────────────────────────────────────────────────────
const TENANT_ID = '5be2b12b7de46a38977805e0';   //tenant_id
const API_KEY   = 'd2b4bec7-0374-4047-90ff-2a5811f1ca82';   //api_key

// ── Zone Definition (Koordinates of Pozyx Dashboard) ─────────────────
// name: has to be exactly the same as the workstation name in the app
const ZONES = [
  {
    name:  'Workstation 1',
    x_min: 6000, x_max: 8050,
    y_min: 3000, y_max: 5000,
  },
  {
    name:  'Workstation 2',
    x_min: 3000, x_max: 4850,
    y_min: 3000, y_max: 5200,
  },
  {
    name:  'Quality Control',
    x_min: 950, x_max: 3000,
    y_min: 980, y_max: 2560,
  },
  {
    name:  'Warehouse',
    x_min: 10000, x_max: 12600,
    y_min: 300, y_max: 2300,
  }
  // Add more zones here if needed
];

// ── App API ───────────────────────────────────────────────────────────────
const APP_API = 'http://localhost:3000/api';

// ── Dwell-Time Configuration ─────────────────────────────────────────────
// A tag must remain in a zone for at least DWELL_MS milliseconds before
// the event is considered valid and sent to the app.
const DWELL_MS = 5000; // 5 seconds — adjust as needed

// ── Tag State: remembers in which zone the tag was last seen ───────────
// Makes it possible to correctly detect ENTER and EXIT events
const tagZoneState = {};
// Format: { [tagId]: Set(['Workstation 1', 'Workstation 2', ...]) }

// ── Dwell Timers ─────────────────────────────────────────────────────────
// Pending ENTER timers: fire only if the tag is still in the zone after DWELL_MS
// { [tagId:zoneName]: { timer, timestamp } }
const dwellTimers = {};

// Active dwell sessions: tags confirmed inside a zone (ENTER already fired)
// { [tagId:zoneName]: { enterTimestamp } }
const activeSessions = {};

// ─────────────────────────────────────────────────────────────────────────
// MQTT Connection
// ─────────────────────────────────────────────────────────────────────────
const client = mqtt.connect(`wss://mqtt.cloud.pozyxlabs.com`, {
  port:     443,
  protocol: 'wss',
  username: TENANT_ID,
  password: API_KEY,
});

client.on('connect', () => {
  console.log('[MQTT] Connected to Pozyx Cloud');
  client.subscribe(`${TENANT_ID}/tags`, (err) => {
    if (err) console.error('[MQTT] Subscribe Error:', err);
    else     console.log(`[MQTT] Subscribed: ${TENANT_ID}/tags`);
  });
});

client.on('error', (err) => {
  console.error('[MQTT] Connection Error:', err.message);
});

client.on('close', () => {
  console.log('[MQTT] Connection closed — attempting to reconnect...');
});

client.on('message', async (topic, message) => {
  try {
    const parsed   = JSON.parse(message.toString());
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const data of messages) {
      await handlePozyxMessage(data);
    }
  } catch (e) {
    console.error('[MQTT] Error processing message:', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Pozyx Messages processing — with dwell-time filtering
// ─────────────────────────────────────────────────────────────────────────
async function handlePozyxMessage(data) {
  // Only process messages with successful position calculation
  if (!data.success) return;

  const tagId = String(data.tagId || '');
  if (!tagId) return;

  const coords = data.data?.coordinates;
  if (!coords) return;

  const x = coords.x;
  const y = coords.y;

  // Calculate in which zones the tag is currently located
  const currentZones = new Set(
    ZONES.filter(z => x >= z.x_min && x <= z.x_max && y >= z.y_min && y <= z.y_max)
         .map(z => z.name)
  );

  // Load previous state (or empty Set if first contact)
  const previousZones = tagZoneState[tagId] || new Set();

  // ── POTENTIAL ENTER: tag appeared in a new zone ───────────────────────
  for (const zone of currentZones) {
    if (!previousZones.has(zone)) {
      const key = `${tagId}:${zone}`;

      // Cancel any lingering EXIT timer for this key (tag came back quickly)
      if (dwellTimers[`exit:${key}`]) {
        clearTimeout(dwellTimers[`exit:${key}`].timer);
        delete dwellTimers[`exit:${key}`];
      }

      // Only start a new ENTER timer if one is not already running AND no active session exists
      if (!dwellTimers[`enter:${key}`] && !activeSessions[key]) {
        const ts = data.timestamp;
        dwellTimers[`enter:${key}`] = {
          timer: setTimeout(async () => {
            delete dwellTimers[`enter:${key}`];
            // Confirm the tag is still in this zone right now
            if (tagZoneState[tagId] && tagZoneState[tagId].has(zone)) {
              activeSessions[key] = { enterTimestamp: ts };
              console.log(`[ZONE] Tag ${tagId} → ENTER "${zone}" (confirmed after ${DWELL_MS / 1000}s dwell)`);
              await sendEventToApp(tagId, zone, 'enter', ts);
            }
          }, DWELL_MS),
          timestamp: ts,
        };
      }
    }
  }

  // ── POTENTIAL EXIT: tag left a zone ──────────────────────────────────
  for (const zone of previousZones) {
    if (!currentZones.has(zone)) {
      const key = `${tagId}:${zone}`;

      // Cancel the pending ENTER timer — tag left before dwell elapsed
      if (dwellTimers[`enter:${key}`]) {
        clearTimeout(dwellTimers[`enter:${key}`].timer);
        delete dwellTimers[`enter:${key}`];
        console.log(`[ZONE] Tag ${tagId} — ENTER "${zone}" cancelled (left before ${DWELL_MS / 1000}s dwell)`);
      }

      // Only send EXIT if an ENTER was actually confirmed for this session
      if (activeSessions[key]) {
        const ts = data.timestamp;
        // Small debounce for exit too: avoid spurious exits from jitter
        if (!dwellTimers[`exit:${key}`]) {
          dwellTimers[`exit:${key}`] = {
            timer: setTimeout(async () => {
              delete dwellTimers[`exit:${key}`];
              // Confirm tag is still outside this zone
              if (!tagZoneState[tagId] || !tagZoneState[tagId].has(zone)) {
                delete activeSessions[key];
                console.log(`[ZONE] Tag ${tagId} → EXIT "${zone}" (confirmed after debounce)`);
                await sendEventToApp(tagId, zone, 'exit', ts);
              }
            }, 5000), // 5s exit debounce time to filter positional jitter at zone boundary
            timestamp: ts,
          };
        }
      }
    }
  }

  // Update zone state
  tagZoneState[tagId] = currentZones;
}

// ─────────────────────────────────────────────────────────────────────────
// Send Event to the App
// ─────────────────────────────────────────────────────────────────────────
async function sendEventToApp(tagId, zoneName, event, timestamp) {
  try {
    // load Orders and find them with tag ID  (= order_number)
    const ordersRes = await fetch(`${APP_API}/orders`);
    const orders    = await ordersRes.json();
    const order     = orders.find(o => o.order_number === tagId);

    if (!order) {
      console.warn(`[APP] No order found for Tag ID: ${tagId}`);
      return;
    }

    // find Workstation with their name (has to match the zone name)
    const wsRes  = await fetch(`${APP_API}/workstations`);
    const wsList = await wsRes.json();
    const ws     = wsList.find(w => w.name === zoneName);

    if (!ws) {
      console.warn(`[APP] No workstations found with name: "${zoneName}"`);
      return;
    }

    // process timestamp
    const ts   = timestamp ? new Date(timestamp * 1000) : new Date();
    const date = ts.toISOString().slice(0, 10);
    const time = ts.toTimeString().slice(0, 8);

    // send Event to the App
    const res = await fetch(`${APP_API}/orders/${order.id}/workstations/${ws.id}/event`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event, date, time }),
    });

    if (res.ok) {
      console.log(`[APP] ✓ Order ${order.order_number} @ "${ws.name}" — ${event.toUpperCase()} ${date} ${time}`);
    } else {
      const err = await res.json();
      if (err.error?.includes('free time slots')) {
        console.warn(`[APP] ⚠ No free slot available: Order ${order.order_number} @ "${ws.name}"`);
      } else {
        console.error(`[APP] Server Error:`, err.error);
      }
    }
  } catch (e) {
    console.error('[APP] sendEventToApp Error:', e.message);
  }

}
