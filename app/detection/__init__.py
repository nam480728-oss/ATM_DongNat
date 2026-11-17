from .base import GROUP_BOTTLE, GROUP_CAN, GROUP_OTHER, Detection, Detector, Frame
from .mock_detector import MockDetector
from .yolo_detector import DetectorUnavailable, YoloDetector


def build_detector(config) -> Detector:
    kind = config["DETECTOR"].lower()
    if kind == "mock":
        return MockDetector(config["CLASS_MAP"], config["CONF_THRESHOLD"])
    if kind == "yolo":
        return YoloDetector(config["MODEL_PATH"], config["CLASS_MAP"], config["CONF_THRESHOLD"])
    raise DetectorUnavailable(f"DETECTOR không hợp lệ: {kind!r} (chỉ nhận 'mock' hoặc 'yolo')")


__all__ = [
    "Detection", "Detector", "Frame", "MockDetector", "YoloDetector", "DetectorUnavailable",
    "build_detector", "GROUP_BOTTLE", "GROUP_CAN", "GROUP_OTHER",
]
