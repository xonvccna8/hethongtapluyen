// REHABBOARD AI — TEST TỔNG HỢP TẤT CẢ MÔ-ĐUN (theo RehabBoard_Ket_noi.pdf)
//
//   01 Nhấn từng ngón + Bóp tay : 6 HX711, SCK GPIO5, DT (phím 1..5, bóp tay) = 16/7/15/6/17/18
//   02 TFT ILI9341 (320x240 ngang): CS 37, RST 38, DC 39, MOSI 40, SCK 41, MISO 42
//   03 Xoay núm (encoder)       : CLK 13, DT 12, SW 11
//   04 Thanh trượt (biến trở)   : SIG GPIO9
//   05 Còi                      : IN GPIO19 (kích mức THẤP — đã test trên board)
//   06 Bảng 9 nút               : chung GPIO10 (9 nút nối song song)
//   07 Game phục hồi            : nút 45/0/35/36, LED 20/21/47/48
//   (Kẹp ngón trên poster chưa có trong sơ đồ nối dây nên chưa test ở đây.)
//
// Màn hình hiện trực tiếp mọi mô-đun; Serial 115200 in 1 dòng tổng hợp mỗi 0,3 s + sự kiện.
//   - Nhấn núm encoder      : đưa vị trí về 0
//   - GIỮ núm encoder 2 giây: đặt 0 lại cho 6 load cell (không chạm load cell lúc đó)
//   - Nhấn 1 trong 9 nút    : còi kêu
//   - Nhấn nút game n       : LED n sáng
//
// Thư viện: Adafruit ILI9341, Adafruit GFX, U8g2_for_Adafruit_GFX

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <U8g2_for_Adafruit_GFX.h>

// ---------------- Chân ----------------
const int HX_SCK = 5;
const int NUM_CELLS = 6;
// THỨ TỰ DÂY THỰC TẾ (test trên board 05/11/2026) khác sơ đồ PDF:
//   Phím 1 -> DT GPIO16, Phím 2 -> GPIO7, Phím 3 -> GPIO15, Phím 4 -> DT GPIO6
//   (sơ đồ ghi Phím 1 = GPIO6, Phím 4 = GPIO16 -> phím 1 và 4 bị đổi dây). Code theo dây thực tế.
//   Phím 5 (GPIO17): HX711 #5 có trả dữ liệu nhưng nhấn phím không đổi số -> lỗi load cell / dây E+,E-,A+,A- / cơ khí.
const int HX_DT[NUM_CELLS] = {16, 7, 15, 6, 17, 18};
const char* CELL_LABEL[NUM_CELLS] = {"N1", "N2", "N3", "N4", "N5", "BOP"};

const int TFT_CS = 37, TFT_RST = 38, TFT_DC = 39, TFT_MOSI = 40, TFT_SCK = 41, TFT_MISO = 42;
const int ENC_CLK = 13, ENC_DT = 12, ENC_SW = 11;
const int POT_PIN = 9;
const int BUZZER_PIN = 19;
const int S1_PIN = 10;

const int NUM_GAME = 4;
const int GAME_BTN[NUM_GAME] = {45, 0, 35, 36};
const int GAME_LED[NUM_GAME] = {20, 21, 47, 48};
const uint16_t GAME_COLOR[NUM_GAME] = {ILI9341_YELLOW, ILI9341_BLUE, ILI9341_RED, ILI9341_GREEN};

// ---------------- Cấu hình ----------------
const int BUZZER_ON = LOW;  // còi trên board kích mức thấp
const int BUZZER_OFF = HIGH;
const int LED_ON = HIGH;
const int LED_OFF = LOW;

// Số đếm HX711 ứng với thanh đầy. Ngón ấn nhẹ hơn bóp tay nhiều (đo trên board: ngón ~5-7k, bóp tay ~70k)
const long FORCE_FULL_SCALE[6] = {10000, 10000, 10000, 10000, 10000, 60000};
const unsigned long HX_WARMUP_MS = 2000;
const int HX_TARE_SAMPLES = 10;

