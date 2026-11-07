// nationcloudPOS - POS sederhana. Node.js 22+, tanpa npm, tanpa internet.
// Data disimpan di satu file: data/pos.db
const http = require('node:http');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { parseAngka, parseDiskon, kunciNama } = require('./public/angka.js');
const { bacaFile } = require('./excel.js');
const { TabelError } = require('./tabel.js');
const { buatLaporanPdf } = require('./laporanpdf.js');

const META = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'versi.json'), 'utf8')); } catch { return { versi: '0.0.0' }; } })();
const VERSION = META.versi;
const update = require('./update.js');
const PORT = Number(process.env.POS_PORT || 8780);
const HOST = process.env.POS_HOST || '127.0.0.1'; // isi 0.0.0.0 agar PC lain bisa akses
const DB_FILE = process.env.POS_DB || path.join(__dirname, 'data', 'pos.db');
const PUBLIC = path.join(__dirname, 'public');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS items (
  kode TEXT PRIMARY KEY, nama TEXT NOT NULL, harga INTEGER NOT NULL DEFAULT 0,
  hpp INTEGER NOT NULL DEFAULT 0, aktif INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kode TEXT NOT NULL, qty INTEGER NOT NULL,
  doc_type TEXT NOT NULL, doc_no TEXT, ts TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS moves_kode ON moves(kode);
CREATE INDEX IF NOT EXISTS moves_doc ON moves(doc_no);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT, no TEXT UNIQUE, ts TEXT NOT NULL, tgl TEXT NOT NULL,
  total INTEGER NOT NULL, tunai INTEGER NOT NULL DEFAULT 0, transfer INTEGER NOT NULL DEFAULT 0,
  qris INTEGER NOT NULL DEFAULT 0, kembali INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid', alasan TEXT);
CREATE INDEX IF NOT EXISTS sales_tgl ON sales(tgl);
CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL REFERENCES sales(id),
  kode TEXT NOT NULL, nama TEXT NOT NULL, qty INTEGER NOT NULL, harga INTEGER NOT NULL, hpp INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sale_lines_sale ON sale_lines(sale_id);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, aksi TEXT NOT NULL, detail TEXT);
