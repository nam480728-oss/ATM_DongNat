"""Hằng số, bảng ánh xạ nhãn và hàm dùng chung cho các bước xử lý dữ liệu.

Thư mục:
  models/data/            dữ liệu thô (KHÔNG sửa)
  models/data_da_xu_ly/   dữ liệu sạch (images/, labels/, ko_ro/, unseen_test/, review/, catalog.csv, BAO_CAO.md)
  models/data_da_xu_ly/_work/   file trung gian (catalog từng bước, ảnh đã chuẩn hóa) — xóa được sau khi xong
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageOps

sys.stdout.reconfigure(encoding="utf-8")
Image.MAX_IMAGE_PIXELS = None

MODELS = Path(__file__).resolve().parents[2]
RAW = MODELS / "data"
OUT = MODELS / "data_da_xu_ly"
WORK = OUT / "_work"
TOOLS = MODELS / "tools"
SEED = 42

CLASSES = ["plastic", "metal", "other"]  # id YOLO: 0, 1, 2
MAX_SIDE = 1280          # thu nhỏ cạnh dài
MIN_BOX_PX = 12          # box có cạnh < 12 px (quy về ảnh 640) coi là quá nhỏ

# ---------------- Bảng ánh xạ nhãn (đã chốt 18/11/2026) ----------------
# Giá trị: "plastic" | "metal" | "other" | None (không vẽ box) | "?<task>" (cần CLIP quyết) | "DROP" (bỏ cả ảnh)
TACO_MAP = {
    **{k: "plastic" for k in [
        "Clear plastic bottle", "Other plastic bottle", "Disposable plastic cup", "Other plastic cup",
        "Disposable food container", "Other plastic container", "Spread tub", "Tupperware"]},
    "Drink can": "metal", "Food Can": "metal",
    "Aerosol": "?can",
}  # mọi lớp TACO khác -> other

DW_MAP = {0: "metal", 1: "other", 2: "plastic", 3: "plastic"}  # AluCan, Glass, HDPEM, PET
DW_NAMES = {0: "AluCan", 1: "Glass", 2: "HDPEM", 3: "PET"}
DW_CAP = 800

RF_MAP = {"plastic bottle": "plastic", "aluminium can": "metal", "tin-and-aluminum-cans": "metal"}

G12_TARGET = {"plastic": "?g12plastic", "metal": "?can"}  # các thư mục khác -> other
G12_CAP_OTHER = 250

COCO_OTHER = {
    "apple", "banana", "orange", "broccoli", "carrot", "donut", "cake", "sandwich", "hot dog", "pizza",
    "book", "cell phone", "remote", "mouse", "keyboard", "scissors", "spoon", "fork", "knife", "toothbrush",
    "teddy bear", "vase", "sports ball", "frisbee", "handbag", "backpack", "tie", "umbrella", "hair drier",
    "baseball glove", "baseball bat", "kite",
}
COCO_DROP = {"clock"}  # "Clock" là lớp unseen -> không cho vào train
COCO_CAP_PER_CLASS = 42

OI_TARGET = {"Tin can": "?can", "Bottle": "?bottle"}
OI_AUX = {"Drink", "Beer", "Wine", "Juice", "Milk"}  # chỉ dùng để soát chai/lon chưa gán
OI_NONE = {"Human hand"}
OI_CAP_OTHER = 80
OI_CAP_KEEP_ALL = {"Plastic bag"}

# ---------------- Prompt cho YOLO-World (bước 03) ----------------
SCAN_VOCAB = ["plastic bottle", "aluminum can", "tin can", "plastic cup", "spray can", "bottle", "can"]
G12_VOCAB = {
    "plastic": ["plastic bottle", "plastic container", "plastic cup", "plastic bag", "plastic object"],
    "metal": ["can", "tin can", "aluminum can", "spray can", "metal object"],
    "battery": ["battery"],
    "biological": ["food", "fruit", "vegetable"],
    "brown-glass": ["glass bottle", "glass jar", "glass"],
    "green-glass": ["glass bottle", "glass jar", "glass"],
    "white-glass": ["glass bottle", "glass jar", "glass"],
    "cardboard": ["cardboard box", "cardboard"],
    "paper": ["paper"],
    "clothes": ["clothing", "shirt", "pants"],
    "shoes": ["shoe"],
    "trash": ["trash", "garbage", "object"],
}

# ---------------- Prompt cho CLIP (bước 04) ----------------
CLIP_TASKS = {
    "bottle": {
        "plastic": ["a plastic bottle", "a clear plastic water bottle", "a plastic soda bottle",
                    "a plastic bottle of juice", "a plastic spray bottle", "a plastic shampoo bottle"],
        "other": ["a glass bottle", "a wine bottle", "a glass beer bottle", "a glass jar",
                  "a ceramic bottle", "a metal water bottle", "a perfume bottle made of glass",
                  "a glass of beer", "a drinking glass", "a glass medicine bottle"],
    },
    "can": {
        "metal": ["an aluminum soda can", "an aluminum beer can", "a steel food can", "a tin can",
                  "a crushed aluminum can", "a metal aerosol spray can", "a paint can", "a metal paint tin"],
        "plastic": ["a plastic spray bottle", "a plastic bottle", "a plastic container", "a plastic cup"],
        "other": ["a metal bottle cap", "a metal lid", "a metal spoon or fork", "aluminum foil", "scrap metal",
                  "a metal tool", "a glass jar", "a paper cup", "a cardboard box", "a battery", "a metal pot",
                  "a metal key", "nails and screws", "a metal wire"],
    },
    "g12plastic": {
        "plastic": ["a plastic bottle", "a plastic cup", "a plastic food container", "a plastic spray bottle",
                    "a plastic tub", "a plastic detergent bottle", "a plastic jug"],
        "other": ["a plastic bag", "plastic wrap", "a plastic bottle cap", "a plastic straw",
                  "plastic cutlery", "a plastic toy", "a glass bottle", "a piece of paper", "a snack wrapper"],
        "metal": ["an aluminum can", "a tin can"],
    },
    "scan": {
        "plastic": ["a plastic bottle", "a plastic cup", "a plastic food container", "a plastic spray bottle"],
        "metal": ["an aluminum soda can", "a steel food can", "a metal aerosol spray can"],
        "other": ["a glass bottle", "a wine glass", "a glass jar", "a vase", "a ceramic mug", "a paper cup",
                  "a candle", "a lamp", "a person", "a hand", "food", "a plant", "a book", "a phone",
                  "a toy", "furniture", "a box", "a bag", "a shoe", "clothes", "a sign", "a wall", "the ground",
                  "a glass of beer", "a glass of juice", "a drinking glass", "a glass of water", "a fire extinguisher",
                  "a juice carton", "a milk carton", "a cooking pot", "a refrigerator", "a plate of food",
                  "a thermos flask", "a lantern", "a bottle of wine", "a glass beer bottle", "a kitchen appliance",
                  "a battery", "an AA battery", "a green glass bottle", "a cardboard package", "a metal storage tin",
                  "a cosmetic jar"],
    },
}
CLIP_MIN_P = 0.60
CLIP_MIN_MARGIN = 0.15
SCAN_ACCEPT_P = 0.90   # box tìm thêm: chỉ tự gán nhựa/kim loại khi rất chắc


# ---------------- Hàm tiện ích ----------------
def safe_id(*parts):
    s = "__".join(str(p) for p in parts)
    return re.sub(r"[^A-Za-z0-9_\-]", "_", s)


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(path)


def open_rgb(path, transpose=True):
    im = Image.open(path)
    if transpose:
        im = ImageOps.exif_transpose(im)
    return im.convert("RGB")


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def ioa(a, b):
    """Tỉ lệ diện tích của a nằm trong b."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    area = (a[2] - a[0]) * (a[3] - a[1])
    return ix * iy / area if area > 0 else 0.0


