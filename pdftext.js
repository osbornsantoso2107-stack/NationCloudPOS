'use strict';
// Pembaca PDF sederhana tanpa paket luar (hanya zlib bawaan Node).
// Tugasnya: ambil teks + posisinya dari PDF "digital" (hasil Excel/Word/aplikasi kasir),
// lalu susun menjadi tabel (baris x kolom). PDF hasil scan/foto TIDAK bisa dibaca (tidak ada teks di dalamnya).
const zlib = require('node:zlib');
const { parseAngka } = require('./public/angka.js');
const { analisis, roleOf, isNumCell, TabelError } = require('./tabel.js');

class PdfError extends TabelError {}

// ---------------------------------------------------------------- objek PDF
function scanObjects(data, buf) {
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(data))) {
    const num = Number(m[1]);
    const bodyStart = re.lastIndex;
    const e = data.indexOf('endobj', bodyStart);
    let streamPos = -1;
    for (let s = bodyStart - 1; ;) {
      s = data.indexOf('stream', s + 1);
      if (s === -1 || (e !== -1 && s > e)) break;
      if (data.slice(s - 3, s) === 'end') continue;
      streamPos = s; break;
    }
    if (streamPos === -1) {
      objs.set(num, { dict: data.slice(bodyStart, e === -1 ? undefined : e).trim(), stream: null });
      if (e !== -1) re.lastIndex = e + 6;
      continue;
    }
    const dict = data.slice(bodyStart, streamPos).trim();
    let ds = streamPos + 6;
    if (data[ds] === '\r' && data[ds + 1] === '\n') ds += 2; else if (data[ds] === '\n' || data[ds] === '\r') ds += 1;
    let len = -1;
    const lm = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
    if (lm) { len = Number(lm[1]); if (!/^\s*endstream/.test(data.slice(ds + len, ds + len + 20))) len = -1; }
    let de;
    if (len >= 0) de = ds + len;
    else {
      de = data.indexOf('endstream', ds);
      if (de === -1) de = e === -1 ? data.length : e;
      else { if (data[de - 1] === '\n') de--; if (data[de - 1] === '\r') de--; }
    }
    objs.set(num, { dict, stream: buf.subarray(ds, de) });
    const e2 = data.indexOf('endobj', de);
    re.lastIndex = e2 === -1 ? de : e2 + 6;
  }
  return objs;
}

function applyPredictor(buf, dict) {
  const pm = /\/Predictor\s+(\d+)/.exec(dict);
  if (!pm || Number(pm[1]) < 10) return buf;
  const columns = Number((/\/Columns\s+(\d+)/.exec(dict) || [0, 1])[1]);
  const colors = Number((/\/Colors\s+(\d+)/.exec(dict) || [0, 1])[1]);
  const bpc = Number((/\/BitsPerComponent\s+(\d+)/.exec(dict) || [0, 8])[1]);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(buf.length / (rowLen + 1));
  const out = Buffer.alloc(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = buf[r * (rowLen + 1)];
    for (let i = 0; i < rowLen; i++) {
      const raw = buf[r * (rowLen + 1) + 1 + i];
      const a = i >= bpp ? out[r * rowLen + i - bpp] : 0;
      const b = r > 0 ? out[(r - 1) * rowLen + i] : 0;
      const c = r > 0 && i >= bpp ? out[(r - 1) * rowLen + i - bpp] : 0;
      let v;
      switch (ft) {
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = raw;
      }
      out[r * rowLen + i] = v & 255;
    }
  }
  return out;
}

