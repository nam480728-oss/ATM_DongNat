"""Tải 2 project Roboflow (định dạng YOLOv8) vào models/data/roboflow/<project>/.

Cần ROBOFLOW_API_KEY trong .env.  Chạy:  python models/scripts/Down_data/download_roboflow.py
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.stdout.reconfigure(encoding="utf-8")
BASE = Path(__file__).resolve().parents[3]
ROOT = BASE / "models" / "data" / "roboflow"
load_dotenv(BASE / ".env")

# (workspace, project, version hoặc None = bản mới nhất)
PROJECTS = [
    ("jidapa-thonglek", "bottle-can-detector", None),
    ("national-cheng-kung-university-wjot1", "tin-and-aluminum-cans", None),
]


def main():
    from roboflow import Roboflow

    key = os.getenv("ROBOFLOW_API_KEY")
    if not key:
        sys.exit("Thiếu ROBOFLOW_API_KEY trong .env")
    rf = Roboflow(api_key=key)
    for ws, pj, ver in PROJECTS:
        dst = ROOT / pj
        if (dst / ".done").exists():
            print(f"[skip] {pj}")
            continue
        try:
            project = rf.workspace(ws).project(pj)
            if ver is None:
                ver = max(int(v.version.split("/")[-1]) for v in project.versions())
            print(f"[get ] {ws}/{pj} v{ver}", flush=True)
            project.version(ver).download("yolov8", location=str(dst), overwrite=True)
            (dst / ".done").write_text(f"{ws}/{pj} v{ver}", encoding="utf-8")
            print(f"[ok  ] {pj}", flush=True)
        except Exception as e:  # ghi lỗi, không in key
            print(f"[FAIL] {pj}: {type(e).__name__}: {e}", flush=True)


if __name__ == "__main__":
    main()
