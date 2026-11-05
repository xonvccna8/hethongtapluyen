// 01 · ĐO LỰC — thử riêng 1 load cell (theo RehabBoard_Ket_noi.pdf)
//   Mặc định: LC6 Bóp tay -> HX711 #6, DT GPIO18, SCK GPIO5 (khớp sơ đồ)
//   Muốn thử ô khác, đổi HX711_DT theo DÂY THỰC TẾ: Phím1=16, Phím2=7, Phím3=15, Phím4=6, Phím5=17, Bóp tay=18
//   (sơ đồ PDF ghi Phím1=6, Phím4=16 nhưng trên board hai dây này bị đổi chỗ)
//   Cần thư viện "HX711" (bogde)

#include "HX711.h"

const int HX711_DT  = 18;
const int HX711_SCK = 5;

HX711 scale;

void setup() {
  Serial.begin(115200);
  scale.begin(HX711_DT, HX711_SCK);

  Serial.println("Doc HX711...");
}

void loop() {
  if (scale.is_ready()) {
    long rawValue = scale.read();
    Serial.print("Gia tri raw: ");
    Serial.println(rawValue);
  } else {
    Serial.println("HX711 chua san sang - kiem tra day DT/SCK va nguon");
  }

  delay(300);
}