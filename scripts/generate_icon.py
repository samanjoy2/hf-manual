from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

size = 512
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

green = (31, 77, 59, 255)
cream = (255, 253, 248, 255)
draw.rounded_rectangle((24, 24, size - 24, size - 24), radius=112, fill=green)
draw.rounded_rectangle((43, 43, size - 43, size - 43), radius=96, outline=(255, 255, 255, 24), width=4)

font_candidates = [
    Path("C:/Windows/Fonts/georgiab.ttf"),
    Path("C:/Windows/Fonts/georgia.ttf"),
    Path("C:/Windows/Fonts/timesbd.ttf"),
]
font_path = next((candidate for candidate in font_candidates if candidate.exists()), None)
font = ImageFont.truetype(str(font_path), 196) if font_path else ImageFont.load_default()

label = "HF"
box = draw.textbbox((0, 0), label, font=font)
text_width = box[2] - box[0]
text_height = box[3] - box[1]
draw.text(
    ((size - text_width) / 2, (size - text_height) / 2 - box[1] - 8),
    label,
    font=font,
    fill=cream,
)

image.save(BUILD / "icon.png")
image.save(
    BUILD / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