// ---------------- Màn hình 320x240 ----------------
// Màn này là loại 320x240 ngang sẵn (kiểu ILI9342) — báo đúng kích thước cho thư viện.
class TFT_320x240 : public Adafruit_ILI9341 {
public:
  using Adafruit_ILI9341::Adafruit_ILI9341;
  void setRotation(uint8_t m) override {
    Adafruit_ILI9341::setRotation(m);
    if (m % 2 == 0) { _width = 320; _height = 240; }
    else            { _width = 240; _height = 320; }
  }
};

// SPI phần cứng trên đúng các chân của sơ đồ (nhanh hơn nhiều so với SPI mềm)
SPIClass tftSPI(FSPI);
TFT_320x240 tft(&tftSPI, TFT_DC, TFT_CS, TFT_RST);
U8G2_FOR_ADAFRUIT_GFX u8g2;

const uint16_t C_BG = ILI9341_BLACK;
const uint16_t C_DIM = 0x4208;    // xám tối
const uint16_t C_TEXT = ILI9341_WHITE;
const uint16_t C_HEAD = 0x07FF;   // xanh ngọc

// ---------------- Trạng thái ----------------
bool cellPresent[NUM_CELLS];
long zeroOffset[NUM_CELLS];
long cellDelta[NUM_CELLS];        // số đếm đã trừ 0
unsigned long lastHxRead = 0;
unsigned long hxSamples = 0;

// Encoder đọc bằng ngắt để màn hình vẽ không làm sót nấc
const int8_t ENC_TABLE[16] = {0, 1, -1, 0, -1, 0, 0, 1, 1, 0, 0, -1, 0, -1, 1, 0};
volatile uint8_t encState = 0;
volatile int encQuarter = 0;
volatile long encPos = 0;

int swStable = HIGH, swLastRead = HIGH;
unsigned long swChangeMs = 0, swPressMs = 0;
bool swHoldDone = false;

int s1State = HIGH;
unsigned long s1ChangeMs = 0;
unsigned long s1Count = 0;

int gameState[NUM_GAME] = {HIGH, HIGH, HIGH, HIGH};
unsigned long gameChangeMs[NUM_GAME] = {0, 0, 0, 0};
unsigned long gameCount[NUM_GAME] = {0, 0, 0, 0};

int potRaw = 0;

// ---------------- Encoder ----------------
void IRAM_ATTR encoderISR() {
  uint8_t s = (digitalRead(ENC_CLK) << 1) | digitalRead(ENC_DT);
  encQuarter += ENC_TABLE[(encState << 2) | s];
  encState = s;
  if (encQuarter >= 4) { encPos++; encQuarter = 0; }
  else if (encQuarter <= -4) { encPos--; encQuarter = 0; }
}

long readEncoder() {
  noInterrupts();
  long p = encPos;
  interrupts();
  return p;
}

void resetEncoder() {
  noInterrupts();
  encPos = 0;
  encQuarter = 0;
  interrupts();
}

// ---------------- HX711 (6 mô-đun chung SCK, đọc đồng thời) ----------------
int presentCount() {
  int n = 0;
  for (int i = 0; i < NUM_CELLS; i++) n += cellPresent[i];
  return n;
}

bool allPresentReady() {
  bool any = false;
  for (int i = 0; i < NUM_CELLS; i++) {
    if (!cellPresent[i]) continue;
    any = true;
    if (digitalRead(HX_DT[i]) == HIGH) return false;
  }
  return any;
}

