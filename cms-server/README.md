# Street Light CMS (apna software)

160 smart feeder panels (ESP32 + 4G) ke liye Central Monitoring System. ThingsBoard ki jagah apna server.

**Phase 1 me kya hai**

- Panels ka MQTT server, ThingsBoard jaisa hi device API. Panel firmware me sirf `MQTT_HOST` badalna hai, baaki code same.
- Auto registration: naya panel pehli baar online aate hi khud register hota hai (`CMS-<IMEI>`).
- Dashboard: login, KPI (online, lights ON, load, aaj ka kWh, alarms), map, panel list with search.
- Panel page: live V / A / kW / PF per phase, lamps failed, history graph (24 h / 7 din / 30 din), roz ka kWh, CSV download.
- Alarms: firmware ke 14 faults + panel offline. Active / history, acknowledge, alarm count badge.
- Event log: har fault RAISED/CLEARED, har command (kis user ne kiya), login, settings change.
- Control: Light ON/OFF, Astro / Schedule mode, ON-OFF time, astro offset, status refresh.
- Users: admin / operator (control + ack) / viewer (sirf dekhna).
- Live update: dashboard khud refresh hota hai jab panel data ya alarm aata hai.
- 5 saal data: PostgreSQL + TimescaleDB (compression, 6 saal retention).

**Abhi baaki (agle phase)**: SMS/email alerts, group-wise scheduling (ek saath 160 panel), PDF/Excel monthly reports, panel list Excel se import, HTTPS setup guide.

## Server pe chalana (Docker)

```bash
cd cms-server
cp .env.example .env      # passwords aur secrets badlo
docker compose up -d
```

Dashboard: `http://<server-ip>:8080`, login `.env` wale `ADMIN_USER` / `ADMIN_PASSWORD` se. Pehli login ke baad password badlo (Users page).

Server ka firewall: `8080` (ya HTTPS ke liye 443, Nginx/Caddy ke peeche) aur `1883` (panels) kholo.

## Panel firmware me badlav

`street_light_panel.ino` me:

```cpp
const char MQTT_HOST[] = "<aapke server ka IP ya domain>";
const char PROVISION_KEY[]    = "...";   // .env ke PROVISION_KEY jaisa
const char PROVISION_SECRET[] = "...";   // .env ke PROVISION_SECRET jaisa
```

Bas. Topics, telemetry keys aur commands same hain.

## Bina panel ke demo (simulator)

```bash
npm install
npm run simulate -- --panels 160 --interval 10 --host <server> --lat 28.61 --lon 77.21
```

Simulator asli firmware jaise messages bhejta hai: register, har 10 s data, kabhi-kabhi fault, aur commands ka jawab.

## Local development

```bash
npm install
export DATABASE_URL=postgres://cms:cms@localhost:5432/cms
npm start                                  # http://localhost:8080, MQTT 1883
TEST_DATABASE_URL=postgres://cms:cms@localhost:5432/cms_test npm test   # test DB ka data mit jata hai
```

Bina `TEST_DATABASE_URL` ke sirf unit tests chalte hain.

## Kaise bana hai

| Part | File |
|---|---|
| MQTT device API (provision, telemetry, RPC) | `src/broker.js` |
| Data save, alarms, offline detection | `src/service.js`, `src/telemetry.js` |
| Database tables | `src/schema.sql` |
| Web API + live stream | `src/http.js` |
| Dashboard (plain JS, Leaflet, Chart.js) | `public/` |
| Panel simulator | `tools/simulate.js` |

Load: 160 panels ko har 2 second data bhejte hue test kiya (asli load se ~150 guna), server ~85 MB RAM pe chala.

Map tiles OpenStreetMap se aate hain (internet chahiye). Bade use ke liye apna tile provider ya government map service lagana behtar hai.
