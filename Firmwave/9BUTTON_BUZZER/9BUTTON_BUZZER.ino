// 05 · NÚT THỬ / BUZZER + 06 · BẢNG 9 NÚT (theo RehabBoard_Ket_noi.pdf)
//   Nút S1 : GPIO10 <-> nút <-> GND
//   Buzzer : IN -> GPIO19  (code cũ dùng GPIO36 — sai sơ đồ)

const int buttonPin = 10;
const int buzzerPin = 19;

// Mô-đun còi trên board là loại KÍCH MỨC THẤP (đã test: LOW = kêu, HIGH = im).
// Nếu thay còi loại kích mức cao thì đổi BUZZER_ON thành HIGH.
const int BUZZER_ON  = LOW;
const int BUZZER_OFF = (BUZZER_ON == HIGH) ? LOW : HIGH;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  digitalWrite(buzzerPin, BUZZER_OFF);  // đặt mức tắt trước để còi không kêu lúc khởi động
  pinMode(buzzerPin, OUTPUT);
  digitalWrite(buzzerPin, BUZZER_OFF);  // Còi tắt ban đầu
}

void loop() {
  bool pressed = (digitalRead(buttonPin) == LOW);

  digitalWrite(buzzerPin, pressed ? BUZZER_ON : BUZZER_OFF);

  delay(10);
}
