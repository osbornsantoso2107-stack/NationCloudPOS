// Tes otomatis. Jalankan: node test.js  (memakai database sementara, data toko TIDAK tersentuh)
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const assert = require('node:assert/strict'); const { execFileSync } = require('node:child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncpos-'));
process.env.POS_DB = path.join(tmp, 'pos.db');
const pos = require('./server.js');
const { parseAngka, parseDiskon } = require('./public/angka.js');
const { bacaFile } = require('./excel.js');
const ex = (fn, re, msg) => assert.throws(fn, re, msg);
const hariIni = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
let nTes = 0; const ok = (nama, fn) => { fn(); nTes++; };

// ---------- angka ----------
ok('angka', () => {
  assert.equal(parseAngka('15.000'), 15000); assert.equal(parseAngka('Rp 1.250.000'), 1250000); assert.equal(parseAngka('Rp 15.000,50'), 15001);
  assert.equal(parseAngka('15,000'), 15000); assert.equal(parseAngka('12,5'), 13); assert.equal(parseAngka('12 pcs'), 12); assert.equal(parseAngka('-'), null);
  assert.equal(parseAngka(''), null); assert.equal(parseAngka('abc'), null); assert.equal(parseAngka('27334'), 27334); assert.equal(parseAngka(57500), 57500);
  assert.equal(parseDiskon('10%', 50000), 5000); assert.equal(parseDiskon('2.500', 50000), 2500); assert.equal(parseDiskon('', 5), 0); assert.ok(Number.isNaN(parseDiskon('abc', 5))); assert.ok(Number.isNaN(parseDiskon('120%', 5)));
});

// ---------- barang & penjualan dasar ----------
pos.saveItem({ kode: 'sabun', nama: 'Sabun Mandi', harga: 3000, hpp: 2000, stok: 10 });
pos.saveItem({ kode: 'GULA1', nama: 'Gula 1kg', harga: 15000, hpp: 13000, stok: 5 });
ok('stok & cari', () => { assert.equal(pos.stokDari('SABUN'), 10); assert.equal(pos.listItems('mandi sab').length, 1); });

let s;
ok('jual + kembalian', () => {
  s = pos.createSale({ lines: [{ kode: 'SABUN', qty: 2 }, { kode: 'GULA1', qty: 1 }], tunai: 25000 });
  assert.equal(s.total, 21000); assert.equal(s.kembali, 4000); assert.equal(s.tunai, 21000); assert.equal(s.diskon_nota, 0);
  assert.equal(pos.stokDari('SABUN'), 8); assert.equal(pos.stokDari('GULA1'), 4);
});

// ---------- harga manual & diskon ----------
ok('harga manual', () => {
  s = pos.createSale({ lines: [{ kode: 'SABUN', qty: 2, harga: '2.500' }], tunai: 5000 });
  assert.equal(s.total, 5000); assert.equal(s.lines[0].harga, 2500); assert.equal(s.lines[0].harga_asli, 3000);
  ex(() => pos.createSale({ lines: [{ kode: 'SABUN', qty: 1, harga: 'abc' }], tunai: 9999 }), /tidak valid/);
  ex(() => pos.createSale({ lines: [{ kode: 'SABUN', qty: 1, harga: -5 }], tunai: 9999 }), /tidak valid/);
});
ok('diskon baris (Rp dan %)', () => {
  s = pos.createSale({ lines: [{ kode: 'GULA1', qty: 2, diskon: '10%' }], tunai: 27000 }); assert.equal(s.total, 27000); assert.equal(s.lines[0].diskon, 3000);
  s = pos.createSale({ lines: [{ kode: 'GULA1', qty: 2, diskon: '5000' }], tunai: 25000 }); assert.equal(s.total, 25000);
  ex(() => pos.createSale({ lines: [{ kode: 'GULA1', qty: 1, diskon: '20000' }], tunai: 99999 }), /melebihi/);
  ex(() => pos.createSale({ lines: [{ kode: 'GULA1', qty: 1, diskon: 'xx' }], tunai: 99999 }), /tidak valid/);
  ex(() => pos.createSale({ lines: [{ kode: 'GULA1', qty: 1, diskon: '-100' }], tunai: 99999 }), /tidak valid/);
});
ok('diskon nota', () => {
  s = pos.createSale({ lines: [{ kode: 'GULA1', qty: 2 }, { kode: 'SABUN', qty: 1 }], diskon_nota: '10%', tunai: 30000 });
  assert.equal(s.subtotal, 33000); assert.equal(s.diskon_nota, 3300); assert.equal(s.total, 29700); assert.equal(s.kembali, 300);
  ex(() => pos.createSale({ lines: [{ kode: 'SABUN', qty: 1 }], diskon_nota: '99999', tunai: 99999 }), /melebihi/);
  s = pos.createSale({ lines: [{ kode: 'SABUN', qty: 1 }], diskon_nota: '100%', tunai: 0 }); assert.equal(s.total, 0); // gratis (mis. bonus) tetap tercatat
});

