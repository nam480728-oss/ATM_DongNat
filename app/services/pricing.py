"""Tính tiền quy đổi."""


def calc_amount(bottles: int, cans: int, price_bottle: int, price_can: int) -> int:
    if bottles < 0 or cans < 0:
        raise ValueError("Số lượng không được âm")
    return bottles * price_bottle + cans * price_can


def format_vnd(amount: int) -> str:
    """1200 -> '1.200đ'"""
    return f"{amount:,}".replace(",", ".") + "đ"