function decodeStream(obj) {
  if (!obj || !obj.stream) return null;
  const d = obj.dict;
  const fm = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(d);
  const filters = fm ? (fm[1].match(/\/\w+/g) || []).map((x) => x.slice(1)) : [];
  let buf = obj.stream;
  for (const f of filters) {
    if (f === 'FlateDecode' || f === 'Fl') {
      try { buf = zlib.inflateSync(buf); }
      catch { try { buf = zlib.inflateSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return null; } }
      buf = applyPredictor(buf, d);
    } else if (f === 'ASCII85Decode' || f === 'A85') buf = ascii85(buf);
    else if (f === 'ASCIIHexDecode' || f === 'AHx') buf = asciiHex(buf);
    else return null; // filter lain (gambar, LZW, dll) tidak dibutuhkan untuk teks
  }
  return buf;
}
function ascii85(buf) {
  let s = buf.toString('latin1').replace(/\s+/g, '');
  if (s.startsWith('<~')) s = s.slice(2);
  const end = s.indexOf('~>'); if (end !== -1) s = s.slice(0, end);
  const out = []; let grp = [];
  const flush = (n) => { // n = jumlah karakter nyata dalam grup
    let v = 0; for (let k = 0; k < 5; k++) v = v * 85 + ((grp[k] === undefined ? 117 : grp[k]) - 33);
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n === 5 ? 4 : n - 1)); grp = [];
  };
  for (const ch of s) {
    if (ch === 'z' && grp.length === 0) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0); if (c < 33 || c > 117) continue;
    grp.push(c); if (grp.length === 5) flush(5);
  }
  if (grp.length > 1) flush(grp.length);
  return Buffer.from(out);
}
function asciiHex(buf) {
  let s = buf.toString('latin1').replace(/[^0-9A-Fa-f>]/g, ''); const e = s.indexOf('>'); if (e !== -1) s = s.slice(0, e);
  if (s.length % 2) s += '0';
  return Buffer.from(s, 'hex');
}

// ---------------------------------------------------------------- bantu baca dictionary
function balanced(text, start) {
  const open = text.startsWith('<<', start) ? '<<' : '[';
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (open === '<<') {
      if (text.startsWith('<<', i)) { depth++; i++; }
      else if (text.startsWith('>>', i)) { depth--; i++; if (depth === 0) return text.slice(start, i + 1); }
    } else {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
  }
  return text.slice(start);
}
function refNum(d, key) {
  const m = new RegExp('/' + key + '(?![A-Za-z0-9_.])\\s*(\\d+)\\s+\\d+\\s+R').exec(d);
  return m ? Number(m[1]) : null;
}
// Ambil nilai kunci: dict / array langsung, atau isi objek yang dirujuk
function val(objs, d, key) {
  const m = new RegExp('/' + key + '(?![A-Za-z0-9_.])\\s*').exec(d);
  if (!m) return null;
  const p = m.index + m[0].length;
  if (d.startsWith('<<', p) || d[p] === '[') return balanced(d, p);
  const rm = /^(\d+)\s+\d+\s+R/.exec(d.slice(p, p + 30));
  if (rm) { const o = objs.get(Number(rm[1])); return o ? o.dict : null; }
  const tm = /^[^\s\/<>\[\]]+/.exec(d.slice(p, p + 60));
  return tm ? tm[0] : null;
}

// ---------------------------------------------------------------- font
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const defaultWidth = (code) => (code >= 32 && code <= 126 ? HELV[code - 32] : 556);

const GLYPHS = { space: ' ', period: '.', comma: ',', hyphen: '-', minus: '-', endash: '–', emdash: '—', slash: '/', colon: ':', semicolon: ';', parenleft: '(', parenright: ')',
  percent: '%', plus: '+', equal: '=', underscore: '_', quotesingle: "'", quotedbl: '"', ampersand: '&', at: '@', numbersign: '#', asterisk: '*', bracketleft: '[', bracketright: ']',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', question: '?', exclam: '!', bullet: '•', fi: 'fi', fl: 'fl' };
function glyphToChar(name) {
  if (GLYPHS[name]) return GLYPHS[name];
  if (name.length === 1) return name;
  const u = /^uni([0-9A-Fa-f]{4})$/.exec(name); if (u) return String.fromCharCode(parseInt(u[1], 16));
  return '';
}

const hexToStr = (hex) => {
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex, 16));
  let s = ''; for (let i = 0; i + 3 < hex.length + 1; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
  return s;
};
function parseCMap(buf) {
  const map = new Map(); let bytes = null;
  if (!buf) return { map, bytes };
  const t = buf.toString('latin1');
  const cs = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(t); if (cs) bytes = cs[1].length / 2;
  for (const blk of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(parseInt(p[1], 16), hexToStr(p[2]));
  for (const blk of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
      if (p[3][0] === '[') { const items = [...p[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => hexToStr(x[1])); for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]); }
      else {
        const dst = p[3].slice(1, -1), base = hexToStr(dst);
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)));
      }
    }
  return { map, bytes };
}
const nums = (t) => (t ? (t.match(/-?\d+\.?\d*/g) || []).map(Number) : []);