`);
// Migrasi: kolom baru ditambahkan, tidak pernah dihapus (database lama tetap bisa dibuka)
function addCol(table, col, ddl, after) {
  if (db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  if (after) db.exec(after);
}
addCol('sale_lines', 'harga_asli', 'INTEGER NOT NULL DEFAULT 0', 'UPDATE sale_lines SET harga_asli = harga');
addCol('sale_lines', 'diskon', 'INTEGER NOT NULL DEFAULT 0');
addCol('sales', 'diskon_nota', 'INTEGER NOT NULL DEFAULT 0');

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const nowParts = () => {
  const d = new Date();
  const tgl = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { tgl, ts: `${tgl} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` };
};
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const int = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, `${name} harus angka bulat`);
  return n;
};
const tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};
const stokDari = (kode) => db.prepare('SELECT COALESCE(SUM(qty),0) s FROM moves WHERE kode=?').get(kode).s;
const getSetting = (k, d = '') => db.prepare('SELECT v FROM meta WHERE k=?').get(k)?.v ?? d;
const setSetting = (k, v) => db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
const log = (aksi, detail) => db.prepare('INSERT INTO audit(ts,aksi,detail) VALUES(?,?,?)').run(nowParts().ts, aksi, typeof detail === 'string' ? detail : JSON.stringify(detail));
const move = (kode, qty, type, no) => db.prepare('INSERT INTO moves(kode,qty,doc_type,doc_no,ts) VALUES(?,?,?,?,?)').run(kode, qty, type, no || '', nowParts().ts);
const normNama = kunciNama;
const cekTgl = (t) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t || ''))) throw new HttpError(400, 'Tanggal tidak valid'); return t; };
const KODE_RE = /^[A-Z0-9][A-Z0-9_.\/-]{0,29}$/;

// ---------- barang ----------
function listItems(q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const rows = db.prepare(`SELECT i.kode, i.nama, i.harga, i.hpp, i.aktif,
      COALESCE((SELECT SUM(qty) FROM moves m WHERE m.kode=i.kode),0) AS stok
      FROM items i ORDER BY i.nama`).all();
  return rows.filter((r) => words.every((w) => (r.kode + ' ' + r.nama).toLowerCase().includes(w)));
}

function kodeBebas() {
  let n = 0;
  for (const r of db.prepare("SELECT kode FROM items WHERE kode GLOB 'BRG[0-9]*'").all()) {
    const m = /^BRG(\d+)$/.exec(r.kode); if (m) n = Math.max(n, Number(m[1]));
  }
  let kode;
  do { n++; kode = 'BRG' + String(n).padStart(4, '0'); } while (db.prepare('SELECT 1 FROM items WHERE kode=?').get(kode));
  return kode;
}
function saveItem(b) {
  let kode = String(b.kode || '').trim().toUpperCase();
  const nama = String(b.nama || '').replace(/\s+/g, ' ').trim();
  if (b.baru && !kode) kode = kodeBebas();
  if (b.baru && db.prepare('SELECT nama FROM items WHERE kode=?').get(kode)) {
    const o = db.prepare('SELECT nama FROM items WHERE kode=?').get(kode);
    throw new HttpError(400, `Kode ${kode} sudah dipakai barang "${o.nama}". Pakai kode lain, atau kosongkan kode agar dibuat otomatis.`);
  }
  if (!KODE_RE.test(kode)) throw new HttpError(400, 'Kode: 1-30 huruf besar/angka (boleh - _ . /)');
  if (!nama) throw new HttpError(400, 'Nama barang wajib diisi');
  if (nama.length > 200) throw new HttpError(400, 'Nama barang maksimal 200 huruf');
  const harga = int(b.harga, 'Harga'), hpp = int(b.hpp ?? 0, 'HPP');
  if (harga < 0 || hpp < 0) throw new HttpError(400, 'Harga tidak boleh minus');
  const aktif = b.aktif === 0 || b.aktif === false ? 0 : 1;
  return tx(() => {
    const ada = db.prepare('SELECT 1 FROM items WHERE kode=?').get(kode);
    if (ada) {
      db.prepare('UPDATE items SET nama=?, harga=?, hpp=?, aktif=? WHERE kode=?').run(nama, harga, hpp, aktif, kode);
    } else {
      db.prepare('INSERT INTO items(kode,nama,harga,hpp,aktif) VALUES(?,?,?,?,?)').run(kode, nama, harga, hpp, aktif);
      const stok = int(b.stok ?? 0, 'Stok awal');
      if (stok !== 0) move(kode, stok, 'AWAL');
    }
    return { kode, baru: !ada };
  });
}

function setStok(kode, fisik) {
  fisik = int(fisik, 'Stok');
  if (fisik < 0) throw new HttpError(400, 'Stok tidak boleh minus');
  return tx(() => {
    if (!db.prepare('SELECT 1 FROM items WHERE kode=?').get(kode)) throw new HttpError(404, 'Barang tidak ada');
    const selisih = fisik - stokDari(kode);
    if (selisih !== 0) move(kode, selisih, 'OPNAME');
    return { kode, stok: fisik, selisih };
  });
}

function tambahStok(kode, qty) {
  qty = int(qty, 'Jumlah');
  if (qty <= 0) throw new HttpError(400, 'Jumlah harus lebih dari 0');
  return tx(() => {
    if (!db.prepare('SELECT 1 FROM items WHERE kode=?').get(kode)) throw new HttpError(404, 'Barang tidak ada');
    move(kode, qty, 'MASUK');
    return { kode, stok: stokDari(kode) };
  });
}

// Hapus barang (riwayat penjualan lama tetap tersimpan lengkap dengan nama barangnya)
function hapusBarang(kodes) {
  if (!Array.isArray(kodes) || !kodes.length) throw new HttpError(400, 'Tidak ada barang yang dipilih');
  if (kodes.length >= 3) { try { backupNow(); } catch { /* cadangan gagal tidak menghalangi */ } }
  return tx(() => {
    let n = 0; const nama = [];
    for (const kode of kodes) {
      const it = db.prepare('SELECT kode,nama FROM items WHERE kode=?').get(String(kode));
      if (!it) continue;
      db.prepare('DELETE FROM moves WHERE kode=?').run(it.kode);
      db.prepare('DELETE FROM items WHERE kode=?').run(it.kode);
      n++; if (nama.length < 30) nama.push(`${it.kode} ${it.nama}`);
    }
    if (n) log('HAPUS_BARANG', { jumlah: n, contoh: nama });
    return { dihapus: n };
  });
}

// Impor dari PDF / Excel: baris = [{kode?, nama, harga, hpp?, stok?}]
function importBarang(b) {
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) throw new HttpError(400, 'Tidak ada baris untuk diimpor');
  if (rows.length > 5000) throw new HttpError(400, 'Maksimal 5.000 baris sekali impor');
  const perbarui = b.mode === 'perbarui', aturStok = !!b.atur_stok;
  return tx(() => {
    const byKode = new Map(), byNama = new Map();
    for (const it of db.prepare('SELECT kode,nama FROM items').all()) { byKode.set(it.kode, it); const k = normNama(it.nama); if (!byNama.has(k)) byNama.set(k, it); }
    let maxN = 0; for (const k of byKode.keys()) { const m = /^BRG(\d+)$/.exec(k); if (m) maxN = Math.max(maxN, Number(m[1])); }
    const hasil = { baru: 0, diperbarui: 0, dilewati: 0, gagal: [] };
    const blank = (v) => v === null || v === undefined || String(v).trim() === '' || String(v).trim() === '-';
    rows.forEach((r, i) => {
      const gagal = (alasan) => hasil.gagal.push({ baris: i + 1, nama: String(r.nama ?? '').slice(0, 80), alasan });
      const nama = String(r.nama ?? '').replace(/\s+/g, ' ').trim();
      if (!nama) return gagal('Nama kosong');
      if (nama.length > 200) return gagal('Nama lebih dari 200 huruf');
      let kode = String(r.kode ?? '').trim().toUpperCase(); if (blank(kode)) kode = '';
      if (kode && !KODE_RE.test(kode)) return gagal('Kode tidak valid (huruf besar/angka, maks 30)');
      const ada = kode ? byKode.get(kode) : byNama.get(normNama(nama));
      const harga = parseAngka(r.harga);
      // Barang yang sudah ada (di database, atau sudah masuk dari baris lain di file ini): baris ini cukup dilewati
      // kalau mode "lewati", atau kalau harganya kosong (tidak ada yang bisa diperbarui).
      if (ada && (!perbarui || harga === null || harga < 0)) { hasil.dilewati++; return; }
      if (harga === null) return gagal('Harga jual kosong / bukan angka');
      if (harga < 0) return gagal('Harga jual minus');
      let hpp = null; if (!blank(r.hpp)) { hpp = parseAngka(r.hpp); if (hpp === null || hpp < 0) return gagal('HPP bukan angka yang benar'); }
      let stok = null; if (!blank(r.stok)) { stok = parseAngka(r.stok); if (stok === null) return gagal('Stok bukan angka'); if (stok < 0) return gagal('Stok minus'); }
      if (ada) {
        db.prepare('UPDATE items SET harga=?' + (hpp !== null ? ', hpp=?' : '') + ' WHERE kode=?').run(...(hpp !== null ? [harga, hpp, ada.kode] : [harga, ada.kode]));
        if (aturStok && stok !== null) { const sel = stok - stokDari(ada.kode); if (sel !== 0) move(ada.kode, sel, 'OPNAME'); }
        hasil.diperbarui++; return;
      }
      if (!kode) { do { maxN++; kode = 'BRG' + String(maxN).padStart(4, '0'); } while (byKode.has(kode)); }
      db.prepare('INSERT INTO items(kode,nama,harga,hpp,aktif) VALUES(?,?,?,?,1)').run(kode, nama, harga, hpp ?? 0);
      if (stok) move(kode, stok, 'AWAL');
      const it = { kode, nama }; byKode.set(kode, it); if (!byNama.has(normNama(nama))) byNama.set(normNama(nama), it);
      hasil.baru++;
    });
    log('IMPOR_BARANG', { baru: hasil.baru, diperbarui: hasil.diperbarui, dilewati: hasil.dilewati, gagal: hasil.gagal.length, mode: perbarui ? 'perbarui' : 'lewati' });
    return hasil;
  });
}

// ---------- penjualan ----------
function createSale(b) {
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) throw new HttpError(400, 'Keranjang kosong');
  const tunai = int(b.tunai ?? 0, 'Tunai'), transfer = int(b.transfer ?? 0, 'Transfer'), qris = int(b.qris ?? 0, 'QRIS');
  if (tunai < 0 || transfer < 0 || qris < 0) throw new HttpError(400, 'Pembayaran tidak boleh minus');
  const blokStok = getSetting('blok_stok', '0') === '1';
  return tx(() => {
    const rows = []; const qtyPerKode = new Map(); let subtotal = 0;
    for (const l of lines) {
      const qty = int(l.qty, 'Jumlah');
      if (qty <= 0) throw new HttpError(400, 'Jumlah harus lebih dari 0');
      const it = db.prepare('SELECT * FROM items WHERE kode=?').get(String(l.kode));
      if (!it || !it.aktif) throw new HttpError(400, `Barang ${l.kode} tidak ditemukan / nonaktif`);
      // harga: dari database, kecuali kasir sengaja mengubahnya (harga manual)
      let harga = it.harga;
      if (l.harga !== undefined && l.harga !== null && String(l.harga).trim() !== '') {
        harga = parseAngka(l.harga);
        if (harga === null || harga < 0) throw new HttpError(400, `Harga ${it.nama} tidak valid`);
      }
      const kotor = qty * harga;
      const diskon = parseDiskon(l.diskon, kotor);
      if (Number.isNaN(diskon) || diskon < 0) throw new HttpError(400, `Diskon ${it.nama} tidak valid (contoh: 5000 atau 10%)`);
      if (diskon > kotor) throw new HttpError(400, `Diskon ${it.nama} melebihi harganya`);
      rows.push({ kode: it.kode, nama: it.nama, qty, harga, harga_asli: it.harga, diskon, hpp: it.hpp });
      qtyPerKode.set(it.kode, (qtyPerKode.get(it.kode) || 0) + qty);
      subtotal += kotor - diskon;
    }
    if (blokStok) for (const [kode, q] of qtyPerKode) { const s = stokDari(kode); if (s < q) throw new HttpError(400, `Stok ${db.prepare('SELECT nama FROM items WHERE kode=?').get(kode).nama} kurang (sisa ${s})`); }
    const diskonNota = parseDiskon(b.diskon_nota, subtotal);
    if (Number.isNaN(diskonNota) || diskonNota < 0) throw new HttpError(400, 'Diskon nota tidak valid (contoh: 5000 atau 10%)');
    if (diskonNota > subtotal) throw new HttpError(400, 'Diskon nota melebihi total belanja');
    const total = subtotal - diskonNota;
    const diBayar = tunai + transfer + qris;
    if (diBayar < total) throw new HttpError(400, `Pembayaran kurang Rp ${(total - diBayar).toLocaleString('id-ID')}`);
    const lebih = diBayar - total;
    if (lebih > tunai) throw new HttpError(400, 'Kelebihan bayar hanya boleh dikembalikan dari uang tunai');
    const { tgl, ts } = nowParts();
    const last = db.prepare("SELECT MAX(CAST(substr(no, -4) AS INTEGER)) m FROM sales WHERE tgl=?").get(tgl).m || 0;
    const no = `S${tgl.replaceAll('-', '').slice(2)}-${String(last + 1).padStart(4, '0')}`;
    const r = db.prepare(`INSERT INTO sales(no,ts,tgl,total,tunai,transfer,qris,kembali,diskon_nota) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(no, ts, tgl, total, tunai - lebih, transfer, qris, lebih, diskonNota); // tunai disimpan bersih (setelah kembalian)
    const id = Number(r.lastInsertRowid);
    for (const l of rows) {
      db.prepare('INSERT INTO sale_lines(sale_id,kode,nama,qty,harga,harga_asli,diskon,hpp) VALUES(?,?,?,?,?,?,?,?)').run(id, l.kode, l.nama, l.qty, l.harga, l.harga_asli, l.diskon, l.hpp);
      move(l.kode, -l.qty, 'JUAL', no);
    }
    return getSale(id);
  });
}

