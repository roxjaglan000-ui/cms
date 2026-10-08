# Build and test

## Firmware

1. Arduino IDE with the "esp32 by Espressif" board package. Board: **ESP32 Dev Module**, partition scheme with SPIFFS (used by LittleFS).
2. Libraries: TinyGSM, PubSubClient, ModbusMaster, RTClib, ArduinoJson (v7).
3. Edit the SETTINGS block at the top of `street_light_panel.ino`: APN, MQTT host, device token, latitude/longitude.

## Test order

1. **Bench:** LilyGO + RS485 module + meter on 230 V. Check V/I readings in the Serial Monitor.
2. **Relay:** switch the contactor from the relay with no load; check aux feedback.
3. **Cloud:** insert the SIM, confirm data reaches ThingsBoard and the dashboard switch drives the relay.
4. **Panel wiring:** per [design.md](design.md). Megger and continuity tests, earth resistance check.
5. **Load test:** run with real lights for the first night. The baseline current is learned automatically (or send `learnBaseline`).
6. **Fault drill:** switch off one outgoing MCB (MCB trip alarm), remove one lamp (lamp failure), open the door (door alarm), cut and restore the network (buffered data arrives).

## Safety

415 V can kill. Have a licensed electrician do the power wiring and testing. Earth the panel body and door. Switch off and lock the incomer before working inside.
