/*
  Smart Feeder Control Panel (Street Light) -> CMS dashboard
  ----------------------------------------------------------
  Board  : LilyGO T-SIM7600 (ESP32 + 4G LTE, India ke liye "E" version)
  Meter  : Eastron SDM630-Modbus V2 (3-phase, RS485, slave id 1, 9600 8N1)
  RTC    : DS3231 (I2C)
  CMS    : ThingsBoard (MQTT, device access token)

  Libraries (Arduino Library Manager se install karo):
    TinyGSM, PubSubClient, ModbusMaster, RTClib, ArduinoJson (v7)
  Board package: "esp32 by Espressif", board = "ESP32 Dev Module",
    Partition scheme = "Default 4MB with spiffs" (LittleFS ke liye)

  NOTE: Pin numbers LilyGO T-SIM7600 ke hisaab se hain. Apne board ka
        pinout zaroor check karo. GPIO 34-39 input-only hain, inpe
        10k external pull-up lagana hai.
*/

#define TINY_GSM_MODEM_SIM7600
#define TINY_GSM_RX_BUFFER 1024
#include <TinyGsmClient.h>
#include <PubSubClient.h>
#include <ModbusMaster.h>
#include <RTClib.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <math.h>

// ================== SETTINGS (apne hisaab se badlo) ==================
const char APN[]          = "airtelgprs.com";   // Jio: "jionet", Vi: "www", BSNL: "bsnlnet"
const char MQTT_HOST[]    = "cms.example.com";  // aapka ThingsBoard server
const uint16_t MQTT_PORT  = 1883;
const char DEVICE_TOKEN[] = "PANEL_001_TOKEN";  // ThingsBoard device access token
const float LAT = 28.61, LON = 77.21;           // panel ki location (example: Delhi)
const float TZ_HOURS = 5.5;                     // IST

// Fault limits
const float V_LOW = 180, V_HIGH = 270;          // volts (phase-neutral)
const float I_MAX = 25;                         // A per phase (10kW ~ 14.6A)
const float LAMP_DROP = 0.80;                   // current base ke 80% se kam = lamp fail
const uint32_t SETTLE_MS = 10UL * 60 * 1000;    // ON hone ke 10 min baad hi lamp check

// ================== PINS (LilyGO T-SIM7600) ==================
#define MODEM_TX      27
#define MODEM_RX      26
#define MODEM_PWRKEY  4
#define MODEM_FLIGHT  25
#define RS485_RX      18   // TTL-RS485 module (auto direction) ka TXD
#define RS485_TX      19   // TTL-RS485 module ka RXD
#define I2C_SDA       21   // DS3231
#define I2C_SCL       22
#define PIN_RELAY     23   // relay -> contactor coil (AUTO path)
#define PIN_DOOR      35   // door limit switch, LOW = door band
#define PIN_AUX       36   // contactor aux NO via 230V opto, LOW = contactor ON
#define PIN_MCB_R     39   // outgoing MCB R ke baad 230V opto, LOW = supply hai
#define PIN_MCB_Y     13
#define PIN_MCB_B     14
#define PIN_SEL_AUTO  15   // selector switch AUTO position, LOW = AUTO
#define RELAY_ON_LEVEL HIGH

// ================== OBJECTS ==================
HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);
TinyGsmClient gsmClient(modem);
PubSubClient mqtt(gsmClient);
ModbusMaster meterBus;
RTC_DS3231 rtc;
Preferences prefs;

// ================== DATA ==================
struct Meter {
  float v[3], i[3], p[3], pf[3];
  float kwTotal, freq, kwh;
  bool ok;
} m;

struct Special { uint16_t mmdd; int16_t onMin, offMin; };  // mmdd=0 means empty

enum Mode : uint8_t { MODE_ASTRO = 0, MODE_SCHEDULE = 1, MODE_MANUAL = 2 };

struct Config {
  uint8_t mode;
  int16_t onOffset, offOffset;   // ASTRO: sunset+onOffset ON, sunrise+offOffset OFF (minutes)
  int16_t onMin, offMin;         // SCHEDULE: minutes from midnight
  uint8_t dayMask;               // bit0=Sun ... bit6=Sat
  bool manualState;
  float base[3];                 // normal current per phase (A), auto-learn
  float lampAmp;                 // ek lamp ka current (A), e.g. 150W LED ~0.7A
  Special specials[8];           // date-wise override (festival etc.)
} cfg;

