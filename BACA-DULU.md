# nationcloudPOS – panduan singkat

Program kasir sederhana untuk toko. Jalan di komputer Anda sendiri, **tanpa internet**, **tanpa biaya bulanan**.

## Cara menjalankan (Windows)

1. **Pasang Node.js** (sekali saja): buka <https://nodejs.org>, unduh versi **LTS** (minimal 22.13), pasang dengan klik *Next* terus.
2. **Ekstrak zip** ini: klik kanan `nationcloudPOS.zip` → *Extract All…* (misalnya ke `C:\nationcloudPOS`).
3. **Klik dua kali `Mulai.vbs`**. Program terbuka sebagai jendela sendiri (tanpa kolom alamat, tab, dan bookmark) dan berjalan tersembunyi, tidak ada jendela hitam. Kalau Chrome/Edge tidak ditemukan, program dibuka di browser biasa.
4. **Shortcut di Desktop (sekali saja):** klik dua kali `Buat-Shortcut.vbs`. Muncul ikon **nationcloudPOS** (logo awan biru) di Desktop; seterusnya buka program lewat ikon itu. Kalau folder program dipindah, jalankan `Buat-Shortcut.vbs` lagi.
5. Menu **Pengaturan** → isi nama toko dan teks struk → *Simpan*.
6. Menu **Barang** → *⬆ Impor PDF / Excel* (lihat di bawah) atau *+ Barang baru*.
7. Menu **Kasir** dan mulai jualan.

Menutup program: **Pengaturan → Tutup program** (kalau hanya menutup jendelanya, program tetap berjalan di belakang dan bisa dibuka lagi dengan klik `Mulai.vbs`). Data aman, tersimpan di `data\pos.db`.

> **Sebelumnya memakai SimplePOS?** Salin folder `data` dari folder lama ke dalam folder `nationcloudPOS` yang baru (timpa), maka semua barang dan penjualan lama ikut terbawa. Database lama otomatis diperbarui.

## Impor barang dari PDF / Excel

*Barang → ⬆ Impor PDF / Excel* → pilih atau tarik file.
- Bisa **Excel (.xlsx)**, **CSV**, atau **PDF** yang dibuat dari Excel/Word/aplikasi (PDF hasil foto atau scan tidak bisa dibaca; PDF berpassword harus dibuka kuncinya dulu). File lama `.xls`: buka di Excel lalu *Save As → .xlsx*.
- Program menebak arti tiap kolom (nama, harga jual, modal/HPP, stok, kode). **Periksa tebakannya** di tabel pratinjau dan ubah kalau salah.
- Kolom wajib: **nama barang** dan **harga jual**. Kode, modal, dan stok boleh tidak ada (kode dibuat otomatis: BRG0001, BRG0002, …).
- Barang yang sudah ada (kode atau nama sama) dilewati, atau diperbarui harganya kalau Anda memilih *Perbarui*. Mengimpor file yang sama dua kali tidak menggandakan barang.
- Salah impor? Di daftar barang, centang barangnya lalu *Hapus terpilih*.

## Pemakaian harian

- **Kasir**: ketik sebagian nama atau kode barang, ↑ ↓ untuk memilih, **Enter** untuk menambah. `5*sabun` = tambah 5 sekaligus.
  - **Harga bisa diubah langsung** di kolom *Harga* keranjang (tombol *kembalikan* mengembalikan ke harga normal).
  - **Diskon per barang** di kolom *Diskon* dan **diskon nota** di bawah keranjang. Tulis rupiah (`5000`) atau persen (`10%`).
  - Tekan **End** atau klik *Bayar*. Bisa bayar Tunai / Transfer / QRIS atau campuran. Struk dicetak.
