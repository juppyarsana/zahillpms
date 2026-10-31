# Cost of sales: makanan & minuman lewat persediaan

Untuk akuntan. Kalau metode ini aktif, makanan dan minuman yang dibeli masuk ke **persediaan** dulu, bukan langsung jadi biaya. Biayanya baru masuk saat dipakai, sekali sebulan. Jadi food cost di Profit & Loss sesuai dengan penjualan bulan itu.

## Mengaktifkan

**Accounting → Cost of sales** → pilih tanggal mulai → **Switch on**. Tanggal itu harus di hari yang belum ditutup. Pakai hari pertama buku.

Mulai tanggal itu:

- Expenses dan tagihan supplier dengan kategori **Food** masuk ke 130-00-001 Inventory — Food.
- Kategori **Drinks** masuk ke 130-00-002 Inventory — Beverage.
- Kategori lain tidak berubah, tetap langsung jadi biaya.

Halaman Reports dan Costs tetap menghitung pembelian sebagai biaya pada hari dibeli. Hanya buku di Accounting yang memakai metode ini.

## Setiap akhir bulan

1. Lakukan **stock opname** di PMS (Operations → Stock) dan di POS, sedekat mungkin dengan akhir bulan.
2. Buka **Accounting → Cost of sales**, pilih bulannya.
3. Periksa rumusnya untuk Food dan Drinks:

   **Stok awal + dibeli − stok akhir = cost of sales**

4. Stok akhir terisi sendiri: stok hotel ditambah stok restoran pada tengah malam setelah akhir bulan. Angkanya boleh diganti kalau hasil hitung Anda berbeda.
5. Baca peringatan kuning kalau ada, lalu tekan **Post to the journal** → **Yes, post**.

Hasilnya satu journal entry biasa di tab Journal entries, tertanggal hari terakhir bulan itu. Posting sebelum menutup hari terakhir bulan. Kalau hari itu sudah ditutup, pilih tanggal yang masih terbuka.

## Kalau ada yang salah

Buka tab **Journal entries**: **Void** kalau harinya belum ditutup, **Reverse** kalau sudah. Setelah itu posting lagi dari Cost of sales.

## Hal yang perlu diingat

- **Satu tagihan, satu kategori.** Kalau satu PO berisi makanan dan minuman, buat dua tagihan supaya pembagiannya benar.
- **Belanja yang tidak masuk stok** (misalnya makanan pasar untuk hari itu) tetap tercatat dengan kategori Food. Karena tidak ada di stok akhir, nilainya masuk cost of sales di akhir bulan.
- **Stok POS harus diberi tanda Food atau Drink:** di POS, Stock → **Set food or drink**. Yang belum diberi tanda dihitung sebagai makanan, dan halaman ini memberi peringatan.
- **Hasil minus** berarti stok akhir lebih besar dari stok awal ditambah pembelian. Periksa opening balance dan kategori pembelian.
- **Stok akhir dihitung dengan harga rata-rata hari ini**, jadi posting secepatnya setelah opname.
