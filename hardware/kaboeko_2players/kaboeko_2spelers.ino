// Kaboeko – één ESP32-S3 voor twee spelers, elk met een MPU-6050 en een knop
//
// Speler 1 (eerste I2C-bus, "Wire"):
//   MPU VCC -> 3V3, GND -> GND, SDA -> GPIO 8,  SCL -> GPIO 9
//   Knop speler 1: GPIO 4 en GND
// Speler 2 (tweede I2C-bus, "Wire1"):
//   MPU VCC -> 3V3, GND -> GND, SDA -> GPIO 10, SCL -> GPIO 11
//   Knop speler 2: GPIO 5 en GND
// Beide sensoren mogen dezelfde 3V3 en GND delen.
//
// Bibliotheek: "MPU6050_light" van rfetick
//
// Stuurt 50 keer per seconde twee regels JSON, één per speler:
//   {"p":1,"x":12.3,"y":-4.1,"z":87.0,"shake":0,"btn":0}
//   {"p":2,"x":-3.0,"y":8.2,"z":10.5,"shake":0,"btn":1}
// Is een sensor niet gevonden, dan stuurt de ESP voor die speler een foutmelding
// en blijft de andere speler gewoon werken.

#include <Wire.h>
#include <MPU6050_light.h>

const int SDA1 = 8,  SCL1 = 9,  BTN1 = 4;
const int SDA2 = 10, SCL2 = 11, BTN2 = 5;

// Lange kabels? Zet dit lager (bv. 50000) als de data hapert.
const uint32_t I2C_SPEED = 100000;
const float SHAKE_THRESHOLD = 1.8;

MPU6050 mpu1(Wire);
MPU6050 mpu2(Wire1);
bool ok1 = false, ok2 = false;
unsigned long lastSend = 0, lastRetry = 0;

bool startSensor(MPU6050 &mpu, int player) {
  byte status = mpu.begin();
  if (status != 0) {
    Serial.print("{\"error\":\"MPU speler "); Serial.print(player);
    Serial.print(" niet gevonden, status "); Serial.print(status); Serial.println("\"}");
    return false;
  }
  return true;
}

void sendPlayer(MPU6050 &mpu, int player, int btnPin) {
  float ax = mpu.getAccX(), ay = mpu.getAccY(), az = mpu.getAccZ();
  int shake = sqrt(ax * ax + ay * ay + az * az) > SHAKE_THRESHOLD ? 1 : 0;
  int btn = digitalRead(btnPin) == LOW ? 1 : 0;
  Serial.print("{\"p\":");     Serial.print(player);
  Serial.print(",\"x\":");     Serial.print(mpu.getAngleX(), 1);
  Serial.print(",\"y\":");     Serial.print(mpu.getAngleY(), 1);
  Serial.print(",\"z\":");     Serial.print(mpu.getAngleZ(), 1);
  Serial.print(",\"shake\":"); Serial.print(shake);
  Serial.print(",\"btn\":");   Serial.print(btn);
  Serial.println("}");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(BTN1, INPUT_PULLUP);
  pinMode(BTN2, INPUT_PULLUP);

  Wire.begin(SDA1, SCL1);  Wire.setClock(I2C_SPEED);
  Wire1.begin(SDA2, SCL2); Wire1.setClock(I2C_SPEED);

  ok1 = startSensor(mpu1, 1);
  ok2 = startSensor(mpu2, 2);

  // Leg beide sensoren STIL en PLAT neer.
  Serial.println("{\"info\":\"kalibreren, sensoren stil houden\"}");
  delay(1000);
  if (ok1) mpu1.calcOffsets();
  if (ok2) mpu2.calcOffsets();
  Serial.println("{\"info\":\"klaar\"}");
}

void loop() {
  if (ok1) mpu1.update();
  if (ok2) mpu2.update();

  // Ontbrekende sensor? Elke 2 seconden opnieuw proberen.
  if ((!ok1 || !ok2) && millis() - lastRetry > 2000) {
    lastRetry = millis();
    if (!ok1 && (ok1 = startSensor(mpu1, 1))) mpu1.calcOffsets();
    if (!ok2 && (ok2 = startSensor(mpu2, 2))) mpu2.calcOffsets();
  }

  if (millis() - lastSend < 20) return;  // 50 keer per seconde
  lastSend = millis();
  if (ok1) sendPlayer(mpu1, 1, BTN1);
  if (ok2) sendPlayer(mpu2, 2, BTN2);
}
