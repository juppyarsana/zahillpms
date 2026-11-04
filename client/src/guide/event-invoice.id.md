# Satu invoice untuk kamar + meeting

Meeting atau event (menu Events) punya **tagihan sendiri**. Kalau tamu atau perusahaan minta **satu invoice berisi semuanya** (kamar dan meeting), hubungkan event ke reservasinya lalu cetak invoice gabungan.

> Yang digabung hanya **invoice yang dicetak**. Kamar dan event tetap punya tagihan dan pembayaran masing-masing. Laporan dan akuntansi tidak berubah.

## 1. Hubungkan event ke reservasi

1. Buka event → **⋮ More** → **Edit details**.
2. Di **Rooms for this event**, cari nama tamu atau nama pemesan grup.
   - **Grup** (👥): pilih grupnya, bukan salah satu kamarnya.
   - **Satu reservasi** (🛏): pilih reservasinya.
3. Tekan **Save changes**.

Satu event dihubungkan ke **satu** grup atau **satu** reservasi. Beberapa tamu yang pesan terpisah? Masukkan dulu ke satu grup (booking **⋮ → Move into a Group**), lalu hubungkan grupnya.

## 2. Cetak invoice gabungan

Dari salah satu halaman ini → **Documents**:

| Halaman | Menu |
| --- | --- |
| Event | **Invoice — rooms + event** / **Pro Forma — rooms + event** |
| Booking | **Invoice — room + event** / **Pro Forma — room + event** |
| Grup | **Invoice — rooms + event** / **Pro Forma — rooms + event** |

Invoice berisi **kamar** (sama seperti invoice kamar biasa), lalu **setiap event yang terhubung**, lalu **ringkasan**: total, sudah dibayar dan sisa untuk kamar dan untuk setiap event, dan satu **Balance due**.

- **Invoice** = yang sudah diposting. Malam kamar diposting saat night audit, jadi sebelum tamu datang kamar masih Rp 0. Pakai **Pro Forma** untuk perkiraan seluruh menginap.
- Event yang dibatalkan tidak ikut.

## 3. Menerima pembayaran

Pakai **Record Payment** seperti biasa di booking (atau **Record Group Payment** di grup). Kalau meeting yang terhubung masih punya sisa tagihan, jendelanya punya satu bagian tambahan di bawah: **Meeting / event**.

1. Centang baris kamar seperti biasa.
2. Centang meeting-nya dan cek **Pay now** (ketik lebih kecil untuk bayar sebagian).
3. Pilih metode, tanggal dan referensi satu kali, lalu **Receive**.

PMS mencatat bagian kamar di booking dan bagian meeting di event, dengan metode, tanggal dan referensi yang sama. Bagian meeting awalnya tidak dicentang: biarkan tidak dicentang kalau perusahaan membayar meeting-nya sendiri.

**Record payment** di halaman event tetap bisa dipakai untuk meeting yang dibayar terpisah.

Klien yang minta **invoice terpisah** tetap pakai **Invoice** milik event dan invoice kamar seperti biasa.

## 4. Satu bill restoran untuk beberapa makanan

Kalau restoran membuat **satu bill** untuk makan siang + coffee break + ruang meeting, kasir mencentang makanan yang termasuk di bill itu waktu **Charge to Event** di POS (bagian **This bill covers**). Harga yang disepakati untuk makanan itu tidak dihitung lagi di atas bill, jadi **Expected total** = bill restoran.

- Jumlah orang berubah (mis. 50 jadi 60)? Tidak apa-apa: invoice mengikuti bill restoran. Kalau berubah sebelum acara, ubah juga jumlah orang di makanannya selama belum dikerjakan restoran.
- Lupa dicentang? Tekan **Already on a restaurant bill** di makanannya di halaman event.
- Bill di-void: harga yang disepakati dihitung lagi sampai bill yang sudah dibetulkan di-charge ulang.
