/*
 * SafeTrack — ESP8266 Wi-Fi bridge
 *
 * Reads one JSON reading per line from the Arduino Uno (Serial, 9600 baud), POSTs it to
 * SafeTrack /api/device/ingest and writes the actuation back to the Uno as "A:<0|1>,<G|A|R>".
 *
 * Network loss (report §6.3): readings that cannot be delivered are kept in a ring buffer
 * with their capture time and uploaded as one batch ({"readings":[...]} with "age_s") once
 * the connection returns, so the server stores them with their original timestamps.
 *
 * Libraries: ESP8266 core, ArduinoJson 7.
 */
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "config.h"

const uint8_t BUFFER_SIZE = 24;  // 2 minutes at one reading per 5 s
struct Pending {
  String json;
  unsigned long capturedAt;
};
Pending buffer[BUFFER_SIZE];
uint8_t head = 0, count = 0;
String line;

void push(const String& json) {
  buffer[(head + count) % BUFFER_SIZE] = {json, millis()};
  if (count < BUFFER_SIZE) count++;
  else head = (head + 1) % BUFFER_SIZE;  // oldest reading dropped when full
}

bool post(const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  client.setInsecure();  // prototype: skip certificate pinning. Pin Render's certificate for production.
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(client, String(SERVER_URL) + "/api/device/ingest")) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = http.POST(body);
  if (code == 200) response = http.getString();
  http.end();
  return code == 200;
}

void actuate(const String& response) {
  JsonDocument doc;
  if (deserializeJson(doc, response)) return;
  bool buzzer = doc["actuate"]["buzzer"] | false;
  const char* led = doc["actuate"]["led"] | "green";
  char c = led[0] == 'r' ? 'R' : led[0] == 'a' ? 'A' : 'G';
  Serial.printf("A:%d,%c\n", buzzer ? 1 : 0, c);
}

void flush(const String& latest) {
  push(latest);
  String body;
  if (count == 1) {
    body = buffer[head].json;
  } else {
    // Batch: inject "age_s" into each buffered object.
    body = "{\"readings\":[";
    for (uint8_t i = 0; i < count; i++) {
      Pending& p = buffer[(head + i) % BUFFER_SIZE];
      String item = p.json;
      item.remove(item.length() - 1);  // drop closing brace
      item += ",\"age_s\":" + String((millis() - p.capturedAt) / 1000.0, 1) + "}";
      body += (i ? "," : "") + item;
    }
    body += "]}";
  }
  String response;
  if (post(body, response)) {
    count = 0;
    actuate(response);
  } else {
    Serial.println("A:0,A");  // amber: offline, buffering
  }
}

void setup() {
  Serial.begin(9600);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      line.trim();
      if (line.startsWith("{") && line.endsWith("}")) flush(line);
      line = "";
    } else if (line.length() < 400) {
      line += c;
    }
  }
}
