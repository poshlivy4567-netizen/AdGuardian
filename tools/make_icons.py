# -*- coding: utf-8 -*-
"""Генерирует иконки AdGuardian (16/32/48/128) в стиле Linear: тёмный фон, фиолетовый щит, белая галочка."""
from PIL import Image, ImageDraw, ImageFont
import os

SIZES = [16, 32, 48, 128]
BG = (11, 11, 13)          # #0b0b0d
ACCENT = (94, 106, 210)    # #5e6ad2
ACCENT2 = (139, 147, 255)  # #8b93ff
WHITE = (255, 255, 255)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
os.makedirs(out, exist_ok=True)

FONT_PATH = r"C:\Windows\Fonts\arialbd.ttf"

def shield(draw, size):
    """Рисует щит с градиентом (по строкам) и белой галочкой."""
    s = size
    # щит: верхняя часть — трапеция, нижняя — закруглённый треугольник
    def in_shield(x, y):
        cx = s / 2
        top = s * 0.22
        bottom = s * 0.82
        half_top = s * 0.34
        half_bottom = s * 0.24
        if y < top or y > bottom:
            return False
        t = (y - top) / (bottom - top)
        half = half_top + (half_bottom - half_top) * t
        return abs(x - cx) <= half

    for y in range(s):
        for x in range(s):
            if in_shield(x, y):
                t = y / s
                r = int(ACCENT[0] + (ACCENT2[0] - ACCENT[0]) * t)
                g = int(ACCENT[1] + (ACCENT2[1] - ACCENT[1]) * t)
                b = int(ACCENT[2] + (ACCENT2[2] - ACCENT[2]) * t)
                draw.point((x, y), fill=(r, g, b))

    # белая галочка (два отрезка)
    lw = max(2, s // 14)
    p1 = (s * 0.34, s * 0.50)
    p2 = (s * 0.46, s * 0.62)
    p3 = (s * 0.68, s * 0.38)
    draw.line([p1, p2], fill=WHITE, width=lw)
    draw.line([p2, p3], fill=WHITE, width=lw)

for size in SIZES:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # скруглённый тёмный квадрат-подложка
    rad = max(2, size // 5)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=rad, fill=BG)
    shield(draw, size)
    img.save(os.path.join(out, f"icon{size}.png"))
    print(f"icon{size}.png  {size}x{size}")

# 128 — большая для manifest "icons"
print("OK")
