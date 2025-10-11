# ☁️ Sprint 2 — Cloud Backend & Data Storage

## 🎯 Objective
Connect the live MQTT data from the hardware layer to a cloud backend,  
store it in a structured database, and automate ingestion, aggregation, and retention.

---

## 🧱 Final Architecture
MiFlora / VegTrug Sensors
↓ (BLE)
Theengs Bridge (ESP32)
↓ (MQTT/TLS)
HiveMQ Cloud Cluster
↓
Render Worker (Node.js + Supabase Client)
↓
Supabase (Postgres + Auth + Cron)


| Layer | Purpose |
|--------|----------|
| **HiveMQ Cloud** | Central broker; multiple MQTT scanners publish securely over TLS (8883). |
| **Render Worker** | Parses MQTT messages, normalizes fields, auto-registers sensors, writes to Supabase. |
| **Supabase (Postgres)** | Stores normalized telemetry, manages triggers, hourly roll-ups, and data retention. |

---

## 🗂️ Database Schema Implemented

| Table | Description |
|--------|-------------|
| **plants** | One record per real plant.  Holds latest shallow/deep readings and metadata (`name`, `emoji`, `species`, `location`). |
| **sensors** | Each physical probe (`device_id`, `probe_type`, `hw_name`, `model`, `brand`) linked to a `plant_id`. |
| **readings** | Raw time-series data per sensor:  `moisture`, `temperature`, `fertility`, `light_lux`, `battery`, `rssi`, `raw JSON`. |
| **sensor_readings_hourly** | Hourly averages per sensor (30-min cron refresh). |
| **plant_readings_hourly_type** | Hourly averages per plant + probe type (30-min cron refresh). |

**Indexes**
- `(sensor_id, observed_at)` → quick historical queries  
- `(plant_id)` → fast joins and roll-ups

---

## ⚙️ Worker (index.js)

Main responsibilities:

1. **Connects** to HiveMQ Cloud using `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`.  
2. **Subscribes** to `home/Theengs/BTtoMQTT/#`.  
3. **Parses** each JSON payload and normalizes field names.  
4. **Determines probe type**  
   - `"Flower care"` → `shallow`  
   - `"Grow care garden"` → `deep`  
   - Fallback via MAC prefix (`C47C8D6C` = shallow, `C47C8D6D` = deep)  
5. **Inserts** data into `readings`.  
6. **Auto-registers** unknown sensors to *Quarantine Plant* (`DEFAULT_PLANT_ID`).  
7. **Updates** metadata (`brand`, `hw_name`, `probe_type`) if improved info arrives.  
8. **Stores RSSI** for signal diagnostics and potential mobility tracking.  
9. **Backfills model = MiFlora** and ensures consistent brand naming.  

---



## 🕒 Database Automations Completed

| Automation | Schedule | Function |
|-------------|-----------|-----------|
| **`sensor_readings_hourly`** | Every 30 min | Averages all readings per sensor per hour. |
| **`plant_readings_hourly_type`** | Every 30 min | Aggregates hourly averages per plant and probe type. |
| **`latest_plant_metrics` trigger** | On new reading | Updates latest shallow/deep values directly on `plants`. |
| **`purge_readings_2y` / `purge_events_2y`** | Nightly (02:15–02:20 UTC) | Removes data older than 2 years (GDPR limit). |

---

## 📈 Key Design Decisions

| Area | Decision | Rationale |
|-------|-----------|-----------|
| **Data granularity** | Keep per-sensor readings + hourly summaries | Flexible analysis without query overhead. |
| **RSSI storage** | Always recorded | Enables “plant moved?” or battery diagnostics later. |
| **Probe typing** | From message (`name`) > MAC prefix | Accurate deep/shallow detection. |
| **Auto-registration** | Default Quarantine plant | Zero manual setup for new devices. |
| **Two-year retention** | Automated purge jobs | GDPR compliance and seasonal trend coverage. |
| **Raw JSONB** | Keep entire payload | Future proof for schema changes or debugging. |
| **Error handling** | Catch/log unknown IDs and continue | Prevent data loss during multi-sensor streams. |

---

## ⚙️ Scalability & Multi-Scanner Setup

- **Multiple gateways** (ESP32s) can publish to the same HiveMQ cluster using unique client IDs.  
- Ingestion logic filters only plant devices (`type: PLANT`, model regex, prefix C47C8D6…).  
- Non-plant devices are ignored without breaking the worker.  
- Future multi-user support planned via `mqtt_namespaces` table (`site` / `default_plant_id`).  

---

## 📊 Current Data Flow Example

| Stage | Example |
|--------|----------|
| **MQTT Topic** | `home/Theengs/BTtoMQTT/C47C8D6D58DC` |
| **Payload In** | `{"moi": 23,"tempc": 21.5,"fer": 420,"lux": 42,"rssi": -83}` |
| **Normalized Row** | `(sensor_id, moisture=23, temperature=21.5, fertility=420, light_lux=42, rssi=-83)` |
| **Plant Update** | `plants.moisture_deep = 23`, `plants.temp_deep = 21.5`, etc. |

---

## ✅ Outcome

- MQTT → Cloud → Database pipeline fully operational.  
- 14 active sensors ingesting data continuously.  
- Automatic sensor registration and metadata correction.  
- 30-minute roll-ups and 2-year data retention running in Supabase.  
- Live RSSI values and probe type classification available.

**- To explore for scaling**
- Events - Watering / PLant Moved / Location of the Plant (e.g which windows) / Size of the pot / seasons
- Watering Ranges to add where
- Unique IDs for the type of plant. So that we can built more comprehensive models


---

## 🔮 Next Sprint Preview — Sprint 3 Dashboard / Web App

- Build Next.js frontend with Supabase Auth (login + session handling).  
- Display live and hourly plant metrics (charts for moisture & light).  
- Add “Water Soon” / “Low Battery” indicators.  
- Implement basic notification logic (WhatsApp / Twilio mock).  