// ---------- validasi pembayaran / stok ----------
ok('validasi', () => {
  ex(() => pos.createSale({ lines: [{ kode: 'SABUN', qty: 1 }], tunai: 1000 }), /kurang/i);
  ex(() => pos.createSale({ lines: [{ kode: 'SABUN', qty: 1 }], qris: 5000 }), /tunai/i);
  ex(() => pos.createSale({ lines: [{ kode: 'SABUN', qty: -1 }], tunai: 5000 }), /lebih dari 0/);
  ex(() => pos.createSale({ lines: [], tunai: 1 }), /kosong/i);
  ex(() => pos.createSale({ lines: [{ kode: 'TIDAKADA', qty: 1 }], tunai: 5000 }), /tidak ditemukan/);
});
ok('stok minus: boleh (bawaan) atau diblokir (pengaturan)', () => {
  const sebelum = pos.stokDari('SABUN');
  s = pos.createSale({ lines: [{ kode: 'SABUN', qty: sebelum + 5 }], tunai: 999999 });
  assert.equal(pos.stokDari('SABUN'), -5); // stok minus diizinkan agar kasir tidak terhenti
  pos.setStok('SABUN', 20);
  pos.db.prepare("INSERT INTO meta(k,v) VALUES('blok_stok','1')").run();
  ex(() => pos.createSale({ lines: [{ kode: 'SABUN', qty: 21 }], tunai: 999999 }), /Stok/);
  pos.db.prepare("DELETE FROM meta WHERE k='blok_stok'").run();
});

// ---------- batal & hapus penjualan ----------
ok('batal -> stok kembali', () => {
  pos.setStok('GULA1', 10);
  const a = pos.createSale({ lines: [{ kode: 'GULA1', qty: 2 }], tunai: 30000 });
  assert.equal(pos.stokDari('GULA1'), 8);
  pos.voidSale(a.id, 'salah input'); assert.equal(pos.stokDari('GULA1'), 10);
  ex(() => pos.voidSale(a.id, 'lagi'), /sudah dibatalkan/);
});
ok('hapus penjualan (lunas & batal) mengembalikan stok, nomor nota tidak bentrok', () => {
  pos.setStok('GULA1', 10);
  const a = pos.createSale({ lines: [{ kode: 'GULA1', qty: 3 }], tunai: 45000 });
  const b = pos.createSale({ lines: [{ kode: 'GULA1', qty: 1 }], tunai: 15000 });
  const c = pos.createSale({ lines: [{ kode: 'GULA1', qty: 1 }], tunai: 15000 });
  pos.voidSale(c.id, 'tes');
  assert.equal(pos.stokDari('GULA1'), 6);
  assert.equal(pos.hapusPenjualan([a.id, c.id]).dihapus, 2);
  assert.equal(pos.stokDari('GULA1'), 9, 'stok penjualan lunas yang dihapus kembali; yang sudah batal tidak dobel');
  ex(() => pos.getSale(a.id), /tidak ada/);
  const d = pos.createSale({ lines: [{ kode: 'GULA1', qty: 1 }], tunai: 15000 });
  assert.notEqual(d.no, b.no); // tidak error UNIQUE setelah ada nota yang dihapus
  assert.equal(pos.hapusPenjualan([999999]).dihapus, 0);
  ex(() => pos.hapusPenjualan([]), /Tidak ada/);
  pos.hapusPenjualan([b.id, d.id]); pos.setStok('GULA1', 4);
});

