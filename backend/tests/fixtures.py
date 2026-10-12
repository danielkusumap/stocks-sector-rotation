"""Fixture & konstanta bersama untuk test backend (file Excel kecil, angka universe nyata)."""

from __future__ import annotations

import openpyxl

HEADER = ["No", "Kode", "Nama Perusahaan", "Tanggal Pencatatan", "Saham", "Papan Pencatatan"]

# 5 valid, 1 kode tidak valid (`BCA`), 1 duplikat (`bbca.jk` → BBCA) — docs/07 B1 AC 7.
FIXTURE_SHEETS = {
    "IDXFINANCE": [
        ("BBCA", "Bank Central Asia Tbk.", "06 Jul 2021", 8603416176, "Utama"),
        ("BBRI", "Bank Rakyat Indonesia Tbk.", "10 Nov 2003", 151000000000, "Utama"),
        ("BMRI", "Bank Mandiri Tbk.", "14 Jul 2003", 93333333333, "Utama"),
        ("BBNI", "Bank Negara Indonesia Tbk.", "25 Nov 1996", 37300000000, "Utama"),
        ("BNGA", "Bank CIMB Niaga Tbk.", "29 Nov 1989", 25000000000, "Utama"),
    ],
    "IDXBASIC": [("BCA", "Kode cuma 3 huruf", "01 Jan 2000", 1000, "Utama")],
    "IDXCYCLIC": [("bbca.jk", "Duplikat BBCA lewat normalisasi", "01 Jan 2000", 1000, "Utama")],
}

PER_SECTOR = {
    "IDXCYCLIC": 162,
    "IDXNONCYC": 133,
    "IDXBASIC": 114,
    "IDXFINANCE": 106,
    "IDXPROPERT": 93,
    "IDXENERGY": 90,
    "IDXINFRA": 70,
    "IDXINDUST": 66,
    "IDXTECHNO": 47,
    "IDXHEALTH": 41,
    "IDXTRANS": 40,
}
BOARDS = {"Utama": 293, "Pengembangan": 556, "Pemantauan Khusus": 69, "Akselerasi": 43, "Ekonomi Baru": 1}


def write_xlsx(path, sheets: dict[str, list[tuple]]) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        ws.append(HEADER)
        for i, row in enumerate(rows, start=1):
            ws.append((i, *row))
    wb.save(path)
    return path.read_bytes()
