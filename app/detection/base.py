"""Interface nhận diện. Mọi detector (giả lập hay model thật) đều trả về list[Detection]."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from PIL import Image

GROUP_BOTTLE = "bottle"
GROUP_CAN = "can"
GROUP_OTHER = "other"


@dataclass
class Detection:
    label: str                      # tên lớp gốc model trả về (vd 'milk_carton')
    group: str                      # 'bottle' | 'can' | 'other'
    confidence: float
    bbox: tuple[int, int, int, int]  # (x1, y1, x2, y2) pixel trên ảnh chụp
    overlapped: bool = False        # vật đang đè/dính vật khác -> cần rung lại

    @property
    def is_valid(self) -> bool:
        return self.group in (GROUP_BOTTLE, GROUP_CAN)

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "group": self.group,
            "confidence": round(self.confidence, 4),
            "bbox": list(self.bbox),
            "overlapped": self.overlapped,
        }


@dataclass
class Frame:
    """Một lần chụp từ camera buồng quét.

    `hints` chỉ có ở bản mô phỏng: 'đáp án' do scene 3D cung cấp (loại vật + bbox chiếu 2D).
    Model thật bỏ qua trường này.
    """
    image: Image.Image
    hints: list[dict] = field(default_factory=list)


class Detector(ABC):
    def __init__(self, class_map: dict[str, str], conf_threshold: float = 0.5):
        self.class_map = class_map
        self.conf_threshold = conf_threshold

    def group_of(self, label: str, confidence: float) -> str:
        # Không chắc chắn -> coi là không hợp lệ cho an toàn
        if confidence < self.conf_threshold:
            return GROUP_OTHER
        return self.class_map.get(label, GROUP_OTHER)

    @abstractmethod
    def detect(self, frame: Frame) -> list[Detection]:
        ...