// ---------- barang baru tidak boleh menimpa kode lama ----------
ok('barang baru dengan kode yang sudah dipakai ditolak; kode kosong dibuat otomatis', () => {
  pos.saveItem({ kode: 'XLIMTES', nama: 'XLIM V3 RACE RED', harga: 100000, hpp: 0, stok: 5 });
  ex(() => pos.saveItem({ baru: true, kode: 'xlimtes', nama: 'NIXX FILTER PLUS LAVENDER', harga: 50000 }), /sudah dipakai/);
  assert.equal(pos.listItems('XLIMTES')[0].nama, 'XLIM V3 RACE RED', 'barang lama tidak tertimpa');
  const a = pos.saveItem({ baru: true, kode: '', nama: 'NIXX FILTER PLUS LAVENDER', harga: 50000, stok: 3 });
  assert.match(a.kode, /^BRG\d{4}$/);
  pos.saveItem({ kode: 'XLIMTES', nama: 'XLIM V3 RACE RED 2', harga: 100000 }); // ubah barang (tanpa "baru") tetap boleh
  pos.hapusBarang(['XLIMTES', a.kode]);
});

// ---------- ubah isi nota ----------
ok('hapus / kurangi barang di nota: stok, total, pembayaran, nota kosong = batal', () => {
  pos.saveItem({ kode: 'UBH1', nama: 'Barang Satu', harga: 10000, stok: 10 });
  pos.saveItem({ kode: 'UBH2', nama: 'Barang Dua', harga: 20000, stok: 10 });
  const s = pos.createSale({ lines: [{ kode: 'UBH1', qty: 3 }, { kode: 'UBH2', qty: 1, diskon: '2000' }], diskon_nota: '1000', tunai: 60000 });
  assert.equal(s.total, 30000 + 18000 - 1000); assert.equal(s.kembali, 13000);
  const [l1, l2] = s.lines; assert.ok(l1.id && l2.id);
  assert.equal(pos.stokDari('UBH1'), 7);
  let r = pos.ubahBaris(s.id, l1.id, 1, 'tunai'); // 3 -> 1
  assert.equal(pos.stokDari('UBH1'), 9); assert.equal(r.total, 10000 + 18000 - 1000);
  assert.equal(r.tunai + r.transfer + r.qris, r.total, 'pembayaran = total');
  r = pos.ubahBaris(s.id, l2.id, 0, 'tunai'); // hapus Barang Dua
  assert.equal(pos.stokDari('UBH2'), 10); assert.equal(r.lines.length, 1); assert.equal(r.total, 9000);
  ex(() => pos.ubahBaris(s.id, l1.id, 5, 'tunai'), /dikurangi/);
  r = pos.ubahBaris(s.id, l1.id, 0, 'tunai'); // barang terakhir -> nota batal
  assert.equal(r.status, 'void'); assert.equal(pos.stokDari('UBH1'), 10);
  ex(() => pos.ubahBaris(s.id, l1.id, 0, 'tunai'), /batal/);
  assert.equal(pos.report(r.tgl, r.tgl).omzet >= 0, true);
  // pembayaran campuran: uang kembali diambil dari metode yang dipilih lebih dulu
  const t = pos.createSale({ lines: [{ kode: 'UBH1', qty: 2 }, { kode: 'UBH2', qty: 1 }], tunai: 10000, qris: 30000 });
  const r2 = pos.ubahBaris(t.id, t.lines[1].id, 0, 'qris');
  assert.equal(r2.qris, 10000); assert.equal(r2.tunai, 10000); assert.equal(r2.total, 20000);
  pos.hapusPenjualan([s.id, t.id]); pos.hapusBarang(['UBH1', 'UBH2']);
});

// ---------- laba per nota ----------
ok('laba per nota = hitungan Laporan; ikut berubah saat isi nota diubah', () => {
  pos.saveItem({ kode: 'LB1', nama: 'Laba Satu', harga: 10000, hpp: 6000, stok: 10 });
  pos.saveItem({ kode: 'LB2', nama: 'Laba Dua', harga: 5000, hpp: 0, stok: 10 });
  const before = pos.report('2000-01-01', '2999-12-31').laba;
  const s = pos.createSale({ lines: [{ kode: 'LB1', qty: 3, diskon: '1000' }, { kode: 'LB2', qty: 2 }], diskon_nota: '1001', tunai: 100000 });
  // (30000-1000-18000) + (10000-0) - 1001 = 19999
  assert.equal(s.laba.laba, 19999); assert.equal(s.laba.hpp, 18000); assert.equal(s.laba.net, s.total); assert.equal(s.laba.tanpaHpp, 1);
  assert.equal(Object.values(s.laba.baris).reduce((a, b) => a + b.laba, 0), s.laba.laba, 'jumlah laba per barang = laba nota');
  assert.equal(pos.report('2000-01-01', '2999-12-31').laba - before, s.laba.laba, 'sama dengan Laporan');
  const r = pos.ubahBaris(s.id, s.lines[1].id, 0, 'tunai');
  assert.equal(r.laba.laba, r.total - 18000);
  assert.equal(pos.voidSale(s.id, 'tes').laba, undefined);
  pos.hapusPenjualan([s.id]); pos.hapusBarang(['LB1', 'LB2']);
});

