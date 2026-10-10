# CMS: Smart Street Light Feeder Panel

3-phase, 10 kW smart feeder control panel for street lights. It talks to a **CMS (Central Monitoring System)** dashboard over 4G/LTE. The panel switches the lights on a schedule or by sunset/sunrise and reads a 3-phase energy meter. It detects lamp, MCB, phase and contactor faults and logs every event, as asked for in the [tender spec](docs/tender-spec.md).

![Block diagram](docs/diagrams/block-diagram.svg)

## Repository layout

| Path | What it has |
|---|---|
| [docs/report/CMS-Project-Report.pdf](docs/report/CMS-Project-Report.pdf) | Full project report (PDF + Word): design, wiring, parts, build and test checklists |
| [docs/tender-spec.md](docs/tender-spec.md) | Tender requirements (with the original screenshot) and where each is covered |
| [docs/design.md](docs/design.md) | Load calculation, power wiring, control wiring, controller wiring, pin map |
| [docs/logic.md](docs/logic.md) | Operating modes, flowchart, fault detection rules |
| [docs/bom.md](docs/bom.md) | Lowest-cost tender components list with INR prices, savings and running cost |
| [docs/cms-dashboard.md](docs/cms-dashboard.md) | ThingsBoard server setup, telemetry keys, remote commands |
| [docs/scale-and-bid.md](docs/scale-and-bid.md) | 40,000 poles on 160 panels: load check, CMS scale, bid estimate |
| [docs/build-and-test.md](docs/build-and-test.md) | Next steps for the code: flash, test, deploy; safety |
| [firmware/street_light_panel/](firmware/street_light_panel/street_light_panel.ino) | ESP32 + 4G controller code (Arduino IDE) |

## Hardware at a glance

- Controller: LilyGO T-A7670E (ESP32 + 4G LTE Cat-1)
- Energy meter: Selec MFM383A-C with 3 CTs (RS485)
- Two 3-phase outgoing feeders (one per road direction) with 6 MCBs and a 300 mA RCCB, sized for 250 poles per panel
- Panel cost: about ₹25,500–32,500 for the 10 kW tender build, excluding poles and lights ([bom.md](docs/bom.md))
- Switching: 4P 40 A contactor with an AUTO / OFF / MANUAL selector, so the lights still work if the controller fails
- CMS: ThingsBoard over MQTT

## Status

Design stage. The firmware has not been compiled or tested on hardware yet. Bench-test it first (see [build-and-test.md](docs/build-and-test.md)).

Scale: about 40,000 poles on 160 panels (250 per panel), see [scale-and-bid.md](docs/scale-and-bid.md).

Open questions:
- Lamp wattage per pole: 10 kW for 250 poles only fits lamps of about 40 W
- How many new poles are needed, and whether the per-pole window items apply to all 40,000
- Own CMS server (ThingsBoard) or the client's existing software
