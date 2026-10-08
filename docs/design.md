# Panel design

## Load calculation

I = P / (√3 × V × PF) = 10,000 / (1.732 × 415 × 0.95) ≈ **14.6 A per phase**

LED drivers draw a high inrush current, so the incomer and contactor are rated 40 A (about 2.5× margin).

| Item | Value |
|---|---|
| Supply | 415 V, 3-phase + N |
| Connected load | 10 kW |
| Current per phase | ≈ 14.6 A |
| Incomer | 4P MCB 40 A C-curve + Type 2 SPD |
| Contactor | 4P 40 A AC-1, 230 V coil |
| Outgoing | 3 × SP MCB 20 A C-curve (one feeder per phase) |
| Power wiring | 6 sq mm Cu (16/25 sq mm at terminal blocks per spec) |
| Control wiring | 1.5 sq mm Cu |

## Block diagram

![Block diagram](diagrams/block-diagram.svg)

## Power wiring

Indian colour code: R red, Y yellow, B blue, neutral black, earth green.

![Power wiring](diagrams/power-wiring.svg)

Supply → 4P incomer → SPD (to earth) → energy meter (Selec MFM383A-C, with 3 CTs on R, Y, B) → aluminium busbar → contactor K1 → 3 outgoing SP MCBs → feeders. A 230 V opto module after each outgoing MCB tells the controller whether that MCB has tripped. Control supply is tapped from the R bus and N through two 6 A MCBs.

## Control wiring

![Control wiring](diagrams/control-wiring.svg)

The 3-position selector switch:
- **AUTO**: the coil is fed through relay RL1, driven by the controller (GPIO23).
- **OFF**: lights off.
- **MANUAL**: the coil is fed directly, so the lights can run even if the controller fails.

The contactor aux NO contact feeds a 230 V opto input so the controller knows the contactor really closed.

## Controller pin map (LilyGO T-A7670 / T-SIM7600)

| ESP32 pin | Connected to | Note |
|---|---|---|
| GPIO18 / GPIO19 | TTL-RS485 module TXD / RXD → meter A, B | Auto-direction module, twisted pair, 120 Ω at the end |
| GPIO21 / GPIO22 | DS3231 RTC SDA / SCL | Keeps time without network |
| GPIO23 | Relay module IN → RL1 | Opto-isolated relay |
| GPIO35 | Door limit switch | LOW = door closed, 10k pull-up |
| GPIO36 | Contactor aux NO via 230 V opto | LOW = contactor on, 10k pull-up |
| GPIO39 / 13 / 14 | 230 V opto after outgoing MCB R / Y / B | LOW = supply present; 10k pull-up on 39 |
| GPIO15 | Selector AUTO position (extra contact block) | LOW = AUTO |
| 5V / GND | 230 V → 5 V 3 A SMPS | The 4G modem draws up to 2 A peaks |
| SIM / antenna | Nano SIM, 4G antenna mounted outside the panel | Metal enclosures block signal |

The modem uses GPIO26/27 and GPIO4 on both boards, plus GPIO12 (power) on the T-A7670 and GPIO25 on the T-SIM7600. Pins are for these LilyGO boards. Check the pinout of the actual board before wiring. GPIO 34–39 are input-only and have no internal pull-ups.
