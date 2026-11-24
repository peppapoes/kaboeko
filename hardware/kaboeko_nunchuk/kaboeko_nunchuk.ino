// Kaboeko – testcontroller met een Wii Nunchuk op een ESP32-S3 DevKitC
//
// Aansluiten via de Adafruit Wii Nunchuck Breakout Adapter (4836)
// en een STEMMA QT-naar-jumperkabel:
//   rood   (V+)  -> ESP32 3V3
//   zwart  (GND) -> ESP32 GND
//   blauw  (SDA) -> ESP32 GPIO 8
//   geel   (SCL) -> ESP32 GPIO 9
// Dezelfde pinnen als de MPU-6050: ze mogen allebei tegelijk aangesloten zijn.
//
// Geen extra bibliotheek nodig.
//
// Wat het doet: stuurt 50 keer per seconde één regel JSON via USB, bv.
//   {"p":1,"jx":0,"jy":0,"x":12.3,"y":-4.1,"c":0,"z":0,"shake":0,"btn":0}
//   jx / jy  = joystick, van -100 (links/onder) tot 100 (rechts/boven)
//   x / y    = kantelen voor/achter en links/rechts, in graden
//   c / z    = de C-knop en de Z-knop (1 = ingedrukt)
//   btn      = zelfde als z, zodat de game-code van de MPU-6050 blijft werken
//   shake    = 1 als je hard schudt
// Let op: de Nunchuk heeft geen gyroscoop, dus "draaien" (links/rechts wijzen) meet hij niet.

#include <Wire.h>

const int PLAYER = 1;          // zet op 2 voor de controller van speler 2
const int SDA_PIN = 8;
const int SCL_PIN = 9;
const byte NUNCHUK_ADDR = 0x52;

// Hoe hard je moet schudden: 1.0 = zwaartekracht, alles boven ~1.8 g telt als schudden.
const float SHAKE_THRESHOLD = 1.8;
// Ongeveer 200 meetwaarden = 1 g bij een Nunchuk. Pas aan als kantelen te weinig of te veel geeft.
const float COUNTS_PER_G = 200.0;
// Middenstand van de joystick (pas aan als hij in rust niet op 0 staat).
int joyCenterX = 128;
int joyCenterY = 128;

bool connected = false;
unsigned long lastSend = 0;
unsigned long lastRetry = 0;

bool initNunchuk() {
  // "Onversleutelde" start: werkt met originele en met namaak-Nunchuks.
  Wire.beginTransmission(NUNCHUK_ADDR);
  Wire.write(0xF0);
  Wire.write(0x55);
  if (Wire.endTransmission() != 0) return false;
  delay(10);
  Wire.beginTransmission(NUNCHUK_ADDR);
  Wire.write(0xFB);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;
  delay(10);
  return true;
}

bool readNunchuk(byte data[6]) {
  Wire.beginTransmission(NUNCHUK_ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;
  delayMicroseconds(500);
  if (Wire.requestFrom(NUNCHUK_ADDR, (uint8_t)6) != 6) return false;
  for (int i = 0; i < 6; i++) data[i] = Wire.read();
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  connected = initNunchuk();
  if (connected) Serial.println("{\"info\":\"nunchuk gevonden\"}");
}

void loop() {
  if (!connected) {
    // Niet gevonden: elke seconde opnieuw proberen (je mag hem dus ook later insteken).
    if (millis() - lastRetry > 1000) {
      lastRetry = millis();
      connected = initNunchuk();
      if (connected) Serial.println("{\"info\":\"nunchuk gevonden\"}");
      else Serial.println("{\"error\":\"Nunchuk niet gevonden: check de adapter en de 4 draadjes\"}");
    }
    return;
  }

  if (millis() - lastSend < 20) return;  // 20 ms = 50 berichten per seconde
  lastSend = millis();

  byte d[6];
  if (!readNunchuk(d)) {
    connected = false;
    Serial.println("{\"error\":\"verbinding met Nunchuk kwijt\"}");
    return;
  }

  // Joystick: 0..255, midden ~128 -> -100..100
  int jx = constrain((int)((d[0] - joyCenterX) * 100L / 100), -100, 100);
  int jy = constrain((int)((d[1] - joyCenterY) * 100L / 100), -100, 100);

  // Versnelling: 10 bits per as, midden ~512
  int ax = (d[2] << 2) | ((d[5] >> 2) & 0x03);
  int ay = (d[3] << 2) | ((d[5] >> 4) & 0x03);
  int az = (d[4] << 2) | ((d[5] >> 6) & 0x03);
  float gx = (ax - 512) / COUNTS_PER_G;
  float gy = (ay - 512) / COUNTS_PER_G;
  float gz = (az - 512) / COUNTS_PER_G;

  // Kantelen in graden
  float pitch = atan2(gy, sqrt(gx * gx + gz * gz)) * 180.0 / PI;  // voor/achter
  float roll  = atan2(gx, gz) * 180.0 / PI;                         // links/rechts

  float g = sqrt(gx * gx + gy * gy + gz * gz);
  int shake = g > SHAKE_THRESHOLD ? 1 : 0;

  // Knoppen: 0 = ingedrukt in de ruwe data
  int zBtn = (d[5] & 0x01) ? 0 : 1;
  int cBtn = (d[5] & 0x02) ? 0 : 1;

  Serial.print("{\"p\":");     Serial.print(PLAYER);
  Serial.print(",\"jx\":");    Serial.print(jx);
  Serial.print(",\"jy\":");    Serial.print(jy);
  Serial.print(",\"x\":");     Serial.print(pitch, 1);
  Serial.print(",\"y\":");     Serial.print(roll, 1);
  Serial.print(",\"c\":");     Serial.print(cBtn);
  Serial.print(",\"z\":");     Serial.print(zBtn);
  Serial.print(",\"shake\":"); Serial.print(shake);
  Serial.print(",\"btn\":");   Serial.print(zBtn);
  Serial.println("}");
}