# Components list (one panel)

Rates are rough estimates as of October 2026 (online and electrical markets). They can vary 15–25% by brand and city. Get vendor quotes before buying.

| # | Item | Spec / example | Qty | Approx ₹ |
|---|---|---|---|---:|
| 1 | Panel enclosure | Compartmentalised, IP55, powder coated, ~600×500×250 mm, lock + canopy | 1 | 9,000–15,000 |
| 2 | Incomer | 4P MCCB 40 A (or 4P MCB 40 A C-curve) | 1 | 2,500–5,500 |
| 3 | Surge protection device | Type 2, 3P+N, 40 kA | 1 | 3,000–5,000 |
| 4 | Aluminium busbar set | R, Y, B, N strips 100 A + SMC insulators | 1 | 2,000–3,000 |
| 5 | 3-phase energy meter | Eastron SDM630-Modbus V2 (direct 100 A, RS485). Cheaper: Selec MFM383A-C + 3 CT 25/5 A (needs a different register map in firmware) | 1 | 6,500–9,000 |
| 6 | Power contactor | 4P 40 A AC-1, 230 V AC coil, + 1NO aux block | 1 | 3,000–4,500 |
| 7 | Outgoing MCB | SP 20 A C-curve | 3 | 750 |
| 8 | Control MCB | SP 6 A C-curve | 2 | 500 |
| 9 | Selector switch | 3-position AUTO-OFF-MAN, 22 mm, 2 contact blocks | 1 | 300–500 |
| 10 | Indicator lamps | 22 mm LED: R, Y, B, Light ON, Trip | 5 | 500 |
| 11 | SMPS | 230 V AC → 12 V DC 2.5 A, DIN rail (Mean Well HDR-30-12) | 1 | 1,200–1,600 |
| 12 | Buck converter | 12 V → 5 V 3 A | 1 | 150 |
| 13 | Controller + 4G | LilyGO T-SIM7600E (ESP32 + SIM7600, India bands) + antenna | 1 | 5,000–6,500 |
| 14 | Backup cell | 18650 Li-ion 2600 mAh (to report power failure) | 1 | 250 |
| 15 | RTC module | DS3231 with coin cell | 1 | 150 |
| 16 | RS485 module | TTL ↔ RS485, auto direction, 3.3 V | 1 | 150 |
| 17 | Relay module | 1-channel 5 V opto-isolated, 10 A (or DIN interface relay) | 1 | 100–400 |
| 18 | AC sense module | 230 V opto-isolated detection, 4 channel | 1 | 300 |
| 19 | Door limit switch | Roller lever | 1 | 150 |
| 20 | Antenna extension | SMA cable 3 m + panel-mount antenna | 1 | 400 |
| 21 | Terminal blocks | 63 A for 16/25 sq mm × 4, plus 2.5 sq mm control terminals | 1 set | 1,100 |
| 22 | Wiring material | 6 + 1.5 sq mm Cu wire, lugs, ferrules, DIN rail, duct, glands | 1 set | 2,000–3,000 |
| 23 | Earthing | Earth bar, earth stud, washers (earth pits on site extra) | 1 set | 300 |
| | **Panel total** (excluding poles, lights, cable, labour) | | | **≈ 40,000–60,000** |

Per-pole items from the spec (63 A terminal blocks, 6 A SP MCBs, laminated sheet, 12 m octagonal poles) are priced separately per pole.

## Running cost

| Item | Detail | Approx ₹ / month |
|---|---|---:|
| SIM data | ~200–300 MB per panel per month | 150–300 |
| CMS server | ThingsBoard Community on a 2 GB VPS; one server handles many panels | 500–1,200 |