function loadFont(objs, num, cache) {
  if (cache.has(num)) return cache.get(num);
  const o = objs.get(num); const f = { map: null, bytes: 1, widths: null, first: 0, dw: null, wmap: null, diff: null };
  cache.set(num, f);
  if (!o) return f;
  const d = o.dict;
  const sub = (/\/Subtype\s*\/(\w+)/.exec(d) || [])[1];
  const tu = refNum(d, 'ToUnicode');
  if (tu && objs.get(tu)) { const c = parseCMap(decodeStream(objs.get(tu))); if (c.map.size) f.map = c.map; if (c.bytes) f.bytes = c.bytes; }
  if (sub === 'Type0') {
    const enc = (/\/Encoding\s*\/([\w-]+)/.exec(d) || [])[1] || '';
    if (/Identity|UCS2|UTF16/i.test(enc) || !f.map) f.bytes = 2;
    const desc = val(objs, d, 'DescendantFonts');
    const dn = desc && /(\d+)\s+\d+\s+R/.exec(desc);
    const dd = dn ? (objs.get(Number(dn[1])) || {}).dict : (desc && desc.startsWith('[') ? desc : null);
    if (dd) {
      const dw = /\/DW\s+(-?\d+\.?\d*)/.exec(dd); f.dw = dw ? Number(dw[1]) : 1000;
      const w = val(objs, dd, 'W');
      if (w) {
        f.wmap = new Map();
        const t = w.replace(/^\[/, '').replace(/\]$/, '');
        const re = /(\d+)\s*\[([^\]]*)\]|(\d+)\s+(\d+)\s+(-?\d+\.?\d*)/g; let m;
        while ((m = re.exec(t))) {
          if (m[1] !== undefined) { nums(m[2]).forEach((x, i) => f.wmap.set(Number(m[1]) + i, x)); }
          else for (let c = Number(m[3]); c <= Number(m[4]) && c - Number(m[3]) < 70000; c++) f.wmap.set(c, Number(m[5]));
        }
      }
    }
  } else {
    f.first = Number((/\/FirstChar\s+(\d+)/.exec(d) || [0, 0])[1]);
    const w = val(objs, d, 'Widths'); if (w) f.widths = nums(w);
    const enc = val(objs, d, 'Encoding');
    if (enc && enc.includes('Differences')) {
      const dif = /\/Differences\s*\[([\s\S]*?)\]/.exec(enc);
      if (dif) {
        f.diff = new Map(); let code = 0;
        for (const tk of dif[1].match(/-?\d+|\/[^\s\/\[\]]+/g) || []) {
          if (tk[0] === '/') { f.diff.set(code, glyphToChar(tk.slice(1))); code++; } else code = Number(tk);
        }
      }
    }
  }
  return f;
}
function decodeText(font, s) { // s = string berisi byte mentah -> [{ch, w, sp}]
  const out = [];
  if (font.bytes === 2) {
    for (let i = 0; i + 1 < s.length; i += 2) {
      const code = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1);
      const ch = font.map && font.map.has(code) ? font.map.get(code) : (font.map ? '' : String.fromCharCode(code));
      out.push({ ch, w: font.wmap && font.wmap.has(code) ? font.wmap.get(code) : (font.dw ?? 1000), sp: false });
    }
  } else {
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      let ch = font.map && font.map.has(code) ? font.map.get(code) : (font.diff && font.diff.has(code) ? font.diff.get(code) : String.fromCharCode(code));
      let w = font.widths && code - font.first >= 0 && code - font.first < font.widths.length ? font.widths[code - font.first] : defaultWidth(code);
      out.push({ ch, w: w || defaultWidth(code), sp: code === 32 });
    }
  }
  return out;
}

// ---------------------------------------------------------------- isi halaman (content stream)
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const WS = /[\s\0]/, DELIM = /[\s\0()<>\[\]{}\/%]/;

