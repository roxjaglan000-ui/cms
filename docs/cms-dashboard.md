# CMS dashboard (ThingsBoard)

ThingsBoard is an open-source IoT platform with dashboards, alarms, history, maps and user logins built in, so no custom website is needed.

## Setup

1. Install ThingsBoard Community Edition on an Ubuntu VPS, or use a ThingsBoard Cloud account.
2. Create one **Device profile** (e.g. `Street light panel`) and turn on **device provisioning** ("Allow to create new devices") with a provision key and secret. Put the same key and secret in `PROVISION_KEY` / `PROVISION_SECRET` in the firmware. Every panel runs the same firmware: on first connect it registers itself as `CMS-<IMEI>` and stores its own access token. No per-panel compile is needed.
   After a panel registers, set its location once with `setLocation` (or from a CSV import of panel IDs, wards and coordinates), and rename/label it in ThingsBoard by ward or road.
3. **Device profile → Alarm rules**: e.g. `f_lampR == true` raises "Lamp failure R". Add one rule per `f_*` key.
4. **Dashboard widgets**: light ON/OFF switch (RPC `setLight`), V / A / kW gauges, kWh chart, alarm table, event log (key `event`), map of all panels, schedule form (RPC `setSchedule`).
5. **Notifications**: a rule chain sends email / SMS / Telegram on alarms.
6. **Reports**: Community Edition can export history to CSV/Excel. Scheduled email reports need ThingsBoard PE/Cloud or a small script.

## MQTT topics

| Direction | Topic |
|---|---|
| Panel → CMS telemetry | `v1/devices/me/telemetry` (`{"ts":…, "values":{…}}`) |
| CMS → panel command | `v1/devices/me/rpc/request/{id}` |
| Panel → CMS reply | `v1/devices/me/rpc/response/{id}` |

## Telemetry keys

`vR vY vB`, `iR iY iB`, `kwR kwY kwB`, `pfR pfY pfB`, `kwTotal`, `freq`, `kwh`, `light`, `mode`, `selector`, `sunrise`, `sunset` (minutes from midnight), `rssi`, `lampsFailedR/Y/B`, fault flags `f_*` (see [logic.md](logic.md)), and `event`.

## Remote commands (RPC)

| Method | Example params | Effect |
|---|---|---|
| `setLight` | `true` | Switch on now (sets MANUAL mode) |
| `setMode` | `"ASTRO"` | ASTRO / SCHEDULE / MANUAL |
| `setSchedule` | `{"on":"18:30","off":"06:00","days":127}` | days: bit0 = Sunday … bit6 = Saturday (127 = every day) |
| `setAstro` | `{"onOffset":10,"offOffset":-10}` | Minutes after sunset / relative to sunrise |
| `setSpecial` | `{"slot":0,"date":"11-08","on":"17:30","off":"06:30"}` | Different times on one date (8 slots) |
| `learnBaseline` | none | Re-learn normal phase currents after lamps are replaced |
| `setInterval` | `300` | Seconds between normal data uploads (60–3600). Lower data cost with a longer interval. |
| `setLampW` | `40` | Wattage of one lamp, for counting failed lamps |
| `setLocation` | `{"lat":28.61,"lon":77.21}` | Panel location for sunrise/sunset (set once per panel) |
| `getStatus` | none | Full live status in the reply |
