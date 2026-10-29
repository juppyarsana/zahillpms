# Permintaan pembelian

Departemen meminta barang yang dibutuhkan; **purchasing** yang memesan. Ini tab pertama di **[Operations → Purchasing → Requests](/purchasing?tab=requests)** — siklus belanja dibaca dari kiri ke kanan: Requests → Purchase Orders → terima barang. Kepala departemen yang hanya punya izin *Purchase requests* melihat menu **Purchase requests**, yang membuka daftar yang sama.

- Untuk **meminta**, perlu izin **Purchase requests**.
- Untuk **memesan**, menolak atau menutup permintaan, perlu izin **Purchasing**. Owner punya keduanya.

## Meminta (semua departemen)

1. **+ New request**, atau **🛒 Request to buy** di halaman Stock (langsung berisi semua barang yang menipis atau habis).
2. Pilih **departemen**, dan tanggal dibutuhkan jika ada.
3. Tambah barang. Pilih dari daftar stok (terlihat sisanya), atau pilih **Something else — type it** untuk barang yang tidak ada di daftar (spare part, alat).
4. **Send to purchasing**. Purchasing mendapat pesan Telegram.

Permintaan Anda lalu menunjukkan sampai di mana: **Waiting** → **Ordered** → **Partly received** → **Received**. Statusnya **Closed** atau **Declined**, dengan alasan dari purchasing, jika tidak semua akan dibeli. Selama belum ada yang dipesan, Anda masih bisa **Cancel**.

## Restoran meminta dari aplikasinya sendiri

Bahan dapur disimpan di **aplikasi restoran (POS)**, karena resepnya mengurangi stok di setiap penjualan. Chef meminta dari sana: **Inventory → Request to buy**. Permintaannya masuk ke sini dengan tanda **Restaurant app**, dan chef memantaunya di POS.

## Memesan (purchasing)

1. **To order** berisi semua barang yang belum dipesan dari semua permintaan terbuka (**All requests** menampilkan per permintaan). Centang barang yang akan dibeli. Boleh dari beberapa permintaan jika supplier-nya sama.
2. **Make purchase order** → pilih supplier, cek jumlah, dan isi harga.
   - Untuk barang yang diketik (tidak ada di daftar), pilih beli apa adanya (tidak masuk stok), atau masukkan ke salah satu barang stok.
3. **PO draft** dibuat di tab **[Purchase Orders](/purchasing?tab=purchase_orders)**. Ajukan dan setujui seperti biasa. Nomor PO terlihat di permintaan.

**Approve lewat Telegram.** Saat PO diajukan, semua yang mencentang *Approve purchase orders* di **[Settings → Notifications](/settings/reports)** (hanya chat pribadi) menerimanya di Telegram: supplier, setiap barang dengan harganya, dan totalnya. Harga yang jauh di atas biaya biasanya ditandai ⚠️. PO yang panjang dikirim dalam beberapa pesan, dan tombol **✅ Approve / ↩️ Send back** ada di bawah total pada pesan terakhir. Yang pertama menekan yang memutuskan. Tombol di chat yang lain hilang, dengan keterangan siapa yang memutuskan. *Send back* mengembalikan PO ke draft: buka di **Purchase Orders** → **✏ Edit** (jumlah, harga, supplier, tambah atau hapus baris), lalu **Submit for Approval** lagi. PO di PMS menunjukkan "by … on Telegram".

Satu barang boleh masuk lebih dari satu PO (dibagi ke beberapa supplier). Permintaan menunjukkan berapa yang belum dipesan.

## Menerima barang

Terima barang di PO seperti biasa (**Receive Items**).

- **Barang hotel** masuk ke stok PMS.
- **Barang restoran** masuk ke **stok restoran di POS**, dengan harga di PO, supaya food cost-nya benar. Stok PMS tidak berubah.
- Jika POS tidak bisa dihubungi, baris PO bertuliskan *Not sent to the POS*. Tekan **Send to the POS** di PO setelah POS menyala lagi. Mengirim ulang tidak pernah menambah barang dua kali.

Permintaan otomatis menjadi **Received** setelah semua barangnya datang. Jika ada yang tidak jadi dibeli, **Close** dengan alasannya.

**Make bill** di PO otomatis memakai departemen dari permintaan, supaya Costs by department tetap benar.
