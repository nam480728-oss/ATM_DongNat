"""T0 — Kiểm tra môi trường trước khi train.

Chạy:  python models/scripts/Train/00_kiem_tra.py
Kiểm tra: GPU/CUDA, RAM trống, trọng số yolo11s.pt (tự tải từ GitHub nếu chưa có), data.yaml, albumentations.
"""
import psutil
import torch

from _chung import load_cfg


def main():
    cfg = load_cfg()
    ok = True

    def line(good, name, detail=""):
        nonlocal ok
        ok &= good
        print(f"  {'OK ' if good else 'LỖI'} {name}{': ' + detail if detail else ''}")

    print("T0: kiểm tra môi trường")
    import ultralytics
    line(True, "ultralytics", ultralytics.__version__)
    cuda = torch.cuda.is_available()
    line(cuda, "GPU CUDA", torch.cuda.get_device_name(0) + f", {torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} GB"
         if cuda else "không thấy GPU")
    vm = psutil.virtual_memory()
    ram = f"{vm.available / 2**30:.1f} / {vm.total / 2**30:.1f} GB"
    if vm.available > 6 * 2**30:
        line(True, "RAM trống", ram)
    else:  # chỉ cảnh báo, không chặn
        print(f"  !!  RAM trống: {ram} — NÊN đóng bớt trình duyệt/ứng dụng nặng trước khi train (khuyên ≥ 6 GB)")
    try:
        import albumentations
        line(True, "albumentations", albumentations.__version__)
    except Exception as e:
        line(False, "albumentations", f"{type(e).__name__}: {e}")
    from pathlib import Path
    from ultralytics.utils.downloads import attempt_download_asset
    w = Path(cfg["model"])
    if not w.is_file():
        print(f"  tải {w.name} ...")
        w.parent.mkdir(parents=True, exist_ok=True)
        attempt_download_asset(w)
    line(w.is_file(), "trọng số khởi tạo", f"{w} ({w.stat().st_size / 2**20:.1f} MB)" if w.is_file() else "không tải được")
    from ultralytics.data.utils import check_det_dataset
    try:
        d = check_det_dataset(cfg["data"])
        n = {s: len(list(Path(d[s]).glob("*.jpg"))) for s in ("train", "val", "test")}
        line(d["nc"] == 3, "data.yaml", f"{d['names']}, ảnh {n}")
    except Exception as e:
        line(False, "data.yaml", f"{type(e).__name__}: {e}")
    print("T0: " + ("sẵn sàng train." if ok else "CÓ LỖI — xem các dòng LỖI ở trên."))


if __name__ == "__main__":
    main()
