# Scale: 40,000 poles on 160 panels

## Load per panel

| Item | Value |
|---|---|
| Poles per panel | 40,000 ÷ 160 = **250** |
| Lamps per phase | ≈ 83 |
| Panel rating (spec) | 10 kW |
| Maximum lamp wattage that fits | 10,000 W ÷ 250 = **40 W per pole** |

The 10 kW panel only works if each pole has one lamp of about 40 W or less (LED driver losses use the rest). With bigger lamps (60–90 W are common on 12 m poles), 250 poles need 15–23 kW, and the incomer, contactor, meter CTs and feeder cables must be sized up. **Confirm the lamp wattage and lamps per pole from the tender BOQ before pricing.**

Each feeder (one per phase) carries about 83 lamps along the road. Size the feeder cable for voltage drop on the longest run (keep it under about 5%).

## What the CMS can and cannot detect at this scale

| Can detect | Cannot detect |
|---|---|
| Phase fail, MCB trip, contactor fault, day burning, door open, power fail | One single failed lamp |
| About 4+ failed lamps on a phase (power drop ≥ 5%) | Which pole has the failed lamp |
| Energy use per panel, per phase | |

Finding the exact pole needs a controller on every lamp (₹1,500–3,000 each, i.e. ₹6–12 crore for 40,000 poles). The spec asks for panel-level monitoring, so this design does not include it. If the authority expects pole-level fault reporting, it is a separate, much bigger item.

## One firmware for all 160 panels

- Every panel runs the same `.bin`. On first connect it registers itself in ThingsBoard as `CMS-<IMEI>` (device provisioning) and stores its own token.
- Location is set once per panel from the CMS (`setLocation`) or a CSV import, so sunrise/sunset is right for each site.
- Each panel uses its IMEI as MQTT client ID, so 160 panels do not knock each other off the server.
- Next step before mass deployment: over-the-air (OTA) firmware update, so a bug fix does not need 160 site visits.

## CMS server for 160 panels

160 panels sending every 5 minutes is a light load. ThingsBoard Community Edition handles it on one 4 GB VPS. Add daily database backups. If the authority wants hosting in their own or a government data centre, the same software installs there.

## Bid estimate (panels + CMS, 5 years)

Rough figures as of October 2026. Get vendor quotes before bidding.

| Item | Per panel ₹ | 160 panels ₹ |
|---|---:|---:|
| Panel material (tender build, ~10% bulk discount) | 21,000–26,000 | 33.6–41.6 lakh |
| Assembly, wiring, testing per panel | 2,500–3,500 | 4.0–5.6 lakh |
| Transport | 500–1,000 | 0.8–1.6 lakh |
| Site installation and commissioning (plinth, 2 earth pits, terminations) | 8,000–12,000 | 12.8–19.2 lakh |
| SIM data, 5 years (M2M plan) | 2,400–6,000 | 3.8–9.6 lakh |
| CMS server 5 years + dashboard setup | — | 2.5–4.0 lakh |
| Spares and warranty visits reserve (~10% of panel material) | 2,100–2,600 | 3.4–4.2 lakh |
| Prototype and development (one-time) | — | 1.0–2.0 lakh |
| **Total before profit and GST** | | **≈ ₹62–88 lakh** |

Add your margin and 18% GST on top.

## Per-pole items in the spec

The spec also lists items fitted in each pole's window box. If these are for all 40,000 poles, they are a bigger cost than the panels:

| Item (per pole) | Approx ₹ |
|---|---:|
| 63 A terminal block for 16/25 sq mm, 4 nos, on DIN channel | 400–600 |
| 6 A SP MCB C-curve, 2 nos | 300–400 |
| 6 mm laminated sheet, mounting | 100–200 |
| Earth stud, washers, nuts, DIN channel | 100–150 |
| Fixing labour | 150–300 |
| **Per pole** | **≈ 1,050–1,650** |
| **× 40,000 poles** | **≈ ₹4.2–6.6 crore** |

The 12 m hot-dip galvanised octagonal poles are priced per new pole, depending on steel rates. Check the BOQ for how many new poles are needed versus existing ones.