// Laba satu nota: sama dengan hitungan di Laporan (harga jual - diskon - HPP, lalu dikurangi diskon nota).
// Diskon nota dibagi ke tiap barang sesuai nilainya; sisa pembulatan masuk ke barang terakhir.
function labaNota(s) {
  const nilai = s.lines.map((l) => l.qty * l.harga - l.diskon), jumlah = nilai.reduce((a, b) => a + b, 0);
  let sisaDn = s.diskon_nota; const baris = {}; let hpp = 0, tanpaHpp = 0;
  s.lines.forEach((l, i) => {
    const dn = i === s.lines.length - 1 ? sisaDn : (jumlah > 0 ? Math.round(s.diskon_nota * nilai[i] / jumlah) : 0);
    sisaDn -= dn;
    const net = nilai[i] - dn, h = l.qty * l.hpp;
    baris[l.id] = { net, hpp: h, laba: net - h, tanpaHpp: !l.hpp };
    hpp += h; if (!l.hpp) tanpaHpp++;
  });
  const laba = s.total - hpp;
  return { net: s.total, hpp, laba, margin: s.total ? Math.round(laba / s.total * 1000) / 10 : null, tanpaHpp, baris };
}
function getSale(id) {
  const s = db.prepare('SELECT * FROM sales WHERE id=? OR no=?').get(id, String(id));
  if (!s) throw new HttpError(404, 'Penjualan tidak ada');
  s.lines = db.prepare('SELECT id,kode,nama,qty,harga,harga_asli,diskon,hpp FROM sale_lines WHERE sale_id=? ORDER BY id').all(s.id);
  s.subtotal = s.total + s.diskon_nota;
  if (s.status === 'paid') s.laba = labaNota(s);
  return s;
}

