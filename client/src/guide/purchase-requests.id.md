# Permintaan pembelian

Departemen meminta barang yang dibutuhkan; **purchasing** yang memesan. Ini tab pertama di **[Operations → Purchasing → Requests](/purchasing?tab=requests)** — siklus belanja dibaca dari kiri ke kanan: Requests → Purchase Orders → terima barang. Kepala departemen yang hanya punya izin *Purchase requests* melihat menu **Purchase requests**, yang membuka daftar yang sama.

- Untuk **meminta**, perlu izin **Purchase requests**.
- Untuk **memesan**, menolak atau menutup permintaan, perlu izin **Purchasing**. Owner punya keduanya.

## Meminta (semua departemen)

1. **+ New request**, atau **🛒 Request to buy** di halaman Stock (langsung berisi semua barang yang menipis atau habis, kecuali yang sudah diminta dan belum datang; barang itu disebut di bagian atas jendela dan masih bisa ditambahkan kalau perlu lebih).
2. Pilih **departemen**, dan tanggal dibutuhkan jika ada.
3. Tambah barang. Pilih dari daftar stok (terlihat sisanya), atau pilih **Something else — type it** untuk barang yang tidak ada di daftar (spare part, alat).
4. **Send to purchasing**. Purchasing mendapat pesan Telegram.

Permintaan Anda lalu menunjukkan sampai di mana: **Waiting** → **Ordered** → **Partly received** → **Received**. Statusnya **Closed** atau **Declined**, dengan alasan dari purchasing, jika tidak semua akan dibeli. Selama masih **Waiting** (belum ada yang dipesan), Anda masih bisa **Edit** — ubah barang, jumlah, tanggal *needed by*, Kitchen/Resto atau catatan; purchasing mendapat pesan Telegram berisi apa yang berubah — atau **Cancel**. Daftar di POS diurutkan dari nomor PR terbaru.

## Restoran meminta dari aplikasinya sendiri

Bahan dapur disimpan di **aplikasi restoran (POS)**, karena resepnya mengurangi stok di setiap penjualan. Chef meminta dari sana: **Inventory → Request to buy**. Permintaannya masuk ke sini dengan tanda **Restaurant app**, dan chef memantaunya di POS.

Setiap permintaan dari POS memilih **untuk Kitchen atau Resto**, jadi barang yang sama bisa diminta oleh keduanya (misalnya daun mint). Di purchase order dan saat menerima barang, tiap baris bertanda **For Kitchen** atau **For Resto**, supaya mudah dibagi saat barang datang. Stok di POS tetap satu angka untuk satu barang.

## Memesan (purchasing)

1. Di **Requests**, buka satu permintaan lalu centang barang yang akan dibeli. Untuk membeli dari satu supplier untuk beberapa permintaan, pakai **Items to order**: isinya semua barang yang belum dipesan dari semua permintaan terbuka, dan angka di tab menunjukkan berapa yang menunggu.
2. **Make purchase order** → pilih supplier, cek jumlah, dan isi harga.
   - Untuk barang yang diketik (tidak ada di daftar), pilih beli apa adanya (tidak masuk stok), atau masukkan ke salah satu barang stok.
3. **PO draft** dibuat di tab **[Purchase Orders](/purchasing?tab=purchase_orders)**. Ajukan dan setujui seperti biasa. Nomor PO terlihat di permintaan.

**Approve lewat Telegram.** Saat PO diajukan, semua yang mencentang *Approve purchase orders* di **[Settings → Notifications](/settings/reports)** (hanya chat pribadi) menerimanya di Telegram: supplier, setiap barang dengan harganya, dan totalnya. Harga yang jauh di atas biaya biasanya ditandai ⚠️. PO yang panjang dikirim dalam beberapa pesan, dan tombol **✅ Approve / ↩️ Send back** ada di bawah total pada pesan terakhir. Yang pertama menekan yang memutuskan. Tombol di chat yang lain hilang, dengan keterangan siapa yang memutuskan. *Send back* mengembalikan PO ke draft: buka di **Purchase Orders** → **✏ Edit** (jumlah, harga, supplier, tambah atau hapus baris), lalu **Submit for Approval** lagi. PO di PMS menunjukkan "by … on Telegram".

Satu barang boleh masuk lebih dari satu PO (dibagi ke beberapa supplier). Permintaan menunjukkan berapa yang belum dipesan.

## Menerima barang

Terima barang di PO seperti biasa (**Receive Items**).

- **Barang hotel** masuk ke stok PMS.
- **Barang restoran** juga masuk ke **Main Store** dan menunggu di sana sebagai stok hotel. Baris PO menyebutkan barangnya disimpan di gudang hotel.
- Untuk menyerahkannya ke dapur atau bar: **[Stock](/stock) → Transfers → + Move stock**, dari Main Store ke Kitchen atau Resto. Chef membuka **Inventory → 📦 Incoming** di POS, mengecek barang yang datang, lalu mengonfirmasi jumlahnya. Hanya yang dikonfirmasi chef yang masuk ke stok restoran, dengan harga belinya.
- Jika dapur mengonfirmasi lebih sedikit, sisanya kembali ke Main Store dengan alasannya, dan pesan Telegram terkirim. Tagihan supplier tidak berubah, karena hotel memang menerima semuanya.
- Barang yang belum dikonfirmasi tetap di luar stok restoran. Telegram mengingatkan yang mencentang *Kitchen handover* di **[Settings → Notifications](/settings/reports)**, setelah 3 jam secara default, dan tidak pernah pada malam hari.
- Jika POS tidak bisa dihubungi, transfernya bertuliskan *Not sent to the POS*. Buka transfernya dan tekan **Send to the POS** setelah POS menyala lagi. Mengirim ulang tidak pernah menambah barang dua kali.

**🖨 Print checklist** di PO memberi daftar kertas tanpa harga, terpisah untuk stok hotel, Kitchen, dan Resto, untuk mengecek barang dan serah terima. Saat menerima, isi juga tanggal dan nomor surat jalan. Cara mengirim PO ke supplier, menutup pengiriman yang kurang, dan tanda tagihan dijelaskan di **[Belanja: pakai halaman yang mana](/guide/purchasing)**.

Permintaan otomatis menjadi **Received** setelah semua barangnya datang. Kalau supplier tidak bisa mengirim sisanya, purchasing menutup PO (**Close – rest won't come**): yang kurang kembali terlihat belum dipesan di permintaan, untuk dipesan ke supplier lain. Jika ada yang tidak jadi dibeli, **Close** permintaannya dengan alasan.

**Make bill** di PO otomatis memakai departemen dari permintaan, supaya Costs by department tetap benar.
