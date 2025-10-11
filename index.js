import mqtt from 'mqtt';
import { createClient } from '@supabase/supabase-js';

const {
  MQTT_URL,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_TOPIC_BASE,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  DEFAULT_PLANT_ID
} = process.env;

if (!MQTT_URL || !MQTT_TOPIC_BASE || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing env vars: MQTT_URL, MQTT_TOPIC_BASE, SUPABASE_URL, SUPABASE_SERVICE_ROLE');
  process.exit(1);
}

console.log('DEFAULT_PLANT_ID:', DEFAULT_PLANT_ID ? 'set' : 'NOT set');

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

/* ---------- Helpers ---------- */

function guessDeviceIdFromTopic(topic) {
  // e.g. "home/Theengs/BTtoMQTT/C47C8D6D672B" -> "C47C8D6D672B"
  const parts = (topic || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function normalizeId(id) {
  if (!id) return null;
  const hex = id.toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length !== 12) return id;     // keep as-is if not a 12-hex MiFlora MAC
  return hex.match(/.{2}/g).join(':');  // "C4:7C:8D:6D:67:2B"
}

function hexNoColons(id) {
  return (id || '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

function isPlantSensor(msg, deviceIdHexNoColons) {
  // 1) Prefer explicit message hints
  if (msg?.type && String(msg.type).toUpperCase() === 'PLANT') return true;
  if (msg?.plant === true) return true;
  if (msg?.model && /MiFlora|Flower\s*Care/i.test(String(msg.model))) return true;

  // 2) Fallback: Xiaomi MiFlora family prefix only if message is inconclusive
  if (deviceIdHexNoColons?.startsWith('C47C8D6')) return true;

  return false;
}

function inferModel(msg, deviceIdHexNoColons) {
  if (msg?.model) return String(msg.model);
  const hex = (deviceIdHexNoColons || '').toUpperCase();
  if (hex.startsWith('C47C8D6C')) return 'MiFlora';
  if (hex.startsWith('C47C8D6D')) return 'Flower Care';
  return 'Unknown';
}

function extractBrand(msg) {
  return msg?.brand ? String(msg.brand) : null;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function intNum(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

/* ---------- Message handler ---------- */

client.on('message', async (topic, payload) => {
  let msg;
  try {
    msg = JSON.parse(payload.toString());
  } catch {
    console.warn('Skipping non-JSON:', topic);
    return;
  }

  // Device ID (topic or payload), normalized to colon format
  const raw_id = msg.device_id || msg.id || guessDeviceIdFromTopic(topic);
  const device_id = normalizeId(raw_id);
  const deviceHex = hexNoColons(device_id);

  // Only ingest plant sensors (data-driven first, Xiaomi prefix as fallback)
  if (!isPlantSensor(msg, deviceHex)) {
    return; // ignore non-plant devices cleanly
  }

  // Map fields
  const moisture    = num(msg.moisture ?? msg.moi);
  const temperature = num(msg.temp ?? msg.tempc);
  const fertility   = num(msg.fertility ?? msg.fer);
  const light_lux   = num(msg.light_lux ?? msg.lux);
  const battery     = (msg.battery === undefined) ? null : intNum(msg.battery);

  // Model/brand from message (preferred), else infer
  const model = inferModel(msg, deviceHex);
  const brand = extractBrand(msg);

  if (!device_id) {
    console.warn('No device_id → skipping', { topic });
    return;
  }

  try {
    // Find (or auto-register) sensor by device_id
    const { data: sensor, error: sensorErr } = await supabase
      .from('sensors')
      .select('id, model, brand')
      .eq('device_id', device_id)
      .maybeSingle();

    let sensor_id;
    if (!sensorErr && sensor) {
      sensor_id = sensor.id;

      // Backfill model/brand if missing/unknown and we now know better
      const needModel = (!sensor.model || sensor.model === 'Unknown') && model && model !== 'Unknown';
      const needBrand = (!sensor.brand && brand);
      if (needModel || needBrand) {
        const patch = {};
        if (needModel) patch.model = model;
        if (needBrand) patch.brand = brand;
        await supabase.from('sensors').update(patch).eq('id', sensor_id);
      }

    } else if (DEFAULT_PLANT_ID) {
      // Auto-register unknown sensor into Quarantine with best-known metadata
      const { data: ins, error: insErr } = await supabase
        .from('sensors')
        .insert({
          plant_id: DEFAULT_PLANT_ID,
          device_id,
          model,
          brand,
          notes: 'Auto-registered by worker'
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
      sensor_id = ins.id;
      console.log(`Auto-registered sensor ${device_id} → plant ${DEFAULT_PLANT_ID} (model=${model}${brand ? `, brand=${brand}` : ''})`);
    } else {
      console.warn(`Unknown device_id "${device_id}" – skipped (no DEFAULT_PLANT_ID).`);
      return;
    }

    // Insert the reading
    const row = { sensor_id, moisture, temperature, fertility, light_lux, battery, raw: msg };
    const { error: insertErr } = await supabase.from('readings').insert(row);
    if (insertErr) throw insertErr;

    console.log('Inserted:', { device_id, moisture, temperature, fertility, light_lux, battery, model, brand });
  } catch (e) {
    console.error('Ingestion error:', e);
  }
});
