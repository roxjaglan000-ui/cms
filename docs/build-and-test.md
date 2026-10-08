# Next steps for the code: flash, test, deploy

The firmware has not been compiled or run on hardware yet. Follow these steps in order.

## 1. Buy parts for 2 prototype panels

LilyGO T-A7670E, Selec MFM383A-C + 3 CTs, RS485 module, DS3231, relay module, 4-channel 230 V opto module, 5 V 3 A SMPS, 18650 cell, and one M2M/IoT SIM per board. Roughly ₹10,000 per set for the electronics.

## 2. Set up the CMS (ThingsBoard)

Start with a free ThingsBoard Cloud trial, or install Community Edition on a VPS. Create the device profile with provisioning enabled and note the provision key and secret ([cms-dashboard.md](cms-dashboard.md)).

## 3. Compile the firmware

1. Install Arduino IDE 2 and add the "esp32 by Espressif" board package. Board: **ESP32 Dev Module**, partition scheme with SPIFFS (used by LittleFS).
2. Install libraries: TinyGSM, PubSubClient, ModbusMaster, RTClib, ArduinoJson (v7). For the T-A7670, use the TinyGSM copy in LilyGO's LilyGO-T-A76XX repository (`lib` folder) if the library has no A7670 support.
3. Open `firmware/street_light_panel/street_light_panel.ino`.
4. At the top, pick the board (`BOARD_T_A7670` or `BOARD_T_SIM7600`) and meter (`METER_SELEC_MFM383A` or `METER_SDM630`).
5. In SETTINGS, set `APN` for your SIM, `MQTT_HOST` (your ThingsBoard address), `PROVISION_KEY` and `PROVISION_SECRET`.
6. Click **Verify**. Fix any compile errors (send them over if stuck).

## 4. Bench test (on a table)

1. Flash one board over USB and open Serial Monitor at 115200.
2. Connect the RS485 module and the meter on 230 V. Check V, I and kW on the dashboard against the meter's own display. If values look wrong, flip `WORD_SWAP` for the Selec meter.
3. Check the panel appears in ThingsBoard as `CMS-<IMEI>` by itself, then send `setLocation`.
4. Press the dashboard switch: the relay should click within 1–2 seconds.
5. Wire the contactor (no load) and check aux feedback.

## 5. Prototype panel and field trial

1. Build one complete panel per [design.md](design.md). Megger and continuity tests, earth resistance check.
2. Run it on a real feeder for 1–2 weeks: first night learns the baseline (or send `learnBaseline`).
3. Fault drill: switch off one outgoing MCB (MCB trip alarm), switch off a few lamps (lamp failure), open the door, cut and restore the network (buffered data arrives), cut mains (power-fail report on battery).
4. Use this panel for a demo to the authority if the tender asks for one.

## 6. Production for 160 panels

1. Export one compiled binary (Sketch → Export Compiled Binary) and flash every board with the same file.
2. Label each panel with its IMEI. On site, power it up; it registers itself in the CMS.
3. Set location and ward/road name per panel from the CMS (or import a CSV).
4. Before mass rollout, add over-the-air updates so later fixes do not need site visits.

## Safety

415 V can kill. Have a licensed electrician do the power wiring and testing. Earth the panel body and door. Switch off and lock the incomer before working inside.