void hxReadRaw(long out[NUM_CELLS]) {
  uint32_t raw[NUM_CELLS] = {0, 0, 0, 0, 0, 0};
  for (int bit = 0; bit < 24; bit++) {
    digitalWrite(HX_SCK, HIGH);
    delayMicroseconds(1);
    for (int i = 0; i < NUM_CELLS; i++) raw[i] = (raw[i] << 1) | digitalRead(HX_DT[i]);
    digitalWrite(HX_SCK, LOW);
    delayMicroseconds(1);
  }
  // Xung thứ 25: kênh A, gain 128
  digitalWrite(HX_SCK, HIGH);
  delayMicroseconds(1);
  digitalWrite(HX_SCK, LOW);
  delayMicroseconds(1);
  for (int i = 0; i < NUM_CELLS; i++) {
    int32_t v = raw[i];
    if (raw[i] & 0x800000UL) v -= 0x1000000L;
    out[i] = v;
  }
}

// Chờ có mẫu (tối đa timeoutMs). -> true nếu đọc được
bool hxReadBlocking(long out[NUM_CELLS], unsigned long timeoutMs) {
  unsigned long t0 = millis();
  while (!allPresentReady()) {
    if (millis() - t0 > timeoutMs) return false;
    delay(1);
  }
  hxReadRaw(out);
  return true;
}

void hxDetectAndWarmup() {
  // HX711 có DOUT đẩy-kéo; thiếu mô-đun thì chân DT nằm ở mức cao nhờ kéo lên -> coi là vắng
  for (int i = 0; i < NUM_CELLS; i++) cellPresent[i] = false;
  unsigned long t0 = millis();
  while (millis() - t0 < 600) {
    for (int i = 0; i < NUM_CELLS; i++)
      if (digitalRead(HX_DT[i]) == LOW) cellPresent[i] = true;
  }
  // Bỏ các mẫu đầu cho HX711 ổn định (HX711 #5 cần lâu hơn — đã đo trên board)
  long raw[NUM_CELLS];
  t0 = millis();
  while (millis() - t0 < HX_WARMUP_MS) hxReadBlocking(raw, 300);
}

void hxTare() {
  long raw[NUM_CELLS];
  long long sum[NUM_CELLS] = {0, 0, 0, 0, 0, 0};
  int n = 0;
  unsigned long t0 = millis();
  while (n < HX_TARE_SAMPLES && millis() - t0 < 4000) {
    if (hxReadBlocking(raw, 500)) {
      for (int i = 0; i < NUM_CELLS; i++) sum[i] += raw[i];
      n++;
    }
  }
  for (int i = 0; i < NUM_CELLS; i++) {
    zeroOffset[i] = n ? (long)(sum[i] / n) : 0;
    cellDelta[i] = 0;
  }
  lastHxRead = millis();
}

void hxUpdate() {
  if (!presentCount()) return;
  if (allPresentReady()) {
    long raw[NUM_CELLS];
    hxReadRaw(raw);
    for (int i = 0; i < NUM_CELLS; i++) cellDelta[i] = cellPresent[i] ? raw[i] - zeroOffset[i] : 0;
    lastHxRead = millis();
    hxSamples++;
  } else if (millis() - lastHxRead > 1500) {
    // Có mô-đun ngừng trả dữ liệu: loại ra để các kênh còn lại vẫn chạy
    for (int i = 0; i < NUM_CELLS; i++) {
      if (cellPresent[i] && digitalRead(HX_DT[i]) == HIGH) {
        cellPresent[i] = false;
        Serial.printf("[LOI] HX711 %s (DT GPIO%d) ngung tra du lieu - kiem tra day\n", CELL_LABEL[i], HX_DT[i]);
      }
    }
    lastHxRead = millis();
  }
}

// ---------------- Màn hình ----------------
// Khung vỏ che mép trên ~8 px và mép phải ~25 px (đo từ ảnh chụp board) -> chỉ vẽ trong vùng nhìn thấy
const int SAFE_W = 292;
const int ROW_Y0 = 42, ROW_DY = 18;
const int BAR_X = 30, BAR_W = 96, BAR_H = 12;
const int VAL_X = 130;            // cột số bên phải thanh
const int COL2_X = 186;           // cột phải (xoay núm, 9 nút)
const int GAME_W = 68, GAME_DX = 72;
int lastBarW[NUM_CELLS + 1];  // +1: thanh trượt
uint16_t lastBarColor[NUM_CELLS + 1];