enum Fault : uint32_t {
  F_PHASE_R = 1UL << 0, F_PHASE_Y = 1UL << 1, F_PHASE_B = 1UL << 2,
  F_OVERVOLT = 1UL << 3, F_OVERCURRENT = 1UL << 4,
  F_LAMP_R = 1UL << 5, F_LAMP_Y = 1UL << 6, F_LAMP_B = 1UL << 7,
  F_CONTACTOR = 1UL << 8, F_DAY_BURN = 1UL << 9,
  F_MCB_R = 1UL << 10, F_MCB_Y = 1UL << 11, F_MCB_B = 1UL << 12,
  F_DOOR = 1UL << 13, F_METER = 1UL << 14
};
const char* FAULT_KEYS[] = {
  "f_phaseR", "f_phaseY", "f_phaseB", "f_overVolt", "f_overCurrent",
  "f_lampR", "f_lampY", "f_lampB", "f_contactor", "f_dayBurn",
  "f_mcbR", "f_mcbY", "f_mcbB", "f_door", "f_meter"
};
const int FAULT_COUNT = sizeof(FAULT_KEYS) / sizeof(FAULT_KEYS[0]);

uint32_t faults = 0, lastFaults = 0;
bool lightOn = false;
uint32_t onSinceMs = 0, dayBurnSinceMs = 0;
int sunriseMin = 360, sunsetMin = 1080;
int failedLamps[3] = {0, 0, 0};
uint32_t tRead = 0, tPublish = 0, tConnect = 0;

// ================== TIME HELPERS ==================
DateTime localNow() { return rtc.now() + TimeSpan((int32_t)(TZ_HOURS * 3600)); }
uint64_t epochMs() { return (uint64_t)rtc.now().unixtime() * 1000ULL; }

