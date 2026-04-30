const mqtt = require('mqtt');
const db = require('../db');

const BROKER = process.env.MQTT_BROKER || 'mqtt://mqtt.birdnestay.id:1883';
const USERNAME = process.env.MQTT_USERNAME || '';
const PASSWORD = process.env.MQTT_PASSWORD || '';
const CLIENT_ID = process.env.MQTT_CLIENT_ID || 'birdnest-pms';

let client = null;

// birdnest/room/<controller_id>/connected          → "1" | "0"
// birdnest/room/<controller_id>/relay/<relay_num>/state → "1" | "0"
// birdnest/room/<controller_id>/rgb/state          → JSON {"r":0,"g":0,"b":0}
// birdnest/room/<controller_id>/status             → JSON {"ip":"...","uptime":...}

const SUBSCRIPTIONS = [
  'birdnest/room/+/connected',
  'birdnest/room/+/relay/+/state',
  'birdnest/room/+/rgb/state',
  'birdnest/room/+/status',
];

async function handleConnected(controllerId, payload) {
  const connected = payload === 'true';
  await db.query(
    `INSERT INTO room_controller_status (controller_id, connected, last_seen)
     VALUES ($1, $2, NOW())
     ON CONFLICT (controller_id) DO UPDATE
       SET connected = $2, last_seen = NOW()`,
    [controllerId, connected]
  );
}

async function handleRelayState(controllerId, relayNum, payload) {
  const state = payload === 'on';
  // Look up unit by controller_id
  const { rows } = await db.query(
    'SELECT id FROM units WHERE controller_id = $1 LIMIT 1',
    [controllerId]
  );
  if (!rows[0]) return;
  const unitId = rows[0].id;

  await db.query(
    `INSERT INTO unit_relays (unit_id, relay_num, state, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (unit_id, relay_num) DO UPDATE
       SET state = $3, updated_at = NOW()`,
    [unitId, relayNum, state]
  );
}

async function handleRgbState(controllerId, payload) {
  let rgb;
  try { rgb = JSON.parse(payload); } catch { return; }
  await db.query(
    `INSERT INTO room_controller_status (controller_id, rgb, last_seen)
     VALUES ($1, $2, NOW())
     ON CONFLICT (controller_id) DO UPDATE
       SET rgb = $2, last_seen = NOW()`,
    [controllerId, JSON.stringify(rgb)]
  );
}

async function handleStatus(controllerId, payload) {
  let data;
  try { data = JSON.parse(payload); } catch { return; }
  await db.query(
    `INSERT INTO room_controller_status (controller_id, ip_address, last_seen)
     VALUES ($1, $2, NOW())
     ON CONFLICT (controller_id) DO UPDATE
       SET ip_address = $2, last_seen = NOW()`,
    [controllerId, data.ip || null]
  );
}

function parseRelayTopic(topic) {
  // birdnest/room/<id>/relay/<num>/state
  const m = topic.match(/^birdnest\/room\/([^/]+)\/relay\/(\d+)\/state$/);
  return m ? { controllerId: m[1], relayNum: parseInt(m[2], 10) } : null;
}

function connect() {
  client = mqtt.connect(BROKER, {
    clientId: CLIENT_ID,
    username: USERNAME || undefined,
    password: PASSWORD || undefined,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    console.log('[MQTT] Connected to', BROKER);
    SUBSCRIPTIONS.forEach(topic => client.subscribe(topic, { qos: 1 }));
  });

  client.on('reconnect', () => console.log('[MQTT] Reconnecting...'));
  client.on('error', err => console.error('[MQTT] Error:', err.message));

  client.on('message', async (topic, buffer) => {
    const payload = buffer.toString().trim();
    try {
      if (topic.endsWith('/connected')) {
        const controllerId = topic.split('/')[2];
        await handleConnected(controllerId, payload);
      } else if (topic.includes('/relay/') && topic.endsWith('/state')) {
        const parsed = parseRelayTopic(topic);
        if (parsed) await handleRelayState(parsed.controllerId, parsed.relayNum, payload);
      } else if (topic.endsWith('/rgb/state')) {
        const controllerId = topic.split('/')[2];
        await handleRgbState(controllerId, payload);
      } else if (topic.endsWith('/status')) {
        const controllerId = topic.split('/')[2];
        await handleStatus(controllerId, payload);
      }
    } catch (err) {
      console.error('[MQTT] DB error processing', topic, err.message);
    }
  });

  return client;
}

function publish(topic, payload, opts = {}) {
  if (!client || !client.connected) throw new Error('MQTT client not connected');
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1, ...opts }, err => {
      if (err) reject(err); else resolve();
    });
  });
}

function getClient() { return client; }

module.exports = { connect, publish, getClient };
