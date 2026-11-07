'use strict';
// Update program dari GitHub tanpa paket luar: baca versi.json di repo, unduh zip, periksa,
// pasang, dan kembalikan bila perlu. Folder data/ tidak pernah disentuh.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { readZip } = require('./excel.js');

class UpdateError extends Error {}
const RAW = () => process.env.POS_UPDATE_RAW || 'https://raw.githubusercontent.com';
const ZIPBASE = () => process.env.POS_UPDATE_ZIP || 'https://github.com';
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CABANG_RE = /^[A-Za-z0-9_./-]+$/;

function cekNama(repo, cabang) {
  if (!REPO_RE.test(repo || '')) throw new UpdateError('Nama repo harus berbentuk  akun/nama-repo  (contoh: toko-saya/nationcloudpos)');
  if (!CABANG_RE.test(cabang || '') || cabang.includes('..')) throw new UpdateError('Nama cabang tidak valid (biasanya: main)');
}
function lebihBaru(a, b) { // apakah versi a lebih baru dari b
  const x = String(a).split('.').map((n) => parseInt(n, 10) || 0), y = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
async function ambil(url, ms, maxByte) {
  let r;
  try { r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'nationcloudPOS-updater', 'Cache-Control': 'no-cache' } }); }
  catch { throw new UpdateError('Tidak bisa terhubung ke GitHub. Periksa koneksi internet, lalu coba lagi.'); }
  if (r.status === 404) throw new UpdateError('Repo atau file versi.json tidak ditemukan. Pastikan nama repo benar dan repo bersifat Public.');
  if (!r.ok) throw new UpdateError(`GitHub menjawab kesalahan ${r.status}. Coba lagi sebentar lagi.`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxByte) throw new UpdateError('File update terlalu besar, dibatalkan.');
  return buf;
}

let cache = { t: 0, key: '', val: null };
async function cek({ repo, cabang, versi }, paksa = false) {
  cekNama(repo, cabang);
  const key = `${repo}@${cabang}`;
  if (!paksa && cache.key === key && Date.now() - cache.t < 30 * 60 * 1000) return { ...cache.val, sekarang: versi, ada: lebihBaru(cache.val.versi_baru, versi) };
  const buf = await ambil(`${RAW()}/${repo}/${cabang}/versi.json?t=${Date.now()}`, 8000, 200000);
  let m; try { m = JSON.parse(buf.toString('utf8')); } catch { throw new UpdateError('versi.json di repo rusak.'); }
  if (!m || typeof m.versi !== 'string' || !/^\d+(\.\d+){1,3}$/.test(m.versi)) throw new UpdateError('versi.json di repo tidak punya nomor versi yang benar.');
  const val = { versi_baru: m.versi, catatan: Array.isArray(m.catatan) ? m.catatan.map(String).slice(0, 30) : [] };
  cache = { t: Date.now(), key, val };
  return { ...val, sekarang: versi, ada: lebihBaru(m.versi, versi) };
}

function salinPohon(dari, ke, lewati, catat) { // salin semua berkas dari -> ke
  for (const e of fs.readdirSync(dari, { withFileTypes: true })) {
    const rel = catat.prefix ? `${catat.prefix}/${e.name}` : e.name;
    if (lewati(rel)) continue;
    const a = path.join(dari, e.name), b = path.join(ke, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); salinPohon(a, b, lewati, { ...catat, prefix: rel }); }
    else catat.fn(rel, a, b);
  }
}
const lewatiProgram = (rel) => /^(data|update)(\/|$)/.test(rel) || rel.startsWith('.git');

async function cobaJalan(dir, dbSalinan, versiHarus) { // jalankan versi baru sebentar di port acak: harus menjawab dengan versi yang benar
  const port = 20000 + Math.floor(Math.random() * 40000);
  const anak = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, POS_PORT: String(port), POS_HOST: '127.0.0.1', POS_DB: dbSalinan } });
  let err = ''; anak.stderr.on('data', (d) => { err += d; });
  let mati = false; anak.on('exit', () => { mati = true; });
  try {
    for (let i = 0; i < 40 && !mati; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) { const j = await r.json(); if (j.versi === versiHarus) return; throw new UpdateError(`Versi baru menyebut dirinya ${j.versi}, bukan ${versiHarus}.`); }
      } catch (e) { if (e instanceof UpdateError) throw e; }
    }
    throw new UpdateError('Versi baru gagal dijalankan pada uji coba, jadi tidak dipasang. ' + (err.trim().split('\n').slice(-2).join(' ') || ''));
  } finally { try { anak.kill(); } catch { /* sudah mati */ } }
}

