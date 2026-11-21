// Kaboeko – testcontroller met MPU-6050 op een ESP32-S3 DevKitC
//
// Aansluiten (breadboard):
//   MPU-6050 VCC -> ESP32 3V3
//   MPU-6050 GND -> ESP32 GND
//   MPU-6050 SDA -> ESP32 GPIO 8
//   MPU-6050 SCL -> ESP32 GPIO 9
//   Knopje (uit de starterset): ene poot -> GPIO 4, andere poot -> GND
//
// Bibliotheek: "MPU6050_light" van rfetick (Arduino IDE > Library Manager)
//
// Wat het doet: stuurt 50 keer per seconde één regel JSON via USB, bv.
//   {"p":1,"x":12.3,"y":-4.1,"z":87.0,"shake":0,"btn":1}
// Die regels leest de Phaser-game later via Web Serial.

#include <Wire.h>
#include <MPU6050_light.h>

const int PLAYER = 1;          // zet op 2 voor de controller van speler 2
const int SDA_PIN = 8;
const int SCL_PIN = 9;
const int BUTTON_PIN = 4;

// Hoe hard je moet schudden: 1.0 = zwaartekracht, alles boven ~1.8 g telt als schudden.
const float SHAKE_THRESHOLD = 1.8;

MPU6050 mpu(Wire);
unsigned long lastSend = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(BUTTON_PIN, INPUT_PULLUP);  // interne weerstand: geen extra onderdelen nodig
  Wire.begin(SDA_PIN, SCL_PIN);

  byte status = mpu.begin();
  if (status != 0) {
    // 0 = alles ok. Iets anders = de sensor wordt niet gevonden: check de draadjes.
    while (true) {
      Serial.print("{\"error\":\"MPU6050 niet gevonden, status ");
      Serial.print(status);
      Serial.println("\"}");
      delay(1000);
    }
  }

  // Leg de sensor STIL en PLAT neer tijdens deze 2 seconden.
  Serial.println("{\"info\":\"kalibreren, sensor stil houden\"}");
  delay(1000);
  mpu.calcOffsets();
  Serial.println("{\"info\":\"klaar\"}");
}

void loop() {
  mpu.update();  // zo vaak mogelijk aanroepen, ook als we niet sturen

  if (millis() - lastSend < 20) return;  // 20 ms = 50 berichten per seconde
  lastSend = millis();

  // Schudden: hoeveel g er in totaal op de sensor werkt.
  float ax = mpu.getAccX();
  float ay = mpu.getAccY();
  float az = mpu.getAccZ();
  float g = sqrt(ax * ax + ay * ay + az * az);
  int shake = g > SHAKE_THRESHOLD ? 1 : 0;

  int btn = digitalRead(BUTTON_PIN) == LOW ? 1 : 0;  // ingedrukt = LOW door de pull-up

  Serial.print("{\"p\":");     Serial.print(PLAYER);
  Serial.print(",\"x\":");     Serial.print(mpu.getAngleX(), 1);  // kantelen voor/achter
  Serial.print(",\"y\":");     Serial.print(mpu.getAngleY(), 1);  // kantelen links/rechts
  Serial.print(",\"z\":");     Serial.print(mpu.getAngleZ(), 1);  // draaien (verschuift langzaam)
  Serial.print(",\"shake\":"); Serial.print(shake);
  Serial.print(",\"btn\":");   Serial.print(btn);
  Serial.println("}");
}