function tokenize(c, onOp) {
  let i = 0; const n = c.length; const stack = [];
  const readString = () => {
    let depth = 1, s = ''; i++;
    while (i < n && depth > 0) {
      const ch = c[i];
      if (ch === '\\') {
        const nx = c[i + 1]; i += 2;
        if (nx === 'n') s += '\n'; else if (nx === 'r') s += '\r'; else if (nx === 't') s += '\t'; else if (nx === 'b') s += '\b'; else if (nx === 'f') s += '\f';
        else if (nx >= '0' && nx <= '7') { let o = nx; while (o.length < 3 && c[i] >= '0' && c[i] <= '7') o += c[i++]; s += String.fromCharCode(parseInt(o, 8) & 255); }
        else if (nx === '\r') { if (c[i] === '\n') i++; } else if (nx === '\n') { /* sambung baris */ } else s += nx;
      } else if (ch === '(') { depth++; s += ch; i++; }
      else if (ch === ')') { depth--; if (depth > 0) s += ch; i++; }
      else { s += ch; i++; }
    }
    return { s };
  };
  const readValue = () => {
    const ch = c[i];
    if (ch === '(') return readString();
    if (ch === '<' && c[i + 1] === '<') { let d = 0; while (i < n) { if (c.startsWith('<<', i)) { d++; i += 2; } else if (c.startsWith('>>', i)) { d--; i += 2; if (d === 0) break; } else i++; } return null; }
    if (ch === '<') { const e = c.indexOf('>', i); let h = c.slice(i + 1, e === -1 ? n : e).replace(/\s+/g, ''); if (h.length % 2) h += '0'; i = e === -1 ? n : e + 1; let s = ''; for (let k = 0; k < h.length; k += 2) s += String.fromCharCode(parseInt(h.substr(k, 2), 16)); return { s }; }
    if (ch === '[') { i++; const arr = []; while (i < n && c[i] !== ']') { if (WS.test(c[i])) { i++; continue; } const v = readValue(); if (v !== undefined) arr.push(v); } i++; return arr; }
    if (ch === '/') { let j = i + 1; while (j < n && !DELIM.test(c[j])) j++; const name = c.slice(i + 1, j); i = j; return { name }; }
    const nm = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(c.slice(i, i + 30));
    if (nm && (i + nm[0].length >= n || DELIM.test(c[i + nm[0].length]))) { i += nm[0].length; return Number(nm[0]); }
    let j = i; while (j < n && !DELIM.test(c[j])) j++;
    if (j === i) j = i + 1; // karakter aneh
    const op = c.slice(i, j); i = j; return { op };
  };
  while (i < n) {
    const ch = c[i];
    if (WS.test(ch)) { i++; continue; }
    if (ch === '%') { while (i < n && c[i] !== '\n' && c[i] !== '\r') i++; continue; }
    if (ch === ')' || ch === '>' || ch === ']' || ch === '{' || ch === '}') { i++; continue; }
    const v = readValue();
    if (v && v.op !== undefined) {
      if (v.op === 'BI') { // gambar inline: lompati sampai EI
        let p = c.indexOf('ID', i); if (p === -1) break; p += 2;
        for (; ;) { p = c.indexOf('EI', p); if (p === -1) { p = n; break; } if (WS.test(c[p - 1] || ' ') && (p + 2 >= n || WS.test(c[p + 2]))) { p += 2; break; } p += 2; }
        i = p; stack.length = 0; continue;
      }
      onOp(v.op, stack); stack.length = 0;
    } else if (v !== undefined) stack.push(v);
  }
}