void textAt(int x, int y, const char* s, uint16_t fg, uint8_t size = 1) {
  tft.setTextSize(size);
  tft.setTextColor(fg, C_BG);  // có nền -> ghi đè chữ cũ, không nháy
  tft.setCursor(x, y);
  tft.print(s);
}

void drawBar(int idx, int x, int y, int w, long value, long full) {
  long a = value < 0 ? -value : value;
  int fill = (int)((a * w) / full);
  if (fill > w) fill = w;
  uint16_t color = fill < w / 2 ? ILI9341_GREEN : (fill < w * 4 / 5 ? ILI9341_YELLOW : ILI9341_RED);
  if (color != lastBarColor[idx]) {
    if (fill) tft.fillRect(x, y, fill, BAR_H, color);
    lastBarColor[idx] = color;
  } else if (fill > lastBarW[idx]) {
    tft.fillRect(x + lastBarW[idx], y, fill - lastBarW[idx], BAR_H, color);
  }
  if (fill < lastBarW[idx]) tft.fillRect(x + fill, y, lastBarW[idx] - fill, BAR_H, C_DIM);
  lastBarW[idx] = fill;
}

void drawTitle(const char* subtitle) {
  tft.fillRect(0, 0, 320, 26, C_BG);
  u8g2.setForegroundColor(C_HEAD);
  u8g2.setBackgroundColor(C_BG);
  const char* title = "REHABBOARD AI · KIỂM TRA TỔNG THỂ";
  u8g2.setCursor((SAFE_W - u8g2.getUTF8Width(title)) / 2, 23);
  u8g2.print(title);
  tft.drawFastHLine(0, 26, SAFE_W, C_DIM);
  if (subtitle) {
    tft.fillRect(0, 110, 320, 24, C_BG);
    u8g2.setForegroundColor(ILI9341_YELLOW);
    u8g2.setCursor((SAFE_W - u8g2.getUTF8Width(subtitle)) / 2, 128);
    u8g2.print(subtitle);
  }
}

void drawStaticLayout() {
  tft.fillScreen(C_BG);
  drawTitle(nullptr);

  textAt(4, 30, "1-2 NHAN NGON / BOP TAY", C_HEAD);
  for (int i = 0; i < NUM_CELLS; i++) {
    int y = ROW_Y0 + i * ROW_DY;
    textAt(4, y + 2, CELL_LABEL[i], C_TEXT);
    tft.fillRect(BAR_X, y, BAR_W, BAR_H, C_DIM);
    lastBarW[i] = 0;
    lastBarColor[i] = 0;
  }

  int ys = ROW_Y0 + NUM_CELLS * ROW_DY + 2;  // 150
  textAt(4, ys, "5 THANH TRUOT", C_HEAD);
  tft.fillRect(BAR_X, ys + 12, BAR_W, BAR_H, C_DIM);
  lastBarW[NUM_CELLS] = 0;
  lastBarColor[NUM_CELLS] = 0;

  tft.drawFastVLine(COL2_X - 6, 28, 152, C_DIM);
  textAt(COL2_X, 30, "4 XOAY NUM", C_HEAD);
  textAt(COL2_X, 88, "9 NUT + COI", C_HEAD);
  textAt(COL2_X, 136, "GIU NUM 2s=DAT 0", C_DIM);

  tft.drawFastHLine(0, 180, SAFE_W, C_DIM);
  textAt(4, 184, "6 GAME PHUC HOI (nut -> LED)", C_HEAD);
  for (int i = 0; i < NUM_GAME; i++) tft.drawRect(4 + i * GAME_DX, 196, GAME_W, 40, GAME_COLOR[i]);
}