// Ubah isi nota: qty baru 0 = hapus barang dari nota; qty lebih kecil = kurangi jumlah.
// Stok dikembalikan, total dihitung ulang, uang yang harus dikembalikan dipotong dari pembayaran.
function ubahBaris(saleId, lineId, qtyBaru, metode) {
  qtyBaru = int(qtyBaru, 'Jumlah');
  if (qtyBaru < 0) throw new HttpError(400, 'Jumlah tidak boleh minus');
  return tx(() => {
    const s = db.prepare('SELECT * FROM sales WHERE id=?').get(Number(saleId));
    if (!s) throw new HttpError(404, 'Penjualan tidak ada');
    if (s.status !== 'paid') throw new HttpError(400, 'Nota yang sudah batal tidak bisa diubah');
    const l = db.prepare('SELECT * FROM sale_lines WHERE id=? AND sale_id=?').get(Number(lineId), s.id);
    if (!l) throw new HttpError(404, 'Barang di nota ini tidak ada');
    if (qtyBaru > l.qty) throw new HttpError(400, 'Jumlah hanya bisa dikurangi, tidak bisa ditambah (buat nota baru di Kasir)');
    if (qtyBaru === l.qty) return getSale(s.id);
    const bahwa = qtyBaru === 0;
    const lain = db.prepare('SELECT COUNT(*) n FROM sale_lines WHERE sale_id=? AND id<>?').get(s.id, l.id).n;
    const selisih = l.qty - qtyBaru;
    if (db.prepare('SELECT 1 FROM items WHERE kode=?').get(l.kode)) move(l.kode, selisih, 'BATAL', s.no);
    if (bahwa) db.prepare('DELETE FROM sale_lines WHERE id=?').run(l.id);
    else db.prepare('UPDATE sale_lines SET qty=?, diskon=? WHERE id=?').run(qtyBaru, Math.round(l.diskon * qtyBaru / l.qty), l.id);
    if (!lain) { // nota kosong → dianggap batal
      db.prepare("UPDATE sales SET status='void', alasan=? WHERE id=?").run('Semua barang dihapus dari nota', s.id);
      log('UBAH_NOTA', { no: s.no, barang: l.nama, dari: l.qty, jadi: 0, nota_batal: true, total_lama: s.total });
      return getSale(s.id);
    }
    const sub = db.prepare('SELECT COALESCE(SUM(qty*harga-diskon),0) t FROM sale_lines WHERE sale_id=?').get(s.id).t;
    const dn = Math.min(s.diskon_nota, sub), total = sub - dn;
    let kembaliUang = s.total - total; // uang yang dikembalikan ke pelanggan
    const sisa = { tunai: s.tunai, transfer: s.transfer, qris: s.qris };
    const urut = [metode, 'tunai', 'transfer', 'qris'].filter((k, i, a) => sisa[k] !== undefined && a.indexOf(k) === i);
    for (const k of urut) { const ambil = Math.min(sisa[k], kembaliUang); sisa[k] -= ambil; kembaliUang -= ambil; }
    db.prepare('UPDATE sales SET total=?, diskon_nota=?, tunai=?, transfer=?, qris=? WHERE id=?').run(total, dn, sisa.tunai, sisa.transfer, sisa.qris, s.id);
    log('UBAH_NOTA', { no: s.no, barang: l.nama, dari: l.qty, jadi: qtyBaru, total_lama: s.total, total_baru: total, dikembalikan: s.total - total, lewat: metode });
    return getSale(s.id);
  });
}

