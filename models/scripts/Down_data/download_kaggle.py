"""Tải 2 bộ Kaggle vào models/data/kaggle/<tên>/ (cần ~/.kaggle/kaggle.json).

Chạy:  python models/scripts/Down_data/download_kaggle.py
Bộ nào đã giải nén xong (có file .done) thì bỏ qua.
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2] / "data" / "kaggle"

DATASETS = {
    "drinking_waste": "arkadiyhacks/drinking-waste-classification",
    "garbage12": "mostafaabla/garbage-classification",
}


def main():
    for name, slug in DATASETS.items():
        dst = ROOT / name
        done = dst / ".done"
        if done.exists():
            print(f"[skip] {name}")
            continue
        dst.mkdir(parents=True, exist_ok=True)
        print(f"[get ] {slug} -> {dst}", flush=True)
        for attempt in range(3):
            r = subprocess.run(
                [sys.executable, "-m", "kaggle", "datasets", "download", "-d", slug, "-p", str(dst), "--unzip"],
            )
            if r.returncode == 0:
                done.write_text(slug, encoding="utf-8")
                print(f"[ok  ] {name}", flush=True)
                break
            print(f"[retry] {name} lần {attempt + 1} lỗi mã {r.returncode}", flush=True)
        else:
            print(f"[FAIL] {name}", flush=True)


if __name__ == "__main__":
    main()
