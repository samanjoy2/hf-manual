from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

source = BUILD / "app-icon-v2.png"
if not source.exists():
    raise FileNotFoundError(f"Missing icon source: {source}")

image = Image.open(source).convert("RGBA")
if image.width != image.height:
    raise ValueError("The app icon source must be square.")

image.save(
    BUILD / "app-icon-v2.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
