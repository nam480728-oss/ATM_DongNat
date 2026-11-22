"""Đường dẫn, cấu hình và hàm dùng chung cho các script train."""
import json
import re
import sys
import time
from pathlib import Path

import yaml

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

TRAIN_DIR = Path(__file__).resolve().parent
MODELS = TRAIN_DIR.parents[1]                      # D:\ATM_Dong_Nat\models
MODEL_DIR = MODELS / "model"                       # trọng số + biểu đồ + báo cáo
DATA_DIR = MODELS / "data_da_xu_ly"
TOOLS = MODELS / "tools"
CFG_FILE = TRAIN_DIR / "cau_hinh.yaml"
CLASSES = ["plastic", "metal", "other"]
TARGET = {"plastic", "metal"}


def load_cfg(path=CFG_FILE):
    cfg = yaml.safe_load(open(path, encoding="utf-8"))
    for k in ("model", "data"):
        p = Path(cfg[k])
        cfg[k] = str(p if p.is_absolute() else (MODELS / p).resolve())
    return cfg


def run_dir(name):
    return MODEL_DIR / name


def new_run_name(prefix="y11s"):
    """y11s_<MMDD>_<NN>: số thứ tự tăng dần trong ngày, không ghi đè lần cũ."""
    day = time.strftime("%m%d")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    nums = [int(m.group(1)) for p in MODEL_DIR.iterdir()
            if (m := re.fullmatch(rf"{prefix}_{day}_(\d+)", p.name))]
    return f"{prefix}_{day}_{max(nums, default=0) + 1:02d}"


def latest_run():
    runs = [p for p in MODEL_DIR.glob("*/trang_thai.json")]
    return max(runs, key=lambda p: p.stat().st_mtime).parent.name if runs else None


def read_status(name):
    p = run_dir(name) / "trang_thai.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


def write_status(name, **kw):
    p = run_dir(name) / "trang_thai.json"
    st = read_status(name)
    st.update(kw, cap_nhat=time.strftime("%Y-%m-%d %H:%M:%S"))
    p.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")


def read_progress(name):
    p = run_dir(name) / "tien_do.jsonl"
    if not p.is_file():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def fmt_time(sec):
    sec = int(sec)
    return f"{sec // 3600}h{sec % 3600 // 60:02d}m" if sec >= 3600 else f"{sec // 60}m{sec % 60:02d}s"
