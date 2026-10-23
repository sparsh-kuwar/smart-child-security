/*
 * SafeTrack — Arduino Uno sensing controller
 * Smart Child Security System (report §3.1.1 / §5.1)
 *
 * Wiring
 *   RC522 RFID   SDA/SS→D10  SCK→D13  MOSI→D11  MISO→D12  RST→D9   3.3V, GND
 *   Neo-6M GPS   TX→D4 (Uno RX)  RX→D3 (Uno TX)                    5V/3.3V, GND
 *   Sound sensor (electret + envelope) OUT→A0                      5V, GND
 *   Buzzer       D6 (via transistor)
 *   LEDs         green→D7  red→D8  amber→A1   (220 Ω each)
 *   SOS button   D2 → GND (internal pull-up)
 *   Battery sense (optional) divider → A2
 *   ESP8266      Uno TX(D1)→ESP RX,  ESP TX→Uno RX(D0)  (level-shift 5V→3.3V on Uno TX!)
 *                Disconnect D0/D1 while uploading this sketch.
 *
 * Every SEND_INTERVAL_MS the Uno writes one JSON line to the ESP8266, which forwards it
 * to the SafeTrack server. The ESP replies with "A:<buzzer 0|1>,<led G|A|R>" which drives
 * the local buzzer + LEDs.
 *
 * Privacy: the microphone signal is reduced to a single dB estimate per window inside
 * readSoundDb(); raw samples are never stored, buffered or transmitted.
 *
 * Libraries: MFRC522 (miguelbalboa), TinyGPSPlus (mikalhart).
 */
#include <SPI.h>
#include <MFRC522.h>
#include <SoftwareSerial.h>
#include <TinyGPSPlus.h>

#define FW_VERSION "uno-1.0"

const uint8_t PIN_RFID_SS = 10, PIN_RFID_RST = 9;
const uint8_t PIN_GPS_RX = 4, PIN_GPS_TX = 3;
const uint8_t PIN_SOUND = A0, PIN_BATTERY = A2;
const uint8_t PIN_BUZZER = 6, PIN_LED_GREEN = 7, PIN_LED_RED = 8, PIN_LED_AMBER = A1;
const uint8_t PIN_SOS = 2;

const unsigned long SEND_INTERVAL_MS = 5000;
const unsigned long RFID_LOCAL_DEBOUNCE_MS = 3000;  // server applies the configurable 60 s debounce
const unsigned long SOUND_WINDOW_MS = 50;

// Sound calibration: dB = SOUND_GAIN * log10(peak-to-peak counts) + SOUND_OFFSET.
// Calibrate against a reference meter at 40/60/80/100 dB (report §6.1) and update these.
const float SOUND_GAIN = 20.0;
const float SOUND_OFFSET = 34.0;

MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
SoftwareSerial gpsSerial(PIN_GPS_RX, PIN_GPS_TX);
TinyGPSPlus gps;

unsigned long lastSend = 0, lastScanAt = 0, buzzerUntil = 0;
char pendingUid[24] = "";
char lastUid[24] = "";
bool sosPending = false, bootSent = false;
float soundSum = 0;
uint16_t soundCount = 0;
char rxLine[32];
uint8_t rxLen = 0;

void setLed(char c) {
  digitalWrite(PIN_LED_GREEN, c == 'G');
  digitalWrite(PIN_LED_AMBER, c == 'A');
  digitalWrite(PIN_LED_RED, c == 'R');
}

void setup() {
  Serial.begin(9600);  // link to ESP8266
  gpsSerial.begin(9600);
  SPI.begin();
  rfid.PCD_Init();
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_AMBER, OUTPUT);
  pinMode(PIN_SOS, INPUT_PULLUP);
  setLed('A');  // amber until the first server response
}

// Peak-to-peak amplitude over a short window → one dB estimate. Samples stay in registers only.
float readSoundDb() {
  unsigned long start = millis();
  int lo = 1023, hi = 0;
  while (millis() - start < SOUND_WINDOW_MS) {
    int v = analogRead(PIN_SOUND);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  int p2p = hi - lo;
  if (p2p < 1) p2p = 1;
  return SOUND_GAIN * log10((float)p2p) + SOUND_OFFSET;
}

void pollRfid() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  char uid[24] = "";
  for (byte i = 0; i < rfid.uid.size && i < 7; i++) {
    char part[4];
    snprintf(part, sizeof(part), i ? ":%02X" : "%02X", rfid.uid.uidByte[i]);
    strcat(uid, part);
  }
  rfid.PICC_HaltA();
  unsigned long now = millis();
  if (strcmp(uid, lastUid) == 0 && now - lastScanAt < RFID_LOCAL_DEBOUNCE_MS) return;
  strcpy(lastUid, uid);
  strcpy(pendingUid, uid);
  lastScanAt = now;
  tone(PIN_BUZZER, 2200, 60);  // short beep = card read
}