- **Penjualan**: daftar per tanggal atau rentang tanggal. *Detail* untuk melihat isi nota beserta **laba nota itu** (harga jual − diskon − HPP; angka yang sama dengan Laporan) dan laba tiap barang. Barang yang HPP-nya kosong ditandai, karena labanya jadi terlalu tinggi. Di Detail, tombol **Ubah / hapus** di tiap barang dipakai kalau barang batal atau salah input di Kasir: isi 0 untuk menghapus barang dari nota, atau angka lebih kecil untuk mengurangi jumlah. Stok kembali, total nota dihitung ulang, dan program menunjukkan uang yang harus dikembalikan ke pelanggan. Kalau semua barang dihapus, nota otomatis menjadi batal; *Batalkan* (hari yang sama, tetap tercatat sebagai batal) atau **Hapus** (hilang selamanya dari laporan, stok kembali). Bisa centang beberapa nota lalu *Hapus terpilih*.
- **Barang**: kolom harga jual, modal, dan stok otomatis memberi titik ribuan saat diketik (1000 → 1.000). Tombol **Duplikat** membuat varian dari barang yang ada: semua isi (harga, modal) ikut tersalin, tinggal ganti nama (kode dibuat otomatis, stok mulai 0). *+ Barang baru* (kode boleh dikosongkan, dibuat otomatis; kode yang sudah dipakai barang lain ditolak), *Ubah*, *Stok* (barang masuk / koreksi hitung fisik), **Hapus** (satuan atau centang banyak). Riwayat penjualan lama tetap aman walau barangnya dihapus.
- **Laporan**: pilih hari atau rentang tanggal → omzet, laba kotor, diskon, tunai/transfer/QRIS, barang terlaris, lalu klik **⬇ Unduh PDF** untuk laporan harian yang siap cetak.

Penghapusan tercatat di *Pengaturan → Catatan aktivitas*. Kalau menghapus 3 atau lebih sekaligus, backup dibuat otomatis lebih dulu.

## Update program

Di *Pengaturan → Update program*: isi alamat repo GitHub, lalu klik **Cek update**. Kalau ada versi baru, tombol hijau muncul juga di bagian atas program. Klik **Pasang update** (data dibackup dan diuji dulu; program mulai ulang sendiri). Ada masalah? klik *Kembalikan ke versi sebelumnya*. Panduan lengkap: `PANDUAN-UPDATE.md`.

## Struk / printer

Pasang printer struk di Windows dan jadikan **printer default**. Jika muncul jendela cetak, cukup tekan *Print*. Agar langsung cetak tanpa jendela, buat shortcut browser dengan tambahan ` --kiosk-printing` di akhir *Target*.

## Backup (penting!)

- Otomatis tiap 12 jam dan setiap program dibuka; 30 backup terakhir disimpan. Tombol *Backup sekarang* ada di Pengaturan.
- **Lokasi backup bisa dipilih**: *Pengaturan → Lokasi backup → 📁 Pilih folder…* (atau ketik lokasinya, misalnya `E:\Backup Toko`), lalu *Simpan lokasi*. Program langsung membuat satu backup percobaan di sana. Sebaiknya pilih **flashdisk**, harddisk lain, atau folder **Google Drive**. *Kembali ke bawaan* mengembalikan ke `data\backup`.
- Kalau folder pilihan tidak bisa dipakai (misalnya flashdisk dicabut), backup tetap dibuat di folder bawaan dan muncul peringatan merah di Pengaturan, jadi backup tidak terlewat.
- **Pulihkan**: tutup program (*Pengaturan → Tutup program*), salin file backup yang dipilih ke `data\pos.db` (timpa), hapus `pos.db-wal` dan `pos.db-shm` kalau ada, lalu klik `Mulai.vbs`.

## Dipakai dari PC / HP lain di toko (opsional)

Jalankan di Terminal: `set POS_HOST=0.0.0.0 & node server.js`, lalu buka `http://IP-PC-SERVER:8780` dari perangkat lain. Perhatikan: **belum ada login/PIN**, jadi siapa pun di jaringan Wi-Fi toko bisa membuka program, termasuk menghapus data. Gunakan hanya di jaringan yang tepercaya.

## Masalah umum

| Masalah | Solusi |
|---|---|
| "Node.js belum terpasang" | Ulangi langkah 1, lalu klik `Mulai.vbs` lagi. |
| Program tidak mau terbuka | Buka file `data\server.log` dan tunjukkan isinya ke Claude, atau klik `Mulai-lihat-pesan-error.cmd` untuk melihat pesannya langsung di jendela hitam. |
| PDF tidak terbaca saat impor | Pastikan PDF dibuat dari Excel/Word (bukan foto/scan). Atau simpan datanya sebagai Excel/CSV lalu impor. |
| Pesan kesalahan lain | Buka `data\server.log` dan tunjukkan isinya ke Claude. |
