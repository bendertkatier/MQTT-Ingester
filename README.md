Cloud MQTT→Supabase ingestor for plant sensors.
Subscribes to `MQTT_TOPIC_BASE`, expects JSON with {device_id, moisture, temp/temperature, fertility|conductivity|ec, [battery?]}.