// Giá trị lần vẽ trước, chỉ vẽ lại khi đổi
long shownForce[NUM_CELLS];
bool shownPresent[NUM_CELLS];
long shownEnc = LONG_MIN;
int shownSw = -1, shownS1 = -1, shownPot = -1, shownHx = -1;
int shownGame[NUM_GAME] = {-1, -1, -1, -1};

void resetShown() {
  for (int i = 0; i < NUM_CELLS; i++) { shownForce[i] = LONG_MIN; shownPresent[i] = !cellPresent[i]; }
  shownEnc = LONG_MIN;
  shownSw = shownS1 = shownPot = shownHx = -1;
  for (int i = 0; i < NUM_GAME; i++) shownGame[i] = -1;
}

void updateDisplay() {
  char buf[24];

  for (int i = 0; i < NUM_CELLS; i++) {
    int y = ROW_Y0 + i * ROW_DY;
    if (cellPresent[i] != shownPresent[i]) {
      shownPresent[i] = cellPresent[i];
      shownForce[i] = LONG_MIN;
      if (!cellPresent[i]) {
        tft.fillRect(BAR_X, y, BAR_W, BAR_H, C_DIM);
        lastBarW[i] = 0;
        textAt(BAR_X + 4, y + 2, "KHONG CO HX", ILI9341_RED);
        textAt(VAL_X, y + 2, "  ---  ", ILI9341_RED);
      } else {
        tft.fillRect(BAR_X, y, BAR_W, BAR_H, C_DIM);
        lastBarW[i] = 0;
        lastBarColor[i] = 0;
      }
    }
    if (!cellPresent[i]) continue;
    long shown = cellDelta[i] / 100;  // 0,1 nghìn số đếm
    if (shown != shownForce[i]) {
      shownForce[i] = shown;
      drawBar(i, BAR_X, y, BAR_W, cellDelta[i], FORCE_FULL_SCALE[i]);
      snprintf(buf, sizeof(buf), "%6.1fk", cellDelta[i] / 1000.0f);
      textAt(VAL_X, y + 2, buf, C_TEXT);
    }
  }

  if (shownPot < 0 || abs(potRaw - shownPot) > 15) {
    shownPot = potRaw;
    int ys = ROW_Y0 + NUM_CELLS * ROW_DY + 2;
    drawBar(NUM_CELLS, BAR_X, ys + 12, BAR_W, potRaw, 4095);
    snprintf(buf, sizeof(buf), "%3d%%  ", potRaw * 100 / 4095);  // vừa cột số; giá trị ADC đầy đủ ở Serial
    textAt(VAL_X, ys + 14, buf, C_TEXT);
  }

  long enc = readEncoder();
  if (enc != shownEnc) {
    shownEnc = enc;
    snprintf(buf, sizeof(buf), "%5ld", enc);
    textAt(COL2_X + 6, 46, buf, ILI9341_WHITE, 3);
  }
  if (swStable != shownSw) {
    shownSw = swStable;
    textAt(COL2_X, 74, swStable == LOW ? "NUT NUM: NHAN" : "NUT NUM: tha ", swStable == LOW ? ILI9341_GREEN : C_TEXT);
  }

  if (s1State != shownS1) {
    shownS1 = s1State;
    bool p = (s1State == LOW);
    tft.fillRect(COL2_X, 100, SAFE_W - COL2_X - 2, 22, p ? ILI9341_GREEN : C_DIM);
    tft.setTextSize(2);
    tft.setTextColor(p ? ILI9341_BLACK : C_TEXT);
    tft.setCursor(p ? COL2_X + 4 : COL2_X + 32, 104);
    tft.print(p ? "NHAN+COI" : "THA");
  }
  int hx = presentCount();
  if (hx != shownHx) {
    shownHx = hx;
    snprintf(buf, sizeof(buf), "HX711: %d/6 OK ", hx);
    textAt(COL2_X, 152, buf, hx == NUM_CELLS ? ILI9341_GREEN : ILI9341_RED);
  }

  for (int i = 0; i < NUM_GAME; i++) {
    if (gameState[i] == shownGame[i]) continue;
    shownGame[i] = gameState[i];
    bool p = (gameState[i] == LOW);
    int x = 4 + i * GAME_DX;
    tft.fillRect(x + 1, 197, GAME_W - 2, 38, p ? GAME_COLOR[i] : C_BG);
    tft.setTextSize(1);
    tft.setTextColor(p ? ILI9341_BLACK : GAME_COLOR[i]);
    tft.setCursor(x + 5, 205);
    tft.printf("NUT %d", i + 1);
    tft.setCursor(x + 5, 220);
    tft.printf("LED%d %s", i + 1, p ? "SANG" : "tat ");
  }
}

