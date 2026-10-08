# Components list (one panel)

This is a tender, so the default build is the **lowest-cost build that still meets the spec**. The earlier, costlier choices are kept as alternatives.

Rates are rough estimates as of October 2026. They can vary 15–25% by brand, city and quantity. Get vendor quotes before bidding.

## Tender build (lowest cost)

| # | Item | Spec / example | Qty | Approx ₹ |
|---|---|---|---|---:|
| 1 | Panel enclosure | CRCA 16/14 SWG, IP55, powder coated, ~500×400×200 mm, compartmentalised, from a local fabricator | 1 | 5,000–6,500 |
| 2 | Incomer | 4P MCB 40 A C-curve (the spec asks for an MCB incomer) | 1 | 1,600–2,200 |
| 3 | Surge protection device | Type 2, 3P+N, 20 kA. Not in the spec; keep it to protect the 5-year warranty | 1 | 1,500–2,000 |
| 4 | Aluminium busbar set | R, Y, B, N strips + SMC insulators | 1 | 1,200–1,800 |
| 5 | 3-phase energy meter | Selec MFM383A-C (RS485) + 3 CT 30/5 A. Indian make | 1 | 3,800–4,400 |
| 6 | Power contactor | 4P 40 A AC-1, 230 V coil, + 1NO aux, reputed Indian brand | 1 | 1,800–2,500 |
| 7 | Outgoing MCB | SP 20 A C-curve | 3 | 450–600 |
| 8 | Control MCB | SP 6 A C-curve | 2 | 300 |
| 9 | Selector switch | 3-position AUTO-OFF-MAN, 22 mm | 1 | 200–250 |
| 10 | Indicator lamps | 22 mm LED: R, Y, B, Light ON | 4 | 240–300 |
| 11 | Controller + 4G | LilyGO T-A7670E (ESP32 + A7670 LTE Cat-1) with antenna | 1 | 2,300–2,800 |
| 12 | Power supply | 230 V AC → 5 V 3 A SMPS (replaces 12 V SMPS + buck) | 1 | 350–500 |
| 13 | Backup cell | 18650 Li-ion (fits the board's holder) | 1 | 200–250 |
| 14 | RTC module | DS3231 | 1 | 120–150 |
| 15 | RS485 module | TTL ↔ RS485, auto direction | 1 | 100–150 |
| 16 | Relay module | 1-channel 5 V opto-isolated | 1 | 80–120 |
| 17 | AC sense module | 230 V opto-isolated, 4 channel | 1 | 250–300 |
| 18 | Door limit switch | | 1 | 100–150 |
| 19 | Antenna extension | SMA cable + panel-mount antenna | 1 | 250–300 |
| 20 | Terminal blocks | 63 A for 16/25 sq mm × 4 (spec), control terminals | 1 set | 900–1,100 |
| 21 | Wiring material | Cu wire, lugs, ferrules, DIN rail, duct, glands | 1 set | 1,500–2,000 |
| 22 | Earthing | Earth bar, stud, washers | 1 set | 250–300 |
| | **Panel total** (excluding poles, lights, cable, labour) | | | **≈ 23,000–29,000** |

The first design came to about ₹40,000–60,000, so this saves roughly ₹17,000–31,000 per panel.

## Where the saving comes from

| Change | Saving ₹ | Trade-off |
|---|---:|---|
| LilyGO T-SIM7600E → T-A7670E (LTE Cat-1) | ~3,000 | Cat-1 is slower, but plenty for a few KB of data. Firmware supports both. |
| Eastron SDM630 → Selec MFM383A-C + CTs | ~3,000–4,500 | Needs 3 CTs and CT wiring. Indian make helps in tenders. Firmware supports both. |
| MCCB → 4P MCB incomer | ~1,000–3,000 | Matches the spec wording ("incomer of MCB"). |
| Mean Well 12 V SMPS + buck → 5 V 3 A SMPS | ~900–1,200 | Use a decent SMPS; a bad one is the most common field failure. |
| Imported/premium enclosure → local CRCA fabrication | ~4,000–8,000 | Check IP55 gasket and powder coating quality. |
| SPD 40 kA → 20 kA | ~1,500–3,000 | Fine for a street light feeder. |
| Smaller savings (contactor brand, lamps, wiring) | ~3,000–5,000 | |

## Do not cut these

There is a **5-year comprehensive warranty**, so every failure in 5 years costs a site visit. Keep reputed brands for the contactor and MCBs, do the earthing properly, and use a good SMPS and IP55 enclosure. Saving ₹500 here can cost ₹5,000 in visits later.

## At higher quantity (50+ panels)

Replace items 11–17 with one custom PCB: an ESP32-WROOM module, an A7670C module, RS485, opto inputs, relay, RTC and power supply on one board. That costs roughly ₹2,000–2,800 per board at 50+ pieces, against ₹3,400–4,300 for the modules. It also cuts wiring time and loose connections. PCB design and prototypes are a one-time cost.

## Running cost (include this in the bid)

| Item | Detail | Approx ₹ |
|---|---|---:|
| SIM data | Normal data every 5 min (set by `setInterval`), alarms instantly: about 15–30 MB/month. Use an M2M/IoT SIM plan. | 40–100 / month per panel |
| CMS server | ThingsBoard Community (free software) on one 2 GB VPS for all panels | 500–1,200 / month total |

Over a 5-year warranty, SIM data alone is about ₹2,400–6,000 per panel, so price it into the bid.

## Earlier (costlier) build

| Item | Earlier choice | Approx ₹ |
|---|---|---:|
| Controller | LilyGO T-SIM7600E | 5,000–6,500 |
| Meter | Eastron SDM630-Modbus V2 (direct 100 A, no CTs) | 6,500–9,000 |
| Incomer | 4P MCCB 40 A | 2,500–5,500 |
| SPD | Type 2, 40 kA | 3,000–5,000 |
| Power supply | Mean Well HDR-30-12 + 12→5 V buck | 1,350–1,750 |
| Enclosure | IP55, ~600×500×250 mm, canopy | 9,000–15,000 |
