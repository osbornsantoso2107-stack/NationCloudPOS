// Pembaca angka Rupiah / diskon. Dipakai bersama oleh server (Node) dan browser.
(function (root) {
  'use strict';

  // "Rp 1.250.000", "15,000", "12 pcs", 57500  ->  bilangan bulat. Bukan angka -> null.
  function parseAngka(s) {
    if (s === null || s === undefined) return null;
    if (typeof s === 'number') return Number.isFinite(s) ? Math.round(s) : null;
    const m = /-?\d[\d.,\s]*/.exec(String(s).replace(/rp\.?|idr/gi, ' '));
    if (!m) return null;
    const t = m[0].replace(/\s+/g, '').replace(/[.,]+$/, '');
    const dots = (t.match(/\./g) || []).length, commas = (t.match(/,/g) || []).length;
    let v;
    if (dots && commas) { // keduanya ada: yang paling kanan adalah desimal
      const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',', thou = dec === '.' ? ',' : '.';
      v = Number(t.split(thou).join('').replace(dec, '.'));
    } else if (dots + commas === 0) v = Number(t);
    else {
      const parts = t.split(dots ? '.' : ',');
      if (parts.length > 2) v = Number(parts.join('')); // 1.250.000
      else { // 15.000 (ribuan) atau 12,5 (desimal)
        const depan = parts[0].replace('-', '');
        v = parts[1].length === 3 && depan.length <= 3 && depan !== '0' ? Number(parts.join('')) : Number(parts[0] + '.' + parts[1]);
      }
    }
    return Number.isFinite(v) ? Math.round(v) : null;
  }

  // Diskon: "5000" / "5.000" (rupiah) atau "10%" (persen dari base). Kosong -> 0. Tidak valid -> NaN. Minus dikembalikan apa adanya (ditolak pemanggil).
  function parseDiskon(s, base) {
    if (s === null || s === undefined) return 0;
    const t = String(s).trim();
    if (t === '') return 0;
    if (t.endsWith('%')) {
      const p = Number(t.slice(0, -1).trim().replace(',', '.'));
      if (!Number.isFinite(p) || p < 0 || p > 100) return NaN;
      return Math.round((base * p) / 100);
    }
    const v = parseAngka(t);
    return v === null ? NaN : v;
  }

  // Kunci pencocokan nama barang: huruf besar/kecil, spasi dan tanda pemisah (- , / ( ) ; :) diabaikan.
  // "Hanna 30ML - 15MG,Berry" dan "HANNA 30ML 15MG, BERRY" dianggap barang yang sama. Angka, titik dan + tetap dibedakan.
  function kunciNama(s) {
    const t = String(s ?? '').toUpperCase();
    const k = t.replace(/[-\u2013\u2014_\/,;:()\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
    return k || t.replace(/\s+/g, ' ').trim();
  }

  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
  const rp = (n) => (Number(n) < 0 ? '-Rp ' + fmt(-n) : 'Rp ' + fmt(n));

  const api = { parseAngka, parseDiskon, kunciNama, fmt, rp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Angka = api;
})(typeof self !== 'undefined' ? self : this);
