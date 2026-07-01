# ProdTrack - Setup & Running

## Disclaimer

This application is a prototype and therfore not meant to be usead in a real production environment. Consequently, it does not meet the applicable standards and IT security regulations that such an application would need to comply with for use in a real-world environment.

## Folder Structure

```
prodtrack/
├── index.html        ← Frontend (open in browser via localhost:3000)
├── app.js            ← All frontend logic
├── package.json
└── server/
    ├── server.js     ← Express REST API (port 3000)
    ├── db.js         ← SQLite database layer
    └── orders.db     ← Created automatically on first run
```

## First-Time Setup

1. Make sure **Node.js** is installed (https://nodejs.org — LTS version).
   Check with: `node --version`
2. Open a terminal in the `prodtrack/` folder and install dependencies:

   ```
   npm install
   ```

## Start the App

```
npm start
```

Then open your browser at: **http://localhost:3000**

> The database file `server/orders.db` is created automatically on first start.

## During Development (auto-restart on file changes)

```
npm run dev
```

(requires nodemon — install once with `npm install -g nodemon`)

## REST API Reference

| Method | Path                                      | Description                         |
| ------ | ----------------------------------------- | ----------------------------------- |
| GET    | /api/orders                               | All orders with station data        |
| GET    | /api/orders/:id                           | Single order                        |
| POST   | /api/orders                               | Create order `{ name }`           |
| DELETE | /api/orders/:id                           | Delete order + all station logs     |
| PATCH  | /api/orders/:id                           | Update `{ name?, drawing_url? }`  |
| POST   | /api/orders/:id/stations/:stationId/event | Log event `{ event, date, time }` |

## MQTT Integration

When ready, connect your MQTT client and call `processRfidEvent(payload)` from a separate `mqtt-client.js` file:

```js
const mqtt = require('mqtt');
const client = mqtt.connect('ws://your-broker:8083/mqtt');

client.on('message', (topic, message) => {
  const payload = JSON.parse(message.toString());
  // payload: { tagId, zone, event, timestamp }
  window.processRfidEvent(payload);
});

client.subscribe('rfid/events');
```

The `zone` value in the MQTT message must match a station name (WS1, WS2, T1, WS3, T2, QC1).


## App Features
