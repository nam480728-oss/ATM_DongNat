"""T1/T2 — Train YOLO11s 3 nhãn (plastic / metal / other).

Chạy (ở terminal riêng, từ thư mục D:\\ATM_Dong_Nat):
  python models/scripts/Train/01_train.py                     train chính, tên tự đặt y11s_<MMDD>_<NN>
  python models/scripts/Train/01_train.py --ten y11s_1120_01  đặt tên lần train
  python models/scripts/Train/01_train.py --resume y11s_1120_01   train tiếp lần bị ngắt (từ last.pt)
  python models/scripts/Train/01_train.py --thu               chạy thử: 2 epoch trên 10% dữ liệu
  python models/scripts/Train/01_train.py --cau-hinh <file.yaml>  dùng file cấu hình khác (khi thử cải thiện)

Kết quả: models/model/<tên>/  (weights/best.pt, last.pt, results.csv, biểu đồ *.png,
         tien_do.log = tiến độ dễ đọc, tien_do.jsonl + trang_thai.json = để theo dõi tự động)
Dừng giữa chừng: Ctrl+C (last.pt vẫn còn, train tiếp bằng --resume).
"""
import argparse
import json
import math
import os
import shutil
import time
import traceback

import threading

import psutil
import torch

from _chung import CFG_FILE, MODEL_DIR, fmt_time, load_cfg, new_run_name, run_dir, write_status


