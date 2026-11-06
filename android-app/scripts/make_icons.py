"""Tạo icon app Android giống logo trên web: bàn tay ✋ trên nền gradient xanh dương -> xanh lá.

Chạy:  python scripts/make_icons.py   (cần Pillow, font Segoe UI Emoji của Windows)
Ghi đè android/app/src/main/res/mipmap-*/ic_launcher*.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RES = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"
C1, C2 = (0x2F, 0x8C, 0xF0), (0x33, 0xC4, 0x8D)  # .brand-logo trong web/style.css
DENSITY = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
EMOJI_FONT = "C:/Windows/Fonts/seguiemj.ttf"


def gradient(size):
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))  # 135deg
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(C1, C2)) + (255,)
    return img


def hand(size, scale):
    """Ảnh trong suốt cỡ size, emoji ✋ chiếm khoảng scale cạnh."""
    big = 1024
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    font = ImageFont.truetype(EMOJI_FONT, 109)  # font màu chỉ có sẵn ở cỡ 109
    tmp = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((80, 80), "\u270b", font=font, embedded_color=True, anchor="mm")
    box = tmp.getbbox()
    tmp = tmp.crop(box)
    side = round(big * scale)
    w, h = tmp.size
    k = side / max(w, h)
    tmp = tmp.resize((round(w * k), round(h * k)), Image.LANCZOS)
    layer.alpha_composite(tmp, ((big - tmp.width) // 2, (big - tmp.height) // 2))
    return layer.resize((size, size), Image.LANCZOS)


def rounded(img, radius_ratio):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1),
                                           radius=round(img.width * radius_ratio), fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


for name, d in DENSITY.items():
    folder = RES / f"mipmap-{name}"
    legacy, adaptive = round(48 * d), round(108 * d)
    base = gradient(legacy)
    base.alpha_composite(hand(legacy, 0.62))
    rounded(base, 0.22).save(folder / "ic_launcher.png")
    rounded(base, 0.5).save(folder / "ic_launcher_round.png")
    hand(adaptive, 0.40).save(folder / "ic_launcher_foreground.png")  # vùng an toàn adaptive icon: 66/108

# nền adaptive icon: 1 ảnh gradient dùng chung
(RES / "drawable").mkdir(exist_ok=True)
gradient(432).save(RES / "drawable" / "ic_launcher_bg.png")
print("Đã tạo icon trong", RES)
