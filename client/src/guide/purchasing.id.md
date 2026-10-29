# Belanja: pakai halaman yang mana

Setiap biaya dicatat di **satu** tempat saja. Dua pertanyaan yang menentukan:

1. **Apakah menambah stok?** (beras, telur, sayur, air mineral, sabun… — barang di **[Operations → Stock](/stock)**)
2. **Apakah uangnya sudah keluar dari kas atau rekening bank?**

| | Sudah dibayar | Dibayar nanti |
|---|---|---|
| **Menambah stok** | **Purchasing → Bought without a PO**, *Paid already* (atau purchase order) | **Purchasing → Bought without a PO**, *Pay later* (atau purchase order → **Make bill**) — lalu dibayar di **Payables** |
| **Bukan stok** (internet, air, perbaikan, laundry…) | **[Finance → Expenses](/expenses)** | **[Finance → Payables](/payables)** → New bill |

Tiga aturan:

- **Semua tagihan yang dibayar nanti dibayar di Payables**, dari mana pun tagihannya.
- **Expenses berisi semua biaya yang dibayar di tempat.** Belanja stok yang sudah dibayar muncul di sana dengan sendirinya (ditandai nomor PO-nya) — jangan diketik lagi.
- **Satu nota tidak boleh dicatat dua kali.** Kalau sudah lewat Purchasing, jangan dicatat lagi di Expenses atau Payables.

Nota yang berisi stok dan barang lain (misalnya telur dan gas): telur di *Bought without a PO*, gas di Expenses, dengan nomor nota yang sama di keduanya.

## Belanja tanpa PO

Untuk stok yang dibeli di pasar atau toko, tanpa purchase order. Perlu izin **Purchasing** atau **Buy without a PO**.

1. **[Operations → Purchasing](/purchasing)** → **Bought without a PO** → **+ Buy without a PO**.
2. **Bought from**: supplier tetap dari daftar, atau biarkan *Not a regular supplier* dan ketik tempatnya (misalnya Pasar Kintamani).
3. **Date bought** = tanggal di nota. **Receipt / nota number** kalau ada.
4. **What it is for** (Food, Drinks, Guest supplies…) dan **Department** (terisi sendiri).
5. Satu baris per barang: **stock item**, **berapa banyak** dan **harga yang dibayar** untuk baris itu, sesuai nota. Barang yang disimpan dalam g atau ml diketik dalam **kg atau L** (pilihan di sebelah kotaknya). Harga per satuan dihitung otomatis, dengan harga biasanya di sebelahnya (merah kalau 20% atau lebih di atasnya).
   - Untuk dapur atau bar, pilih jenis **Restaurant (POS)**: barangnya langsung masuk ke stok restoran di POS, bukan di PMS. Setelah POS menerimanya, pembelian ini tidak bisa di-void — chef membetulkan stok POS lewat stock opname. Kalau POS tidak bisa dihubungi, buka pembeliannya dan tekan **Send to the POS**.
6. **The money**:
   - **Paid already** → pilih **Paid with** (Cash…). Otomatis masuk Expenses.
   - **Pay later** → harus pilih supplier. Tagihan dibuat di Payables, jatuh tempo sesuai termin supplier (atau ketik tanggalnya). Bayar di sana saat uangnya keluar.
7. **Save**.

Saat disimpan, stok bertambah dan harga rata-rata tiap barang diperbarui (**Stock → Stock value**), sama seperti menerima purchase order.

PMS akan bertanya kalau nomor nota yang sama sudah pernah dicatat.

## Kalau salah

Buka belanjanya → **Void…** dengan alasan. Stok dikurangi lagi dan expense atau tagihannya di-void. Lalu catat ulang dengan benar.

- Ditolak kalau stoknya sudah terpakai (sisa stok lebih sedikit dari yang dibeli) — perbaiki dulu lewat **Stock → Adjust** atau stock opname kalau memang sudah terpakai.
- Ditolak kalau tagihannya sudah ada pembayaran — void dulu pembayaran itu di Payables.

Expense dan tagihannya tidak bisa diubah atau di-void di Expenses / Payables — selalu dari sini, supaya stoknya ikut.

## Telegram dan Daily Close

Owner hanya dapat pesan Telegram kalau belanjanya perlu dicek: jumlah besar, harga jauh di atas harga biasa, tanggal jauh ke belakang atau di hari yang sudah ditutup di Accounting — dan kalau ada yang di-void. Batasnya diatur di **Settings → Notifications → Purchases without a PO**. Semua belanja dihitung di Daily Close.