// ---------------- Nút ----------------
bool debounce(int pin, int& stable, unsigned long& changeMs) {
  int v = digitalRead(pin);
  if (v != stable && millis() - changeMs > 25) {
    stable = v;
    changeMs = millis();
    return true;
  }
  return false;
}

void runTare() {
  Serial.println("[DAT 0] Dang dat 0 cho load cell - khong cham...");
  drawTitle("ĐANG ĐẶT 0 LOAD CELL — KHÔNG CHẠM");
  hxTare();
  drawStaticLayout();
  resetShown();
  Serial.println("[DAT 0] Xong");
}

void handleButtons() {
  // Núm encoder: nhấn = về 0, giữ 2 s = đặt 0 load cell
  int r = digitalRead(ENC_SW);
  if (r != swLastRead) { swLastRead = r; swChangeMs = millis(); }
  if (millis() - swChangeMs > 30 && r != swStable) {
    swStable = r;
    if (r == LOW) {
      swPressMs = millis();
      swHoldDone = false;
      resetEncoder();
      Serial.println("[NUM] Nhan nut - vi tri ve 0");
    }
  }
  if (swStable == LOW && !swHoldDone && millis() - swPressMs > 2000) {
    swHoldDone = true;
    runTare();
  }

  // 9 nút (chung GPIO10) -> còi
  if (debounce(S1_PIN, s1State, s1ChangeMs)) {
    bool p = (s1State == LOW);
    digitalWrite(BUZZER_PIN, p ? BUZZER_ON : BUZZER_OFF);
    if (p) s1Count++;
    Serial.printf("[9 NUT] %s (lan %lu) - coi %s\n", p ? "NHAN" : "tha", s1Count, p ? "KEU" : "tat");
  }

  // Game: nút n -> LED n
  for (int i = 0; i < NUM_GAME; i++) {
    if (debounce(GAME_BTN[i], gameState[i], gameChangeMs[i])) {
      bool p = (gameState[i] == LOW);
      digitalWrite(GAME_LED[i], p ? LED_ON : LED_OFF);
      if (p) gameCount[i]++;
      Serial.printf("[GAME] NUT %d (GPIO%d) %s -> LED %d (GPIO%d) %s\n", i + 1, GAME_BTN[i],
                    p ? "NHAN" : "tha", i + 1, GAME_LED[i], p ? "SANG" : "tat");
    }
  }
}

// ---------------- Serial tổng hợp ----------------
void printSummary() {
  Serial.print("LUC(k):");
  for (int i = 0; i < NUM_CELLS; i++) {
    if (cellPresent[i]) Serial.printf(" %s=%.1f", CELL_LABEL[i], cellDelta[i] / 1000.0f);
    else Serial.printf(" %s=--", CELL_LABEL[i]);
  }
  Serial.printf(" | NUM=%ld | TRUOT=%d(%d%%) | 9NUT=%s | GAME=%c%c%c%c\n", readEncoder(), potRaw,
                potRaw * 100 / 4095, s1State == LOW ? "NHAN" : "tha",
                gameState[0] == LOW ? '1' : '.', gameState[1] == LOW ? '2' : '.',
                gameState[2] == LOW ? '3' : '.', gameState[3] == LOW ? '4' : '.');
}

