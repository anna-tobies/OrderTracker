# ProdTrack

ProdTrack is a web application for tracking production orders through a shop floor in a
high-mix / low-volume manufacturing environment. Orders are logged either manually or
automatically via UWB/RFID tags, and the resulting time data is stored in a local
SQLite database.

The application was developed as part of a master's thesis.

---

## Disclaimer

This application is a prototype and is therefore not intended for use in a real production
environment. Consequently, it does not meet the applicable standards and IT security
regulations that such an application would need to comply with for real-world use.
In particular, there is no user authentication, no access control, no encryption of stored
data and no input validation beyond what is required for the prototype to function.

---

## System Overview

ProdTrack consists of three components that run as separate processes:

| Component             | File(s)                                  | Description                                                                                         |
| --------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Backend**     | `server/server.js`, `server/db.js`   | Node.js/Express REST API with a local SQLite database                                               |
| **Frontend**    | `index.html`, `app.js`, `main.css` | Browser client, communicates with the backend via the REST API                                      |
| **MQTT client** | `mqtt-client.js`                       | Subscribes to the position stream, derives zone enter/exit events and forwards them to the REST API |

The backend and the frontend are required to run the application. The MQTT client is only
required for automatic RFID-based tracking; without it the application can still be used with
manual event logging.

---

## Requirements

