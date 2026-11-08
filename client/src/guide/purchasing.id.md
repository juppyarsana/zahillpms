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

## Purchase order: dari persetujuan sampai tagihan

1. **Setujui.** Semua PO perlu persetujuan, di PMS atau di Telegram.
2. **Kirim ke supplier.** Buka PO yang sudah disetujui → **Send to supplier**:
   - **✉ Email**: PDF terlampir dan balasan masuk ke hotel. Perlu email supplier.
   - **WhatsApp**: membuka WhatsApp dengan pesan yang sudah terisi dan link ke PDF. **Tekan kirim di sana.** PO langsung bertanda *Sent* begitu WhatsApp terbuka, jadi pastikan pesannya benar-benar terkirim. Perlu nomor telepon supplier.
   - **⬇ Download PDF**: untuk dikirim dengan cara lain. Ini tidak menandai PO sebagai terkirim.
   Daftar PO punya filter *Not sent yet*. Link untuk supplier berhenti berlaku setelah 90 hari. Kalau PO dibatalkan, link-nya akan memberi tahu, tapi **supplier tetap harus Anda kabari**.
3. **Cek barang di atas kertas (opsional).** **🖨 Print checklist** berisi barang yang belum datang, tanpa harga, dengan kotak isian dan tempat tanda tangan.
4. **Terima barang.** **Receive Items** → **Date received**, **Delivery note no.** (surat jalan), dan jumlah yang datang. Tidak bisa menerima lebih dari sisa yang belum datang. Tanggalnya hanya catatan: stok bergerak saat Anda konfirmasi, jadi masukkan barang di hari barang datang. Setiap pengiriman tercatat di **Deliveries** pada PO.
5. **Buat tagihan.** **Make bill** terisi dari barang yang datang, dengan harga PO, surat jalan, dan tanggalnya. Setelah semua barang yang datang ditagihkan, tombol ini hilang dan **View bill** membuka tagihannya, sudah dibayar atau belum.

**Not billed / Part billed.** PO yang barangnya sudah datang tapi tagihannya belum penuh diberi tanda ini, dan daftar PO punya filter *Not billed yet*. Kalau tagihan supplier memang lebih rendah (misalnya ada diskon), tekan **Mark as fully billed** dengan alasannya. PO yang diterima sebelum fitur ini tidak diberi tanda.

**Sisanya tidak datang.** Pada PO yang sudah disetujui dan sebagian barangnya datang, tekan **Close – rest won't come** dengan alasannya. Barang yang datang tetap tercatat. Yang kurang kembali ke permintaan pembelian sebagai belum dipesan, jadi bisa dipesan lagi atau permintaannya ditutup.

**Cancel** perlu alasan dan hanya bisa selama belum ada barang yang datang. Setelah itu, pakai Close.

## Belanja tanpa PO

Untuk stok yang dibeli di pasar atau toko, tanpa purchase order. Perlu izin **Purchasing** atau **Buy without a PO**.

1. **[Operations → Purchasing](/purchasing)** → **Bought without a PO** → **+ Buy without a PO**.
2. **Bought from**: supplier tetap dari daftar, atau biarkan *Not a regular supplier* dan ketik tempatnya (misalnya Pasar Kintamani).
3. **Date bought** = tanggal di nota. **Receipt / nota number** kalau ada.
4. **What it is for** (Food, Drinks, Guest supplies…) dan **Department** (terisi sendiri).
5. Satu baris per barang: **stock item**, **berapa banyak** dan **harga yang dibayar** untuk baris itu, sesuai nota. Barang yang disimpan dalam g atau ml diketik dalam **kg atau L** (pilihan di sebelah kotaknya). Harga per satuan dihitung otomatis, dengan harga biasanya di sebelahnya (merah kalau 20% atau lebih di atasnya).
   - Untuk dapur atau bar, pilih jenis **Restaurant (POS)**: barangnya masuk ke **Main Store** seperti barang lain, lalu dikirim ke Kitchen / Resto lewat **[Stock](/stock) → Transfers → Move stock**, dan chef mengonfirmasinya di POS. Pembelian ini hanya bisa di-void selama gudang tempat barang itu masuk masih punya paling sedikit sejumlah yang dibeli.
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