function interpret(content, ctx, out, depth, baseCtm) {
  let ctm = baseCtm || [1, 0, 0, 1, 0, 0]; const ctmStack = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
  let font = null, size = 0, leading = 0, tc = 0, tw = 0, tz = 100;
  const fontFor = (name) => {
    const n = ctx.fontRefs[name]; return n ? loadFont(ctx.objs, n, ctx.fontCache) : null;
  };
  const move = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm.slice(); };
  const num = (v) => (typeof v === 'number' ? v : 0);

  function show(items) { // items: array dari string / angka (TJ) atau satu string
    if (!font) return;
    let frag = null;
    const flush = () => {
      if (frag && frag.str.trim()) { const e = mul(tm, ctm); frag.xEnd = e[4]; out.push(frag); }
      frag = null;
    };
    for (const it of items) {
      if (typeof it === 'number') {
        const adj = (-it / 1000) * size * (tz / 100);
        const sz = frag ? frag.size : Math.abs(size * (mul(tm, ctm)[3] || 1));
        const adjUser = adj * Math.abs(ctm[0] || 1);
        if (frag && adjUser > 1.0 * sz) { flush(); }
        else if (frag && adjUser > 0.15 * sz && !frag.str.endsWith(' ')) frag.str += ' ';
        tm = mul([1, 0, 0, 1, adj, 0], tm);
        continue;
      }
      if (!it || typeof it.s !== 'string') continue;
      for (const g of decodeText(font, it.s)) {
        if (!frag) {
          const p = mul(tm, ctm);
          frag = { str: '', x: p[4], y: p[5], xEnd: p[4], size: Math.abs(Math.hypot(p[2], p[3]) * size) || Math.abs(size) || 10 };
        }
        frag.str += g.ch;
        const tx = ((g.w / 1000) * size + tc + (g.sp ? tw : 0)) * (tz / 100);
        tm = mul([1, 0, 0, 1, tx, 0], tm);
      }
    }
    flush();
  }

  tokenize(content, (op, st) => {
    switch (op) {
      case 'q': ctmStack.push(ctm.slice()); break;
      case 'Q': if (ctmStack.length) ctm = ctmStack.pop(); break;
      case 'cm': if (st.length >= 6) ctm = mul(st.slice(-6).map(num), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
      case 'Tf': font = fontFor(st[0] && st[0].name); size = num(st[1]); break;
      case 'Tm': if (st.length >= 6) { tm = st.slice(-6).map(num); tlm = tm.slice(); } break;
      case 'Td': move(num(st[0]), num(st[1])); break;
      case 'TD': leading = -num(st[1]); move(num(st[0]), num(st[1])); break;
      case 'T*': move(0, -leading); break;
      case 'TL': leading = num(st[0]); break;
      case 'Tc': tc = num(st[0]); break;
      case 'Tw': tw = num(st[0]); break;
      case 'Tz': tz = num(st[0]) || 100; break;
      case 'Tj': show([st[0]]); break;
      case 'TJ': show(Array.isArray(st[0]) ? st[0] : []); break;
      case "'": move(0, -leading); show([st[0]]); break;
      case '"': tw = num(st[0]); tc = num(st[1]); move(0, -leading); show([st[2]]); break;
      case 'Do': {
        if (depth >= 4) break;
        const name = st[0] && st[0].name; const xn = ctx.xobjRefs[name]; const xo = xn && ctx.objs.get(xn);
        if (xo && /\/Subtype\s*\/Form/.test(xo.dict)) {
          const body = decodeStream(xo); if (!body) break;
          const mt = /\/Matrix\s*\[([^\]]*)\]/.exec(xo.dict); const m = mt ? nums(mt[1]) : null;
          const sub = { ...ctx };
          const res = val(ctx.objs, xo.dict, 'Resources'); if (res) { sub.fontRefs = refMap(ctx.objs, val(ctx.objs, res, 'Font')); sub.xobjRefs = refMap(ctx.objs, val(ctx.objs, res, 'XObject')); }
          interpret(body.toString('latin1'), sub, out, depth + 1, m && m.length === 6 ? mul(m, ctm) : ctm);
        }
        break;
      }
      default: break;
    }
  });
}
function refMap(objs, dictText) {
  const m = {}; if (!dictText) return m;
  for (const x of dictText.matchAll(/\/([^\s\/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) m[x[1]] = Number(x[2]);
  return m;
}

// ---------------------------------------------------------------- halaman
function extractPages(buf) {
  const data = buf.toString('latin1');
  if (!data.startsWith('%PDF', 0) && data.indexOf('%PDF') === -1) throw new PdfError('File ini bukan PDF.');
  const objs = scanObjects(data, buf);
  // objek di dalam object stream
  for (const [, o] of [...objs.entries()]) {
    if (o.stream && /\/Type\s*\/ObjStm/.test(o.dict)) {
      const body = decodeStream(o); if (!body) continue;
      const N = Number((/\/N\s+(\d+)/.exec(o.dict) || [0, 0])[1]), first = Number((/\/First\s+(\d+)/.exec(o.dict) || [0, 0])[1]);
      const t = body.toString('latin1'); const head = (t.slice(0, first).match(/\d+/g) || []).map(Number);
      for (let k = 0; k < N; k++) {
        const on = head[2 * k], off = head[2 * k + 1]; const end = k + 1 < N ? head[2 * k + 3] : t.length - first;
        if (on === undefined) break;
        if (!objs.has(on) || !objs.get(on).stream) objs.set(on, { dict: t.slice(first + off, first + end).trim(), stream: null });
      }
    }
  }
  if (/\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(data)) throw new PdfError('PDF ini diberi kata sandi / terkunci. Simpan ulang tanpa kata sandi lalu coba lagi.');

  // urutan halaman
  const pageNums = []; const seen = new Set();
  const cat = [...objs.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.dict));
  const walk = (n, depth) => {
    if (seen.has(n) || depth > 30) return; seen.add(n);
    const o = objs.get(n); if (!o) return;
    if (/\/Type\s*\/Pages\b/.test(o.dict) || (/\/Kids\b/.test(o.dict) && !/\/Type\s*\/Page\b(?!s)/.test(o.dict))) {
      const kids = val(objs, o.dict, 'Kids') || '';
      for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]), depth + 1);
    } else pageNums.push(n);
  };
  const root = cat && refNum(cat.dict, 'Pages'); if (root) walk(root, 0);
  if (!pageNums.length) for (const [n, o] of [...objs.entries()].sort((a, b) => a[0] - b[0])) if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) pageNums.push(n);
  if (!pageNums.length) throw new PdfError('Halaman PDF tidak ditemukan. File mungkin rusak.');

  const inherit = (d, key, depth = 0) => {
    const v = val(objs, d, key); if (v) return v;
    const p = refNum(d, 'Parent'); if (p && objs.get(p) && depth < 20) return inherit(objs.get(p).dict, key, depth + 1);
    return null;
  };
  const fontCache = new Map(); const pages = [];
  for (const pn of pageNums) {
    const pd = objs.get(pn).dict; const out = [];
    const res = inherit(pd, 'Resources') || '';
    const ctx = { objs, fontCache, fontRefs: refMap(objs, val(objs, res, 'Font')), xobjRefs: refMap(objs, val(objs, res, 'XObject')) };
    const cm = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(pd);
    let refs = cm ? [...cm[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1])) : [];
    if (refs.length === 1) { const o = objs.get(refs[0]); if (o && !o.stream && o.dict.startsWith('[')) refs = [...o.dict.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1])); }
    const parts = [];
    for (const r of refs) { const b = decodeStream(objs.get(r)); if (b) parts.push(b.toString('latin1')); }
    if (parts.length) interpret(parts.join('\n'), ctx, out, 0);
    pages.push(out);
  }
  return pages;
}

