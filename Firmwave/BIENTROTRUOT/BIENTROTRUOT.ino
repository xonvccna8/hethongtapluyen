// 04 · BIẾN TRỞ TRƯỢT (theo RehabBoard_Ket_noi.pdf)
//   Chân giữa (con trượt) -> SIG -> GPIO9 (ADC1), hai đầu cố định -> 3V3 / GND

const int potPin = 9;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);  // Giá trị ADC từ 0 đến 4095
}

void loop() {
  int value = analogRead(potPin);

  Serial.print("Gia tri ADC: ");
  Serial.println(value);

  delay(100);
}