'use strict';
// nationcloudPOS - tampilan. Semua harga, total, diskon dan stok dihitung ulang & diputuskan oleh server.
const { parseAngka, parseDiskon, fmt, rp } = Angka;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const tglStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => tglStr(new Date());
const geser = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return tglStr(d); };
const tglID = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '');
let info = { toko: 'NATIONCLOUD', alamat: '', footer: '', blok_stok: false, versi: '', last_backup: '' };

// ---------------------------------------------------------------- server
const OFFLINE = 'Tidak bisa terhubung ke program. Pastikan jendela hitam nationcloudPOS masih terbuka.';
async function kirim(path, opts) {
  let r;
  try { r = await fetch('/api' + path, opts); } catch { throw new Error(OFFLINE); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Terjadi kesalahan');
  return j;
}
const api = (path, body) => kirim(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const apiFile = (path, buf) => kirim(path, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });

// ---------------------------------------------------------------- komponen kecil
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), err ? 5000 : 2200);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message || String(e), true); } };
window.addEventListener('unhandledrejection', (e) => { toast(e.reason && e.reason.message ? e.reason.message : 'Terjadi kesalahan', true); });

function modal(html, opt = {}) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="card${opt.lebar ? ' lebar' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  m.close = () => { if (!m.isConnected) return; m.remove(); if (opt.onClose) opt.onClose(); };
  m.addEventListener('mousedown', (e) => { if (e.target === m && !opt.kunci) m.close(); });
  document.body.appendChild(m);
  return m;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const ms = $$('.modal'); if (ms.length) ms[ms.length - 1].close(); } });

function konfirmasi(judul, html, label = 'Ya, hapus', bahaya = true) {
  return new Promise((resolve) => {
    const m = modal(`<h3>${judul}</h3><div>${html}</div><div class="aksi"><button class="b" data-x>Batal</button><button class="b ${bahaya ? 'danger' : 'pri'}" data-ok>${label}</button></div>`, { onClose: () => resolve(false) });
    $('[data-x]', m).onclick = () => m.close();
    $('[data-ok]', m).onclick = () => { resolve(true); m.remove(); };
    $('[data-ok]', m).focus();
  });
}

function pilihanTanggal(el, onChange) {
  el.innerHTML = `<div class="toolbar"><label class="sm mut">Dari <input type="date" id="rd"></label><label class="sm mut">Sampai <input type="date" id="rs"></label>
    <button class="b sm" data-p="0">Hari ini</button><button class="b sm" data-p="1">Kemarin</button><button class="b sm" data-p="7">7 hari</button><button class="b sm" data-p="b">Bulan ini</button><button class="b sm" data-p="bl">Bulan lalu</button></div>`;
  const rd = $('#rd', el), rs = $('#rs', el);
  const sinkron = () => { rd.value = periode.dari; rs.value = periode.sampai; };
  const ubah = () => { sinkron(); onChange(); };
  rd.onchange = () => { if (!rd.value) return sinkron(); periode.dari = rd.value; if (periode.sampai < periode.dari) periode.sampai = periode.dari; ubah(); };
  rs.onchange = () => { if (!rs.value) return sinkron(); periode.sampai = rs.value; if (periode.dari > periode.sampai) periode.dari = periode.sampai; ubah(); };
  $$('[data-p]', el).forEach((b) => b.onclick = () => {
    const p = b.dataset.p, d = new Date();
    if (p === '0') periode = { dari: today(), sampai: today() };
    else if (p === '1') periode = { dari: geser(-1), sampai: geser(-1) };
    else if (p === '7') periode = { dari: geser(-6), sampai: today() };
    else if (p === 'b') periode = { dari: tglStr(new Date(d.getFullYear(), d.getMonth(), 1)), sampai: today() };
    else periode = { dari: tglStr(new Date(d.getFullYear(), d.getMonth() - 1, 1)), sampai: tglStr(new Date(d.getFullYear(), d.getMonth(), 0)) };
    ubah();
  });
  sinkron();
}
let periode = { dari: today(), sampai: today() };