// ---------- lokasi backup ----------
ok('lokasi backup bisa dipilih; folder rusak -> cadangan di folder bawaan + peringatan', () => {
  const tujuan = path.join(tmp, 'flashdisk', 'Backup Toko');
  const r = pos.aturFolderBackup(tujuan);
  assert.equal(r.folder, tujuan); assert.ok(fs.existsSync(r.file)); assert.equal(pos.backupNow().folder, tujuan);
  ex(() => pos.aturFolderBackup('folder\\relatif'), /lokasi lengkap/);
  const rusak = path.join(tmp, 'berkas.txt'); fs.writeFileSync(rusak, 'x');
  ex(() => pos.aturFolderBackup(path.join(rusak, 'sub')), /tidak bisa dipakai/);
  assert.equal(pos.backupNow().folder, tujuan, 'pengaturan lama tidak berubah setelah input salah');
  fs.rmSync(path.join(tmp, 'flashdisk'), { recursive: true, force: true }); fs.writeFileSync(path.join(tmp, 'flashdisk'), 'bukan folder'); // folder pilihan "hilang"
  const f = pos.backupNow(); assert.ok(f.peringatan && fs.existsSync(f.file)); assert.notEqual(f.folder, tujuan);
  fs.rmSync(path.join(tmp, 'flashdisk'), { force: true });
  const b = pos.aturFolderBackup(''); assert.notEqual(b.folder, tujuan); assert.equal(b.peringatan, undefined);
});

// ---------- laporan ----------
ok('laporan: omzet, diskon, laba, rentang tanggal', () => {
  pos.db.exec('DELETE FROM sale_lines; DELETE FROM sales; DELETE FROM moves'); pos.setStok('SABUN', 100); pos.setStok('GULA1', 100);
  pos.createSale({ lines: [{ kode: 'SABUN', qty: 2 }, { kode: 'GULA1', qty: 1, diskon: '1000' }], tunai: 30000 });     // 6000 + 14000 = 20000
  pos.createSale({ lines: [{ kode: 'GULA1', qty: 1, harga: 14000 }], diskon_nota: '500', transfer: 13500 });         // 13500
  const x = pos.createSale({ lines: [{ kode: 'SABUN', qty: 1 }], qris: 3000 }); pos.voidSale(x.id, 'batal');
  const r = pos.report(hariIni(), hariIni());
  assert.equal(r.omzet, 33500); assert.equal(r.jumlah, 2); assert.equal(r.batal, 1); assert.equal(r.diskon, 1500);
  assert.equal(r.tunai + r.transfer + r.qris, r.omzet);
  // laba = (6000-4000) + (14000-13000) + (14000-13000) - 500
  assert.equal(r.laba, 2000 + 1000 + 1000 - 500);
  assert.equal(r.barang.reduce((a, b) => a + b.nilai, 0), 20000 + 14000);
  assert.equal(pos.report('2000-01-01', hariIni()).jumlah, 2);
  assert.equal(pos.report('2000-01-01', '2000-01-02').jumlah, 0);
  assert.equal(r.stokMenipis, undefined, 'laporan tidak memuat stok menipis');
});
ok('laporan PDF valid & terbaca', () => {
  const pdf = pos.laporanPdf(hariIni(), hariIni());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.toString('latin1').trimEnd().endsWith('%%EOF'));
  const { extractPages } = require('./pdftext.js');
  const teks = extractPages(pdf).flat().map((f) => f.str).join(' ');
  for (const w of ['LAPORAN PENJUALAN', 'Omzet', '33.500', 'Rincian barang terjual', 'Sabun Mandi', 'Halaman 1 dari 1']) assert.ok(teks.includes(w), 'PDF harus memuat: ' + w);
  // banyak data -> beberapa halaman
  for (let i = 0; i < 70; i++) pos.saveItem({ kode: 'PDF' + i, nama: 'Barang PDF ' + i, harga: 1000 + i, hpp: 500, stok: 5 }), pos.createSale({ lines: [{ kode: 'PDF' + i, qty: 1 }], tunai: 5000 });
  const p2 = pos.laporanPdf(hariIni(), hariIni()); const pages = extractPages(p2); assert.ok(pages.length >= 3, 'laporan panjang harus lebih dari 1 halaman');
  assert.ok(pages.flat().map((f) => f.str).join(' ').includes(`Halaman ${pages.length} dari ${pages.length}`));
});