// ---------------------------------------------------------------- baris & sel
function toRows(frags) {
  const fr = frags.filter((f) => f.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const f of fr) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - f.y) <= Math.max(2, f.size * 0.45)) last.frags.push(f); else rows.push({ y: f.y, frags: [f] });
  }
  return rows.map((r) => {
    const items = [];
    for (const f of r.frags.sort((a, b) => a.x - b.x)) { // buang teks tebal palsu (tercetak dua kali di tempat yang sama)
      const p = items[items.length - 1];
      if (p && f.str === p.str && Math.abs(f.x - p.x) < f.size * 0.3) continue;
      items.push(f);
    }
    // "sel" kasar hanya untuk mencari batas kolom; isi tabel nanti diambil dari potongan teks (items)
    const cells = []; let cur = null;
    for (const f of items) {
      if (cur && f.x - cur.xEnd <= 0.4 * f.size) { cur.xEnd = Math.max(cur.xEnd, f.xEnd); continue; }
      cur = { x: f.x, xEnd: f.xEnd }; cells.push(cur);
    }
    return { frags: items, cells, y: r.y, size: items[0].size };
  }).filter((r) => r.frags.length);
}

// ---------------------------------------------------------------- tabel
// Penebak peran kolom ada di tabel.js (dipakai bersama pembaca Excel / CSV).
function buildTable(pages) {
  const all = []; pages.forEach((p, pi) => toRows(p).forEach((r) => all.push({ ...r, pi })));
  if (!all.length) throw new PdfError('Tidak ada teks yang bisa dibaca di PDF ini. Kemungkinan PDF berupa foto / hasil scan. Gunakan PDF yang dibuat dari Excel/Word/aplikasi lain, atau ketik barang lewat tombol "+ Barang baru".');
  const counts = all.map((r) => r.cells.length).filter((c) => c >= 2);
  if (!counts.length) throw new PdfError('Teks ditemukan, tetapi tidak berbentuk tabel (kolom). Pastikan PDF berisi daftar barang dengan kolom kode / nama / harga.');
  const freq = new Map(); counts.forEach((c) => freq.set(c, (freq.get(c) || 0) + 1));
  const mode = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];

  // batas kolom diambil dari baris yang "lengkap" (jumlah selnya = yang paling umum), lalu rentang x yang bertumpuk digabung
  const iv = all.filter((r) => r.cells.length === mode).flatMap((r) => r.cells.map((c) => [c.x, c.xEnd])).sort((a, b) => a[0] - b[0]);
  const cols = [];
  for (const [s, e] of iv) { const l = cols[cols.length - 1]; if (l && s <= l[1] + 0.5) l[1] = Math.max(l[1], e); else cols.push([s, e]); }
  if (cols.length < 2) throw new PdfError('Kolom tabel tidak terdeteksi.');
  const colOf = (f) => { const mid = (f.x + f.xEnd) / 2; let k = cols.findIndex((r) => mid >= r[0] - 0.5 && mid <= r[1] + 0.5); if (k === -1) { let best = 1e9; cols.forEach((r, i) => { const dd = Math.min(Math.abs(mid - r[0]), Math.abs(mid - r[1])); if (dd < best) { best = dd; k = i; } }); } return k; };
  // setiap potongan teks ditaruh ke kolomnya berdasarkan posisi (termasuk baris judul, yang selnya bisa menempel)
  const minFilled = Math.max(2, Math.ceil(cols.length * 0.5));
  // baris judul kolom: rata kiri/kanan sering beda dengan isi kolom, jadi dipasangkan menurut urutan
  const headerLike = (r, i) => i < 12 && r.frags.length === cols.length && !r.frags.some((f) => /\d{3,}/.test(f.str))
    && r.frags.filter((f) => { const ro = roleOf(f.str); return ro && ro !== 'abaikan'; }).length >= 2;
  const totalRe = /^(sub\s*total|total|grand\s*total)\b/i;
  const lines = all.map((r, ri) => {
    const line = cols.map(() => ''), end = cols.map(() => 0);
    if (headerLike(r, ri)) r.frags.forEach((f, k) => { line[k] = f.str; });
    else for (const f of r.frags) { const k = colOf(f); line[k] = line[k] ? line[k] + (f.x - end[k] > 0.15 * f.size && !line[k].endsWith(' ') ? ' ' : '') + f.str : f.str; end[k] = f.xEnd; }
    const row = line.map((t) => t.replace(/\s+/g, ' ').trim());
    const filled = row.filter(Boolean).length;
    const total = filled < cols.length && totalRe.test(row.find(Boolean) || '');
    return { row, filled, y: r.y, size: r.size, pi: r.pi, total, full: filled >= minFilled && !total };
  });
  // Sel yang isinya berbaris-baris (nama panjang, judul 2 baris): baris sambungan menempel ke baris lengkap di sebelahnya
  // (ke sisi yang jaraknya paling rapat), asal jaraknya wajar. Judul halaman / catatan kaki yang jauh dibuang.
  const pieces = new Map();
  for (const l of lines) if (l.full) pieces.set(l, l.row.map((t) => (t ? [{ y: l.y, t }] : [])));
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].full || lines[i].total || !lines[i].filled) continue;
    let j = i; while (j + 1 < lines.length && !lines[j + 1].full && !lines[j + 1].total && lines[j + 1].filled && lines[j + 1].pi === lines[i].pi
      && lines[j].y - lines[j + 1].y <= 1.6 * lines[j + 1].size) j++; // baris sambungan satu sel rapat (±1.2x ukuran huruf)
    const block = lines.slice(i, j + 1);
    const U = i > 0 && lines[i - 1].full && lines[i - 1].pi === lines[i].pi ? lines[i - 1] : null;
    const D = j + 1 < lines.length && lines[j + 1].full && lines[j + 1].pi === lines[i].pi ? lines[j + 1] : null;
    const gU = U ? U.y - block[0].y : Infinity, gD = D ? block[block.length - 1].y - D.y : Infinity;
    const target = gU <= gD ? U : D, gap = Math.min(gU, gD);
    if (target && gap <= 2.0 * block[0].size) for (const b of block) b.row.forEach((t, k) => { if (t) pieces.get(target)[k].push({ y: b.y, t }); });
    i = j;
  }
  const matrix = [...pieces.values()].map((cols_) => cols_.map((ps) => ps.sort((a, b) => b.y - a.y).map((p) => p.t).join(' ').replace(/\s+/g, ' ').trim()));
  if (!matrix.length) throw new PdfError('Baris tabel tidak ditemukan.');

  return { halaman: pages.length, ...analisis(matrix) };
}

function bacaPdf(buf) { return buildTable(extractPages(buf)); }

module.exports = { bacaPdf, extractPages, buildTable, toRows, parseAngka, isNumCell, HELV, PdfError };
