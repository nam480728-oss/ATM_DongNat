"""Cắt ảnh vật không hợp lệ từ ảnh quét để hiện lên màn hình."""
from pathlib import Path

from PIL import Image


def crop_detection(image: Image.Image, bbox, margin: float = 0.10) -> Image.Image:
    x1, y1, x2, y2 = bbox
    w, h = image.size
    mx = int((x2 - x1) * margin)
    my = int((y2 - y1) * margin)
    box = (max(0, x1 - mx), max(0, y1 - my), min(w, x2 + mx), min(h, y2 + my))
    return image.crop(box)


def save_crop(image: Image.Image, bbox, out_dir: Path, name: str, margin: float = 0.10) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{name}.png"
    crop_detection(image, bbox, margin).save(path)
    return path