// ---------------------------------------------------------------- struk
function cetakStruk(s) {
  const r = (a, b) => `<div class="r"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
  let h = `<div class="c"><b>${esc(info.toko)}</b><br>${esc(info.alamat)}</div><hr>`;
  h += r(s.no, s.ts.slice(0, 16)) + '<hr>';
  for (const l of s.lines) {
    h += `<div>${esc(l.nama)}</div>` + r(`${l.qty} x ${fmt(l.harga)}`, fmt(l.qty * l.harga));
    if (l.diskon) h += r('  Diskon', '-' + fmt(l.diskon));
  }
  h += '<hr>';
  if (s.diskon_nota) h += r('Subtotal', fmt(s.subtotal)) + r('Diskon nota', '-' + fmt(s.diskon_nota));
  h += r('TOTAL', fmt(s.total));
  if (s.tunai + s.kembali) h += r('Tunai', fmt(s.tunai + s.kembali));
  if (s.transfer) h += r('Transfer', fmt(s.transfer));
  if (s.qris) h += r('QRIS', fmt(s.qris));
  if (s.kembali) h += r('Kembali', fmt(s.kembali));
  h += `<hr><div class="c">${esc(info.footer)}</div>`;
  $('#struk').innerHTML = h;
  setTimeout(() => window.print(), 60);
}

// ---------------------------------------------------------------- navigasi
const layar = { kasir: viewKasir, barang: viewBarang, jual: viewJual, lap: viewLap, set: viewSet };
function route() {
  const t = (location.hash || '#kasir').slice(1); const nama = layar[t] ? t : 'kasir';
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.t === nama));
  window.onkeydown = null; $('#main').innerHTML = '';
  guard(layar[nama])();
}
$$('#nav button').forEach((b) => b.addEventListener('click', () => { if (location.hash === '#' + b.dataset.t) route(); else location.hash = b.dataset.t; }));
window.addEventListener('hashchange', route);

let katalog = [];
const muatKatalog = async () => { katalog = await api('/items'); return katalog; };
function cari(teks, maks = 40) {
  const w = teks.toLowerCase().split(/\s+/).filter(Boolean); if (!w.length) return [];
  const up = teks.trim().toUpperCase();
  const hit = katalog.filter((i) => i.aktif && w.every((x) => (i.kode + ' ' + i.nama).toLowerCase().includes(x)));
  hit.sort((a, b) => (b.kode === up) - (a.kode === up) || b.kode.startsWith(up) - a.kode.startsWith(up));
  return hit.slice(0, maks);
}

// ================================================================ KASIR
let cart = []; // {kode,nama,harga0,harga,qty,diskon,stok,hpp}
let diskonNota = '';

function hitung() {
  let sub = 0, valid = true;
  const baris = cart.map((c) => {
    const kotor = c.qty * c.harga, d = parseDiskon(c.diskon, kotor);
    const bad = Number.isNaN(d) || d < 0 || d > kotor; if (bad) valid = false;
    const diskon = bad ? 0 : d; sub += kotor - diskon;
    return { kotor, diskon, net: kotor - diskon, bad };
  });
  const dn = parseDiskon(diskonNota, sub), badNota = Number.isNaN(dn) || dn < 0 || dn > sub; if (badNota) valid = false;
  const nota = badNota ? 0 : dn;
  return { baris, sub, nota, badNota, total: sub - nota, valid: valid && cart.length > 0 };
}

async function viewKasir() {
  await muatKatalog();
  $('#main').innerHTML = `
  <div class="row">
    <div class="card grow" style="flex-basis:360px">
      <input id="q" class="cari" style="width:100%" placeholder="Ketik kode atau nama barang…" autocomplete="off" aria-label="Cari barang">
      <div class="hasil" id="hasil" hidden></div>
      <p class="mut sm" style="margin:10px 0 0">Enter = tambah barang paling atas. <b>5*sabun</b> = tambah 5 sekaligus. Harga dan diskon di keranjang bisa diubah langsung (diskon boleh Rp atau %). Tekan <b>End</b> untuk bayar.</p>
      ${katalog.length ? '' : '<div class="alert warn">Belum ada barang. Buka menu <b>Barang</b> lalu <b>Impor PDF / Excel</b> atau <b>+ Barang baru</b>.</div>'}
    </div>
    <div class="card grow" style="flex-basis:640px">
      <div class="scroll" style="max-height:46vh"><table class="cart"><thead><tr><th>Barang</th><th class="n">Harga</th><th class="n">Jml</th><th class="n">Diskon</th><th class="n">Subtotal</th><th></th></tr></thead><tbody id="cart"></tbody></table></div>
      <div class="total-box">
        <div class="r"><span class="mut">Subtotal</span><span id="sub">Rp 0</span></div>
        <div class="r"><span class="mut">Diskon nota <span class="sm">(Rp atau %)</span></span><span><span id="dnrp" class="mut"></span> <input id="dn" placeholder="0 / 10%" aria-label="Diskon nota"></span></div>
        <div class="r"><span><b>TOTAL</b></span><span class="big" id="tot">Rp 0</span></div>
      </div>
      <div class="aksi" style="justify-content:space-between"><button class="b bad" id="kosong">Kosongkan</button><button class="b pri" id="bayar" style="padding:10px 26px;font-size:16px">Bayar (End)</button></div>
    </div>
  </div>`;
  const q = $('#q'), hasil = $('#hasil'); let found = [], sel = 0, mult = 1;
  const gambarHasil = () => {
    hasil.hidden = !found.length;
    hasil.innerHTML = found.map((i, k) => `<div data-k="${k}" class="${k === sel ? 'sel' : ''}"><span><span class="mut sm">${esc(i.kode)}</span> &nbsp;<b>${esc(i.nama)}</b></span><span style="white-space:nowrap">${rp(i.harga)} <span class="mut sm">· stok ${i.stok}</span></span></div>`).join('');
  };
  const ketik = () => {
    let t = q.value.trim(); mult = 1;
    const m = t.match(/^(\d+)\s*\*\s*(.*)$/); if (m) { mult = Math.max(1, parseInt(m[1], 10)); t = m[2]; }
    found = cari(t); sel = 0; gambarHasil();
  };
  const pilih = (k) => { const i = found[k]; if (!i) return; tambah(i, mult); q.value = ''; found = []; gambarHasil(); q.focus(); };
  q.addEventListener('input', ketik);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!found.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      $$('[data-k]', hasil).forEach((d, k) => d.classList.toggle('sel', k === sel)); hasil.children[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); pilih(sel); }
    else if (e.key === 'Escape') { q.value = ''; found = []; gambarHasil(); }
  });
  hasil.addEventListener('click', (e) => { const d = e.target.closest('[data-k]'); if (d) pilih(Number(d.dataset.k)); });

  const tb = $('#cart');
  tb.addEventListener('input', (e) => { const f = e.target.dataset.f; if (f !== 'diskon') return; cart[Number(e.target.closest('tr').dataset.k)].diskon = e.target.value; refresh(); });
  tb.addEventListener('change', (e) => {
    const f = e.target.dataset.f; if (!f) return; const k = Number(e.target.closest('tr').dataset.k), c = cart[k];
    if (f === 'harga') {
      const v = parseAngka(e.target.value);
      if (v === null || v < 0) { toast('Harga tidak valid', true); e.target.value = fmt(c.harga); } else { c.harga = v; e.target.value = fmt(v); }
    } else if (f === 'qty') {
      const v = parseAngka(e.target.value);
      if (v === null || v <= 0) { cart.splice(k, 1); return renderCart(); }
      if (info.blok_stok && v > c.stok) { toast(`Stok ${c.nama} hanya ${c.stok}`, true); e.target.value = c.qty; } else c.qty = v;
    }
    refresh();
  });
  tb.addEventListener('focusin', (e) => { if (e.target.matches('input')) e.target.select(); });
  tb.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.target.blur(); q.focus(); } });
  tb.addEventListener('click', (e) => { const x = e.target.closest('[data-x]'); if (x) { cart.splice(Number(x.dataset.x), 1); renderCart(); } const r = e.target.closest('[data-r]'); if (r) { const c = cart[Number(r.dataset.r)]; c.harga = c.harga0; renderCart(); } });
  const dn = $('#dn'); dn.value = diskonNota; dn.addEventListener('input', () => { diskonNota = dn.value; refresh(); });
  $('#kosong').onclick = async () => { if (cart.length && await konfirmasi('Kosongkan keranjang?', 'Semua barang di keranjang dihapus.', 'Kosongkan')) { cart = []; diskonNota = ''; dn.value = ''; renderCart(); } };
  $('#bayar').onclick = bayar;
  window.onkeydown = (e) => { if (e.key === 'End' && $('#bayar') && !$('.modal')) { e.preventDefault(); bayar(); } };
  renderCart(); q.focus();
}
function tambah(i, n) {
  const c = cart.find((x) => x.kode === i.kode); const baru = (c ? c.qty : 0) + n;
  if (info.blok_stok && baru > i.stok) return toast(`Stok ${i.nama} hanya ${i.stok}`, true);
  if (c) c.qty = baru; else cart.push({ kode: i.kode, nama: i.nama, harga0: i.harga, harga: i.harga, qty: n, diskon: '', stok: i.stok, hpp: i.hpp });
  renderCart();
}
function renderCart() {
  const tb = $('#cart'); if (!tb) return;
  tb.innerHTML = cart.length ? cart.map((c, k) => `<tr data-k="${k}">
      <td class="nm"><div>${esc(c.nama)}</div><div class="mut sm">${esc(c.kode)} <span data-note></span></div></td>
      <td class="n"><input class="inp-h" data-f="harga" value="${fmt(c.harga)}" inputmode="numeric" aria-label="Harga ${esc(c.nama)}"></td>
      <td class="n"><input class="inp-q" data-f="qty" value="${c.qty}" inputmode="numeric" aria-label="Jumlah ${esc(c.nama)}"></td>
      <td class="n"><input class="inp-d" data-f="diskon" value="${esc(c.diskon)}" placeholder="0 / 10%" aria-label="Diskon ${esc(c.nama)}"></td>
      <td class="n" data-sub></td><td><button class="b sm bad" data-x="${k}" aria-label="Hapus ${esc(c.nama)}">✕</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="kosong">Keranjang kosong. Ketik nama atau kode barang di kolom pencarian.</td></tr>';
  refresh();
}
function refresh() {
  const h = hitung();
  cart.forEach((c, k) => {
    const tr = $(`#cart tr[data-k="${k}"]`); if (!tr) return;
    $('[data-sub]', tr).textContent = fmt(h.baris[k].net);
    $('[data-f="diskon"]', tr).classList.toggle('salah', h.baris[k].bad);
    tr.classList.toggle('ubah', c.harga !== c.harga0);
    const notes = [];
    if (c.harga !== c.harga0) notes.push(`<span class="tag">harga diubah · normal ${fmt(c.harga0)}</span> <button class="b sm" data-r="${k}">kembalikan</button>`);
    if (c.hpp > 0 && c.harga < c.hpp) notes.push('<span class="tag merah">di bawah modal</span>');
    $('[data-note]', tr).innerHTML = notes.join(' ');
  });
  $('#sub').textContent = rp(h.sub); $('#dn').classList.toggle('salah', h.badNota);
  $('#dnrp').textContent = h.nota ? '-' + rp(h.nota) : ''; $('#tot').textContent = rp(h.total);
}

