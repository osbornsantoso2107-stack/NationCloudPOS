'use strict';
// Menebak peran kolom (kode / nama / harga / hpp / stok) dari tabel berisi teks.
// Dipakai bersama oleh pembaca PDF, Excel dan CSV.
const { parseAngka } = require('./public/angka.js');

class TabelError extends Error {}

const isNumCell = (s) => /^[\s\-]*(rp\.?\s*)?-?\d[\d.,\s]*\s*(pcs|bh|buah|lusin|dus|pak|box|unit|kg|gr|ltr|set)?\.?$/i.test(String(s).trim());

const HDR = [
  ['abaikan', /^(no\.?|nomor|#|urut)$/i],
  ['kode', /kode|code|sku|^kd\b|^id$|plu|barcode/i],
  ['hpp', /hpp|modal|harga\s*beli|h\.?\s*beli|cost|pokok|hrg\s*beli/i],
  ['harga', /harga|price|jual|hrg|tarif/i],
  ['stok', /stok|stock|qty|kuantitas|jumlah|saldo|sisa|persediaan/i],
  ['nama', /nama|barang|deskripsi|description|item|produk|product|uraian|keterangan/i],
  ['abaikan', /satuan|unit|sat\.?$|jenis|merek|brand|rak|kategori|total|subtotal/i],
];
const roleOf = (label) => { for (const [r, re] of HDR) if (re.test(String(label).trim())) return r; return null; };

// matrix: array baris, tiap baris array teks (panjang sama). Hasil: {kolom:[{label,tebakan}], baris, judul_ditemukan}
function analisis(matrix) {
  matrix = matrix.map((r) => r.map((t) => String(t ?? '').replace(/\s+/g, ' ').trim())).filter((r) => r.some(Boolean));
  if (!matrix.length) throw new TabelError('Tabel kosong.');
  // buang kolom yang kosong semua
  const keep = matrix[0].map((_, k) => k).filter((k) => matrix.some((r) => r[k]));
  matrix = matrix.map((r) => keep.map((k) => r[k]));
  if (keep.length < 2) throw new TabelError('Tabel harus punya minimal 2 kolom (misalnya nama dan harga).');

  // baris judul kolom (dicari di 10 baris pertama)
  let header = -1;
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    const known = matrix[i].map((t) => (t ? roleOf(t) : null)).filter((r) => r && r !== 'abaikan').length;
    if (known >= 2 && !matrix[i].some((t) => t && isNumCell(t) && /\d{3,}/.test(t))) { header = i; break; }
  }
  const nCol = matrix[0].length;
  const labels = header >= 0 ? matrix[header] : Array(nCol).fill('');
  const hdrKey = header >= 0 ? matrix[header].map((t) => t.toLowerCase()).join('|') : null;
  const data = matrix.filter((line, i) => i > header && (hdrKey === null || line.map((t) => t.toLowerCase()).join('|') !== hdrKey));
  const dataNoTitle = header >= 0 ? data : matrix; // tanpa judul: semua baris adalah data

  const guess = Array(nCol).fill('abaikan'); const catatan = [];
  if (header >= 0) {
    const roles = labels.map((t) => (t ? roleOf(t) : null));
    const used = new Set();
    // "harga jual" menang atas kolom "price"/"harga" biasa (yang bisa saja harga modal / harga pesaing)
    const jual = roles.findIndex((r, k) => r === 'harga' && /jual/i.test(labels[k]));
    roles.forEach((r, k) => {
      if (!r || r === 'abaikan' || used.has(r)) return;
      if (r === 'harga' && jual >= 0 && k !== jual) return;
      guess[k] = r; used.add(r);
    });
    // Kolom "price" / "harga" biasa di samping "harga jual": biasanya harga modal. Dianggap HPP bila hampir semua barisnya <= harga jual.
    if (jual >= 0 && !used.has('hpp')) {
      const cand = roles.findIndex((r, k) => r === 'harga' && k !== jual);
      if (cand >= 0) {
        let n = 0, murah = 0;
        for (const l of data) { const a = parseAngka(l[cand]), b = parseAngka(l[jual]); if (a !== null && b !== null && b > 0) { n++; if (a <= b) murah++; } }
        if (n >= 3 && murah / n >= 0.7) { guess[cand] = 'hpp'; catatan.push(`Kolom "${labels[cand]}" dianggap HPP (harga modal) karena ${Math.round((murah / n) * 100)}% barisnya lebih kecil dari "${labels[jual]}". Ubah di bawah kalau salah.`); }
      }
    }
  } else {
    const stat = Array.from({ length: nCol }, (_, k) => {
      const v = dataNoTitle.map((l) => l[k]).filter(Boolean);
      const numeric = v.length > 0 && v.filter(isNumCell).length / v.length > 0.8;
      const ints = numeric ? v.map(parseAngka) : [];
      const seq = numeric && ints.length > 2 && ints.every((x, i) => x === i + 1 || x === ints[0] + i);
      return { numeric, seq, len: v.reduce((a, s) => a + s.length, 0) / (v.length || 1), k };
    });
    if (!stat.some((s) => s.numeric)) throw new TabelError('Tidak ada kolom angka (harga) di file ini. Pastikan berisi daftar barang dengan kolom nama dan harga.');
    const text = stat.filter((s) => !s.numeric).sort((a, b) => b.len - a.len);
    if (text[0]) guess[text[0].k] = 'nama';
    const kodeCol = stat.filter((s) => !s.numeric && s.k !== (text[0] && text[0].k) && s.len <= 20)[0]
      || stat.filter((s) => s.numeric && !s.seq && s.len >= 5 && s.k < (text[0] ? text[0].k : 99))[0];
    if (kodeCol) guess[kodeCol.k] = 'kode';
    const rest = stat.filter((s) => s.numeric && !s.seq && guess[s.k] === 'abaikan');
    const order = rest.length === 1 ? ['harga'] : rest.length === 2 ? ['harga', 'stok'] : ['harga', 'hpp', 'stok'];
    rest.slice(0, order.length).forEach((s, i) => { guess[s.k] = order[i]; });
  }
  return { kolom: labels.map((label, k) => ({ label, tebakan: guess[k] })), baris: dataNoTitle.filter((l) => l.some(Boolean)).slice(0, 5000), judul_ditemukan: header >= 0, catatan };
}

module.exports = { analisis, roleOf, isNumCell, TabelError };
