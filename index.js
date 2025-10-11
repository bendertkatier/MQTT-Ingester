import mqtt from 'mqtt';
import { createClient } from '@supabase/supabase-js';

const {
  MQTT_URL,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_TOPIC_BASE,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE
} = process.env;

console.log('DEFAULT_PLANT_ID:', process.env.DEFAULT_PLANT_ID ? 'set' : 'NOT set');



if (!MQTT_URL || !MQTT_TOPIC_BASE || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing env vars: MQTT_URL, MQTT_TOPIC_BASE, SUPABASE_URL, SUPABASE_SERVICE_ROLE');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD
});

client.on('connect', () => {
  console.log('MQTT connected → subscribing to', MQTT_TOPIC_BASE);
  client.subscribe(MQTT_TOPIC_BASE, (err) => {
    if (err) console.error('Subscribe error:', err);
  });
});

client.on('error', (err) => console.error('MQTT error:', err));

function normalizeId(id) {
  if (!id) return null;
  const hex = id.toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length !== 12) return id;
  return hex.match(/.{2}/g).join(':');
}

client.on('message', async (topic, payload) => {
  let msg;
  try { msg = JSON.parse(payload.toString()); }
  catch { console.warn('Skipping non-JSON:', topic); return; }

   // Extract and normalize device_id (handles both topic + colon formats)
  const raw_id = msg.device_id || msg.id || guessDeviceIdFromTopic(topic);
  const device_id = normalizeId(raw_id);


  // Map Theengs fields → our database columns
  const moisture    = num(msg.moisture ?? msg.moi);
  const temperature = num(msg.temp ?? msg.tempc);
  const fertility   = num(msg.fertility ?? msg.fer);
  const light_lux   = num(msg.light_lux ?? msg.lux);
  const battery     = (msg.battery === undefined) ? null : intNum(msg.battery);

  if (!device_id) { console.warn('No device_id → skipping', { topic }); return; }

try {
  // Find (or auto-register) sensor by device_id
  const { data: sensor, error: sensorErr } = await supabase
    .from('sensors')
    .select('id')
    .eq('device_id', device_id)
    .maybeSingle();

  let sensor_id;
  if (!sensorErr && sensor) {
    sensor_id = sensor.id;
  } else if (process.env.DEFAULT_PLANT_ID) {
    // Auto-register unknown sensor into Quarantine
    const { data: ins, error: insErr } = await supabase
      .from('sensors')
      .insert({
        plant_id: process.env.DEFAULT_PLANT_ID,
        device_id,
        model: msg.model ?? 'MiFlora',
        notes: 'Auto-registered by worker'
      })
      .select('id')
      .single();
    if (insErr) throw insErr;
    sensor_id = ins.id;
    console.log(`Auto-registered sensor ${device_id} → plant ${process.env.DEFAULT_PLANT_ID}`);
  } else {
    console.warn(`Unknown device_id "${device_id}" – add to Supabase.sensors or set DEFAULT_PLANT_ID`);
    return;
  }

  const row = { sensor_id, moisture, temperature, fertility, light_lux, battery, raw: msg };
  const { error: insertErr } = await supabase.from('readings').insert(row);
  if (insertErr) throw insertErr;

  console.log('Inserted:', { device_id, moisture, temperature, fertility, light_lux, battery });
} catch (e) {
  console.error('Ingestion error:', e);
}


function guessDeviceIdFromTopic(topic) {
  // silodam/plants/plant01/telemetry → "plant01"
  const parts = topic.split('/');
  return parts.length >= 4 ? parts[2] : null;
}
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function intNum(v){ const n = parseInt(v,10); return Number.isFinite(n) ? n : null; }
