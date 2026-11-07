'use strict';
// Pembuat file PDF sederhana (tanpa paket luar) khusus untuk Laporan Penjualan.
const zlib = require('node:zlib');
const { HELV } = require('./pdftext.js');

const rp = (n) => 'Rp ' + String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const angka = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const tglID = (s) => (s ? s.slice(8, 10) + '-' + s.slice(5, 7) + '-' + s.slice(0, 4) : '');

class Pdf {
  constructor() { this.W = 595.28; this.H = 841.89; this.pages = []; }
  newPage() { this.cur = []; this.pages.push(this.cur); return this.cur; }
  width(str, size, bold) { let w = 0; for (const ch of String(str)) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HELV[c - 32] : 556; } return (w * size / 1000) * (bold ? 1.07 : 1); }
  fit(str, maxW, size, bold) { // potong teks yang kepanjangan
    str = String(str); if (this.width(str, size, bold) <= maxW) return str;
    while (str.length > 1 && this.width(str + '...', size, bold) > maxW) str = str.slice(0, -1);
    return str + '...';
  }
  esc(s) { let o = ''; for (const ch of String(s)) { const c = ch.charCodeAt(0); const k = c > 255 ? '?' : ch; o += k === '(' || k === ')' || k === '\\' ? '\\' + k : k; } return o; }
  text(x, y, str, size = 10, o = {}) { // y dari atas halaman
    const w = this.width(str, size, o.bold);
    const xx = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    const g = o.gray ?? 0;
    this.cur.push(`BT ${g} g /${o.bold ? 'F2' : 'F1'} ${size} Tf ${xx.toFixed(2)} ${(this.H - y).toFixed(2)} Td (${this.esc(str)}) Tj ET`);
  }
  line(x1, y1, x2, y2, w = 0.5, gray = 0.6) { this.cur.push(`${gray} G ${w} w ${x1.toFixed(2)} ${(this.H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.H - y2).toFixed(2)} l S`); }
  rect(x, y, w, h, gray) { this.cur.push(`${gray} g ${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  build() {
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add(null);
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const content = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const cid = objs.length + 2;
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`));
      add({ stream: content });
    }
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')]; const offs = []; let pos = parts[0].length;
    objs.forEach((o, i) => {
      offs.push(pos);
      const b = o && o.stream
        ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${o.stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')])
        : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
      parts.push(b); pos += b.length;
    });
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; for (const o of offs) x += String(o).padStart(10, '0') + ' 00000 n \n';
    x += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(Buffer.from(x, 'latin1'));
    return Buffer.concat(parts);
  }
}

