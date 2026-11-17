"""Detector dùng model YOLO (ultralytics) do anh/chị tự train.

Cách cắm model:
  1. Đặt file model (vd models/best.pt) và sửa MODEL_PATH trong .env
  2. Đặt DETECTOR=yolo trong .env
  3. Sửa Config.CLASS_MAP (app/config.py) cho khớp tên lớp của model -> 'bottle' / 'can'
"""
from pathlib import Path

from .base import Detection, Detector, Frame


class DetectorUnavailable(RuntimeError):
    pass


class YoloDetector(Detector):
    # Hai bbox có IoU vượt ngưỡng này bị coi là "đè nhau" -> cần rung lại
    OVERLAP_IOU = 0.15

    def __init__(self, model_path: str, class_map, conf_threshold=0.5):
        super().__init__(class_map, conf_threshold)
        path = Path(model_path)
        if not path.is_file():
            raise DetectorUnavailable(f"Không tìm thấy file model: {path}")
        try:
            from ultralytics import YOLO
        except ImportError as e:  # pragma: no cover
            raise DetectorUnavailable("Chưa cài thư viện ultralytics (pip install ultralytics)") from e
        self.model = YOLO(str(path))

    def detect(self, frame: Frame) -> list[Detection]:
        # conf thấp để vật "không chắc" vẫn được trả về rồi bị xếp vào 'other'
        result = self.model.predict(frame.image, conf=0.1, verbose=False)[0]
        names = result.names
        dets = []
        for box in result.boxes:
            x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
            conf = float(box.conf[0])
            label = names[int(box.cls[0])]
            dets.append(Detection(label, self.group_of(label, conf), conf, (x1, y1, x2, y2)))
        for i, a in enumerate(dets):
            for b in dets[i + 1:]:
                if _iou(a.bbox, b.bbox) > self.OVERLAP_IOU:
                    a.overlapped = b.overlapped = True
        return dets


def _iou(a, b) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union else 0.0