def make_trainer(workers_val):
    """Trainer con: giới hạn số tiến trình đọc ảnh val (Ultralytics mặc định = 2 × workers, chạy suốt quá trình
    train dù val chỉ diễn ra cuối epoch -> tốn ~0,6 GB RAM mỗi tiến trình trên Windows)."""
    from ultralytics.models.yolo.detect import DetectionTrainer

    class Trainer(DetectionTrainer):
        def get_dataloader(self, dataset_path, batch_size=16, rank=0, mode="train"):
            if mode == "train":
                return super().get_dataloader(dataset_path, batch_size, rank, mode)
            w = self.args.workers
            self.args.workers = max(1, workers_val // 2)  # Ultralytics nhân đôi cho val
            try:
                return super().get_dataloader(dataset_path, batch_size, rank, mode)
            finally:
                self.args.workers = w

    return Trainer


def log_line(name, text):
    with open(run_dir(name) / "tien_do.log", "a", encoding="utf-8") as f:
        f.write(text + "\n")
    print(text, flush=True)


def make_callbacks(name, t0):
    state = {"times": [], "logged": set(), "ram_min": 1e9}

    def watch_ram():  # RAM trống thấp nhất giữa 2 lần ghi log (máy 16 GB, dễ cạn RAM)
        while True:
            state["ram_min"] = min(state["ram_min"], psutil.virtual_memory().available / 2**30)
            time.sleep(2)

    threading.Thread(target=watch_ram, daemon=True).start()

    def on_train_start(trainer):
        write_status(name, trang_thai="dang_train", pid=os.getpid(), epochs=trainer.epochs,
                     epoch=trainer.start_epoch, bat_dau=time.strftime("%Y-%m-%d %H:%M:%S"))
        log_line(name, f"=== {name} bắt đầu {time.strftime('%Y-%m-%d %H:%M:%S')} | pid {os.getpid()} | "
                       f"{trainer.epochs} epoch, batch {trainer.batch_size}, ảnh train {len(trainer.train_loader.dataset)}")

    def on_fit_epoch_end(trainer):
        e = trainer.epoch + 1
        if e in state["logged"]:  # Ultralytics gọi lại lần nữa khi đánh giá best.pt cuối cùng -> bỏ qua
            return
        state["logged"].add(e)
        m = trainer.metrics or {}
        tl = trainer.tloss.tolist() if trainer.tloss is not None else []
        loss = dict(zip(trainer.loss_names, [round(float(x), 4) for x in (tl if isinstance(tl, list) else [tl])]))
        et = float(trainer.epoch_time or 0)
        state["times"].append(et)
        recent = state["times"][-5:]
        eta = sum(recent) / len(recent) * (trainer.epochs - e)
        rec = {
            "epoch": e, "epochs": trainer.epochs, "thoi_gian": time.strftime("%Y-%m-%d %H:%M:%S"),
            "giay_epoch": round(et, 1), "con_lai_giay": round(eta), "da_chay_giay": round(time.time() - t0),
            "loss": loss,
            "P": round(m.get("metrics/precision(B)", 0), 4), "R": round(m.get("metrics/recall(B)", 0), 4),
            "mAP50": round(m.get("metrics/mAP50(B)", 0), 4), "mAP50_95": round(m.get("metrics/mAP50-95(B)", 0), 4),
            "fitness": round(float(trainer.fitness or 0), 4), "best_fitness": round(float(trainer.best_fitness or 0), 4),
            "best_epoch": int(getattr(trainer.stopper, "best_epoch", 0)),
            "vram_gb": round(torch.cuda.max_memory_reserved() / 2**30, 2) if torch.cuda.is_available() else 0,
            "ram_trong_gb": round(psutil.virtual_memory().available / 2**30, 1),
            "ram_trong_min_gb": round(state["ram_min"], 1),
            "nan": any(math.isnan(v) for v in loss.values()),
        }
        state["ram_min"] = 1e9
        with open(run_dir(name) / "tien_do.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        log_line(name, f"[{rec['thoi_gian'][11:]}] epoch {e}/{trainer.epochs} | "
                       f"loss box {loss.get('box_loss', 0):.3f} cls {loss.get('cls_loss', 0):.3f} | "
                       f"val P {rec['P']:.3f} R {rec['R']:.3f} mAP50 {rec['mAP50']:.3f} mAP50-95 {rec['mAP50_95']:.3f} | "
                       f"tốt nhất epoch {rec['best_epoch']} | {et:.0f}s/epoch, còn ~{fmt_time(eta)} | "
                       f"VRAM {rec['vram_gb']} GB, RAM trống thấp nhất {rec['ram_trong_min_gb']} GB")
        write_status(name, epoch=e, mAP50=rec["mAP50"], mAP50_95=rec["mAP50_95"], best_epoch=rec["best_epoch"])

    def on_train_end(trainer):
        e = trainer.epoch + 1
        early = e < trainer.epochs
        write_status(name, trang_thai="dung_som" if early else "xong", epoch=e,
                     ket_thuc=time.strftime("%Y-%m-%d %H:%M:%S"))
        log_line(name, f"=== {name} {'DỪNG SỚM (hết kiên nhẫn)' if early else 'XONG'} ở epoch {e} | "
                       f"tổng {fmt_time(time.time() - t0)} | best.pt = {trainer.best}")

    return {"on_train_start": on_train_start, "on_fit_epoch_end": on_fit_epoch_end, "on_train_end": on_train_end}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ten")
    ap.add_argument("--resume")
    ap.add_argument("--thu", action="store_true")
    ap.add_argument("--cau-hinh", default=str(CFG_FILE))
    a = ap.parse_args()

    from ultralytics import YOLO
    cfg = load_cfg(a.cau_hinh)
    if a.resume:
        name = a.resume
        last = run_dir(name) / "weights" / "last.pt"
        assert last.is_file(), f"không thấy {last}"
        model = YOLO(str(last))
        kw = dict(resume=True)
    else:
        name = a.ten or (new_run_name("thu") if a.thu else new_run_name())
        assert not run_dir(name).exists(), f"{run_dir(name)} đã tồn tại — chọn tên khác hoặc dùng --resume"
        model = YOLO(cfg["model"])
        # exist_ok=True: thư mục do script tạo trước (đã kiểm tra không trùng ở trên) -> Ultralytics không đổi tên thành <tên>-2
        kw = dict(cfg["train"], data=cfg["data"], project=str(MODEL_DIR), name=name, exist_ok=True)
        if a.thu:
            kw.update(epochs=2, fraction=0.1, patience=2)
    run_dir(name).mkdir(parents=True, exist_ok=True)
    if not a.resume:
        shutil.copyfile(a.cau_hinh, run_dir(name) / "cau_hinh.yaml")
    t0 = time.time()
    for ev, fn in make_callbacks(name, t0).items():
        model.add_callback(ev, fn)
    try:
        model.train(trainer=make_trainer(cfg.get("workers_val", 2)), **kw)
    except KeyboardInterrupt:
        write_status(name, trang_thai="dung_tay", ket_thuc=time.strftime("%Y-%m-%d %H:%M:%S"))
        log_line(name, f"=== {name} bị dừng bằng Ctrl+C. Train tiếp: python models/scripts/Train/01_train.py --resume {name}")
        raise
    except Exception:
        write_status(name, trang_thai="loi", loi=traceback.format_exc()[-2000:],
                     ket_thuc=time.strftime("%Y-%m-%d %H:%M:%S"))
        log_line(name, f"=== {name} LỖI:\n{traceback.format_exc()}")
        raise


if __name__ == "__main__":
    main()