function bayar() {
  if (!cart.length) return toast('Keranjang kosong', true);
  const h = hitung(); if (!h.valid) return toast('Periksa kolom merah: diskon tidak valid atau lebih besar dari harganya', true);
  const total = h.total;
  const saran = [...new Set([total, ...[5000, 10000, 50000, 100000].map((u) => Math.ceil(total / u) * u)])].filter((v) => v >= total).slice(0, 4);
  const m = modal(`<h3 style="margin-top:0">Pembayaran</h3><div class="big">${rp(total)}</div>
    ${h.nota ? `<div class="mut sm">Subtotal ${rp(h.sub)} − diskon nota ${rp(h.nota)}</div>` : ''}
    <div class="pay"><label class="f">Tunai</label><input id="p-tunai" inputmode="numeric" autocomplete="off">
    <div class="chips" id="saran">${saran.map((v) => `<button class="b sm" data-v="${v}">${v === total ? 'Uang pas' : fmt(v)}</button>`).join('')}</div>
    <label class="f">Transfer</label><input id="p-tf" inputmode="numeric" autocomplete="off"><label class="f">QRIS</label><input id="p-qr" inputmode="numeric" autocomplete="off"></div>
    <div style="margin:14px 0 0"><span class="mut">Kembali / kurang:</span> <b id="p-info" style="font-size:18px">-</b></div>
    <div class="aksi"><button class="b" id="p-batal">Batal</button><button class="b pri" id="p-ok">Bayar &amp; cetak struk</button></div>`);
  const T = $('#p-tunai', m), F = $('#p-tf', m), Q = $('#p-qr', m), ok = $('#p-ok', m);
  const upd = () => {
    const d = (parseAngka(T.value) || 0) + (parseAngka(F.value) || 0) + (parseAngka(Q.value) || 0) - total;
    $('#p-info', m).textContent = d >= 0 ? 'Kembali ' + rp(d) : 'Kurang ' + rp(-d);
    $('#p-info', m).className = d >= 0 ? 'ok' : 'bad-t'; ok.disabled = d < 0;
  };
  [T, F, Q].forEach((i) => i.addEventListener('input', upd));
  $('#saran', m).onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) { T.value = b.dataset.v; F.value = ''; Q.value = ''; upd(); ok.focus(); } };
  $('#p-batal', m).onclick = () => m.close();
  let sibuk = false;
  const simpan = guard(async () => {
    if (ok.disabled || sibuk) return; sibuk = true; ok.disabled = true;
    try {
      const lines = cart.map((c) => { const l = { kode: c.kode, qty: c.qty }; if (c.harga !== c.harga0) l.harga = c.harga; if (String(c.diskon).trim()) l.diskon = String(c.diskon).trim(); return l; });
      const s = await api('/sales', { lines, diskon_nota: diskonNota.trim(), tunai: parseAngka(T.value) || 0, transfer: parseAngka(F.value) || 0, qris: parseAngka(Q.value) || 0 });
      m.remove(); cart = []; diskonNota = ''; $('#dn') && ($('#dn').value = ''); renderCart();
      toast(`Tersimpan ${s.no}` + (s.kembali ? ` · kembali ${rp(s.kembali)}` : '')); cetakStruk(s);
      muatKatalog().catch(() => {}); $('#q') && $('#q').focus();
    } finally { sibuk = false; ok.disabled = false; }
  });
  ok.onclick = simpan;
  m.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); simpan(); } });
  T.focus(); upd();
}