- **Node.js** (LTS version, https://nodejs.org) — check with `node --version`
- A modern browser (Chrome, Edge, Safari, Firefox)
- For automatic tracking: access to a RFID system (in this case the one from Pozyx) with valid tenant ID and API key

---

## Folder Structure

```
prodtrack/
├── index.html          ← Frontend markup
├── app.js              ← All frontend logic (REST calls, rendering, views)
├── main.css            ← Styling
├── mqtt-client.js      ← Pozyx/MQTT client, zone logic (run separately)
├── package.json
└── server/
    ├── server.js       ← Express REST API (port 3000)
    ├── db.js           ← SQLite database layer and schema
    └── orders.db       ← Created automatically on first run
```

---

## First-Time Setup

1. Install Node.js (see Requirements).
2. Open a terminal in the `prodtrack/` folder and install the dependencies:

   ```
   npm install
   ```

---

## Start the App

```
npm start
```

Then open the browser at **http://localhost:3000**

The database file `server/orders.db` is created automatically on first start, including the
table schema. No manual database setup is required.

### Start the MQTT client (only for automatic tracking)

In a **second terminal**, with the server already running:

```
node mqtt-client.js
```

---

## Accessing the App from Other Devices (e.g. Tablet on the Shop Floor)

The application is designed to be opened on several devices in the same local network,
for example on a tablet at a workstation.

1. Find the local IP address of the computer running the server:

   - Windows: `ipconfig`
   - macOS: `ipconfig getifaddr en0`
2. In `app.js`, replace `localhost` with that IP address:

   ```js
   const API = 'http://192.168.X.X:3000/api';
   ```
3. Allow inbound traffic on port 3000 in the firewall. On Windows, in a terminal with
   administrator rights:

   ```
   netsh advfirewall firewall add rule name="Node Port 3000" dir=in action=allow protocol=TCP localport=3000
   ```
4. Connect the other device to the same network or hotspot and open
   `http://192.168.X.X:3000` in its browser.

> **Important:** the computer usually receives a new local IP address after a restart or after
> reconnecting to a different network. If connected devices show a "cannot GET /api" error,
> the IP address in `app.js` is most likely outdated and has to be updated.

---

## Using the Application

### 1. Create workstations

Workstations have to exist before orders can be tracked. In the **Workstations** view, new
workstations can be created; the edit and delete buttons are hidden behind the **Edit** toggle
to prevent accidental changes during operation.

The workstation name must match the zone name used in `mqtt-client.js` exactly, otherwise
incoming RFID events cannot be assigned.

### 2. Create an order

A new order is created in the **Orders** view. The order number is assigned automatically in
ascending order. Optionally, a link to a technical drawing and a process description can be
added.

### 3. Assign a tag

For automatic tracking, the automatically generated order number has to be written onto the
physical tag that accompanies the order through production, so that the tag ID and the
order number are identical. Incoming position data can then be assigned to the correct order
without any further matching step.

### 4. Mark the order as ready

A newly created order has the status **In Preparation**. In this state, RFID events are
rejected by the server so that no tracking data is recorded while the order is still being
prepared. The **Mark Ready for Production** button in the work plan sets the `ready` flag and
moves the order to **Not Started**. This action cannot be undone.

### 5. Tracking

Once the order is ready, work plan steps are created and timestamped automatically as the tag
enters and leaves the defined zones. Steps can also be logged, edited or reordered manually,
and events can be injected manually through the **Inject Event** function for testing purposes
without a physical tag.

### Order statuses

| Status         | Meaning                                                   |
| -------------- | --------------------------------------------------------- |
| In Preparation | Order created, not yet released; RFID tracking is blocked |
| Not Started    | Released, no work plan step started yet                   |
| In Progress    | At least one step started, not all steps completed        |
| Complete       | All work plan steps completed                             |

A warning icon (⚠) next to an order name indicates that at least one work plan step contains
a note in its process field.

### Views and refresh behaviour

The frontend is organised into views with tab navigation and refreshes automatically every
five seconds (polling), so that changes made on one device become visible on all other
connected devices without reloading the page. Active search, status and date filters as well
as the scroll position are preserved during refresh.

---

## Data Model

The SQLite database contains three tables:

| Table               | Description                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `workstations`    | Available workstations; the name corresponds to a zone in`mqtt-client.js`                                          |
| `orders`          | Production orders including order number, name, drawing link and the`ready` flag                                   |
| `work_plan_steps` | Individual work steps per order, including workstation reference, step number, process note and start/end timestamps |

Deleting an order also deletes all associated work plan steps.

---

## REST API Reference

| Method | Path                                                  | Description                                                                  |
| ------ | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/orders`                                       | All orders including workstation data                                        |
| GET    | `/api/orders/:id`                                   | Single order                                                                 |
| POST   | `/api/orders`                                       | Create order`{ name }`                                                     |
| PATCH  | `/api/orders/:id`                                   | Update order`{ name?, drawing_url?, ready? }`                              |
| DELETE | `/api/orders/:id`                                   | Delete order and all associated work plan steps                              |
| POST   | `/api/orders/:id/workstations/:workstationId/event` | Log event`{ event, date, time }`, where `event` is `enter` or `exit` |

An event request is rejected with HTTP 400 if the order has not yet been marked as ready.

---

## MQTT / Pozyx Integration

The Pozyx system transmits raw position data, not ready-made enter/exit events. The zone logic
is therefore implemented in `mqtt-client.js`.

**Configuration in `mqtt-client.js`:**

- `TENANT_ID` and `API_KEY` — access credentials
- `ZONES` — one entry per workstation, defined as a coordinate range:

  ```js
  const ZONES = [
    { name: "Workstation 1", x_min: 3000, x_max: 4850, y_min: 3000, y_max: 5200 },
    { name: "Workstation 2", x_min: 6000, x_max: 8050, y_min: 3000, y_max: 5000 },
  ];
  ```

The `name` of a zone must match a workstation name in the application exactly.

**Zone logic:** a tag is only considered to have entered or left a zone after a dwell time of
five seconds. If the tag re-enters or leaves the zone again within this period, the timer is
reset. This buffer compensates for the position jitter of the UWB system and prevents
incorrect step assignments. The time between leaving one zone and entering the next is counted
as idle time.

If a workstation occurs more than once in a work plan, an incoming event is assigned to the
first step with that workstation that has not yet been completed.

---


## Troubleshooting

| Symptom                                    | Likely cause                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| "cannot GET /api" on a connected device    | The IP address in`app.js` line 5 is outdated, or the firewall rule is no longer active                   |
| Server does not start, port already in use | Another instance of the server is still running                                                            |
| RFID events are not recorded               | The order is still in status**In Preparation**, or the zone name does not match the workstation name |
| Events are assigned to the wrong step      | The workstation occurs more than once in the work plan; the first uncompleted step is used                 |
| MQTT client shows`[APP] Server Error`    | Expected behaviour when an order has not been marked ready                                                 |
