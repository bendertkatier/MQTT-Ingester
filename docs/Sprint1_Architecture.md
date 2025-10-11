# 🌿 Sprint 1 — Foundation & Hardware

## 🎯 Objective
Get all my plant sensor reliably pushing data to MQTT.  
Goal: live plant telemetry published to a broker and verified.

---

## ⚙️ Hardware Decisions

| Component | Choice | Notes |
|------------|---------|-------|
| **Sensor type** | Xiaomi MiFlora / VegTrug (HHCCJCY01HHCC) | BLE plant sensor; measures moisture, temperature, fertility, light. |
| **Gateway / Bridge** | ESP32 running Theengs Gateway firmware | Captures BLE advertisements and publishes to MQTT. |
| **Alternative firmware** | ESPHome | For DIY ESP32 builds or custom probe calibration. |
| **Power** | USB or Li-ion battery (18650 cell) | Supports portable placement. |
| **Broker / Protocol** | MQTT over TLS (8883) | Standard lightweight IoT protocol; easy to scale. |
| **Initial cloud broker** | **HiveMQ Cloud Free Tier** | Secure, reliable, simple to manage multiple clients. |

---

## 🧱 Local Setup Steps

1. **Flash firmware** to ESP32   - **Preflashed **
   - Used Theengs Gateway with Wi-Fi credentials + MQTT URL.  
   - Published to:  
     ```
     home/Theengs/BTtoMQTT/<DEVICE_MAC>
     ```

2. **Verify telemetry**  
   Example payload received in HiveMQ Web Client:
   ```json
   {
     "id": "C4:7C:8D:6C:3C:67",
     "name": "Flower care",
     "rssi": -81,
     "brand": "Xiaomi/VegTrug",
     "model": "MiFlora",
     "moi": 26,
     "tempc": 21.5,
     "fer": 420,
     "lux": 72
   }

3. Field Mapping

| Raw key | Normalized field         | Unit           |
| ------- | ------------------------ | -------------- |
| `moi`   | `moisture`               | % (volumetric) |
| `tempc` | `temperature`            | °C             |
| `fer`   | `fertility`              | µS/cm          |
| `lux`   | `light_lux`              | lux            |
| `rssi`  | `rssi` (signal strength) | dBm            |

4. Naming convention

MAC prefix C47C8D6C… → shallow probe (Flower care)

MAC prefix C47C8D6D… → deep probe (Grow care garden)


5. Verification 

| Checkpoint             | Tool                      | Result              |
| ---------------------- | ------------------------- | ------------------- |
| MQTT connection        | HiveMQ Web Client         | “Connected”         |
| Topic subscription     | `home/Theengs/BTtoMQTT/#` | ✅  messages visible |
| Message format         | JSON                      | ✅ valid             |
| Sensor update interval | ~10 min                   | ✅ stable            |

🌍 Outcome

✅ One ESP32 gateway reliably streaming sensor data
✅ Telemetry normalized and validated via HiveMQ
✅ Hardware + topic structure ready for cloud ingestion

Scaling Considerations 

| Area | Approach |
|-------|----------|
| **Multi-user / multi-scanner** | Use `mqtt_namespaces`; each site gets its own Quarantine plant. |
| **Multiple publishers** | MQTT supports many scanners → each unique client ID and credentials. |
| **Data volume** | 2-year retention + hourly roll-ups. |
| **Performance** | Index `(sensor_id, plant_id, observed_at)`. |
| **Security** | TLS 8883; per-scanner HiveMQ users. |
| **Future distribution** | Worker can run as shared edge function. |
