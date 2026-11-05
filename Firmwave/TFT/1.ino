// 02 · TFT ILI9341 (theo RehabBoard_Ket_noi.pdf)
//   CS 37, RST 38, DC 39, MOSI 40, SCK 41, MISO 42 — khớp sơ đồ
//   Cần thư viện: Adafruit ILI9341, Adafruit GFX, U8g2_for_Adafruit_GFX

#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <U8g2_for_Adafruit_GFX.h>

const int TFT_CS   = 37;
const int TFT_RST  = 38;
const int TFT_DC   = 39;
const int TFT_MOSI = 40;
const int TFT_SCK  = 41;
const int TFT_MISO = 42;

// Màn này là loại 320x240 nằm ngang sẵn (kiểu ILI9342), không phải
// 240x320 dọc như ILI9341. Thư viện ILI9341 mặc định coi rotation 0 là
// 240x320 nên chỉ xóa 240 cột (dải nhiễu bên phải) và canh giữa sai.
// Lớp con này báo đúng kích thước thật cho thư viện.
class TFT_320x240 : public Adafruit_ILI9341 {
public:
  using Adafruit_ILI9341::Adafruit_ILI9341;

  void setRotation(uint8_t m) override {
    Adafruit_ILI9341::setRotation(m);
    if (m % 2 == 0) {
      _width = 320;
      _height = 240;
    } else {
      _width = 240;
      _height = 320;
    }
  }
};

TFT_320x240 tft(
  TFT_CS, TFT_DC, TFT_MOSI, TFT_SCK, TFT_RST, TFT_MISO
);

U8G2_FOR_ADAFRUIT_GFX u8g2;

void setup() {
  tft.begin();
  tft.setRotation(0);  // Màn hình ngang
  tft.fillScreen(ILI9341_BLACK);

  u8g2.begin(tft);
  u8g2.setFontMode(1);
  u8g2.setFontDirection(0); 
  u8g2.setForegroundColor(ILI9341_GREEN);
  u8g2.setFont(u8g2_font_unifont_t_vietnamese1);

  const char* lines[] = {
    "HỆ THỐNG",
    "TẬP LUYỆN PHỤC HỒI",
    "CHỨC NĂNG"
  };

  const int y[] = {85, 125, 165};

  for (int i = 0; i < 3; i++) {
    int x = (tft.width() - u8g2.getUTF8Width(lines[i])) / 2;
    u8g2.setCursor(x, y[i]);
    u8g2.print(lines[i]);
  }
}

void loop() {
}