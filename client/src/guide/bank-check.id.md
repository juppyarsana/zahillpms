# Cek bank

Untuk akuntan. Halaman ini menunjukkan uang yang masuk dan keluar di setiap akun, baris per baris, supaya bisa dicocokkan dengan rekening koran bank.

## Membuka

**Accounting → Bank check.** Pilih tanggal (7 hari terakhir, bulan ini, bulan lalu, atau tanggal sendiri, maksimal 62 hari) dan, kalau mau, satu akun.

## Yang terlihat

- **By account**: uang masuk, uang keluar, biaya bank dan netto untuk tiap akun pembukuan (bank, kas, QRIS settlement, dan lainnya). Metode pembayaran masuk ke akun yang dipilih di **Accounting → Accounts**, jadi EDC dan QRIS dari satu bank berada bersama, seperti di rekening korannya.
- **Tiap akun**: semua baris dengan tanggal, jenisnya (pelunasan kamar, extras, pembayaran grup, refund, biaya, bayar supplier, bayar vendor), metode, kamar / tamu / supplier, referensi, dan jumlahnya. Tiap hari ada totalnya. Klik baris untuk membuka reservasi, grup, atau event.

## Uang masuk

Sama dengan **Cashier Closing**, jadi totalnya sama dengan "money received" di Daily Close. Baris di bawah tabel memeriksanya. Tamu yang ditagihkan ke agen bukan uang dan tidak ditampilkan; saat agen atau OTA membayar, pembayaran itulah yang tampil.

## Uang keluar

Biaya (Expenses), pembayaran supplier, dan pembayaran vendor, pada hari dibayar, warna merah.

## Gross, fee, dan net

- **Gross**: yang dibayar tamu.
- **Fee**: bagian bank. Owner mengaturnya per metode di **Settings → Sources & Payments → Edit** (Bank fee %).
- **Net**: gross dikurangi fee, yang dibayarkan bank.
- **Bank pays**: perkiraan hari dibayar. Atur **Bank pays after (days)** per metode (QRIS dan kartu: 1). Sabtu dan Minggu pindah ke Senin. Ini perkiraan; hari libur tidak diketahui.

Fee dan hari hanya dipakai di sini. Tidak mengubah pembukuan atau laporan lain.

## Excel

**Excel** berisi sheet Summary dan satu sheet per akun, dengan total harian, filter, dan kolom kosong **On statement ✓** untuk dicentang manual.

## Perlu diketahui

- Baris dengan **No account chosen** butuh akun untuk metode pembayarannya di Accounting → Accounts.
- Payout Agoda dan OTA lain yang mencakup banyak booking adalah satu baris di bank. Pakai referensi payout untuk mencocokkan.
- Kas juga ditampilkan: cocokkan dengan Cashier Closing, bukan rekening koran.
