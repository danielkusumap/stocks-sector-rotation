-- Master 11 sektor IDX-IC: kode & nama (docs/02 §6), warna (docs/06 §3), urutan tampil (docs/06 §3).
-- INSERT OR IGNORE → aman dijalankan berulang; baris yang sudah ada tidak ditimpa.
INSERT OR IGNORE INTO sector (code, name_id, name_en, color_hex, sort_order) VALUES
  ('IDXENERGY',  'Energi',                      'Energy',                   '#B45309', 1),
  ('IDXBASIC',   'Barang Baku',                 'Basic Materials',          '#7C6F2A', 2),
  ('IDXINDUST',  'Perindustrian',               'Industrials',              '#4B5563', 3),
  ('IDXNONCYC',  'Barang Konsumen Primer',      'Consumer Non-Cyclicals',   '#0F766E', 4),
  ('IDXCYCLIC',  'Barang Konsumen Non-Primer',  'Consumer Cyclicals',       '#BE185D', 5),
  ('IDXHEALTH',  'Kesehatan',                   'Healthcare',               '#0284C7', 6),
  ('IDXFINANCE', 'Keuangan',                    'Financials',               '#1D4ED8', 7),
  ('IDXPROPERT', 'Properti & Real Estat',       'Properties & Real Estate', '#7C3AED', 8),
  ('IDXTECHNO',  'Teknologi',                   'Technology',               '#0891B2', 9),
  ('IDXINFRA',   'Infrastruktur',               'Infrastructures',          '#65A30D', 10),
  ('IDXTRANS',   'Transportasi & Logistik',     'Transportation & Logistic','#C2410C', 11);
