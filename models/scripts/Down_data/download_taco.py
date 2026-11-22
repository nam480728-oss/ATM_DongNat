"""Tải ảnh bộ TACO (http://tacodataset.org) theo file annotations.json.

Chạy:  python models/scripts/Down_data/download_taco.py
Ảnh lưu vào models/data/taco/images/<batch_x>/<file>.jpg (giữ nguyên đường dẫn file_name của COCO).
Chạy lại nhiều lần an toàn: ảnh đã có thì bỏ qua.
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2] / "data" / "taco"
ANN = ROOT / "annotations.json"
IMG = ROOT / "images"


def fetch(img):
    dst = IMG / img["file_name"]
    if dst.is_file() and dst.stat().st_size > 1000:
        return "skip"
    dst.parent.mkdir(parents=True, exist_ok=True)
    for url in (img.get("flickr_url"), img.get("flickr_640_url")):
        if not url:
            continue
        try:
            req = Request(url, headers={"User-Agent": "Mozilla/5.0 (dataset-downloader)"})
            with urlopen(req, timeout=60) as r:
                data = r.read()
            if len(data) > 1000:
                dst.write_bytes(data)
                return "ok"
        except Exception:
            continue
    return "fail"


def main():
    images = json.loads(ANN.read_text(encoding="utf-8"))["images"]
    stats = {"ok": 0, "skip": 0, "fail": 0}
    with ThreadPoolExecutor(8) as ex:
        for i, res in enumerate(ex.map(fetch, images), 1):
            stats[res] += 1
            if i % 100 == 0:
                print(f"{i}/{len(images)} {stats}", flush=True)
    print("Xong:", stats)


if __name__ == "__main__":
    main()
