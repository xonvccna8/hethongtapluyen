// 01 · ĐO LỰC — 6 LOAD CELL / 6 HX711 (theo RehabBoard_Ket_noi.pdf)
//   Chung SCK  : GPIO5
//   LC1 Ngón 1 : DT GPIO16*   LC4 Ngón 4 : DT GPIO6*    (* đổi theo dây thực tế, xem dưới)
//   LC2 Ngón 2 : DT GPIO7     LC5 Ngón 5 : DT GPIO17
//   LC3 Ngón 3 : DT GPIO15    LC6 Bóp tay: DT GPIO18
//   VCC -> 3V3, GND -> GND

const int HX_SCK = 5;
const int NUM_CELLS = 6;
// THỨ TỰ DÂY THỰC TẾ (test trên board 05/11/2026) khác sơ đồ PDF:
//   Phím 1 -> DT GPIO16, Phím 2 -> GPIO7, Phím 3 -> GPIO15, Phím 4 -> DT GPIO6
//   (sơ đồ ghi Phím 1 = GPIO6, Phím 4 = GPIO16 -> phím 1 và 4 bị đổi dây). Code theo dây thực tế.
//   Phím 5 (GPIO17): HX711 #5 có trả dữ liệu nhưng nhấn phím không đổi số -> lỗi load cell / dây E+,E-,A+,A- / cơ khí.
const int DT[NUM_CELLS] = {16, 7, 15, 6, 17, 18};
const char* CELL_NAME[NUM_CELLS] = {"Ngon1", "Ngon2", "Ngon3", "Ngon4", "Ngon5", "BopTay"};

const int SAMPLES_FOR_ZERO = 10;
const unsigned long WARMUP_MS = 2000;  // bỏ mẫu đầu cho HX711 ổn định

// Thay bằng số count/gram đã hiệu chuẩn riêng cho từng load cell.
// Có thể mang dấu âm nếu số đọc giảm khi lực tăng.
float countsPerGram[NUM_CELLS] = {1, 1, 1, 1, 1, 1};

long zeroOffset[NUM_CELLS] = {0, 0, 0, 0, 0, 0};

// In ra những HX711 chưa sẵn sàng (DT vẫn HIGH) để dễ dò dây
void printNotReady() {
  Serial.print("HX711 chua san sang:");
  for (int i = 0; i < NUM_CELLS; i++) {
    if (digitalRead(DT[i]) == HIGH) {
      Serial.print(' ');
      Serial.print(CELL_NAME[i]);
      Serial.print("(GPIO");
      Serial.print(DT[i]);
      Serial.print(')');
    }
  }
  Serial.println(" - kiem tra day DT/SCK/VCC/GND");
}

// Đọc một mẫu đồng thời từ cả 6 HX711
bool readAll(long result[NUM_CELLS]) {
  unsigned long start = millis();

  // HX711 báo có dữ liệu bằng mức LOW trên DT
  while (true) {
    bool allReady = true;

    for (int i = 0; i < NUM_CELLS; i++) {
      if (digitalRead(DT[i]) == HIGH) {
        allReady = false;
        break;
      }
    }

    if (allReady) break;
    if (millis() - start > 1000) return false;
  }

  uint32_t raw[NUM_CELLS] = {0, 0, 0, 0, 0, 0};

  // Đọc 24 bit từ cả 6 module cùng lúc
  for (int bit = 0; bit < 24; bit++) {
    digitalWrite(HX_SCK, HIGH);
    delayMicroseconds(1);

    for (int i = 0; i < NUM_CELLS; i++) {
      raw[i] = (raw[i] << 1) | digitalRead(DT[i]);
    }

    digitalWrite(HX_SCK, LOW);
    delayMicroseconds(1);
  }

  // Xung thứ 25 chọn kênh A, gain 128 cho mẫu tiếp theo
  digitalWrite(HX_SCK, HIGH);
  delayMicroseconds(1);
  digitalWrite(HX_SCK, LOW);
  delayMicroseconds(1);

  // Chuyển số 24-bit có dấu thành số 32-bit
  for (int i = 0; i < NUM_CELLS; i++) {
    int32_t value = raw[i];
    if (raw[i] & 0x800000UL) {
      value -= 0x1000000L;
    }
    result[i] = value;
  }

  return true;
}

void setup() {
  Serial.begin(115200);

  pinMode(HX_SCK, OUTPUT);
  digitalWrite(HX_SCK, LOW);

  for (int i = 0; i < NUM_CELLS; i++) {
    pinMode(DT[i], INPUT);
  }

  delay(500);  // Chờ HX711 khởi động

  Serial.println("Dang dat 0 cho 6 load cell - khong tac dung luc...");

  long raw[NUM_CELLS];

  // Bỏ các mẫu đầu: khi test trên board, HX711 #5 (Ngón 5) cần vài trăm ms
  // mới ổn định, nếu lấy 0 ngay thì kênh đó bị lệch cả trăm đơn vị.
  unsigned long warmupStart = millis();
  while (millis() - warmupStart < WARMUP_MS) {
    readAll(raw);
  }

  // Đặt các cảm biến về 0; trong lúc này không tác dụng lực
  long sum[NUM_CELLS] = {0, 0, 0, 0, 0, 0};
  int collected = 0;

  while (collected < SAMPLES_FOR_ZERO) {
    if (readAll(raw)) {
      for (int i = 0; i < NUM_CELLS; i++) {
        sum[i] += raw[i];
      }
      collected++;
    } else {
      // Trước đây chỗ này treo im lặng mãi nếu thiếu 1 module
      printNotReady();
    }
  }

  for (int i = 0; i < NUM_CELLS; i++) {
    zeroOffset[i] = sum[i] / SAMPLES_FOR_ZERO;
  }

  // Dòng tiêu đề (Serial Plotter dùng làm tên đường)
  for (int i = 0; i < NUM_CELLS; i++) {
    if (i > 0) Serial.print('\t');
    Serial.print(CELL_NAME[i]);
  }
  Serial.println();
}

void loop() {
  long raw[NUM_CELLS];

  if (readAll(raw)) {
    for (int i = 0; i < NUM_CELLS; i++) {
      float grams = (raw[i] - zeroOffset[i]) / countsPerGram[i];
      float forceN = grams * 0.00980665f;  // gram sang Newton

      if (i > 0) Serial.print('\t');
      Serial.print(forceN, 2);
    }

    Serial.println();
  } else {
    printNotReady();
  }
}
