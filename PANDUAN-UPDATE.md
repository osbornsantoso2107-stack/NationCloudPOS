# Update program lewat GitHub

Tujuan: program toko bisa diperbarui dengan **satu klik** di *Pengaturan → Update program*, tanpa ekstrak zip dan salin folder data lagi.

## Persiapan (sekali saja)

1. Buat akun GitHub (gratis) di <https://github.com>.
2. Buat repo baru, misalnya `nationcloudpos`. **Pilih Public** (supaya program bisa membaca tanpa password). Isi repo hanya kode program, **bukan data toko**. Folder `data` tidak pernah ikut diunggah.
3. Berikan nama repo (contoh: `namaakun/nationcloudpos`) ke Claude agar kode program diunggah ke sana.
4. Di program: *Pengaturan → Update program* → isi `namaakun/nationcloudpos` → *Simpan*.

## Memakai update

- Saat Claude mengunggah versi baru, di bagian atas program muncul tombol hijau **⬆ Update x.y.z**. Klik, baca catatan perubahannya, lalu **Pasang update**.
- Yang dilakukan program sendiri: mengunduh → menguji versi baru pada **salinan** data Anda → membuat backup → mengganti file program → memulai ulang (sekitar 10 detik). Kalau ujinya gagal, program lama tetap jalan dan tidak ada yang diganti.
- Data toko (folder `data`) tidak pernah diganti.
- Ada masalah setelah update? *Pengaturan → Update program → Kembalikan ke versi sebelumnya*.
- Pasang update **saat tidak sedang melayani pembeli** (program mati sebentar).

## Catatan

- Versi pertama yang membawa fitur ini harus dipasang dengan cara lama (ekstrak zip + salin folder `data`). Setelah itu update cukup satu klik.
- Update hanya bisa dipasang dari komputer kasir sendiri, bukan dari HP/PC lain di jaringan.
- Perlu internet hanya saat cek/pasang update.
- Repo Private belum didukung.