int dayOfYear(const DateTime& d) {
  static const int cum[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
  int n = cum[d.month() - 1] + d.day();
  bool leap = (d.year() % 4 == 0 && d.year() % 100 != 0) || d.year() % 400 == 0;
  return (leap && d.month() > 2) ? n + 1 : n;
}

// Sunrise/sunset (NOAA "Almanac" method). Returns local minutes from midnight, -1 if none.
int sunEvent(int doy, bool rising) {
  const float RAD = M_PI / 180.0, ZENITH = 90.833;
  float lngHour = LON / 15.0;
  float t = doy + ((rising ? 6 : 18) - lngHour) / 24.0;
  float M = 0.9856 * t - 3.289;
  float L = fmod(M + 1.916 * sin(M * RAD) + 0.020 * sin(2 * M * RAD) + 282.634 + 360, 360);
  float RA = fmod(atan(0.91764 * tan(L * RAD)) / RAD + 360, 360);
  RA += floor(L / 90) * 90 - floor(RA / 90) * 90;
  RA /= 15;
  float sinDec = 0.39782 * sin(L * RAD);
  float cosDec = cos(asin(sinDec));
  float cosH = (cos(ZENITH * RAD) - sinDec * sin(LAT * RAD)) / (cosDec * cos(LAT * RAD));
  if (cosH > 1 || cosH < -1) return -1;
  float H = (rising ? 360 - acos(cosH) / RAD : acos(cosH) / RAD) / 15;
  float T = H + RA - 0.06571 * t - 6.622;
  float local = fmod(T - lngHour + TZ_HOURS + 48, 24);
  return (int)(local * 60);
}

// ON window jo midnight cross kar sakti hai (e.g. 18:30 -> 06:00)
bool inWindow(int now, int on, int off) {
  return (on <= off) ? (now >= on && now < off) : (now >= on || now < off);
}

int parseHHMM(const char* s) { int h = 0, mi = 0; sscanf(s, "%d:%d", &h, &mi); return h * 60 + mi; }

// ================== CONFIG ==================
void loadConfig() {
  prefs.begin("panel", false);
  if (prefs.getBytes("cfg", &cfg, sizeof(cfg)) != sizeof(cfg)) {
    memset(&cfg, 0, sizeof(cfg));
    cfg.mode = MODE_ASTRO;
    cfg.onOffset = 10;   // sunset ke 10 min baad ON
    cfg.offOffset = -10; // sunrise se 10 min pehle OFF
    cfg.onMin = 18 * 60 + 30;
    cfg.offMin = 6 * 60;
    cfg.dayMask = 0x7F;
    cfg.lampAmp = 0.7;
  }
}
void saveConfig() { prefs.putBytes("cfg", &cfg, sizeof(cfg)); }

// ================== METER (Modbus RS485) ==================
float regFloat(uint8_t idx) {
  uint32_t raw = ((uint32_t)meterBus.getResponseBuffer(idx) << 16) | meterBus.getResponseBuffer(idx + 1);
  float f; memcpy(&f, &raw, 4); return f;
}

void readMeter() {
  // SDM630: 0x0000 V1-V3, 0x0006 I1-I3, 0x000C P1-P3 (W), 0x001E PF1-PF3
  if (meterBus.readInputRegisters(0x0000, 36) != meterBus.ku8MBSuccess) { m.ok = false; return; }
  for (int k = 0; k < 3; k++) {
    m.v[k]  = regFloat(0x00 + k * 2);
    m.i[k]  = regFloat(0x06 + k * 2);
    m.p[k]  = regFloat(0x0C + k * 2) / 1000.0;  // kW
    m.pf[k] = regFloat(0x1E + k * 2);
  }
  if (meterBus.readInputRegisters(0x0034, 2) == meterBus.ku8MBSuccess) m.kwTotal = regFloat(0) / 1000.0;
  if (meterBus.readInputRegisters(0x0046, 4) == meterBus.ku8MBSuccess) { m.freq = regFloat(0); m.kwh = regFloat(2); }
  m.ok = true;
}

// ================== LIGHT DECISION ==================
bool selectorAuto() { return digitalRead(PIN_SEL_AUTO) == LOW; }

void setLight(bool on) {
  if (on && !lightOn) onSinceMs = millis();
  lightOn = on;
  digitalWrite(PIN_RELAY, on ? RELAY_ON_LEVEL : !RELAY_ON_LEVEL);
}

void decideLight() {
  DateTime d = localNow();
  int nowMin = d.hour() * 60 + d.minute();
  int doy = dayOfYear(d);
  sunriseMin = sunEvent(doy, true);
  sunsetMin = sunEvent(doy, false);

  bool want = false;
  uint16_t mmdd = d.month() * 100 + d.day();
  const Special* sp = nullptr;
  for (auto& s : cfg.specials) if (s.mmdd == mmdd) sp = &s;

  if (cfg.mode == MODE_MANUAL) {
    want = cfg.manualState;
  } else if (sp) {
    want = inWindow(nowMin, sp->onMin, sp->offMin);
  } else if (cfg.mode == MODE_ASTRO) {
    want = inWindow(nowMin, sunsetMin + cfg.onOffset, sunriseMin + cfg.offOffset);
  } else {  // SCHEDULE
    // subah ka hissa (midnight ke baad) pichle din ki schedule maana jaata hai
    int dow = d.dayOfTheWeek();
    if (cfg.onMin > cfg.offMin && nowMin < cfg.offMin) dow = (dow + 6) % 7;
    want = (cfg.dayMask & (1 << dow)) && inWindow(nowMin, cfg.onMin, cfg.offMin);
  }
  setLight(want);
}

// ================== FAULT DETECTION ==================
void checkFaults() {
  uint32_t f = 0;
  const uint32_t phaseBits[3] = {F_PHASE_R, F_PHASE_Y, F_PHASE_B};
  const uint32_t lampBits[3]  = {F_LAMP_R, F_LAMP_Y, F_LAMP_B};
  const uint32_t mcbBits[3]   = {F_MCB_R, F_MCB_Y, F_MCB_B};
  const int mcbPins[3]        = {PIN_MCB_R, PIN_MCB_Y, PIN_MCB_B};

  if (digitalRead(PIN_DOOR) == HIGH) f |= F_DOOR;
  if (!m.ok) { f |= F_METER; faults = f; return; }

  bool contactorOn = digitalRead(PIN_AUX) == LOW;
  bool settled = lightOn && (millis() - onSinceMs > SETTLE_MS);
  float totalI = 0;

  for (int k = 0; k < 3; k++) {
    totalI += m.i[k];
    if (m.v[k] < V_LOW) f |= phaseBits[k];
    if (m.v[k] > V_HIGH) f |= F_OVERVOLT;
    if (m.i[k] > I_MAX) f |= F_OVERCURRENT;
    bool phaseOk = m.v[k] >= V_LOW;

    // Outgoing MCB trip: phase hai, contactor ON hai, par MCB ke baad supply nahi
    if (contactorOn && phaseOk && digitalRead(mcbPins[k]) == HIGH) f |= mcbBits[k];

    // Lamp failure: current normal (base) se kaafi kam
    failedLamps[k] = 0;
    if (settled && phaseOk && cfg.base[k] > 0.5 && m.i[k] < cfg.base[k] * LAMP_DROP) {
      f |= lampBits[k];
      failedLamps[k] = (int)roundf((cfg.base[k] - m.i[k]) / cfg.lampAmp);
    }
  }

  // Pehli baar: base current khud seekh lo
  if (settled && cfg.base[0] == 0 && cfg.base[1] == 0 && cfg.base[2] == 0 && totalI > 1.0) {
    for (int k = 0; k < 3; k++) cfg.base[k] = m.i[k];
    saveConfig();
  }

  // Contactor fault: command ON tha par contactor/current nahi aaya
  if (selectorAuto() && lightOn && millis() - onSinceMs > 30000 && (!contactorOn || totalI < 0.3))
    f |= F_CONTACTOR;

  // Day burning: command OFF hai par lights jal rahi hain (1 min se zyada)
  if (selectorAuto() && !lightOn && totalI > 0.5) {
    if (!dayBurnSinceMs) dayBurnSinceMs = millis();
    if (millis() - dayBurnSinceMs > 60000) f |= F_DAY_BURN;
  } else dayBurnSinceMs = 0;

  faults = f;
}

// ================== TELEMETRY + OFFLINE LOG ==================
void buildTelemetry(JsonObject v) {
  const char* ph[3] = {"R", "Y", "B"};
  for (int k = 0; k < 3; k++) {
    v[String("v") + ph[k]]  = m.v[k];
    v[String("i") + ph[k]]  = m.i[k];
    v[String("kw") + ph[k]] = m.p[k];
    v[String("pf") + ph[k]] = m.pf[k];
    v[String("lampsFailed") + ph[k]] = failedLamps[k];
  }
  v["kwTotal"] = m.kwTotal; v["freq"] = m.freq; v["kwh"] = m.kwh;
  v["light"] = lightOn;
  v["mode"] = cfg.mode == MODE_ASTRO ? "ASTRO" : cfg.mode == MODE_SCHEDULE ? "SCHEDULE" : "MANUAL";
  v["selector"] = selectorAuto() ? "AUTO" : "LOCAL";
  v["sunrise"] = sunriseMin; v["sunset"] = sunsetMin;
  v["rssi"] = modem.getSignalQuality();
  for (int b = 0; b < FAULT_COUNT; b++) v[FAULT_KEYS[b]] = (bool)(faults & (1UL << b));
}

void logOffline(const String& line) {
  File fl = LittleFS.open("/queue.jsonl", FILE_APPEND);
  if (fl && fl.size() < 900000) fl.println(line);   // ~1MB tak store
  if (fl) fl.close();
}

void flushOffline() {
  if (!LittleFS.exists("/queue.jsonl")) return;
  File fl = LittleFS.open("/queue.jsonl", FILE_READ);
  while (fl.available() && mqtt.connected()) {
    String line = fl.readStringUntil('\n');
    line.trim();
    if (line.length()) mqtt.publish("v1/devices/me/telemetry", line.c_str());
    mqtt.loop();
  }
  fl.close();
  LittleFS.remove("/queue.jsonl");
}

void publishTelemetry() {
  JsonDocument doc;
  doc["ts"] = epochMs();
  buildTelemetry(doc["values"].to<JsonObject>());
  String out; serializeJson(doc, out);
  if (mqtt.connected()) mqtt.publish("v1/devices/me/telemetry", out.c_str());
  else logOffline(out);
}

// Event log: har fault RAISED / CLEARED turant bhejo
void publishEvents() {
  uint32_t changed = faults ^ lastFaults;
  if (!changed) return;
  for (int b = 0; b < FAULT_COUNT; b++) {
    if (!(changed & (1UL << b))) continue;
    JsonDocument doc;
    doc["ts"] = epochMs();
    doc["values"]["event"] = String(FAULT_KEYS[b]) + ((faults & (1UL << b)) ? " RAISED" : " CLEARED");
    String out; serializeJson(doc, out);
    if (mqtt.connected()) mqtt.publish("v1/devices/me/telemetry", out.c_str());
    else logOffline(out);
  }
  lastFaults = faults;
  publishTelemetry();  // alarm ke saath latest values bhi
}

// ================== COMMANDS FROM CMS (RPC) ==================
void onMqtt(char* topic, byte* payload, unsigned int len) {
  String t(topic);
  String reqId = t.substring(t.lastIndexOf('/') + 1);
  JsonDocument req;
  if (deserializeJson(req, payload, len)) return;
  String method = req["method"] | "";
  JsonVariant p = req["params"];
  JsonDocument res; res["ok"] = true;

  if (method == "setLight") {                 // {"method":"setLight","params":true}
    cfg.mode = MODE_MANUAL; cfg.manualState = p.as<bool>();
  } else if (method == "setMode") {           // "ASTRO" | "SCHEDULE" | "MANUAL"
    String md = p.as<String>();
    cfg.mode = md == "SCHEDULE" ? MODE_SCHEDULE : md == "MANUAL" ? MODE_MANUAL : MODE_ASTRO;
  } else if (method == "setSchedule") {       // {"on":"18:30","off":"06:00","days":127}
    cfg.onMin = parseHHMM(p["on"] | "18:30");
    cfg.offMin = parseHHMM(p["off"] | "06:00");
    cfg.dayMask = p["days"] | 0x7F;
  } else if (method == "setAstro") {          // {"onOffset":10,"offOffset":-10}
    cfg.onOffset = p["onOffset"] | 0; cfg.offOffset = p["offOffset"] | 0;
  } else if (method == "setSpecial") {        // {"slot":0,"date":"10-31","on":"17:30","off":"06:30"}
    int slot = p["slot"] | 0;
    int mo = 0, dy = 0; sscanf(p["date"] | "00-00", "%d-%d", &mo, &dy);
    if (slot >= 0 && slot < 8) cfg.specials[slot] = {(uint16_t)(mo * 100 + dy),
      (int16_t)parseHHMM(p["on"] | "00:00"), (int16_t)parseHHMM(p["off"] | "00:00")};
  } else if (method == "learnBaseline") {     // naye lamps lagne ke baad
    for (int k = 0; k < 3; k++) cfg.base[k] = m.i[k];
  } else if (method == "setLampAmp") {
    cfg.lampAmp = p.as<float>();
  } else if (method == "getStatus") {
    buildTelemetry(res["status"].to<JsonObject>());
  } else {
    res["ok"] = false; res["error"] = "unknown method";
  }
  saveConfig();
  decideLight();   // command turant apply, koi delay nahi

  String out; serializeJson(res, out);
  mqtt.publish(("v1/devices/me/rpc/response/" + reqId).c_str(), out.c_str());
  publishTelemetry();
}

// ================== NETWORK ==================
void syncTimeFromNetwork() {
  int y, mo, d, h, mi, s; float tz;
  if (modem.getNetworkTime(&y, &mo, &d, &h, &mi, &s, &tz) && y >= 2025) {
    DateTime localT(y, mo, d, h, mi, s);
    rtc.adjust(localT - TimeSpan((int32_t)(tz * 3600)));  // RTC me UTC rakhte hain
  }
}

void ensureConnected() {
  if (mqtt.connected()) return;
  if (millis() - tConnect < 30000 && tConnect) return;  // har 30 s retry
  tConnect = millis();
  if (!modem.isNetworkConnected() && !modem.waitForNetwork(20000)) return;
  if (!modem.isGprsConnected() && !modem.gprsConnect(APN)) return;
  syncTimeFromNetwork();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqtt);
  mqtt.setKeepAlive(30);
  mqtt.setBufferSize(1024);
  if (mqtt.connect("panel", DEVICE_TOKEN, nullptr)) {
    mqtt.subscribe("v1/devices/me/rpc/request/+", 1);
    flushOffline();
    publishTelemetry();
  }
}