// d: { toko, alamat, dari, sampai, dicetak, r (hasil report), transaksi[], barang[] }
function buatLaporanPdf(d) {
  const pdf = new Pdf(); const M = 40, RW = pdf.W - 2 * M, BOTTOM = pdf.H - 50;
  let y = 0; pdf.newPage();
  const ensure = (h, redraw) => { if (y + h > BOTTOM) { pdf.newPage(); y = M; if (redraw) redraw(); } };
  const periode = d.dari === d.sampai ? tglID(d.dari) : `${tglID(d.dari)} s/d ${tglID(d.sampai)}`;

  pdf.text(M, M + 14, d.toko || 'Toko', 16, { bold: true });
  if (d.alamat) pdf.text(M, M + 28, d.alamat, 9, { gray: 0.4 });
  pdf.text(pdf.W - M, M + 14, 'LAPORAN PENJUALAN', 12, { bold: true, align: 'right' });
  pdf.text(pdf.W - M, M + 28, 'Periode: ' + periode, 10, { align: 'right' });
  pdf.line(M, M + 38, pdf.W - M, M + 38, 1, 0.3);
  y = M + 56;

  // ringkasan (2 kolom)
  const r = d.r;
  const kiri = [['Jumlah transaksi', angka(r.jumlah)], ['Omzet (penjualan bersih)', rp(r.omzet)], ['Diskon diberikan', rp(r.diskon)], ['Laba kotor', rp(r.laba)]];
  const kanan = [['Tunai', rp(r.tunai)], ['Transfer', rp(r.transfer)], ['QRIS', rp(r.qris)], ['Transaksi dibatalkan (tidak dihitung)', angka(r.batal)]];
  const colW = RW / 2 - 8;
  for (let i = 0; i < 4; i++) {
    for (const [k, [lab, val]] of [[0, kiri[i]], [1, kanan[i]]]) {
      const x0 = M + k * (colW + 16);
      pdf.rect(x0, y - 11, colW, 19, i % 2 ? 1 : 0.95);
      pdf.text(x0 + 6, y + 2, lab, 9.5, { gray: 0.25 }); pdf.text(x0 + colW - 6, y + 2, val, 10, { bold: true, align: 'right' });
    }
    y += 19;
  }
  y += 14;

  // tabel umum
  const tabel = (judul, kolom, baris, total) => {
    const head = () => {
      pdf.rect(M, y - 10, RW, 17, 0.88);
      let x = M; for (const c of kolom) { const tx = c.align === 'right' ? x + c.w - 5 : x + 5; pdf.text(tx, y + 2, c.h, 9, { bold: true, align: c.align }); x += c.w; }
      y += 17;
    };
    ensure(60); pdf.text(M, y, judul, 11, { bold: true }); y += 14; head();
    for (const row of baris) {
      ensure(15, head);
      let x = M;
      kolom.forEach((c, i) => { const t = pdf.fit(row.cells[i], c.w - 10, 9, false); const tx = c.align === 'right' ? x + c.w - 5 : x + 5; pdf.text(tx, y + 1, t, 9, { align: c.align, gray: row.gray ?? 0 }); x += c.w; });
      pdf.line(M, y + 5, M + RW, y + 5, 0.3, 0.85); y += 15;
    }
    if (total) {
      ensure(18, head); pdf.line(M, y - 6, M + RW, y - 6, 0.8, 0.3);
      let x = M; kolom.forEach((c, i) => { if (total[i] !== '') { const tx = c.align === 'right' ? x + c.w - 5 : x + 5; pdf.text(tx, y + 6, total[i], 9.5, { bold: true, align: c.align }); } x += c.w; });
      y += 20;
    }
    y += 10;
  };

  if (d.dari !== d.sampai && d.perHari && d.perHari.length)
    tabel('Rekap per hari', [{ h: 'Tanggal', w: 200 }, { h: 'Transaksi', w: 120, align: 'right' }, { h: 'Omzet', w: RW - 320, align: 'right' }],
      d.perHari.map((h) => ({ cells: [tglID(h.tgl), angka(h.jumlah), rp(h.omzet)] })), ['TOTAL', angka(r.jumlah), rp(r.omzet)]);

  const multi = d.dari !== d.sampai;
  tabel(`Daftar transaksi (${d.transaksi.length})`,
    [{ h: 'No. Nota', w: 95 }, { h: multi ? 'Tanggal / jam' : 'Jam', w: multi ? 100 : 60 }, { h: 'Pembayaran', w: multi ? 120 : 160 }, { h: 'Diskon', w: 80, align: 'right' }, { h: 'Total', w: 0, align: 'right' }]
      .map((c, _, a) => (c.w === 0 ? { ...c, w: RW - a.reduce((s, k) => s + k.w, 0) } : c)),
    d.transaksi.map((t) => ({
      gray: t.status === 'void' ? 0.55 : 0,
      cells: [t.no, multi ? tglID(t.ts.slice(0, 10)) + ' ' + t.ts.slice(11, 16) : t.ts.slice(11, 16),
        t.status === 'void' ? 'BATAL' : [t.tunai && 'Tunai', t.transfer && 'Transfer', t.qris && 'QRIS'].filter(Boolean).join(' + '),
        t.diskon ? rp(t.diskon) : '-', t.status === 'void' ? '(' + angka(t.total) + ')' : rp(t.total)],
    })), ['TOTAL', '', '', rp(r.diskon), rp(r.omzet)]);

  if (d.barang.length)
    tabel(`Rincian barang terjual (${d.barang.length} jenis)`,
      [{ h: 'Kode', w: 80 }, { h: 'Nama barang', w: RW - 80 - 55 - 105 }, { h: 'Jumlah', w: 55, align: 'right' }, { h: 'Nilai', w: 105, align: 'right' }],
      d.barang.map((b) => ({ cells: [b.kode, b.nama, angka(b.qty), rp(b.nilai)] })),
      ['', 'TOTAL', angka(d.barang.reduce((s, b) => s + b.qty, 0)), rp(d.barang.reduce((s, b) => s + b.nilai, 0))]);

  if (r.diskon_nota > 0 && d.barang.length) {
    ensure(16); pdf.text(M, y, `Catatan: nilai barang sudah dikurangi diskon per barang, tetapi belum dikurangi diskon nota (${rp(r.diskon_nota)}), sehingga totalnya bisa lebih besar dari omzet.`, 8, { gray: 0.4 }); y += 12;
  }

  // catatan kaki + nomor halaman di semua halaman
  const n = pdf.pages.length;
  pdf.pages.forEach((ops, i) => {
    pdf.cur = ops;
    pdf.line(M, pdf.H - 38, pdf.W - M, pdf.H - 38, 0.5, 0.8);
    pdf.text(M, pdf.H - 26, `${d.toko || ''}  -  dicetak ${d.dicetak}`, 8, { gray: 0.45 });
    pdf.text(pdf.W - M, pdf.H - 26, `Halaman ${i + 1} dari ${n}`, 8, { gray: 0.45, align: 'right' });
  });
  return pdf.build();
}

module.exports = { buatLaporanPdf };