function voidSale(id, alasan) {
  alasan = String(alasan || '').trim();
  if (!alasan) throw new HttpError(400, 'Alasan pembatalan wajib diisi');
  return tx(() => {
    const s = db.prepare('SELECT * FROM sales WHERE id=?').get(id);
    if (!s) throw new HttpError(404, 'Penjualan tidak ada');
    if (s.status !== 'paid') throw new HttpError(400, 'Penjualan sudah dibatalkan');
    if (s.tgl !== nowParts().tgl) throw new HttpError(400, 'Hanya penjualan hari ini yang bisa dibatalkan');
    db.prepare("UPDATE sales SET status='void', alasan=? WHERE id=?").run(alasan, id);
    for (const l of db.prepare('SELECT kode,qty FROM sale_lines WHERE sale_id=?').all(id))
      if (db.prepare('SELECT 1 FROM items WHERE kode=?').get(l.kode)) move(l.kode, l.qty, 'BATAL', s.no);
    log('BATAL_JUAL', { no: s.no, total: s.total, alasan });
    return getSale(id);
  });
}

// Hapus penjualan SELAMANYA (hilang dari laporan). Stok yang terpotong kembali seperti semula.
function hapusPenjualan(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Tidak ada penjualan yang dipilih');
  if (ids.length >= 3) { try { backupNow(); } catch { /* cadangan gagal tidak menghalangi */ } }
  return tx(() => {
    let n = 0, total = 0; const nos = [];
    for (const id of ids) {
      const s = db.prepare('SELECT * FROM sales WHERE id=?').get(Number(id));
      if (!s) continue;
      db.prepare("DELETE FROM moves WHERE doc_no=? AND doc_type IN ('JUAL','BATAL')").run(s.no);
      db.prepare('DELETE FROM sale_lines WHERE sale_id=?').run(s.id);
      db.prepare('DELETE FROM sales WHERE id=?').run(s.id);
      n++; if (s.status === 'paid') total += s.total; if (nos.length < 30) nos.push(`${s.no} (${s.tgl}, Rp ${s.total}${s.status === 'void' ? ', batal' : ''})`);
    }
    if (n) log('HAPUS_JUAL', { jumlah: n, nilai_lunas: total, nota: nos });
    return { dihapus: n };
  });
}