// ================================================================ BARANG
async function viewBarang() {
  $('#main').innerHTML = `<div class="card">
    <div class="toolbar"><input id="bq" class="cari" type="search" placeholder="Cari kode / nama barang…" aria-label="Cari barang">
      <button class="b" id="impor">⬆ Impor PDF / Excel</button><button class="b pri" id="baru">+ Barang baru</button></div>
    <div class="selbar" id="selbar" hidden><b id="selinfo"></b><button class="b bad sm" id="hapusSel">Hapus terpilih</button><button class="b sm" id="batalSel">Batal pilih</button></div>
    <div class="scroll"><table><thead><tr><th style="width:34px"><input type="checkbox" id="all" aria-label="Pilih semua"></th><th>Kode</th><th>Nama</th><th class="n">Harga</th><th class="n">HPP</th><th class="n">Stok</th><th></th></tr></thead><tbody id="bt"></tbody></table></div>
    <div class="foot"><span id="cnt"></span><button class="b sm" id="more" hidden>Tampilkan 200 lagi</button></div></div>`;
  let rows = [], tampil = 200; const dipilih = new Set();
  const load = guard(async () => { rows = await api('/items?q=' + encodeURIComponent($('#bq').value)); for (const k of [...dipilih]) if (!rows.some((r) => r.kode === k)) dipilih.delete(k); gambar(); });
  function gambar() {
    $('#bt').innerHTML = rows.slice(0, tampil).map((i) => `<tr data-kode="${esc(i.kode)}" class="${dipilih.has(i.kode) ? 'sel' : ''}" style="${i.aktif ? '' : 'opacity:.55'}">
      <td><input type="checkbox" class="cb" ${dipilih.has(i.kode) ? 'checked' : ''} aria-label="Pilih ${esc(i.nama)}"></td><td>${esc(i.kode)}</td><td>${esc(i.nama)}${i.aktif ? '' : ' <span class="tag">nonaktif</span>'}</td>
      <td class="n">${fmt(i.harga)}</td><td class="n mut">${fmt(i.hpp)}</td><td class="n ${i.stok <= 0 ? 'mut' : ''}">${i.stok}</td>
      <td style="white-space:nowrap"><button class="b sm" data-e>Ubah</button> <button class="b sm" data-dup title="Buat varian dari barang ini">Duplikat</button> <button class="b sm" data-s>Stok</button> <button class="b sm bad" data-h>Hapus</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="kosong">Belum ada barang. Klik <b>Impor PDF / Excel</b> atau <b>+ Barang baru</b>.</td></tr>';
    $('#cnt').textContent = `${fmt(rows.length)} barang` + (rows.length > tampil ? ` · tampil ${fmt(tampil)}` : '');
    $('#more').hidden = rows.length <= tampil; $('#selbar').hidden = !dipilih.size; $('#selinfo').textContent = `${fmt(dipilih.size)} barang dipilih`;
    const all = $('#all'); all.checked = rows.length > 0 && dipilih.size >= rows.length && rows.every((r) => dipilih.has(r.kode)); all.indeterminate = dipilih.size > 0 && !all.checked;
  }
  $('#bq').addEventListener('input', () => { tampil = 200; load(); });
  $('#more').onclick = () => { tampil += 200; gambar(); };
  $('#all').onchange = (e) => { if (e.target.checked) rows.forEach((r) => dipilih.add(r.kode)); else dipilih.clear(); gambar(); };
  $('#batalSel').onclick = () => { dipilih.clear(); gambar(); };
  $('#bt').addEventListener('change', (e) => { if (!e.target.matches('.cb')) return; const k = e.target.closest('tr').dataset.kode; if (e.target.checked) dipilih.add(k); else dipilih.delete(k); gambar(); });
  $('#bt').addEventListener('click', guard(async (e) => {
    const tr = e.target.closest('tr[data-kode]'); if (!tr) return; const it = rows.find((r) => r.kode === tr.dataset.kode); if (!it) return;
    if (e.target.closest('[data-e]')) formBarang(it, load);
    else if (e.target.closest('[data-dup]')) formBarang(null, load, it);
    else if (e.target.closest('[data-s]')) formStok(it, load);
    else if (e.target.closest('[data-h]')) hapusBarangUI([it.kode], `<b>${esc(it.nama)}</b> (${esc(it.kode)})`, () => { dipilih.delete(it.kode); load(); });
  }));
  $('#hapusSel').onclick = () => hapusBarangUI([...dipilih], `<b>${fmt(dipilih.size)} barang</b> yang dipilih`, () => { dipilih.clear(); load(); });
  $('#baru').onclick = () => formBarang(null, load);
  $('#impor').onclick = () => dialogImpor(load);
  load();
}
async function hapusBarangUI(kodes, apa, done) {
  const ok = await konfirmasi(kodes.length > 1 ? `Hapus ${fmt(kodes.length)} barang?` : 'Hapus barang?',
    `<p>${apa} akan dihapus dari daftar barang beserta catatan stoknya.</p><p class="mut sm">Riwayat penjualan lama tetap tersimpan di laporan. ${kodes.length >= 3 ? 'Cadangan data dibuat otomatis sebelum menghapus.' : ''} Penghapusan tidak bisa dibatalkan.</p>`);
  if (!ok) return;
  const r = await api('/items/hapus', { kodes }); toast(`${fmt(r.dihapus)} barang dihapus`); done();
}
// Kolom angka rupiah: titik ribuan muncul langsung saat mengetik (1000 -> 1.000)
function titikRibuan(el) {
  el.addEventListener('input', () => {
    const v = el.value, pos = el.selectionStart ?? v.length;
    const digitDiKiri = v.slice(0, pos).replace(/\D/g, '').length;
    const angka = v.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const baru = angka ? Number(angka).toLocaleString('id-ID') : '';
    el.value = baru;
    let n = 0, i = 0; while (i < baru.length && n < digitDiKiri) { if (/\d/.test(baru[i])) n++; i++; }
    try { el.setSelectionRange(i, i); } catch { /* abaikan */ }
  });
}
function formBarang(it, done, tpl) {
  const v = it || tpl;
  const m = modal(`<h3 style="margin-top:0">${it ? 'Ubah barang' : tpl ? 'Duplikat barang (varian baru)' : 'Barang baru'}</h3>
    <label class="f">Kode ${it ? '(tidak bisa diubah)' : '(kosongkan = otomatis)'}</label><input id="f-kode" style="width:100%" value="${esc(it?.kode || '')}" ${it ? 'readonly' : ''}>
    <label class="f">Nama</label><input id="f-nama" style="width:100%" value="${esc(v?.nama || '')}">
    <label class="f">Harga jual</label><input id="f-harga" style="width:100%" inputmode="numeric" value="${v ? fmt(v.harga) : ''}">
    <label class="f">HPP / harga modal</label><input id="f-hpp" style="width:100%" inputmode="numeric" value="${v ? fmt(v.hpp) : ''}">
    ${it ? `<label class="f"><input type="checkbox" id="f-aktif" ${it.aktif ? 'checked' : ''}> Barang aktif (tampil di kasir)</label>` : '<label class="f">Stok awal</label><input id="f-stok" style="width:100%" inputmode="numeric" value="0">'}
    <div class="aksi"><button class="b" id="f-x">Batal</button><button class="b pri" id="f-ok">Simpan</button></div>`);
  $('#f-x', m).onclick = () => m.close();
  titikRibuan($('#f-harga', m)); titikRibuan($('#f-hpp', m)); titikRibuan($('#f-stok', m) || document.createElement('input'));
  const simpan = guard(async () => {
    const harga = parseAngka($('#f-harga', m).value), hpp = $('#f-hpp', m).value.trim() === '' ? 0 : parseAngka($('#f-hpp', m).value);
    if (harga === null) throw new Error('Harga jual harus diisi dengan angka'); if (hpp === null) throw new Error('HPP harus berupa angka');
    await api('/items', { baru: !it, kode: $('#f-kode', m).value, nama: $('#f-nama', m).value, harga, hpp,
      stok: it ? undefined : (parseAngka($('#f-stok', m).value) || 0), aktif: it ? ($('#f-aktif', m).checked ? 1 : 0) : 1 });
    m.remove(); toast('Tersimpan'); done();
  });
  $('#f-ok', m).onclick = simpan; m.addEventListener('keydown', (e) => { if (e.key === 'Enter') simpan(); });
  if (tpl) { $('#f-nama', m).focus(); $('#f-nama', m).select(); } else (it ? $('#f-nama', m) : $('#f-kode', m)).focus();
}
function formStok(it, done) {
  const m = modal(`<h3 style="margin-top:0">Stok: ${esc(it.nama)}</h3><p class="mut">Stok sekarang: <b>${it.stok}</b></p>
    <label class="f">Barang masuk (tambah)</label><div style="display:flex;gap:8px"><input id="s-add" inputmode="numeric" style="flex:1"><button class="b pri" id="s-addok">Tambah</button></div>
    <label class="f">Hasil hitung fisik (koreksi / opname)</label><div style="display:flex;gap:8px"><input id="s-set" inputmode="numeric" style="flex:1" value="${it.stok >= 0 ? it.stok : 0}"><button class="b" id="s-setok">Set stok</button></div>
    <div class="aksi"><button class="b" id="s-x">Tutup</button></div>`);
  $('#s-x', m).onclick = () => m.close();
  $('#s-addok', m).onclick = guard(async () => { await api(`/items/${encodeURIComponent(it.kode)}/masuk`, { qty: parseAngka($('#s-add', m).value) }); m.remove(); toast('Stok bertambah'); done(); });
  $('#s-setok', m).onclick = guard(async () => { await api(`/items/${encodeURIComponent(it.kode)}/opname`, { stok: parseAngka($('#s-set', m).value) }); m.remove(); toast('Stok dikoreksi'); done(); });
}

// ---------------------------------------------------------------- impor PDF / Excel
const PERAN = [['abaikan', '— abaikan —'], ['kode', 'Kode'], ['nama', 'Nama barang'], ['harga', 'Harga jual'], ['hpp', 'HPP / modal'], ['stok', 'Stok']];
function dialogImpor(done) {
  let buf = null, nmFile = '', data = null, peta = [], mode = 'lewati', aturStok = false, sudahImpor = false, ada = { kode: new Set(), nama: new Set() };
  const norm = Angka.kunciNama, normKode = (s) => String(s || '').trim().toUpperCase();
  const m = modal('<div id="imp"></div>', { lebar: true, kunci: true, onClose: () => { if (sudahImpor) done(); } });
  const box = $('#imp', m);
  api('/items').then((l) => { l.forEach((i) => { ada.kode.add(i.kode); ada.nama.add(norm(i.nama)); }); }).catch(() => {});

  function viewPilih(pesan) {
    box.innerHTML = `<h3>Impor barang dari PDF / Excel</h3>
      <p class="mut" style="margin-top:0">File dibaca di komputer ini, tidak dikirim ke internet. Kolom yang dibutuhkan: <b>nama barang</b> dan <b>harga jual</b>. Kode, modal (HPP) dan stok boleh ada, boleh tidak.</p>
      <div class="dz" id="dz"><input type="file" id="file" accept=".pdf,.xlsx,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        <div style="font-size:17px;margin-bottom:8px"><b>Tarik file ke sini</b></div><button class="b pri" id="pilih">Pilih file…</button>
        <div class="mut sm" style="margin-top:10px">PDF (hasil cetak dari Excel / Word / aplikasi, bukan foto atau scan) · Excel .xlsx · CSV</div></div>
      ${pesan ? `<div class="alert bad">${esc(pesan)}</div>` : ''}
      <div class="aksi"><button class="b" id="tutup">Tutup</button></div>`;
    const dz = $('#dz', box), inp = $('#file', box);
    $('#pilih', box).onclick = () => inp.click(); $('#tutup', box).onclick = () => m.close();
    inp.onchange = () => { if (inp.files[0]) baca(inp.files[0]); };
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) baca(e.dataTransfer.files[0]); });
  }
  async function baca(f, lembar) {
    if (f.size > 40e6) return viewPilih('File terlalu besar (maksimal 40 MB).');
    box.innerHTML = `<h3>Membaca ${esc(f.name)}…</h3><p><span class="spin"></span>Mohon tunggu sebentar.</p>`;
    try {
      buf = await f.arrayBuffer(); nmFile = f.name;
      data = await apiFile('/impor/baca' + (lembar ? '?lembar=' + encodeURIComponent(lembar) : ''), buf);
    } catch (e) { return viewPilih(e.message); }
    peta = data.kolom.map((k) => k.tebakan); viewPeta();
  }
  function ringkas() {
    const ix = (r) => peta.indexOf(r), iN = ix('nama'), iH = ix('harga'), iK = ix('kode'), iM = ix('hpp');
    const o = { total: data.baris.length, baru: 0, sudah: 0, salah: 0, ganda: 0, rugi: 0, lengkap: iN >= 0 && iH >= 0 };
    if (!o.lengkap) return o;
    const lihat = new Set();
    for (const r of data.baris) {
      const nama = norm(r[iN]), h = parseAngka(r[iH]);
      if (!nama) { o.salah++; continue; }
      const kode = iK >= 0 ? normKode(r[iK]) : '', key = kode ? 'K:' + kode : 'N:' + nama;
      if (lihat.has(key)) { o.ganda++; continue; }
      if (h === null || h < 0) { if (kode ? ada.kode.has(kode) : ada.nama.has(nama)) o.sudah++; else o.salah++; continue; }
      lihat.add(key);
      if (kode ? ada.kode.has(kode) : ada.nama.has(nama)) o.sudah++; else o.baru++;
      if (iM >= 0) { const hp = parseAngka(r[iM]); if (hp !== null && hp > h) o.rugi++; }
    }
    return o;
  }
  function viewPeta() {
    const o = ringkas(), adaStok = peta.includes('stok');
    box.innerHTML = `<h3>Periksa dulu sebelum diimpor</h3>
      <p style="margin-top:0">Terbaca <b>${fmt(data.baris.length)} baris</b> dari <b>${esc(nmFile)}</b> (${esc(data.sumber.toUpperCase())}${data.lembar_dipakai ? ', lembar "' + esc(data.lembar_dipakai) + '"' : ''}${data.halaman ? ', ' + data.halaman + ' halaman' : ''}).
      ${data.lembar && data.lembar.length > 1 ? ` Lembar lain: <select id="lembar">${data.lembar.map((n) => `<option ${n === data.lembar_dipakai ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}</p>
      ${(data.catatan || []).map((c) => `<div class="alert info">${esc(c)}</div>`).join('')}
      <p class="mut sm" style="margin:6px 0">Pilih arti tiap kolom di baris judul tabel. Kolom yang tidak dipakai biarkan <i>abaikan</i>.</p>
      <div class="prev"><table><thead><tr>${data.kolom.map((k, c) => `<th><div class="mut sm">Judul di file: ${esc(k.label || '(tidak ada)')}</div>
        <select data-c="${c}">${PERAN.map(([v, t]) => `<option value="${v}" ${peta[c] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></th>`).join('')}</tr></thead>
        <tbody>${data.baris.slice(0, 8).map((r) => `<tr>${r.map((t) => `<td title="${esc(t)}">${esc(t)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${data.baris.length > 8 ? `<div class="mut sm" style="margin-top:4px">Menampilkan 8 baris pertama dari ${fmt(data.baris.length)}.</div>` : ''}
      ${!o.lengkap ? '<div class="alert warn">Pilih satu kolom sebagai <b>Nama barang</b> dan satu kolom sebagai <b>Harga jual</b> untuk melanjutkan.</div>' : `
      <div class="stat"><div><b>${fmt(o.baru)}</b>barang baru</div><div><b>${fmt(o.sudah)}</b>sudah ada</div><div><b class="${o.salah ? 'warn-t' : ''}">${fmt(o.salah)}</b>baris dilewati (nama / harga kosong)</div></div>
      ${o.ganda ? `<div class="alert warn">${fmt(o.ganda)} baris ternyata barang yang sama dengan baris lain di file ini (nama sama, atau hanya beda huruf besar/kecil, spasi, dan tanda - , / ( )). Barang itu dimasukkan sekali saja: mode <i>Lewati</i> memakai baris yang pertama, mode <i>Perbarui</i> memakai yang terakhir.</div>` : ''}
      ${o.rugi ? `<div class="alert warn">${fmt(o.rugi)} barang punya HPP lebih besar dari harga jual (rugi). Pastikan kolom HPP dan Harga jual tidak tertukar.</div>` : ''}
      ${!peta.includes('kode') ? '<div class="mut sm">Tidak ada kolom kode: barang baru diberi kode otomatis BRG0001, BRG0002, …</div>' : ''}
      ${!adaStok ? '<div class="mut sm">Tidak ada kolom stok: stok awal 0 (isi nanti lewat tombol Stok; kasir tetap bisa menjual).</div>' : ''}
      <fieldset style="border:1px solid var(--line);border-radius:8px;margin:12px 0 0;padding:8px 12px"><legend class="sm mut">Jika barangnya sudah ada (kode atau nama sama)</legend>
        <label><input type="radio" name="mode" value="lewati" ${mode === 'lewati' ? 'checked' : ''}> Lewati — tidak diubah (aman, bisa impor ulang tanpa menggandakan)</label><br>
        <label><input type="radio" name="mode" value="perbarui" ${mode === 'perbarui' ? 'checked' : ''}> Perbarui harga jual${peta.includes('hpp') ? ' dan HPP' : ''} sesuai file</label>
        ${mode === 'perbarui' && adaStok ? `<br><label style="margin-left:24px"><input type="checkbox" id="atur" ${aturStok ? 'checked' : ''}> ubah juga stoknya sesuai file</label>` : ''}</fieldset>`}
      <div class="aksi" style="justify-content:space-between"><button class="b" id="ganti">← Ganti file</button><span><button class="b" id="batal">Batal</button>
        <button class="b pri" id="simpan" ${o.lengkap && (o.baru + (mode === 'perbarui' ? o.sudah : 0)) > 0 ? '' : 'disabled'}>Impor sekarang</button></span></div>`;
    $$('select[data-c]', box).forEach((s) => s.onchange = () => {
      const c = Number(s.dataset.c), v = s.value; if (v !== 'abaikan') peta = peta.map((p) => (p === v ? 'abaikan' : p)); peta[c] = v; viewPeta();
    });
    const lm = $('#lembar', box); if (lm) lm.onchange = () => baca(new File([buf], nmFile), lm.value);
    $$('input[name=mode]', box).forEach((r) => r.onchange = () => { mode = r.value; viewPeta(); });
    const at = $('#atur', box); if (at) at.onchange = () => { aturStok = at.checked; };
    $('#ganti', box).onclick = () => viewPilih(); $('#batal', box).onclick = () => m.close();
    $('#simpan', box).onclick = guard(async () => {
      const ix = (r) => peta.indexOf(r), g = (r, k) => (ix(r) >= 0 ? r2[ix(r)] : undefined); let r2;
      const rows = data.baris.map((r) => { r2 = r; return { kode: g('kode'), nama: g('nama'), harga: g('harga'), hpp: g('hpp'), stok: g('stok') }; });
      box.innerHTML = '<h3>Mengimpor…</h3><p><span class="spin"></span>Mohon tunggu, jangan tutup jendela ini.</p>';
      let h; try { h = await api('/impor/simpan', { rows, mode, atur_stok: aturStok && mode === 'perbarui' }); } catch (e) { toast(e.message, true); return viewPeta(); }
      sudahImpor = true; viewHasil(h);
    });
  }
  function viewHasil(h) {
    box.innerHTML = `<h3>Impor selesai</h3>
      <div class="stat"><div><b class="ok">${fmt(h.baru)}</b>barang baru</div><div><b>${fmt(h.diperbarui)}</b>diperbarui</div><div><b>${fmt(h.dilewati)}</b>dilewati (sudah ada)</div><div><b class="${h.gagal.length ? 'bad-t' : ''}">${fmt(h.gagal.length)}</b>gagal</div></div>
      ${h.baru ? '<div class="alert info">Barang tanpa kode diberi kode otomatis. Cek hasilnya di daftar barang; kalau salah impor, centang barangnya lalu <b>Hapus terpilih</b>.</div>' : ''}
      ${h.gagal.length ? `<p class="mut sm" style="margin-bottom:4px">Baris yang tidak bisa diimpor:</p><div class="prev" style="max-height:220px"><table><thead><tr><th style="min-width:90px">Baris data ke-</th><th>Nama</th><th>Alasan</th></tr></thead><tbody>${h.gagal.slice(0, 100).map((x) => `<tr><td>${x.baris}</td><td>${esc(x.nama)}</td><td>${esc(x.alasan)}</td></tr>`).join('')}</tbody></table></div>${h.gagal.length > 100 ? `<div class="mut sm">…dan ${h.gagal.length - 100} lainnya.</div>` : ''}` : ''}
      <div class="aksi"><button class="b pri" id="selesai">Selesai</button></div>`;
    $('#selesai', box).onclick = () => m.close();
  }
  viewPilih();
}

// ================================================================ PENJUALAN
async function viewJual() {
  $('#main').innerHTML = `<div class="card"><div id="rg"></div>
    <div class="selbar" id="selbar" hidden><b id="selinfo"></b><button class="b bad sm" id="hapusSel">Hapus terpilih</button><button class="b sm" id="batalSel">Batal pilih</button></div>
    <div class="scroll"><table><thead><tr><th style="width:34px"><input type="checkbox" id="all" aria-label="Pilih semua"></th><th>No. nota</th><th>Waktu</th><th>Pembayaran</th><th class="n">Diskon</th><th class="n">Total</th><th>Status</th><th></th></tr></thead><tbody id="jb"></tbody></table></div>
    <div class="foot"><span id="cnt"></span><span id="sum"></span></div></div>`;
  let rows = []; const dipilih = new Set();
  const load = guard(async () => { rows = await api(`/sales?dari=${periode.dari}&sampai=${periode.sampai}`); dipilih.clear(); gambar(); });
  function gambar() {
    const multi = periode.dari !== periode.sampai;
    $('#jb').innerHTML = rows.map((s) => `<tr data-id="${s.id}" class="${dipilih.has(s.id) ? 'sel' : ''}" style="${s.status === 'void' ? 'opacity:.6' : ''}">
      <td><input type="checkbox" class="cb" ${dipilih.has(s.id) ? 'checked' : ''} aria-label="Pilih ${esc(s.no)}"></td><td>${esc(s.no)}</td><td>${multi ? tglID(s.ts.slice(0, 10)) + ' ' : ''}${s.ts.slice(11, 16)}</td>
      <td>${[s.tunai && 'Tunai', s.transfer && 'Transfer', s.qris && 'QRIS'].filter(Boolean).join(' + ') || '-'}</td><td class="n">${s.diskon ? fmt(s.diskon) : '-'}</td><td class="n">${fmt(s.total)}</td>
      <td>${s.status === 'void' ? '<span class="tag merah">Batal</span>' : 'Lunas'}</td>
      <td style="white-space:nowrap"><button class="b sm" data-d>Detail</button> <button class="b sm bad" data-h>Hapus</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="kosong">Tidak ada penjualan pada tanggal ini.</td></tr>';
    const lunas = rows.filter((s) => s.status === 'paid');
    $('#cnt').textContent = `${fmt(rows.length)} transaksi`; $('#sum').innerHTML = `Omzet (lunas): <b>${rp(lunas.reduce((a, s) => a + s.total, 0))}</b>`;
    $('#selbar').hidden = !dipilih.size; $('#selinfo').textContent = `${fmt(dipilih.size)} penjualan dipilih`;
    const all = $('#all'); all.checked = rows.length > 0 && dipilih.size === rows.length; all.indeterminate = dipilih.size > 0 && !all.checked;
  }
  pilihanTanggal($('#rg'), load);
  $('#all').onchange = (e) => { if (e.target.checked) rows.forEach((r) => dipilih.add(r.id)); else dipilih.clear(); gambar(); };
  $('#batalSel').onclick = () => { dipilih.clear(); gambar(); };
  $('#hapusSel').onclick = () => hapusJualUI([...dipilih].map((id) => rows.find((r) => r.id === id)), load);
  $('#jb').addEventListener('change', (e) => { if (!e.target.matches('.cb')) return; const id = Number(e.target.closest('tr').dataset.id); if (e.target.checked) dipilih.add(id); else dipilih.delete(id); gambar(); });
  $('#jb').addEventListener('click', guard(async (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return; const s = rows.find((r) => r.id === Number(tr.dataset.id));
    if (e.target.closest('[data-d]')) detailJual(await api('/sales/' + s.id), load);
    else if (e.target.closest('[data-h]')) hapusJualUI([s], load);
  }));
  load();
}
async function hapusJualUI(list, done) {
  const lunas = list.filter((s) => s.status === 'paid'), nilai = lunas.reduce((a, s) => a + s.total, 0);
  const ok = await konfirmasi(list.length > 1 ? `Hapus ${fmt(list.length)} penjualan?` : 'Hapus penjualan?',
    `<p>${list.length > 1 ? `<b>${fmt(list.length)} penjualan</b>` : `Nota <b>${esc(list[0].no)}</b>`}${nilai ? ` (senilai <b>${rp(nilai)}</b>)` : ''} akan dihapus <b>selamanya</b> dan hilang dari laporan. Stok barang yang terjual dikembalikan.</p>
     <p class="mut sm">Kalau hanya salah input dan ingin tetap tercatat sebagai batal, pakai <i>Batalkan</i> di menu Detail. ${list.length >= 3 ? 'Cadangan data dibuat otomatis sebelum menghapus. ' : ''}Penghapusan tidak bisa dibatalkan.</p>`);
  if (!ok) return;
  const r = await api('/sales/hapus', { ids: list.map((s) => s.id) }); toast(`${fmt(r.dihapus)} penjualan dihapus`); done();
}
function ubahBarisUI(s, l, selesai) {
  const utama = s.tunai > 0 ? 'tunai' : s.transfer > 0 ? 'transfer' : 'qris';
  const m = modal(`<h3 style="margin-top:0">Ubah nota ${esc(s.no)}</h3>
    <p><b>${esc(l.nama)}</b><br><span class="mut">Sekarang ${l.qty} × ${fmt(l.harga)}</span></p>
    <label class="f">Jumlah yang tinggal di nota (isi 0 untuk menghapus barang ini)</label>
    <input id="u-qty" inputmode="numeric" style="width:100%" value="0">
    <div id="u-info" class="sm" style="margin:10px 0"></div>
    <label class="f" id="u-mlab">Uang dikembalikan lewat</label>
    <select id="u-metode" style="width:100%"><option value="tunai">Tunai</option><option value="transfer">Transfer</option><option value="qris">QRIS</option></select>
    <div class="aksi"><button class="b" id="u-x">Batal</button><button class="b pri" id="u-ok">Simpan</button></div>`);
  $('#u-metode', m).value = utama;
  const hitung = () => {
    const q = parseAngka($('#u-qty', m).value);
    const info = $('#u-info', m);
    if (q === null || q < 0 || q > l.qty) { info.innerHTML = `<span class="bad-t">Isi angka 0 sampai ${l.qty}.</span>`; return null; }
    const barisLama = l.qty * l.harga - l.diskon, barisBaru = q * l.harga - Math.round(l.diskon * q / l.qty);
    const sub = s.subtotal - barisLama + barisBaru, dn = Math.min(s.diskon_nota, sub), total = sub - dn, kembali = s.total - total;
    const habis = q === 0 && s.lines.length === 1;
    info.innerHTML = habis ? 'Ini satu-satunya barang di nota, jadi nota akan <b>dibatalkan</b> dan stok dikembalikan.'
      : `Total nota: ${fmt(s.total)} → <b>${fmt(total)}</b>. Uang dikembalikan ke pelanggan: <b>${rp(kembali)}</b>. Stok ${l.qty - q} dikembalikan.`;
    return q;
  };
  $('#u-qty', m).oninput = hitung; hitung();
  $('#u-x', m).onclick = () => m.close();
  const simpan = guard(async () => {
    const q = hitung(); if (q === null) return;
    await api(`/sales/${s.id}/baris`, { line: l.id, qty: q, metode: $('#u-metode', m).value });
    m.remove(); toast(q === 0 ? 'Barang dihapus dari nota, stok dikembalikan' : 'Jumlah diubah, stok dikembalikan'); selesai();
  });
  $('#u-ok', m).onclick = simpan; m.addEventListener('keydown', (e) => { if (e.key === 'Enter') simpan(); });
  $('#u-qty', m).focus(); $('#u-qty', m).select();
}
function detailJual(s, done) {
  const m = modal(`<h3 style="margin-top:0">${esc(s.no)} ${s.status === 'void' ? '<span class="tag merah">BATAL</span>' : ''}</h3><div class="mut">${esc(s.ts)}</div>
    ${s.laba ? `<div class="card" style="margin:8px 0;padding:10px"><div class="mut sm">Laba nota ini</div><div style="font-size:1.3em;font-weight:700" class="${s.laba.laba < 0 ? 'bad-t' : ''}">${s.laba.laba < 0 ? '−' : ''}${rp(Math.abs(s.laba.laba))}</div>
      <div class="mut sm">bersih ${rp(s.laba.net)} − HPP ${rp(s.laba.hpp)} · margin ${s.laba.margin === null ? '–' : String(s.laba.margin).replace('.', ',') + '%'}</div>
      ${s.laba.tanpaHpp ? `<div class="sm warn-t">${s.laba.tanpaHpp} barang belum ada HPP: laba terlihat terlalu tinggi</div>` : ''}</div>` : ''}
    <table style="margin-top:8px">${s.lines.map((l) => `<tr><td>${esc(l.nama)}${l.harga !== l.harga_asli ? `<div class="sm warn-t">harga diubah (normal ${fmt(l.harga_asli)})</div>` : ''}${l.diskon ? `<div class="sm mut">diskon −${fmt(l.diskon)}</div>` : ''}</td>
      <td class="n" style="white-space:nowrap">${l.qty} × ${fmt(l.harga)}</td><td class="n">${fmt(l.qty * l.harga - l.diskon)}${s.laba ? `<div class="sm ${s.laba.baris[l.id].laba < 0 ? 'bad-t' : 'mut'}">laba ${s.laba.baris[l.id].tanpaHpp ? '–' : fmt(s.laba.baris[l.id].laba)}</div>` : ''}</td>
      <td>${s.status === 'paid' ? `<button class="b sm" data-ubah="${l.id}">Ubah / hapus</button>` : ''}</td></tr>`).join('')}
      ${s.diskon_nota ? `<tr><td class="mut">Subtotal</td><td></td><td class="n">${fmt(s.subtotal)}</td></tr><tr><td class="mut">Diskon nota</td><td></td><td class="n">−${fmt(s.diskon_nota)}</td></tr>` : ''}
      <tr><th>Total</th><th></th><th class="n">${fmt(s.total)}</th></tr></table>
    <div class="mut sm" style="margin-top:8px">${[s.tunai + s.kembali && `Tunai ${fmt(s.tunai + s.kembali)}`, s.transfer && `Transfer ${fmt(s.transfer)}`, s.qris && `QRIS ${fmt(s.qris)}`, s.kembali && `Kembali ${fmt(s.kembali)}`].filter(Boolean).join(' · ')}</div>
    ${s.alasan ? `<p class="bad-t">Alasan batal: ${esc(s.alasan)}</p>` : ''}
    <div class="aksi" style="justify-content:space-between"><span>${s.status === 'paid' && s.tgl === today() ? '<button class="b sm" id="d-void">Batalkan (tetap tercatat)</button> ' : ''}<button class="b sm bad" id="d-hapus">Hapus selamanya</button></span>
    <span><button class="b" id="d-print">Cetak ulang</button> <button class="b" id="d-x">Tutup</button></span></div>`);
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ubah]'); if (!b) return;
    const l = s.lines.find((x) => x.id === Number(b.dataset.ubah));
    ubahBarisUI(s, l, guard(async () => { const baru = await api('/sales/' + s.id); m.remove(); done(); detailJual(baru, done); }));
  });
  $('#d-x', m).onclick = () => m.close(); $('#d-print', m).onclick = () => cetakStruk(s);
  $('#d-hapus', m).onclick = guard(async () => { m.close(); await hapusJualUI([s], done); });
  const v = $('#d-void', m);
  if (v) v.onclick = guard(async () => {
    m.style.display = 'none'; const alasan = (prompt('Alasan pembatalan:') || '').trim(); m.style.display = '';
    if (!alasan) return; await api(`/sales/${s.id}/void`, { alasan }); m.remove(); toast('Dibatalkan, stok dikembalikan'); done();
  });
}

// ================================================================ LAPORAN
async function viewLap() {
  $('#main').innerHTML = `<div class="card" style="margin-bottom:14px"><div id="rg"></div><div class="toolbar" style="margin:0"><a class="b pri" id="pdf" download>⬇ Unduh PDF</a><span class="mut sm">Laporan penjualan untuk periode yang dipilih: ringkasan, daftar transaksi, dan rincian barang terjual.</span></div></div><div id="lb"></div>`;
  const load = guard(async () => {
    const r = await api(`/report?dari=${periode.dari}&sampai=${periode.sampai}`);
    $('#pdf').href = `/api/laporan.pdf?dari=${periode.dari}&sampai=${periode.sampai}`;
    $('#lb').innerHTML = `<div class="kpis">
      <div class="card kpi"><div class="l">Omzet</div><div class="v">${rp(r.omzet)}</div><div class="mut sm">${fmt(r.jumlah)} transaksi</div></div>
      <div class="card kpi"><div class="l">Laba kotor</div><div class="v">${rp(r.laba)}</div><div class="mut sm">harga jual − HPP − diskon</div></div>
      <div class="card kpi"><div class="l">Diskon diberikan</div><div class="v">${rp(r.diskon)}</div></div>
      <div class="card kpi"><div class="l">Tunai</div><div class="v">${rp(r.tunai)}</div></div>
      <div class="card kpi"><div class="l">Transfer</div><div class="v">${rp(r.transfer)}</div></div>
      <div class="card kpi"><div class="l">QRIS</div><div class="v">${rp(r.qris)}</div></div></div>
      ${r.batal ? `<p class="mut sm">${fmt(r.batal)} transaksi dibatalkan (tidak dihitung).</p>` : ''}
      <div class="row">
        ${r.perHari.length > 1 ? `<div class="card grow" style="flex-basis:300px"><b>Per hari</b><table><thead><tr><th>Tanggal</th><th class="n">Transaksi</th><th class="n">Omzet</th></tr></thead><tbody>${r.perHari.map((h) => `<tr><td>${tglID(h.tgl)}</td><td class="n">${fmt(h.jumlah)}</td><td class="n">${fmt(h.omzet)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="card grow" style="flex-basis:380px"><b>Barang terlaris</b><table><thead><tr><th>Barang</th><th class="n">Jml</th><th class="n">Nilai</th></tr></thead><tbody>
          ${r.terlaris.map((t) => `<tr><td>${esc(t.nama)}</td><td class="n">${fmt(t.qty)}</td><td class="n">${fmt(t.nilai)}</td></tr>`).join('') || '<tr><td colspan="3" class="kosong">Belum ada penjualan.</td></tr>'}</tbody></table>
          ${r.barang.length > r.terlaris.length ? `<div class="mut sm" style="margin-top:6px">Daftar lengkap ${fmt(r.barang.length)} jenis barang ada di file PDF.</div>` : ''}</div>
      </div>
      <p class="mut sm">Laba dihitung dari HPP yang tercatat di tiap barang; barang tanpa HPP dianggap modalnya Rp 0.</p>`;
  });
  pilihanTanggal($('#rg'), load); load();
}

// ================================================================ PENGATURAN
async function viewSet() {
  info = await api('/info'); $('#tokoNama').textContent = info.toko;
  $('#main').innerHTML = `<div class="row"><div class="card grow" style="flex-basis:380px"><h3>Toko &amp; struk</h3>
    <label class="f">Nama toko</label><input id="s-toko" style="width:100%" value="${esc(info.toko)}">
    <label class="f">Alamat / telepon</label><input id="s-alamat" style="width:100%" value="${esc(info.alamat)}">
    <label class="f">Teks di bawah struk</label><input id="s-footer" style="width:100%" value="${esc(info.footer)}">
    <label class="f" style="margin-top:16px;color:var(--ink)"><input type="checkbox" id="s-blok" ${info.blok_stok ? 'checked' : ''}> Tolak penjualan kalau stok tidak cukup</label>
    <div class="mut sm">Bawaan: mati, jadi kasir tetap bisa menjual walau stok belum diisi (stok bisa jadi minus).</div>
    <div class="aksi" style="justify-content:flex-start"><button class="b pri" id="s-simpan">Simpan</button></div></div>
    <div class="card grow" style="flex-basis:380px"><h3>Backup &amp; versi</h3>
    <p>Backup otomatis tiap 12 jam dan setiap kali program dibuka (30 terakhir disimpan).</p>
    <label class="f">Lokasi backup</label>
    <input id="s-folder" style="width:100%" placeholder="${esc(info.folder_bawaan)}" value="${esc(info.folder_backup)}">
    <div class="mut sm">${info.folder_backup ? '' : 'Sekarang memakai folder bawaan (di dalam folder program). '}Sebaiknya pilih <b>flashdisk</b>, harddisk lain, atau folder <b>Google Drive</b> supaya backup aman kalau komputer rusak.</div>
    <div class="aksi" style="justify-content:flex-start;flex-wrap:wrap"><button class="b" id="s-pilih">📁 Pilih folder…</button><button class="b pri" id="s-fsimpan">Simpan lokasi</button><button class="b" id="s-fbawaan">Kembali ke bawaan</button></div>
    <div id="s-fwarn" class="sm bad-t" style="margin-top:6px">${esc(info.backup_error)}</div>
    <p class="mut" style="margin-top:12px">Backup terakhir: <b id="s-last">${esc(info.last_backup || '-')}</b></p><button class="b" id="s-bk">Backup sekarang</button>
    <p class="mut sm" style="margin-top:14px">Data utama tetap di folder <code>data</code>. Salin folder itu juga sesekali sebagai cadangan tambahan.</p>
    <p class="mut sm">nationcloudPOS versi ${esc(info.versi)}</p>
    <hr style="border:0;border-top:1px solid var(--line,#e5e7eb);margin:14px 0"><button class="b bad" id="s-keluar">Tutup program</button>
    <div class="mut sm">Pakai ini kalau toko tutup. Data aman tersimpan. Untuk membuka lagi, klik <b>Mulai.vbs</b>.</div></div></div>
    <div class="card" style="margin-top:14px" id="upd"><h3>Update program</h3>
      <p>Versi sekarang: <b>${esc(info.versi)}</b></p>
      <label class="f">Alamat repo GitHub (akun/nama-repo, repo harus Public)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="u-repo" style="flex:1 1 260px" placeholder="contoh: nama-akun/nationcloudpos" value="${esc(info.update_repo)}"><button class="b" id="u-simpan">Simpan</button><button class="b pri" id="u-cek">Cek update</button></div>
      <div id="u-hasil" class="sm" style="margin-top:10px"></div>
      <div id="u-aksi" class="aksi" style="justify-content:flex-start"></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Catatan aktivitas <span class="mut sm">(100 terakhir: hapus, impor, batal)</span></h3><div class="scroll" style="max-height:300px"><table><thead><tr><th>Waktu</th><th>Aksi</th><th>Keterangan</th></tr></thead><tbody id="aud"><tr><td colspan="3" class="kosong">Memuat…</td></tr></tbody></table></div></div>`;
  $('#s-simpan').onclick = guard(async () => {
    await api('/info', { toko: $('#s-toko').value, alamat: $('#s-alamat').value, footer: $('#s-footer').value, blok_stok: $('#s-blok').checked });
    info = await api('/info'); $('#tokoNama').textContent = info.toko; toast('Tersimpan');
  });
  $('#s-keluar').onclick = guard(async () => {
    if (!(await konfirmasi('Tutup program?', '<p>Program akan berhenti dan tidak bisa dipakai sampai dibuka lagi lewat <b>Mulai.vbs</b>. Data tetap aman.</p>', 'Ya, tutup', false))) return;
    await api('/keluar', {});
    document.body.innerHTML = '<div style="font:18px system-ui;text-align:center;margin-top:20vh">nationcloudPOS sudah ditutup.<br><span style="font-size:14px;color:#64748b">Jendela ini boleh ditutup. Untuk membuka lagi, klik Mulai.vbs.</span></div>';
    setTimeout(() => window.close(), 300);
  });
  const hasilBackup = (r) => { $('#s-last').textContent = r.ts; $('#s-fwarn').textContent = r.peringatan || ''; info.backup_error = r.peringatan || ''; };
  $('#s-bk').onclick = guard(async () => { const r = await api('/backup', {}); hasilBackup(r); toast(r.peringatan ? 'Backup masuk folder bawaan (lihat peringatan)' : 'Backup selesai: ' + r.folder, !!r.peringatan); });
  const simpanFolder = guard(async (folder) => {
    const r = await api('/backup/folder', { folder }); hasilBackup(r); info.folder_backup = folder.trim(); $('#s-folder').value = folder.trim();
    toast(folder.trim() ? 'Lokasi backup disimpan. Backup percobaan masuk ke: ' + r.folder : 'Kembali ke folder bawaan');
  });
  $('#s-fsimpan').onclick = () => simpanFolder($('#s-folder').value);
  $('#s-fbawaan').onclick = () => { $('#s-folder').value = ''; simpanFolder(''); };
  $('#s-pilih').onclick = guard(async () => { toast('Jendela pilih folder dibuka… (kalau tidak terlihat, cek di taskbar)'); const r = await api('/backup/pilih', {}); if (r.folder) { $('#s-folder').value = r.folder; await simpanFolder(r.folder); } });

  // ---- update program dari GitHub ----
  const uHasil = $('#u-hasil'), uAksi = $('#u-aksi');
  const tampilUpdate = (r) => {
    uAksi.innerHTML = '';
    if (r.belum_diatur) uHasil.innerHTML = '<span class="mut">Isi alamat repo GitHub di atas, lalu klik <b>Simpan</b>.</span>';
    else if (r.ada) {
      uHasil.innerHTML = `<b class="ok">Ada versi baru: ${esc(r.versi_baru)}</b>${r.catatan.length ? '<ul style="margin:6px 0 0 18px;padding:0">' + r.catatan.map((c) => `<li>${esc(c)}</li>`).join('') + '</ul>' : ''}`;
      uAksi.innerHTML = `<button class="b pri" id="u-pasang">⬆ Pasang update ${esc(r.versi_baru)}</button>`;
      $('#u-pasang').onclick = pasangUpdate(r);
    } else uHasil.innerHTML = `<span class="ok">✔ Sudah versi terbaru (${esc(r.sekarang)}).</span>`;
    if (r.sebelumnya) { uAksi.insertAdjacentHTML('beforeend', ` <button class="b" id="u-kembali">↩ Kembalikan ke versi ${esc(r.sebelumnya.dari)}</button>`); $('#u-kembali').onclick = kembaliUpdate(r.sebelumnya); }
  };
  const tungguRestart = async (versiTarget) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="u-tunggu" style="position:fixed;inset:0;background:rgba(15,27,51,.92);color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;font:18px system-ui;z-index:99;padding:20px">Memasang update dan memulai ulang program…<br><span style="font-size:14px;opacity:.8">Mohon tunggu sekitar 10 detik, jangan tutup jendela ini.</span></div>');
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('/api/info', { cache: 'no-store' }); if (r.ok && (await r.json()).versi === versiTarget) { location.reload(); return; } } catch { /* masih mulai ulang */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    $('#u-tunggu').innerHTML = 'Program belum menyala kembali.<br><span style="font-size:14px">Tutup jendela ini lalu klik Mulai.vbs. Data aman.</span>';
  };
  const pasangUpdate = (r) => guard(async () => {
    if (!(await konfirmasi(`Pasang versi ${esc(r.versi_baru)}?`, '<p>Program akan diuji dulu, data dibackup otomatis, lalu program dimulai ulang (sekitar 10 detik). <b>Pastikan tidak sedang melayani pembeli.</b></p><p class="mut sm">Data toko tidak berubah. Kalau ada masalah, tersedia tombol "Kembalikan ke versi sebelumnya".</p>', 'Ya, pasang', false))) return;
    uHasil.innerHTML = '<span class="mut">Mengunduh dan menguji versi baru…</span>'; uAksi.innerHTML = '';
    try { const h = await api('/update/pasang', {}); await tungguRestart(h.ke); }
    catch (e) { uHasil.innerHTML = `<span class="bad-t">${esc(e.message)}</span><div class="mut sm">Program lama tetap berjalan seperti biasa.</div>`; }
  });
  const kembaliUpdate = (s) => guard(async () => {
    if (!(await konfirmasi('Kembalikan versi sebelumnya?', `<p>Program kembali ke versi <b>${esc(s.dari)}</b> dan dimulai ulang. Data tidak berubah.</p>`, 'Ya, kembalikan', false))) return;
    const h = await api('/update/kembalikan', {}); await tungguRestart(h.ke);
  });
  const cekUpdate = guard(async (paksa) => {
    uHasil.innerHTML = '<span class="mut">Memeriksa…</span>';
    try { tampilUpdate(await api('/update/cek' + (paksa ? '?paksa=1' : ''))); } catch (e) { uHasil.innerHTML = `<span class="bad-t">${esc(e.message)}</span>`; }
  });
  $('#u-simpan').onclick = guard(async () => { const r = await api('/update/repo', { repo: $('#u-repo').value }); $('#u-repo').value = r.repo; info = await api('/info'); toast(r.repo ? 'Alamat repo disimpan' : 'Alamat repo dikosongkan'); await cekUpdate(true); });
  $('#u-cek').onclick = () => cekUpdate(true);
  cekUpdate(false);
  guard(async () => {
    const a = await api('/audit'); const NAMA = { HAPUS_JUAL: 'Hapus penjualan', HAPUS_BARANG: 'Hapus barang', IMPOR_BARANG: 'Impor barang', BATAL_JUAL: 'Batal penjualan' };
    $('#aud').innerHTML = a.map((x) => `<tr><td style="white-space:nowrap">${esc(x.ts)}</td><td>${esc(NAMA[x.aksi] || x.aksi)}</td><td class="mut sm">${esc(String(x.detail || '').slice(0, 220))}</td></tr>`).join('') || '<tr><td colspan="3" class="kosong">Belum ada catatan.</td></tr>';
  })();
}

// ================================================================ mulai
guard(async () => { info = await api('/info'); $('#tokoNama').textContent = info.toko; })().finally(route);
// lencana "Ada update" di bagian atas (diam saja kalau offline / belum diatur)
(async () => {
  try {
    const r = await api('/update/cek'); const b = $('#updbadge');
    if (r.ada) { b.textContent = '⬆ Update ' + r.versi_baru; b.hidden = false; b.onclick = () => { location.hash = '#set'; }; }
  } catch { /* tanpa internet: tidak perlu mengganggu */ }
})();
