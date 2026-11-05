// 03 · ENCODER XOAY (theo RehabBoard_Ket_noi.pdf)
//   CLK -> GPIO13, DT -> GPIO12, SW -> GPIO11, VCC -> 3V3, GND chung
//   Sơ đồ ghi "cần kéo lên nếu mô-đun chưa có" -> dùng INPUT_PULLUP
//   (mô-đun KY-040 thường không có điện trở kéo lên cho chân SW)

const int PIN_CLK = 13;
const int PIN_DT  = 12;
const int PIN_SW  = 11;

// Bảng giải mã chuyển trạng thái của encoder
const int8_t transitionTable[16] = {
   0,  1, -1,  0,
  -1,  0,  0,  1,
   1,  0,  0, -1,
   0, -1,  1,  0
};

uint8_t lastEncoderState;
int quarterSteps = 0;
long encoderPosition = 0;

int lastButtonReading = HIGH;
int stableButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long debounceMs = 30;

void setup() {
  Serial.begin(115200);

  pinMode(PIN_CLK, INPUT_PULLUP);
  pinMode(PIN_DT,  INPUT_PULLUP);
  pinMode(PIN_SW,  INPUT_PULLUP);

  lastEncoderState =
    (digitalRead(PIN_CLK) << 1) | digitalRead(PIN_DT);

  Serial.println("Encoder ready");
}

void loop() {
  // Đọc encoder xoay
  uint8_t currentState =
    (digitalRead(PIN_CLK) << 1) | digitalRead(PIN_DT);

  if (currentState != lastEncoderState) {
    uint8_t index = (lastEncoderState << 2) | currentState;
    quarterSteps += transitionTable[index];
    lastEncoderState = currentState;

    // Thường encoder có 4 chuyển trạng thái cho mỗi nấc
    if (quarterSteps >= 4) {
      encoderPosition++;
      quarterSteps = 0;
      Serial.print("Vi tri: ");
      Serial.println(encoderPosition);
    } else if (quarterSteps <= -4) {
      encoderPosition--;
      quarterSteps = 0;
      Serial.print("Vi tri: ");
      Serial.println(encoderPosition);
    }
  }

  // Đọc nút SW, chống dội
  int buttonReading = digitalRead(PIN_SW);

  if (buttonReading != lastButtonReading) {
    lastDebounceTime = millis();
    lastButtonReading = buttonReading;
  }

  if (millis() - lastDebounceTime > debounceMs &&
      buttonReading != stableButtonState) {
    stableButtonState = buttonReading;

    if (stableButtonState == LOW) {
      encoderPosition = 0;
      quarterSteps = 0;
      Serial.println("Da nhan nut - dua vi tri ve 0");
    }
  }
}
// void setup() {
//   Serial.begin(115200);

//   pinMode(13, INPUT_PULLUP);  // CLK
//   pinMode(12, INPUT_PULLUP);  // DT
//   pinMode(11, INPUT_PULLUP);  // SW
// }

// void loop() {
//   Serial.print("CLK=");
//   Serial.print(digitalRead(13));
//   Serial.print(" DT=");
//   Serial.print(digitalRead(12));
//   Serial.print(" SW=");
//   Serial.println(digitalRead(11));

//   delay(250);
// }