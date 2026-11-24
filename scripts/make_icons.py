"""Генерация PNG-иконок PWA из тех же пропорций, что и public/favicon.svg."""

from PIL import Image, ImageDraw

CLAY = (165, 77, 40)
PAPER = (251, 250, 247)


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if maskable:
        # Safe zone: фон на весь холст, глиф — в центральных 60%.
        draw.rectangle([0, 0, s, s], fill=CLAY)
        pad = s * 0.2
    else:
        radius = int(s * 0.22)
        draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=CLAY)
        pad = s * 0.18

    box = (pad, pad, s - pad, s - pad)
    w = box[2] - box[0]
    stroke = max(1, int(w * 0.075))

    # «Тетрадь»: открытая книга с корешком слева.
    x0, y0, x1, y1 = box
    right = x1 - w * 0.08
    bottom = y1 - w * 0.04
    left = x0 + w * 0.02
    top = y0 + w * 0.02
    radius = int(w * 0.10)

    # Контур страницы.
    draw.rounded_rectangle(
        [left, top, right, bottom], radius=radius, outline=PAPER, width=stroke
    )
    # Корешок.
    spine = left + w * 0.20
    draw.line([(spine, top), (spine, bottom)], fill=PAPER, width=stroke)
    # Строки.
    for i, fy in enumerate((0.30, 0.48)):
        draw.line(
            [(spine + w * 0.10, top + w * fy), (right - w * 0.12, top + w * fy)],
            fill=PAPER,
            width=stroke,
        )
    # Нижняя линия (обрез блока).
    draw.line(
        [(spine, bottom - w * 0.06), (right - w * 0.04, bottom - w * 0.06)],
        fill=PAPER,
        width=stroke,
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = "public/icons"
    import os

    os.makedirs(out, exist_ok=True)
    draw_icon(192).save(f"{out}/icon-192.png")
    draw_icon(512).save(f"{out}/icon-512.png")
    draw_icon(512, maskable=True).save(f"{out}/icon-512-maskable.png")
    # Apple touch icon.
    draw_icon(180).save(f"{out}/apple-touch-icon.png")
    print("icons written")


if __name__ == "__main__":
    main()
