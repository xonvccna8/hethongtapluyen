// 07 · GAME PHẢN XẠ — test 4 nút + 4 LED (theo RehabBoard_Ket_noi.pdf)
//   BUTTON1 GPIO45   BUTTON2 GPIO0   BUTTON3 GPIO35   BUTTON4 GPIO36  (nút <-> GND)
//   LED1    GPIO20   LED2    GPIO21  LED3    GPIO47   LED4    GPIO48  (GPIO -> điện trở -> LED -> GND)
//
// Cách test:
//   1. Khởi động: 4 LED sáng lần lượt LED1 -> LED4 (mỗi LED 0,5 s), lặp 2 vòng.
//      LED nào không sáng đúng lượt -> kiểm tra dây / chiều LED / điện trở của LED đó.
//   2. Sau đó: giữ BUTTON n -> LED n sáng, Serial in "BUTTON n NHAN".
//      Nhấn nút này mà LED khác sáng -> dây nút hoặc LED bị đổi chỗ.
//
// Lưu ý phần cứng:
//   - GPIO0 (BUTTON2): đừng giữ nút lúc cấp điện/reset, board sẽ vào chế độ nạp code.
//   - GPIO45 (BUTTON1): nút phải nối xuống GND, không nối lên 3V3.
//   - GPIO20 (LED1) là chân USB D+ gốc: đừng cắm cáp vào cổng USB native của board khi chạy.

const int NUM = 4;
const int BTN[NUM] = {45, 0, 35, 36};
const int LED[NUM] = {20, 21, 47, 48};

// Đổi thành LOW nếu LED nối kiểu GPIO kéo xuống (anode lên 3V3)
const int LED_ON  = HIGH;
const int LED_OFF = (LED_ON == HIGH) ? LOW : HIGH;

int lastBtn[NUM] = {HIGH, HIGH, HIGH, HIGH};

void allLeds(int level) {
  for (int i = 0; i < NUM; i++) digitalWrite(LED[i], level);
}

void setup() {
  Serial.begin(115200);

  for (int i = 0; i < NUM; i++) {
    pinMode(BTN[i], INPUT_PULLUP);
    digitalWrite(LED[i], LED_OFF);
    pinMode(LED[i], OUTPUT);
    digitalWrite(LED[i], LED_OFF);
  }

  delay(300);
  Serial.println("=== TEST GAME PHAN XA: 4 nut + 4 LED ===");
  Serial.println("Buoc 1: LED sang lan luot LED1 -> LED4 (2 vong)");

  for (int round = 0; round < 2; round++) {
    for (int i = 0; i < NUM; i++) {
      allLeds(LED_OFF);
      digitalWrite(LED[i], LED_ON);
      Serial.printf("  LED%d (GPIO%d) SANG\n", i + 1, LED[i]);
      delay(500);
    }
  }
  allLeds(LED_OFF);

  Serial.println("Buoc 2: giu BUTTON n -> LED n sang");
}

void loop() {
  for (int i = 0; i < NUM; i++) {
    int v = digitalRead(BTN[i]);
    if (v != lastBtn[i]) {
      lastBtn[i] = v;
      bool pressed = (v == LOW);
      digitalWrite(LED[i], pressed ? LED_ON : LED_OFF);
      Serial.printf("BUTTON%d (GPIO%d) %s -> LED%d (GPIO%d) %s\n",
                    i + 1, BTN[i], pressed ? "NHAN" : "tha",
                    i + 1, LED[i], pressed ? "SANG" : "tat");
      delay(15);  // chống dội
    }
  }
}
