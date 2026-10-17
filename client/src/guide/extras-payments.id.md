# Extras: bayar sebagian & pindah tagihan

Dua hal di **tab Folio** sebuah booking, untuk tagihan extra (restoran / POS, item Sales, aktivitas):

- **Bayar sebagian**: tamu membayar sebagian sekarang, sisanya nanti, misalnya dengan dua bank berbeda.
- **Pindah tagihan (Transfer bill)**: tagihan extra kamar lain dibayar oleh kamar ini, misalnya dua teman yang pesan terpisah lewat OTA.

## Bayar sebagian

1. Tab **Folio** → **💳 Record Payment**.
2. Centang extra yang dibayar (biasanya sudah tercentang semua).
3. Di kolom **Extras — pay now**, ketik jumlah yang diterima sekarang, misalnya **2.000.000**.
4. Pilih **Method** (misalnya Bank Transfer), isi **Reference** kalau ada, lalu tekan **Receive**.
5. Jendela menampilkan sisa yang belum dibayar. Untuk sisanya, buka **Record Payment** lagi. Jumlahnya sudah terisi sisa itu; pilih bank kedua lalu **Receive**.

> Pembayaran sebagian dicatat sebagai **pembayaran di muka (on account)**. Saldo langsung berkurang, tetapi baris extra **tidak** mendapat tanda "Paid". Itu normal: lihat **Balance due**. Setiap pembayaran punya **🖨 receipt** sendiri di daftar pembayaran.

> **Reservasi OTA** (Booking.com, Agoda, Traveloka…): baris **Room** di jendela ini **tidak tercentang**, karena kamar dibayar oleh OTA, bukan tamu. Centang hanya kalau uang dari OTA sudah masuk ke bank (metode = bank itu, tanggal = hari uang masuk). "Guest owes" di atas adalah yang harus dibayar tamu.

Kalau jumlahnya tidak diubah (dibayar penuh sekaligus), semuanya berjalan seperti biasa: baris extra mendapat tanda **Paid · metode**.

## Pindah tagihan ke kamar lain

Contoh: kamar 101 dan 102 pesan terpisah dari OTA, tetapi tagihan restoran kamar 102 dibayar oleh kamar 101.

1. Buka booking **kamar 102** → tab **Folio**.
2. Di bagian **Posted**, tekan **⇄ Transfer to another room**.
3. Centang baris yang dipindah.
4. Pilih kamar yang membayar (**101**). Daftar menampilkan kamar yang menginap di tanggal yang sama.
5. Isi **Reason**, misalnya "Kamar 101 membayar tagihan temannya", lalu tekan **Transfer**.

Baris itu sekarang ada di folio **kamar 101**, dengan tanda **from room 102 · nama**, dan dibayar di sana (termasuk saat check-out kamar 101). Invoice kamar 101 juga menulis "(from room 102 …)". Kedua booking mendapat catatan di **Edit History**.

**Yang bisa dipindah:** extra yang **belum dibayar**, yaitu tagihan restoran / POS, item Sales, dan aktivitas.

**Yang tidak bisa dipindah:**
- Malam kamar dan meal plan (tetap di kamarnya sendiri; harga kamar OTA dibayar oleh OTA).
- Extra per malam, misalnya extra bed.
- Baris yang sudah dibayar.
- Tagihan yang sudah di tagihan agen.
- Pemindahan ke booking yang sudah check-out atau dibatalkan.

> Salah pindah? Buka folio kamar tujuan dan pindahkan baris itu kembali ke kamar asalnya. Tandanya akan hilang.
