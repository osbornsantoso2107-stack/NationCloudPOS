// Tes update program: GitHub tiruan di komputer sendiri, program disalin ke folder sementara.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib'), http = require('node:http');
const assert = require('node:assert/strict');
const update = require('./update.js');
const { DatabaseSync } = require('node:sqlite');

function buatZip(files) {
  const loc = [], cen = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const d = Buffer.from(data), comp = zlib.deflateRawSync(d), nm = Buffer.from(name), crc = zlib.crc32(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    loc.push(lh, nm, comp); cen.push(ch, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(cen), end = Buffer.alloc(22); const n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, end]);
}
function bacaPohon(dir, pre = '', out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^(data|update|node_modules)$/.test(e.name) && !pre) continue;
    const r = pre + e.name; if (e.isDirectory()) bacaPohon(path.join(dir, e.name), r + '/', out); else out[r] = fs.readFileSync(path.join(dir, e.name));
  }
  return out;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncpos-upd-'));
  const prog = path.join(tmp, 'program'); fs.mkdirSync(path.join(prog, 'data'), { recursive: true });
  const asli = bacaPohon(__dirname); for (const k of Object.keys(asli)) if (/^test|^\.|\.zip$/.test(k)) delete asli[k];
  for (const [k, v] of Object.entries(asli)) { fs.mkdirSync(path.dirname(path.join(prog, k)), { recursive: true }); fs.writeFileSync(path.join(prog, k), v); }
  // database toko "asli" berisi data
  const dbFile = path.join(prog, 'data', 'pos.db'); const d0 = new DatabaseSync(dbFile); d0.exec("CREATE TABLE x(a); INSERT INTO x VALUES('data toko penting')"); d0.close();
  const versiLama = JSON.parse(fs.readFileSync(path.join(prog, 'versi.json'), 'utf8')).versi;

  // versi baru di "GitHub": ubah versi + tambah file baru
  let versiBaru = '99.0.0'; let zipBuf;
  const susunZip = (extra = {}, ubahVersi = versiBaru) => {
    const f = { ...asli, ...extra }; f['versi.json'] = JSON.stringify({ versi: ubahVersi, repo: '', cabang: 'main', catatan: ['Fitur contoh', 'Perbaikan contoh'] });
    f['fitur-baru.txt'] = 'halo'; const top = {}; for (const [k, v] of Object.entries(f)) top['nationcloudpos-main/' + k] = v; return buatZip(top);
  };
  zipBuf = susunZip();
  let hit = 0; let versiJson = () => JSON.stringify({ versi: versiBaru, catatan: ['Fitur contoh', 'Perbaikan contoh'] });
  const srv = http.createServer((req, res) => {
    hit++;
    if (req.url.startsWith('/toko/nationcloudpos/main/versi.json')) { res.end(versiJson()); }
    else if (req.url === '/toko/nationcloudpos/archive/refs/heads/main.zip') { res.end(zipBuf); }
    else { res.statusCode = 404; res.end('nope'); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  process.env.POS_UPDATE_RAW = base; process.env.POS_UPDATE_ZIP = base; process.env.POS_NO_RESTART = '1';

  const ctx = (extra = {}) => ({ dir: prog, repo: 'toko/nationcloudpos', cabang: 'main', versi: versiLama,
    salinDb: (f) => { const d = new DatabaseSync(dbFile); d.exec(`VACUUM INTO '${f}'`); d.close(); },
    backup: () => { const f = path.join(prog, 'data', 'backup-tes.db'); fs.copyFileSync(dbFile, f); return { file: f }; },
    log: (a, b) => { ctx.catat.push([a, b]); }, ...extra });
  ctx.catat = [];

  // 1. nama repo / versi
  assert.throws(() => update.cekNama('bukan-repo', 'main'), /akun\/nama-repo/);
  assert.throws(() => update.cekNama('a/b', '../x'), /cabang/);
  assert.equal(update.lebihBaru('1.10.0', '1.9.9'), true); assert.equal(update.lebihBaru('1.4.1', '1.4.1'), false); assert.equal(update.lebihBaru('1.4', '1.4.0'), false);

  // 2. cek
  let c = await update.cek(ctx(), true); assert.equal(c.ada, true); assert.equal(c.versi_baru, '99.0.0'); assert.deepEqual(c.catatan, ['Fitur contoh', 'Perbaikan contoh']);
  await assert.rejects(() => update.cek({ ...ctx(), repo: 'toko/tidak-ada' }, true), /tidak ditemukan/);
  const n0 = hit; await update.cek(ctx()); assert.equal(hit, n0, 'hasil cek disimpan sebentar (tidak menembak GitHub terus)');

  // 3. versi baru rusak -> TIDAK dipasang, program lama utuh
  const rusak = susunZip({ 'server.js': 'ini bukan javascript {{{' });
  zipBuf = rusak; const sebelum = fs.readFileSync(path.join(prog, 'server.js'));
  await assert.rejects(() => update.pasang(ctx()), /gagal dijalankan/);
  assert.deepEqual(fs.readFileSync(path.join(prog, 'server.js')), sebelum, 'server.js lama tidak berubah'); assert.equal(fs.existsSync(path.join(prog, 'fitur-baru.txt')), false); assert.deepEqual(fs.readdirSync(path.join(prog, 'update')).filter((f) => /^(baru|uji)/.test(f)), [], 'folder sementara dibersihkan');

  // 4. zip berisi jalur berbahaya
  zipBuf = buatZip({ 'r-main/server.js': 'x', 'r-main/../../jahat.txt': 'x', 'r-main/versi.json': versiJson(), 'r-main/public/index.html': '', 'r-main/public/app.js': '' });
  await assert.rejects(() => update.pasang(ctx()), /tidak aman/); assert.equal(fs.existsSync(path.join(tmp, 'jahat.txt')), false);

  // 5. versi di zip beda dengan yang diumumkan
  zipBuf = susunZip({}, '98.0.0'); await assert.rejects(() => update.pasang(ctx()), /berbeda/);

  // 6. update yang benar
  zipBuf = susunZip(); const dataSblm = fs.readFileSync(dbFile);
  const h = await update.pasang(ctx()); assert.equal(h.ke, '99.0.0'); assert.equal(h.dari, versiLama);
  assert.equal(JSON.parse(fs.readFileSync(path.join(prog, 'versi.json'), 'utf8')).versi, '99.0.0'); assert.equal(fs.readFileSync(path.join(prog, 'fitur-baru.txt'), 'utf8'), 'halo');
  assert.deepEqual(fs.readFileSync(dbFile), dataSblm, 'data toko tidak tersentuh'); assert.ok(fs.existsSync(h.backup), 'backup dibuat sebelum memasang');
  assert.ok(ctx.catat.some(([a]) => a === 'UPDATE')); assert.deepEqual(update.adaSebelumnya(prog), { dari: versiLama, ke: '99.0.0' });
  assert.deepEqual(fs.readdirSync(path.join(prog, 'update')).filter((f) => /^(baru|uji)/.test(f)), []);
  await assert.rejects(() => update.pasang(ctx({ versi: '99.0.0' })), /sudah versi terbaru/);

  // 7. kembalikan
  update.kembalikan(ctx({ versi: '99.0.0' }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(prog, 'versi.json'), 'utf8')).versi, versiLama); assert.equal(fs.existsSync(path.join(prog, 'fitur-baru.txt')), false, 'berkas baru dari update dihapus');
  assert.deepEqual(fs.readFileSync(path.join(prog, 'server.js')), sebelum); assert.equal(update.adaSebelumnya(prog), null);
  assert.throws(() => update.kembalikan(ctx()), /Tidak ada versi sebelumnya/);

  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Tes update lulus.');
})().catch((e) => { console.error(e); process.exit(1); });
