# nationcloudPOS – catatan untuk Claude

Program kasir sederhana untuk satu toko. Pemilik toko bukan programmer: jelaskan dalam Bahasa Indonesia yang sederhana, tanpa istilah teknis kalau tidak perlu. Panduan pemakai ada di `BACA-DULU.md`.

## Teknis
- Node.js 22+ saja, `node:sqlite` bawaan, **tanpa npm / tanpa internet**. Satu file data: `data/pos.db`. Jangan menambah paket luar.
- `server.js` = semua logika dan route. Harga, diskon, total, stok diputuskan di server (browser hanya mengusulkan). Uang selalu bilangan bulat Rupiah.
- `public/app.js` + `public/index.html` = tampilan (JS biasa, route `#kasir`, `#barang`, `#jual`, `#lap`, `#set`). `public/angka.js` dipakai bersama server dan browser (baca angka Rupiah, diskon `5000`/`10%`).
- `excel.js` (baca .xlsx/.csv, zip + XML sendiri, pintu masuk semua file impor), `pdftext.js` (baca teks PDF), `tabel.js` (menebak kolom nama/harga/hpp/stok), `laporanpdf.js` (membuat PDF laporan).
- Stok = jumlah tabel `moves` per barang. Penjualan lunas mengurangi stok; batal menambah kembali; hapus penjualan menghapus `moves`-nya.
- Database: tambah kolom lewat `addCol()` di `server.js`, **jangan** hapus/ganti nama kolom (database toko yang sudah berjalan harus tetap terbuka).
- Setiap hapus / impor / batal dicatat di tabel `audit`. Hapus massal (≥3) membuat backup dulu.

- Barang baru (`baru:true`) tidak boleh memakai kode yang sudah ada (dulu diam-diam menimpa barang lama). Ubah isi nota lewat `ubahBaris()` (qty 0 = hapus baris; stok kembali lewat move `BATAL`; dicatat `UBAH_NOTA`).

- Laba per nota (`labaNota()` di `getSale`) memakai rumus yang sama dengan `report()`. Belum ada login, jadi siapa pun yang membuka program bisa melihat laba/HPP.
- Program ini BUKAN salinan BasePOS (beda kode, tanpa folder `app\`). Update dari pembuat BasePOS (kit "merge") tidak bisa digabung langsung; fiturnya dipasang ulang secara manual. Versi: 1.3.0 = fitur laba per nota dari BasePOS 1.0.1.

- Peluncur: `Mulai.vbs` (server tersembunyi, log di `data\server.log`, jendela Chrome/Edge `--app`); `Mulai-lihat-pesan-error.cmd` = mode jendela hitam untuk debugging. Berhenti lewat `POST /api/keluar` (hanya dari localhost; tombol di Pengaturan).

- Lokasi backup: setting `folder_backup` (kosong = `data\backup`). `backupNow()` jatuh ke folder bawaan + `backup_error` bila folder pilihan gagal. Tombol pilih folder = PowerShell FolderBrowserDialog (Windows saja, localhost saja).

- Logo: `public/logo.ico` + `logo.png` (awan biru di kotak navy, sama dengan logo di pojok kiri). `Buat-Shortcut.vbs` membuat shortcut Desktop ke `wscript Mulai.vbs` dengan ikon itu.

- Update dari GitHub (`update.js`, rute `/api/update/*`, UI di Pengaturan + lencana di header): baca `versi.json` di repo (publik) lalu unduh zip `archive/refs/heads/<cabang>.zip`; uji versi baru di port acak pada SALINAN database; backup; ganti berkas (kecuali `data/`, `update/`); simpan versi lama di `update/sebelumnya`; mulai ulang sendiri. Pasang/kembalikan/ubah-repo hanya dari localhost. Tes: `test-update.js` (GitHub tiruan).
- **Cara merilis (Claude):** ubah `versi.json` (`versi` naik + `catatan` singkat berbahasa Indonesia sederhana), `node test.js` harus hijau, commit & push ke cabang `main`. Versi di `versi.json` = satu-satunya sumber nomor versi. Jangan pernah commit `data/`.

## Tes
- `node test.js` memakai database sementara (data toko tidak tersentuh). Harus tetap hijau setelah mengubah logika.
- Ubah perilaku → ubah/tambah tesnya di `test.js` juga.

## Belum ada
Login/PIN & hak akses, retur barang hari lalu, pembelian/pemasok, pelanggan & grup diskon, tutup kasir, satuan (lusin/dus). Rancangan lengkap program yang lebih besar ada di `SETUP-TUTORIAL.md` (BasePOS) bila pemilik membawanya.

## Keputusan pemilik
- Stok menipis tidak diperlukan; yang penting laporan harian (sudah ada, bisa diunduh PDF).
- Kasir boleh mengubah harga jual dan memberi diskon (per barang dan per nota) tanpa PIN.