// ---------- hapus barang ----------
ok('hapus barang', () => {
  const sebelum = pos.listItems('').length;
  assert.equal(pos.hapusBarang(['PDF1', 'PDF2', 'TIDAKADA']).dihapus, 2);
  assert.equal(pos.listItems('').length, sebelum - 2);
  assert.equal(pos.stokDari('PDF1'), 0);
  // riwayat penjualan barang yang dihapus tetap ada, dan tidak error
  const r = pos.report(hariIni(), hariIni()); assert.ok(r.barang.some((b) => b.kode === 'PDF1'));
  ex(() => pos.hapusBarang([]), /Tidak ada/);
  const sale = pos.db.prepare("SELECT s.id FROM sales s JOIN sale_lines l ON l.sale_id=s.id WHERE l.kode='PDF3'").get();
  pos.hapusBarang(['PDF3']); pos.voidSale(sale.id, 'barang sudah dihapus'); assert.equal(pos.stokDari('PDF3'), 0);
});

// ---------- impor barang ----------
ok('impor: baru, ganda, kode otomatis, lewati/perbarui, gagal', () => {
  pos.db.exec('DELETE FROM sale_lines; DELETE FROM sales; DELETE FROM moves; DELETE FROM items');
  const rows = [
    { nama: 'Balon Latex Merah', harga: '2.500', hpp: '1.500', stok: '100' },
    { nama: 'Topi Ulang Tahun', harga: 'Rp 1.500' },
    { kode: 'lilin5', nama: 'Lilin Angka 5', harga: '3000', stok: '12 pcs' },
    { nama: '  balon   latex merah ', harga: '2.700' },           // ganda (nama sama)
    { nama: '', harga: '1000' }, { nama: 'Tanpa Harga', harga: '' }, { nama: 'Harga Strip', harga: '-' },
    { nama: 'Stok Minus', harga: '1000', stok: '-3' }, { kode: 'bad code!', nama: 'Kode Jelek', harga: '1000' },
    { nama: 'Topi Ulang Tahun', harga: '' },                          // barang yang sama dari baris lain, harga kosong: dilewati, bukan gagal
  ];
  let h = pos.importBarang({ rows, mode: 'lewati' });
  assert.deepEqual([h.baru, h.dilewati, h.diperbarui, h.gagal.length], [3, 2, 0, 5]);
  assert.deepEqual(h.gagal.map((g) => g.baris), [5, 6, 7, 8, 9]);
  const b = pos.listItems('balon')[0]; assert.equal(b.kode, 'BRG0001'); assert.equal(b.harga, 2500); assert.equal(b.hpp, 1500); assert.equal(b.stok, 100);
  assert.equal(pos.listItems('topi')[0].kode, 'BRG0002'); assert.equal(pos.listItems('lilin')[0].kode, 'LILIN5'); assert.equal(pos.listItems('lilin')[0].stok, 12);
  // impor ulang file yang sama tidak menggandakan
  h = pos.importBarang({ rows: rows.slice(0, 3), mode: 'lewati' }); assert.deepEqual([h.baru, h.dilewati], [0, 3]); assert.equal(pos.listItems('').length, 3);
  // perbarui harga (stok tidak berubah kecuali diminta)
  h = pos.importBarang({ rows: [{ nama: 'Balon Latex Merah', harga: '3.000', stok: '5' }], mode: 'perbarui' });
  assert.equal(h.diperbarui, 1); assert.equal(pos.listItems('balon')[0].harga, 3000); assert.equal(pos.listItems('balon')[0].hpp, 1500); assert.equal(pos.listItems('balon')[0].stok, 100);
  pos.importBarang({ rows: [{ nama: 'Balon Latex Merah', harga: '3.000', stok: '5' }], mode: 'perbarui', atur_stok: true }); assert.equal(pos.listItems('balon')[0].stok, 5);
  // kode otomatis lanjut dari yang terbesar
  pos.importBarang({ rows: [{ nama: 'Barang Baru X', harga: '100' }], mode: 'lewati' }); assert.equal(pos.listItems('baru x')[0].kode, 'BRG0003');
  ex(() => pos.importBarang({ rows: [] }), /Tidak ada/);
});

