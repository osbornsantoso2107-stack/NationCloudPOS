'use strict';
// Pembaca file Excel (.xlsx) dan CSV tanpa paket luar (zip + XML dibaca sendiri).
const zlib = require('node:zlib');
const { analisis, TabelError } = require('./tabel.js');

// ---------------------------------------------------------------- zip
function readZip(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new TabelError('File Excel rusak (bukan format .xlsx yang valid).');
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const files = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    files.set(name, { method, csize, off });
    p += 46 + nl + el + cl;
  }
  return {
    get(name) {
      const f = files.get(name); if (!f) return null;
      const o = f.off; const ds = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
      const raw = buf.subarray(ds, ds + f.csize);
      return f.method === 0 ? raw : zlib.inflateRawSync(raw);
    },
    has: (name) => files.has(name),
    names: () => [...files.keys()],
  };
}

// ---------------------------------------------------------------- xml kecil
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => {
  if (g[0] === '#') return String.fromCodePoint(g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g.toLowerCase()];
});
const textOf = (xml) => { let out = ''; for (const m of xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1]; return decode(out); };
const colIndex = (ref) => { let n = 0; for (const ch of /^[A-Z]+/i.exec(ref)[0].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

function bacaXlsx(buf, pilihLembar) {
  const zip = readZip(buf);
  const wbx = zip.get('xl/workbook.xml');
  if (!wbx) throw new TabelError('Ini bukan file Excel (.xlsx).');
  const wb = wbx.toString('utf8');
  const rels = new Map(); const rx = (zip.get('xl/_rels/workbook.xml.rels') || Buffer.alloc(0)).toString('utf8');
  for (const m of rx.matchAll(/<Relationship\b([^>]*)>/g)) { const id = /Id="([^"]*)"/.exec(m[1]), t = /Target="([^"]*)"/.exec(m[1]); if (id && t) rels.set(id[1], t[1]); }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)>/g)) {
    const nm = /name="([^"]*)"/.exec(m[1]), rid = /r:id="([^"]*)"/.exec(m[1]); if (!nm || !rid) continue;
    let t = rels.get(rid[1]) || ''; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    if (zip.has(t)) sheets.push({ name: decode(nm[1]), path: t });
  }
  if (!sheets.length) throw new TabelError('Tidak ada lembar (sheet) yang bisa dibaca di file Excel ini.');

  const sst = [];
  const ss = zip.get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sst.push(textOf(m[1]));

  const readSheet = (sh) => {
    const xml = zip.get(sh.path).toString('utf8'); const rows = new Map(); let maxCol = 0;
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rnum = Number((/\br="(\d+)"/.exec(rm[1]) || [])[1]); if (!rnum || !rm[2]) continue;
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/i.exec(cm[1]); if (!ref || !cm[2]) continue;
        const type = (/\bt="([^"]*)"/.exec(cm[1]) || [])[1];
        let v = null;
        if (type === 'inlineStr') v = textOf(cm[2]);
        else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(cm[2]); if (!vm) continue;
          if (type === 's') v = sst[Number(vm[1])] ?? '';
          else if (type === 'str') v = decode(vm[1]);
          else if (type === 'b' || type === 'e') continue;
          else { const num = Number(vm[1]); v = Number.isFinite(num) ? (Number.isInteger(num) ? String(num) : String(+num.toFixed(6))) : vm[1]; }
        }
        if (v === null || v === '') continue;
        const c = colIndex(ref[1]); if (c > maxCol) maxCol = c;
        if (!rows.has(rnum)) rows.set(rnum, new Map());
        rows.get(rnum).set(c, v);
      }
    }
    const out = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => Array.from({ length: maxCol + 1 }, (_, c) => cells.get(c) ?? ''));
    return out;
  };

  const all = sheets.map((sh) => ({ name: sh.name, rows: readSheet(sh) }));
  let pick = pilihLembar ? all.find((s) => s.name === pilihLembar) : null;
  if (!pick) pick = [...all].sort((a, b) => b.rows.length - a.rows.length)[0]; // lembar terisi paling banyak
  if (!pick.rows.length) throw new TabelError('Lembar "' + pick.name + '" kosong. Pastikan isi tabel ada di lembar yang benar.');
  return { lembar: all.map((s) => s.name), lembar_dipakai: pick.name, matrix: pick.rows };
}

// ---------------------------------------------------------------- csv
function bacaCsv(buf) {
  let t = buf.toString('utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  if (t.includes('�')) t = buf.toString('latin1'); // CSV lama (Windows-1252)
  const first = t.split(/\r?\n/).slice(0, 5).join('\n');
  const cnt = (ch) => (first.match(new RegExp(ch === '\t' ? '\\t' : '\\' + ch, 'g')) || []).length;
  const delim = [';', ',', '\t'].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const w = Math.max(0, ...rows.map((r) => r.length));
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => Array.from({ length: w }, (_, k) => (r[k] ?? '').trim()));
}

// ---------------------------------------------------------------- pintu masuk: tentukan jenis file dari isinya
function bacaFile(buf, opsi = {}) {
  const { bacaPdf } = require('./pdftext.js');
  if (buf.length < 4) throw new TabelError('File kosong.');
  const head = buf.subarray(0, 5).toString('latin1');
  if (head.startsWith('%PDF') || buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) return { sumber: 'pdf', ...bacaPdf(buf) };
  if (buf.readUInt32BE(0) === 0xd0cf11e0) throw new TabelError('Format Excel lama (.xls) belum bisa dibaca. Buka di Excel, lalu Save As → "Excel Workbook (.xlsx)" dan unggah lagi.');
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const r = bacaXlsx(buf, opsi.lembar);
    return { sumber: 'xlsx', lembar: r.lembar, lembar_dipakai: r.lembar_dipakai, ...analisis(r.matrix) };
  }
  if (buf.subarray(0, 2048).includes(0)) throw new TabelError('Format file tidak dikenali. Gunakan file PDF, Excel (.xlsx) atau CSV.');
  const rows = bacaCsv(buf);
  if (!rows.length) throw new TabelError('File kosong.');
  return { sumber: 'csv', ...analisis(rows) };
}

module.exports = { bacaFile, bacaXlsx, bacaCsv, readZip };