// ---------------- setup / loop ----------------
void setup() {
  Serial.begin(115200);

  // Còi và LED tắt trước tiên
  digitalWrite(BUZZER_PIN, BUZZER_OFF);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, BUZZER_OFF);
  for (int i = 0; i < NUM_GAME; i++) {
    digitalWrite(GAME_LED[i], LED_OFF);
    pinMode(GAME_LED[i], OUTPUT);
    digitalWrite(GAME_LED[i], LED_OFF);
    pinMode(GAME_BTN[i], INPUT_PULLUP);
  }
  pinMode(S1_PIN, INPUT_PULLUP);
  pinMode(ENC_CLK, INPUT_PULLUP);
  pinMode(ENC_DT, INPUT_PULLUP);
  pinMode(ENC_SW, INPUT_PULLUP);
  pinMode(HX_SCK, OUTPUT);
  digitalWrite(HX_SCK, LOW);
  for (int i = 0; i < NUM_CELLS; i++) pinMode(HX_DT[i], INPUT_PULLUP);
  analogReadResolution(12);

  // Màn hình
  tftSPI.begin(TFT_SCK, TFT_MISO, TFT_MOSI, TFT_CS);
  tft.begin();
  tft.setRotation(0);
  tft.fillScreen(C_BG);
  u8g2.begin(tft);
  u8g2.setFontMode(0);
  u8g2.setFontDirection(0);
  u8g2.setFont(u8g2_font_unifont_t_vietnamese1);

  Serial.println();
  Serial.println("=== REHABBOARD AI - TEST TONG HOP ===");
  Serial.println("Khoi dong: LED chay lan luot + coi bip, roi dat 0 load cell (KHONG CHAM)");
  drawTitle("ĐANG KHỞI ĐỘNG — KHÔNG CHẠM LOAD CELL");

  // Tự kiểm: LED chạy lần lượt + còi bíp ngắn
  for (int i = 0; i < NUM_GAME; i++) {
    digitalWrite(GAME_LED[i], LED_ON);
    delay(250);
    digitalWrite(GAME_LED[i], LED_OFF);
  }
  digitalWrite(BUZZER_PIN, BUZZER_ON);
  delay(120);
  digitalWrite(BUZZER_PIN, BUZZER_OFF);

  // Load cell: dò mô-đun, bỏ mẫu đầu, đặt 0
  hxDetectAndWarmup();
  hxTare();
  Serial.printf("HX711 tim thay: %d/6 ->", presentCount());
  for (int i = 0; i < NUM_CELLS; i++)
    Serial.printf(" %s(GPIO%d)=%s", CELL_LABEL[i], HX_DT[i], cellPresent[i] ? "OK" : "KHONG CO");
  Serial.println();

  // Encoder bằng ngắt
  encState = (digitalRead(ENC_CLK) << 1) | digitalRead(ENC_DT);
  attachInterrupt(digitalPinToInterrupt(ENC_CLK), encoderISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_DT), encoderISR, CHANGE);

  drawStaticLayout();
  resetShown();
  Serial.println("San sang. Nhan / xoay / bop / keo tung mo-dun de kiem tra.");
}

unsigned long lastPotMs = 0, lastDrawMs = 0, lastPrintMs = 0;

void loop() {
  handleButtons();
  hxUpdate();

  if (millis() - lastPotMs >= 30) {
    lastPotMs = millis();
    potRaw = (potRaw * 3 + analogRead(POT_PIN)) / 4;  // lọc nhẹ cho đỡ rung số
  }
  if (millis() - lastDrawMs >= 80) {
    lastDrawMs = millis();
    updateDisplay();
  }
  if (millis() - lastPrintMs >= 300) {
    lastPrintMs = millis();
    printSummary();
  }
}