def clip01(b):
    return [min(1.0, max(0.0, v)) for v in b]


def box_px640(b, w, h):
    """Cạnh nhỏ nhất của box (pixel) khi ảnh được thu về cạnh dài 640."""
    s = 640 / max(w, h)
    return min((b[2] - b[0]) * w * s, (b[3] - b[1]) * h * s)


def crop_box(im, b, margin=0.1):
    W, H = im.size
    bw, bh = (b[2] - b[0]) * W, (b[3] - b[1]) * H
    x0 = max(0, int(b[0] * W - margin * bw)); y0 = max(0, int(b[1] * H - margin * bh))
    x1 = min(W, int(b[2] * W + margin * bw)); y1 = min(H, int(b[3] * H + margin * bh))
    return im.crop((x0, y0, max(x1, x0 + 1), max(y1, y0 + 1)))


def log(msg):
    print(msg, flush=True)


def parse_yolo_line(line):
    """Dòng YOLO -> (class_id, [x0,y0,x1,y1]). Hỗ trợ cả box (5 số) và đa giác (1 + 2n số)."""
    p = line.split()
    if len(p) == 5:
        c, cx, cy, w, h = int(float(p[0])), *map(float, p[1:])
        return c, [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
    if len(p) >= 7 and len(p) % 2 == 1:
        xs, ys = list(map(float, p[1::2])), list(map(float, p[2::2]))
        return int(float(p[0])), [min(xs), min(ys), max(xs), max(ys)]
    return None