// ---------- laporan ----------
function report(dari, sampai) {
  const q = [dari, sampai];
  const t = db.prepare(`SELECT COUNT(*) AS jumlah, COALESCE(SUM(total),0) AS omzet, COALESCE(SUM(tunai),0) AS tunai,
      COALESCE(SUM(transfer),0) AS transfer, COALESCE(SUM(qris),0) AS qris, COALESCE(SUM(diskon_nota),0) AS diskon_nota
      FROM sales WHERE tgl BETWEEN ? AND ? AND status='paid'`).get(...q);
  const l = db.prepare(`SELECT COALESCE(SUM(l.diskon),0) AS diskon_baris, COALESCE(SUM(l.qty*l.harga - l.diskon - l.qty*l.hpp),0) AS laba_baris
      FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.tgl BETWEEN ? AND ? AND s.status='paid'`).get(...q);
  const barang = db.prepare(`SELECT l.kode, l.nama, SUM(l.qty) AS qty, SUM(l.qty*l.harga - l.diskon) AS nilai FROM sale_lines l
      JOIN sales s ON s.id=l.sale_id WHERE s.tgl BETWEEN ? AND ? AND s.status='paid' GROUP BY l.kode, l.nama ORDER BY qty DESC, nilai DESC LIMIT 2000`).all(...q);
  const batal = db.prepare("SELECT COUNT(*) c FROM sales WHERE tgl BETWEEN ? AND ? AND status='void'").get(...q).c;
  const perHari = db.prepare("SELECT tgl, COUNT(*) AS jumlah, COALESCE(SUM(total),0) AS omzet FROM sales WHERE tgl BETWEEN ? AND ? AND status='paid' GROUP BY tgl ORDER BY tgl").all(...q);
  return {
    dari, sampai, jumlah: t.jumlah, omzet: t.omzet, tunai: t.tunai, transfer: t.transfer, qris: t.qris,
    diskon: t.diskon_nota + l.diskon_baris, diskon_nota: t.diskon_nota, laba: l.laba_baris - t.diskon_nota, batal,
    terlaris: barang.slice(0, 10), barang, perHari,
  };
}
function periode(q) {
  const dari = cekTgl(q.get('dari') || q.get('tgl') || nowParts().tgl), sampai = cekTgl(q.get('sampai') || q.get('tgl') || dari);
  if (sampai < dari) throw new HttpError(400, 'Tanggal "sampai" harus sesudah "dari"');
  return [dari, sampai];
}
function laporanPdf(dari, sampai) {
  const r = report(dari, sampai);
  const transaksi = db.prepare(`SELECT s.id, s.no, s.ts, s.total, s.tunai, s.transfer, s.qris, s.status, s.diskon_nota + COALESCE((SELECT SUM(diskon) FROM sale_lines WHERE sale_id=s.id),0) AS diskon
      FROM sales s WHERE s.tgl BETWEEN ? AND ? ORDER BY s.ts, s.id`).all(dari, sampai);
  return buatLaporanPdf({ toko: getSetting('toko', 'NATIONCLOUD'), alamat: getSetting('alamat', ''), dari, sampai, dicetak: nowParts().ts.slice(0, 16), r, transaksi, barang: r.barang, perHari: r.perHari });
}

