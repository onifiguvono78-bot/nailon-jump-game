"""
去除角色贴图的白色背景。
策略：基于像素到纯白的距离做 alpha 渐变，边缘轻微羽化 + 轻度去白边。
牙齿、眼白等内部白色细节会一并被置为透明，最终只保留完整的黄色人物形象。
"""
import sys
from pathlib import Path
from PIL import Image, ImageFilter

SRC = Path(__file__).resolve().parent.parent / 'images' / 'character_original.png'
DST = Path(__file__).resolve().parent.parent / 'images' / 'character.png'
BACKUP = Path(__file__).resolve().parent.parent / 'images' / 'character_original.png'

FADE_LOW = 40        # 距离纯白 < FADE_LOW：完全透明
FADE_HIGH = 55       # 距离纯白 > FADE_HIGH：完全不透明
FEATHER = 1          # 边缘羽化半径（px）


def main():
    src = SRC if SRC.exists() else BACKUP.parent / 'character.png'
    if not src.exists():
        print(f'[ERROR] 源文件不存在: {src}', file=sys.stderr)
        sys.exit(1)

    img = Image.open(src).convert('RGBA')
    w, h = img.size
    pixels = img.load()

    # 1. 按到纯白距离生成 alpha 掩码
    alpha = Image.new('L', (w, h), 0)
    a_pix = alpha.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = pixels[x, y]
            dist = ((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2) ** 0.5
            if dist <= FADE_LOW:
                a = 0
            elif dist >= FADE_HIGH:
                a = 255
            else:
                a = int(255 * (dist - FADE_LOW) / (FADE_HIGH - FADE_LOW))
            a_pix[x, y] = a

    # 2. 轻微羽化，消除硬边锯齿
    alpha = alpha.filter(ImageFilter.GaussianBlur(FEATHER))

    # 3. 应用 alpha 并做轻度去白边
    r, g, b, _ = img.split()
    img = Image.merge('RGBA', (r, g, b, alpha))
    pixels = img.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0 or a == 255:
                continue
            # 边缘半透明像素中若残留白色，向黄色方向压
            whiteness = min(255 - r, 255 - g, 255 - b) / 255.0
            if whiteness > 0.25:
                strength = whiteness * 0.45 * (1 - a / 255.0)
                g = int(g * (1 - strength * 0.30))
                b = int(b * (1 - strength * 0.60))
                pixels[x, y] = (r, g, b, a)

    # 4. 去掉半透明且仍然偏白的残留光晕（alpha 较低时直接透明）
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if 0 < a < 140:
                dist = ((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2) ** 0.5
                if dist < 35:
                    pixels[x, y] = (r, g, b, 0)

    # 5. 清理脚底阴影：底部区域中 alpha 较低或偏灰白的像素直接透明
    bottom_threshold_y = int(h * 0.85)
    for y in range(bottom_threshold_y, h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            mx = max(r, g, b)
            mn = min(r, g, b)
            saturation = (mx - mn) / mx if mx > 0 else 0
            brightness = (r + g + b) / 3.0
            # 偏灰白且较亮的底部像素视为投影
            if saturation < 0.18 and brightness > 130:
                pixels[x, y] = (r, g, b, 0)
            elif a < 180:
                pixels[x, y] = (r, g, b, 0)

    img.save(DST, 'PNG')
    print(f'[OK] 已保存去底图: {DST} ({w}x{h})')


if __name__ == '__main__':
    main()