void pollSos() {
  static unsigned long pressedAt = 0;
  if (digitalRead(PIN_SOS) == LOW) {
    if (!pressedAt) pressedAt = millis();
    if (!sosPending && millis() - pressedAt > 800) {  // long press avoids accidental triggers
      sosPending = true;
      setLed('R');  // local alarm immediately, before the server answers (report §6.2.7)
      digitalWrite(PIN_BUZZER, HIGH);
      buzzerUntil = millis() + 3000;
      lastSend = 0;  // send right away
    }
  } else {
    pressedAt = 0;
  }
}

void pollEsp() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      rxLine[rxLen] = 0;
      // "A:1,R" → buzzer on, red LED
      if (rxLen >= 5 && rxLine[0] == 'A' && rxLine[1] == ':') {
        if (rxLine[2] == '1') {
          digitalWrite(PIN_BUZZER, HIGH);
          buzzerUntil = millis() + 4000;
        }
        setLed(rxLine[4]);
      }
      rxLen = 0;
    } else if (rxLen < sizeof(rxLine) - 1) {
      rxLine[rxLen++] = c;
    }
  }
}

float batteryPercent() {
  int raw = analogRead(PIN_BATTERY);  // 2:1 divider on a 2S Li-ion pack (6.0–8.4 V)
  float volts = raw * (5.0 / 1023.0) * 2.0;
  float pct = (volts - 6.0) / (8.4 - 6.0) * 100.0;
  return constrain(pct, 0, 100);
}

void sendReading() {
  char line[220], latS[14], lonS[14], dbS[8], mvS[8], batS[8];
  bool fix = gps.location.isValid() && gps.location.age() < 10000;
  float speedKmph = gps.speed.isValid() ? gps.speed.kmph() : 0;
  // No IMU in the prototype parts list: movement and steps are estimated from GPS speed.
  // (Swap in an MPU-6050 step counter here for indoor accuracy.)
  float movement = constrain(speedKmph / 12.0, 0, 1);
  int steps = (int)(speedKmph / 3.6 * (SEND_INTERVAL_MS / 1000.0) * 1.4);
  float db = soundCount ? soundSum / soundCount : -1;

  dtostrf(fix ? gps.location.lat() : 0, 1, 6, latS);
  dtostrf(fix ? gps.location.lng() : 0, 1, 6, lonS);
  dtostrf(db, 1, 1, dbS);
  dtostrf(movement, 1, 2, mvS);
  dtostrf(batteryPercent(), 1, 0, batS);

  int n = snprintf(line, sizeof(line),
                   "{\"lat\":%s,\"lon\":%s,\"gps_fix\":%s,\"satellites\":%d,\"steps\":%d,\"movement\":%s,"
                   "\"sound_db\":%s,\"battery\":%s,\"fw\":\"%s\"",
                   latS, lonS, fix ? "true" : "false", gps.satellites.isValid() ? (int)gps.satellites.value() : 0,
                   steps, mvS, db < 0 ? "null" : dbS, batS, FW_VERSION);
  if (pendingUid[0]) n += snprintf(line + n, sizeof(line) - n, ",\"rfid_uid\":\"%s\"", pendingUid);
  if (sosPending) n += snprintf(line + n, sizeof(line) - n, ",\"sos\":true");
  if (!bootSent) n += snprintf(line + n, sizeof(line) - n, ",\"event\":\"boot\"");
  snprintf(line + n, sizeof(line) - n, "}");
  Serial.println(line);

  pendingUid[0] = 0;
  sosPending = false;
  bootSent = true;
  soundSum = 0;
  soundCount = 0;
}

void loop() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());
  pollRfid();
  pollSos();
  pollEsp();

  soundSum += readSoundDb();  // averaged into one value per send interval
  soundCount++;

  if (buzzerUntil && millis() > buzzerUntil) {
    digitalWrite(PIN_BUZZER, LOW);
    buzzerUntil = 0;
  }
  if (millis() - lastSend >= SEND_INTERVAL_MS || lastSend == 0) {
    lastSend = millis();
    sendReading();
  }
}