async function pasang(ctx) { // ctx: { dir, repo, cabang, versi, salinDb(file), backup(), log(aksi, detail) }
  const { dir, repo, cabang } = ctx;
  const info = await cek(ctx, true);
  if (!info.ada) throw new UpdateError('Program sudah versi terbaru.');
  const zip = readZip(await ambil(`${ZIPBASE()}/${repo}/archive/refs/heads/${cabang}.zip`, 120000, 60e6));
  const semua = zip.names();
  const top = semua[0] ? semua[0].split('/')[0] + '/' : '';
  if (!top || !semua.every((n) => n.startsWith(top))) throw new UpdateError('Isi zip dari GitHub tidak dikenali.');
  const stg = path.join(dir, 'update', 'baru');
  fs.rmSync(stg, { recursive: true, force: true }); fs.mkdirSync(stg, { recursive: true });
  try {
    for (const n of semua) {
      const rel = n.slice(top.length);
      if (!rel || rel.endsWith('/')) continue;
      if (rel.includes('..') || rel.includes('\\') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) throw new UpdateError('Zip berisi nama berkas yang tidak aman, dibatalkan.');
      if (lewatiProgram(rel) || rel.startsWith('.github/')) continue;
      const tujuan = path.join(stg, rel); fs.mkdirSync(path.dirname(tujuan), { recursive: true }); fs.writeFileSync(tujuan, zip.get(n));
    }
    for (const w of ['server.js', 'versi.json', 'public/index.html', 'public/app.js']) if (!fs.existsSync(path.join(stg, w))) throw new UpdateError(`Update tidak lengkap (tidak ada ${w}), dibatalkan.`);
    let baru; try { baru = JSON.parse(fs.readFileSync(path.join(stg, 'versi.json'), 'utf8')); } catch { throw new UpdateError('versi.json di dalam zip rusak.'); }
    if (baru.versi !== info.versi_baru) throw new UpdateError('Versi di dalam zip berbeda dengan yang diumumkan. Coba lagi beberapa menit lagi.');
    // uji coba pada SALINAN data asli (memastikan database toko Anda tetap terbuka oleh versi baru)
    const salinan = path.join(stg, '_uji.db'); ctx.salinDb(salinan);
    await cobaJalan(stg, salinan, info.versi_baru);
    for (const f of fs.readdirSync(stg)) if (f.startsWith('_uji.db') || f === 'backup') fs.rmSync(path.join(stg, f), { recursive: true, force: true });
    const cad = ctx.backup(); // cadangan data sebelum apa pun diganti
    // simpan berkas lama untuk "Kembalikan versi sebelumnya"
    const sb = path.join(dir, 'update', 'sebelumnya'); fs.rmSync(sb, { recursive: true, force: true }); fs.mkdirSync(sb, { recursive: true });
    const baruSaja = [], ada = [];
    salinPohon(stg, dir, lewatiProgram, { prefix: '', fn: (rel, a, b) => {
      if (fs.existsSync(b)) { const s = path.join(sb, 'berkas', rel); fs.mkdirSync(path.dirname(s), { recursive: true }); fs.copyFileSync(b, s); ada.push(rel); } else baruSaja.push(rel);
    } });
    fs.writeFileSync(path.join(sb, '_daftar.json'), JSON.stringify({ dari: ctx.versi, ke: info.versi_baru, baruSaja, ada }));
    salinPohon(stg, dir, lewatiProgram, { prefix: '', fn: (rel, a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); } });
    ctx.log('UPDATE', { dari: ctx.versi, ke: info.versi_baru, repo, backup: cad && cad.file });
    return { dari: ctx.versi, ke: info.versi_baru, catatan: info.catatan, backup: cad && cad.file };
  } finally { fs.rmSync(stg, { recursive: true, force: true }); }
}

function adaSebelumnya(dir) {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'update', 'sebelumnya', '_daftar.json'), 'utf8')); return { dari: j.dari, ke: j.ke }; } catch { return null; }
}
function kembalikan(ctx) {
  const sb = path.join(ctx.dir, 'update', 'sebelumnya'); const a = adaSebelumnya(ctx.dir);
  if (!a) throw new UpdateError('Tidak ada versi sebelumnya yang tersimpan.');
  const j = JSON.parse(fs.readFileSync(path.join(sb, '_daftar.json'), 'utf8'));
  ctx.backup();
  for (const rel of j.ada) { const dst = path.join(ctx.dir, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(sb, 'berkas', rel), dst); }
  for (const rel of j.baruSaja) fs.rmSync(path.join(ctx.dir, rel), { force: true });
  fs.rmSync(sb, { recursive: true, force: true });
  ctx.log('UPDATE_KEMBALI', { dari: j.ke, ke: j.dari });
  return { ke: j.dari };
}

// Mulai ulang program setelah update: proses baru dijalankan tersembunyi setelah yang lama berhenti.
function mulaiUlang(dir, keluar) {
  if (process.env.POS_NO_RESTART) return;
  const kode = "const fs=require('fs'),path=require('path');setTimeout(()=>{let o='ignore';try{fs.mkdirSync(path.join(process.argv[1],'data'),{recursive:true});o=fs.openSync(path.join(process.argv[1],'data','server.log'),'a')}catch{}" +
    "require('child_process').spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.js'],{cwd:process.argv[1],detached:true,windowsHide:true,stdio:['ignore',o,o]}).unref()},1500)";
  spawn(process.execPath, ['-e', kode, dir], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  setTimeout(keluar, 400);
}

module.exports = { cek, pasang, kembalikan, adaSebelumnya, mulaiUlang, UpdateError, lebihBaru, cekNama };