// ================== SETUP / LOOP ==================
void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY, OUTPUT); digitalWrite(PIN_RELAY, !RELAY_ON_LEVEL);
  pinMode(PIN_DOOR, INPUT); pinMode(PIN_AUX, INPUT); pinMode(PIN_MCB_R, INPUT);  // external pull-up
  pinMode(PIN_MCB_Y, INPUT_PULLUP); pinMode(PIN_MCB_B, INPUT_PULLUP); pinMode(PIN_SEL_AUTO, INPUT_PULLUP);

  Wire.begin(I2C_SDA, I2C_SCL);
  rtc.begin();
  LittleFS.begin(true);
  loadConfig();

  Serial2.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  meterBus.begin(1, Serial2);

  // 4G modem power on
  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, HIGH); delay(300); digitalWrite(MODEM_PWRKEY, LOW);
  pinMode(MODEM_FLIGHT, OUTPUT); digitalWrite(MODEM_FLIGHT, HIGH);
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  delay(3000);
  modem.restart();

  readMeter(); decideLight(); checkFaults();  // network na ho tab bhi lights chalti rahein
}

void loop() {
  mqtt.loop();                                  // commands turant receive
  if (millis() - tRead > 5000) {                // har 5 s
    tRead = millis();
    readMeter(); decideLight(); checkFaults(); publishEvents();
  }
  if (millis() - tPublish > 60000) {            // har 1 min data log
    tPublish = millis();
    publishTelemetry();
  }
  ensureConnected();
}