const DIR_BACKUP_BAWAAN = () => path.join(path.dirname(DB_FILE), 'backup');
function tulisBackup(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const { ts } = nowParts();
  const dasar = `pos-${ts.replace(/[- :]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')}`;
  let file = path.join(dir, dasar + '.db');
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${dasar}-${n}.db`); // dua backup dalam detik yang sama
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const all = fs.readdirSync(dir).filter((f) => /^pos-.*\.db$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.unlinkSync(path.join(dir, old)); // simpan 30 terakhir
  setSetting('last_backup', ts);
  return { file, ts, folder: dir };
}
// Backup ke folder pilihan pemilik; kalau folder itu tidak bisa dipakai (flashdisk dicabut, dsb.)
// tetap disimpan di folder bawaan supaya backup tidak terlewat, dan peringatannya ditampilkan.
function backupNow() {
  const pilihan = getSetting('folder_backup', '');
  if (pilihan) {
    try { const r = tulisBackup(pilihan); setSetting('backup_error', ''); return r; }
    catch (e) {
      const r = tulisBackup(DIR_BACKUP_BAWAAN());
      r.peringatan = `Folder backup pilihan tidak bisa dipakai, jadi backup disimpan di folder bawaan (${r.folder}). Periksa folder: ${pilihan}`;
      setSetting('backup_error', r.peringatan); return r;
    }
  }
  setSetting('backup_error', ''); return tulisBackup(DIR_BACKUP_BAWAAN());
}
function aturFolderBackup(folder) {
  folder = String(folder || '').trim().replace(/^"(.*)"$/, '$1');
  if (!folder) { setSetting('folder_backup', ''); log('FOLDER_BACKUP', 'kembali ke bawaan'); return backupNow(); }
  if (!path.isAbsolute(folder)) throw new HttpError(400, 'Tulis lokasi lengkap, contoh: D:\\BackupToko  (atau pakai tombol Pilih folder)');
  try {
    fs.mkdirSync(folder, { recursive: true });
    const tes = path.join(folder, '.tes-nationcloudpos'); fs.writeFileSync(tes, 'ok'); fs.unlinkSync(tes);
  } catch (e) { throw new HttpError(400, `Folder itu tidak bisa dipakai (${e.code || e.message}). Pilih folder lain, atau pastikan flashdisk/drive terpasang.`); }
  setSetting('folder_backup', folder); log('FOLDER_BACKUP', folder);
  return backupNow(); // langsung backup sekali sebagai bukti folder berfungsi
}
// Jendela "Pilih folder" bawaan Windows (hanya jalan di komputer kasir sendiri)
function pilihFolderWindows() {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new HttpError(400, 'Tombol Pilih folder hanya ada di Windows. Ketik lokasi folder secara manual.'));
    const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; " +
      "$f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='Pilih folder tujuan backup (misalnya flashdisk atau folder Google Drive)'; $f.ShowNewFolderButton=$true; " +
      "$o=New-Object System.Windows.Forms.Form; $o.TopMost=$true; if($f.ShowDialog($o) -eq 'OK'){[Console]::Out.Write($f.SelectedPath)}";
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true, timeout: 10 * 60 * 1000, encoding: 'utf8' }, (err, out) => {
      if (err) return reject(new HttpError(500, 'Jendela pilih folder gagal dibuka. Ketik lokasi folder secara manual.'));
      resolve(String(out || '').trim());
    });
  });
}

// ---------- update dari GitHub ----------
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const sumberUpdate = () => ({ repo: getSetting('update_repo', '') || META.repo || '', cabang: getSetting('update_cabang', '') || META.cabang || 'main' });
const ctxUpdate = () => ({ dir: __dirname, ...sumberUpdate(), versi: VERSION,
  salinDb: (f) => db.exec(`VACUUM INTO '${f.replaceAll("'", "''")}'`), backup: () => backupNow(), log });
const bungkusUpdate = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof update.UpdateError) throw new HttpError(400, e.message); throw e; } };
async function rutUpdate(m, p, q, req) {
  const s = sumberUpdate();
  if (m === 'GET' && p === '/api/update/cek') {
    if (!s.repo) return { repo: '', belum_diatur: true, sekarang: VERSION, ada: false, sebelumnya: update.adaSebelumnya(__dirname) };
    const hasil = await bungkusUpdate(() => update.cek({ ...s, versi: VERSION }, q.get('paksa') === '1'));
    return { ...hasil, repo: s.repo, sebelumnya: update.adaSebelumnya(__dirname) };
  }
  // yang mengubah / memasang program hanya boleh dari komputer kasir sendiri
  if (!LOOPBACK.includes(req.socket.remoteAddress)) throw new HttpError(403, 'Update hanya bisa dilakukan dari komputer kasir');
  if (m === 'POST' && p === '/api/update/repo') {
    const b = await readBody(req); const repo = String(b.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, ''), cabang = String(b.cabang || 'main').trim() || 'main';
    if (repo) await bungkusUpdate(async () => update.cekNama(repo, cabang));
    setSetting('update_repo', repo); setSetting('update_cabang', cabang); log('UPDATE_REPO', repo || 'dikosongkan');
    return { repo, cabang };
  }
  if (m === 'POST' && p === '/api/update/pasang') {
    if (!s.repo) throw new HttpError(400, 'Isi dulu nama repo GitHub di bagian Update program');
    const hasil = await bungkusUpdate(() => update.pasang(ctxUpdate()));
    update.mulaiUlang(__dirname, () => { try { db.close(); } catch { /* */ } process.exit(0); });
    return hasil;
  }
  if (m === 'POST' && p === '/api/update/kembalikan') {
    const hasil = await bungkusUpdate(async () => update.kembalikan(ctxUpdate()));
    update.mulaiUlang(__dirname, () => { try { db.close(); } catch { /* */ } process.exit(0); });
    return hasil;
  }
  throw new HttpError(404, 'Tidak ditemukan');
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new HttpError(413, 'File terlalu besar')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
async function readBody(req) {
  const s = (await readRaw(req, 8e6)).toString('utf8');
  try { return s ? JSON.parse(s) : {}; } catch { throw new HttpError(400, 'JSON tidak valid'); }
}

async function api(req, res, url) {
  const m = req.method, p = url.pathname, q = url.searchParams;
  let r;
  if (m === 'GET' && p === '/api/info') r = { toko: getSetting('toko', 'NATIONCLOUD'), alamat: getSetting('alamat', ''), footer: getSetting('footer', 'Terima kasih'), last_backup: getSetting('last_backup', ''), folder_backup: getSetting('folder_backup', ''), folder_bawaan: DIR_BACKUP_BAWAAN(), backup_error: getSetting('backup_error', ''), update_repo: sumberUpdate().repo, blok_stok: getSetting('blok_stok', '0') === '1', versi: VERSION };
  else if (m === 'POST' && p === '/api/info') {
    const b = await readBody(req);
    for (const k of ['toko', 'alamat', 'footer']) if (typeof b[k] === 'string') setSetting(k, b[k].slice(0, 200));
    if (typeof b.blok_stok === 'boolean') setSetting('blok_stok', b.blok_stok ? '1' : '0');
    r = { ok: true };
  }
  else if (m === 'GET' && p === '/api/items') r = listItems(q.get('q'));
  else if (m === 'POST' && p === '/api/items') r = saveItem(await readBody(req));
  else if (m === 'POST' && p === '/api/items/hapus') r = hapusBarang((await readBody(req)).kodes);
  else if (m === 'POST' && /^\/api\/items\/[^/]+\/opname$/.test(p)) r = setStok(decodeURIComponent(p.split('/')[3]), (await readBody(req)).stok);
  else if (m === 'POST' && /^\/api\/items\/[^/]+\/masuk$/.test(p)) r = tambahStok(decodeURIComponent(p.split('/')[3]), (await readBody(req)).qty);
  else if (m === 'POST' && p === '/api/impor/baca') r = bacaFile(await readRaw(req, 40e6), { lembar: q.get('lembar') || undefined });
  else if (m === 'POST' && p === '/api/impor/simpan') r = importBarang(await readBody(req));
  else if (m === 'POST' && p === '/api/sales') r = createSale(await readBody(req));
  else if (m === 'POST' && p === '/api/sales/hapus') r = hapusPenjualan((await readBody(req)).ids);
  else if (m === 'GET' && p === '/api/sales') {
    const [dari, sampai] = periode(q);
    r = db.prepare(`SELECT s.id,s.no,s.ts,s.total,s.tunai,s.transfer,s.qris,s.status, s.diskon_nota + COALESCE((SELECT SUM(diskon) FROM sale_lines WHERE sale_id=s.id),0) AS diskon
      FROM sales s WHERE s.tgl BETWEEN ? AND ? ORDER BY s.id DESC`).all(dari, sampai);
  }
  else if (m === 'GET' && /^\/api\/sales\/\d+$/.test(p)) r = getSale(Number(p.split('/')[3]));
  else if (m === 'POST' && /^\/api\/sales\/\d+\/baris$/.test(p)) { const b = await readBody(req); r = ubahBaris(Number(p.split('/')[3]), b.line, b.qty, b.metode); }
  else if (m === 'POST' && /^\/api\/sales\/\d+\/void$/.test(p)) r = voidSale(Number(p.split('/')[3]), (await readBody(req)).alasan);
  else if (m === 'GET' && p === '/api/report') r = report(...periode(q));
  else if (m === 'GET' && p === '/api/laporan.pdf') {
    const [dari, sampai] = periode(q); const pdf = laporanPdf(dari, sampai);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="laporan-penjualan-${dari}${sampai !== dari ? '_sd_' + sampai : ''}.pdf"` });
    return res.end(pdf);
  }
  else if (m === 'GET' && p === '/api/audit') r = db.prepare('SELECT ts,aksi,detail FROM audit ORDER BY id DESC LIMIT 100').all();
  else if (m === 'POST' && p === '/api/backup') r = backupNow();
  else if (m === 'POST' && p === '/api/backup/folder') r = aturFolderBackup((await readBody(req)).folder);
  else if (m === 'POST' && p === '/api/backup/pilih') {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw new HttpError(403, 'Hanya dari komputer kasir');
    r = { folder: await pilihFolderWindows() };
  }
  else if (p.startsWith('/api/update/')) r = await rutUpdate(m, p, q, req);
  else if (m === 'POST' && p === '/api/keluar') { // tutup program (hanya dari komputer ini)
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw new HttpError(403, 'Program hanya bisa ditutup dari komputer kasir');
    r = { ok: true }; setTimeout(() => { try { db.close(); } catch { /* sudah tertutup */ } process.exit(0); }, 300);
  }
  else throw new HttpError(404, 'Tidak ditemukan');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(r));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let f = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.normalize(path.join(PUBLIC, f));
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || !fs.statSync(full).isFile()) throw new HttpError(404, 'Tidak ditemukan');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : e instanceof TabelError ? 400 : 500;
    if (code === 500) console.error(e);
    if (res.headersSent) return res.end();
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: code === 500 ? 'Kesalahan di server' : e.message }));
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} sudah dipakai - kemungkinan nationcloudPOS sudah berjalan. Buka http://localhost:${PORT}`);
  else console.error(e);
  process.exit(1);
});

// backup otomatis tiap 12 jam + saat start
const autoBackup = () => { try { backupNow(); } catch (e) { console.error('Backup gagal:', e.message); } };
setInterval(autoBackup, 12 * 3600 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`nationcloudPOS v${VERSION} berjalan di http://localhost:${PORT}  (jangan tutup jendela ini selama toko buka)`);
    autoBackup();
  });
}
module.exports = { createSale, ubahBaris, saveItem, setStok, tambahStok, voidSale, hapusPenjualan, hapusBarang, importBarang, report, laporanPdf, listItems, stokDari, backupNow, aturFolderBackup, getSale, db, server };