// ---------- baca Excel (xlsx dibuat langsung di tes) + CSV ----------
function buatXlsx(rows, sheetName = 'Data') {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const strings = []; const si = (t) => { let i = strings.indexOf(t); if (i < 0) { strings.push(t); i = strings.length - 1; } return i; };
  const colL = (c) => String.fromCharCode(65 + c);
  const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows.map((r, i) =>
    `<row r="${i + 1}">` + r.map((v, c) => v === null ? '' : typeof v === 'number' ? `<c r="${colL(c)}${i + 1}"><v>${v}</v></c>` : `<c r="${colL(c)}${i + 1}" t="s"><v>${si(v)}</v></c>`).join('') + '</row>').join('') + '</sheetData></worksheet>';
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': '<?xml version="1.0"?><sst>' + strings.map((t) => `<si><t>${esc(t)}</t></si>`).join('') + '</sst>',
  };
  const loc = [], cen = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), comp = zlib.deflateRawSync(data), nm = Buffer.from(name), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    loc.push(lh, nm, comp); cen.push(ch, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(cen); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, end]);
}
ok('baca Excel: judul tidak di baris pertama, kolom kosong, baris sampah', () => {
  const x = buatXlsx([[null, 'DAFTAR HARGA TOKO'], [], [null, 'Nama produk', null, 'price', 'harga jual'], [null, 'Balon & Pita <A>', null, 1000, 1500], [null, 'batal', null, '-', null], [null, 'Topi', null, 2000, 2500]]);
  const t = bacaFile(x);
  assert.equal(t.sumber, 'xlsx'); assert.deepEqual(t.kolom.map((k) => k.tebakan), ['nama', 'abaikan', 'harga']);
  assert.equal(t.baris.length, 3); assert.deepEqual(t.baris[0], ['Balon & Pita <A>', '1000', '1500']);
});
ok('baca Excel tanpa judul kolom + CSV titik koma', () => {
  const t = bacaFile(buatXlsx([['A001', 'Sabun Mandi Besar', 4500, 10], ['A002', 'Gula Pasir 1 Kg', 15000, 4]]));
  assert.deepEqual(t.kolom.map((k) => k.tebakan), ['kode', 'nama', 'harga', 'stok']); assert.equal(t.judul_ditemukan, false);
  const c = bacaFile(Buffer.from('﻿Kode;Nama Barang;Harga Jual;Stok\nB1;"Balon; besar";2.500;10\nB2;Topi;1.500;3\n'));
  assert.equal(c.sumber, 'csv'); assert.deepEqual(c.kolom.map((k) => k.tebakan), ['kode', 'nama', 'harga', 'stok']); assert.deepEqual(c.baris[0], ['B1', 'Balon; besar', '2.500', '10']);
});
ok('file rusak / salah format memberi pesan jelas', () => {
  ex(() => bacaFile(Buffer.from('PK\x03\x04 rusak rusak rusak')), /rusak|Excel/);
  ex(() => bacaFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), /xlsx/);
  ex(() => bacaFile(Buffer.from('')), /kosong/);
  ex(() => bacaFile(Buffer.from('%PDF-1.4\n bukan pdf sungguhan')), /Halaman|PDF|teks/);
});

