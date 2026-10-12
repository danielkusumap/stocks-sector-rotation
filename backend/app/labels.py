"""Label kuadran Bahasa Indonesia (docs/03 §3) — dipakai respons API & rationale sinyal."""

from __future__ import annotations

QUADRANT_LABEL = {
    "leading": "Memimpin",
    "improving": "Membaik",
    "weakening": "Melemah",
    "lagging": "Tertinggal",
}

QUADRANT_DESC = {
    "leading": "Tren relatif naik dan masih dipercepat.",
    "improving": "Tren relatif masih di bawah acuan, tapi mulai dipercepat.",
    "weakening": "Tren relatif masih di atas acuan, tapi mulai melambat.",
    "lagging": "Tren relatif turun dan masih melambat.",
}

# docs/06 §7: label kolom return per "window".
WINDOW_RETURN_COLUMN = {"1w": "ret_1w", "1m": "ret_1m", "3m": "ret_3m", "6m": "ret_6m", "1y": "ret_1y", "ytd": "ret_ytd"}
WINDOW_DAYS = {"1w": 7, "1m": 31, "3m": 92, "6m": 183, "1y": 366}


def quadrant_label(quadrant: str | None) -> str | None:
    return QUADRANT_LABEL.get(quadrant or "")


def quadrant_desc(quadrant: str | None) -> str | None:
    return QUADRANT_DESC.get(quadrant or "")


def format_id_number(value: float | int, decimals: int = 0) -> str:
    """Angka format Indonesia: titik ribuan, koma desimal (AGENTS.md aturan 7)."""
    text = f"{value:,.{decimals}f}"
    return text.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