// ---------- migrasi database lama + HTTP ----------
ok('database versi lama bisa dibuka dan diperbarui', () => {
  const old = path.join(tmp, 'lama.db'); const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(old);
  d.exec(`CREATE TABLE items (kode TEXT PRIMARY KEY, nama TEXT NOT NULL, harga INTEGER NOT NULL DEFAULT 0, hpp INTEGER NOT NULL DEFAULT 0, aktif INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE moves (id INTEGER PRIMARY KEY AUTOINCREMENT, kode TEXT NOT NULL, qty INTEGER NOT NULL, doc_type TEXT NOT NULL, doc_no TEXT, ts TEXT NOT NULL);
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, no TEXT UNIQUE, ts TEXT NOT NULL, tgl TEXT NOT NULL, total INTEGER NOT NULL, tunai INTEGER NOT NULL DEFAULT 0, transfer INTEGER NOT NULL DEFAULT 0, qris INTEGER NOT NULL DEFAULT 0, kembali INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'paid', alasan TEXT);
    CREATE TABLE sale_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, kode TEXT NOT NULL, nama TEXT NOT NULL, qty INTEGER NOT NULL, harga INTEGER NOT NULL, hpp INTEGER NOT NULL);
    INSERT INTO sales(no,ts,tgl,total,tunai) VALUES('S250101-0001','2025-01-01 10:00:00','2025-01-01',9000,9000);
    INSERT INTO sale_lines(sale_id,kode,nama,qty,harga,hpp) VALUES(1,'X','Barang X',3,3000,2000);`); d.close();
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `const p=require('./server.js'); const s=p.getSale(1); const r=p.report('2025-01-01','2025-01-01'); console.log(JSON.stringify({l:s.lines[0],r:[r.omzet,r.laba,r.diskon]})); p.db.close();`], { cwd: __dirname, env: { ...process.env, POS_DB: old } });
  const j = JSON.parse(out.toString().trim().split('\n').pop());
  assert.equal(j.l.harga_asli, 3000); assert.equal(j.l.diskon, 0); assert.deepEqual(j.r, [9000, 3000, 0]);
});

(async () => {
  await new Promise((r) => pos.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + pos.server.address().port;
  const j = async (u, body) => { const r = await fetch(base + u, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { st: r.status, j: await r.json() }; };
  let r = await j('/api/impor/baca', undefined); assert.equal(r.st, 404); // GET tidak ada
  const up = await fetch(base + '/api/impor/baca', { method: 'POST', body: buatXlsx([['Nama Barang', 'Harga Jual'], ['Kopi Hitam', 5000], ['Teh Manis', 4000]]) });
  assert.equal(up.status, 200); const t = await up.json(); assert.equal(t.baris.length, 2);
  const bad = await fetch(base + '/api/impor/baca', { method: 'POST', body: Buffer.from('bukan file apa-apa, hanya teks') }); assert.equal(bad.status, 400);
  r = await j('/api/impor/simpan', { rows: t.baris.map((b) => ({ nama: b[0], harga: b[1] })), mode: 'lewati' }); assert.equal(r.j.baru, 2);
  r = await j('/api/sales', { lines: [{ kode: 'BRG0004', qty: 1, harga: '4.500', diskon: '10%' }], tunai: 5000 }); assert.equal(r.st, 200, JSON.stringify(r.j)); assert.equal(r.j.total, 4050);
  r = await j('/api/sales/hapus', { ids: [r.j.id] }); assert.equal(r.j.dihapus, 1);
  r = await j('/api/items/hapus', { kodes: ['BRG0004'] }); assert.equal(r.j.dihapus, 1);
  r = await j('/api/info', { blok_stok: true }); r = await j('/api/info'); assert.equal(r.j.blok_stok, true); assert.equal(r.j.versi.length > 0, true);
  const pdf = await fetch(base + `/api/laporan.pdf?dari=${hariIni()}&sampai=${hariIni()}`); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /attachment; filename="laporan-penjualan-\d{4}-\d{2}-\d{2}\.pdf"/); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  assert.equal((await fetch(base + '/api/laporan.pdf?dari=bukan-tanggal')).status, 400); assert.equal((await fetch(base + '/api/report?dari=2026-02-01&sampai=2026-01-01')).status, 400);
  r = await j('/api/audit'); assert.ok(r.j.some((a) => a.aksi === 'HAPUS_JUAL') && r.j.some((a) => a.aksi === 'IMPOR_BARANG'));
  assert.equal((await fetch(base + '/../server.js')).status, 404); assert.equal((await fetch(base + '/')).status, 200);
  nTes += 3;
  pos.server.close(); pos.db.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'test-update.js')], { encoding: 'utf8' }).trim()); nTes++;
  console.log(`Semua tes lulus (${nTes} kelompok).`);
})().catch((e) => { console.error(e); process.exit(1); });
