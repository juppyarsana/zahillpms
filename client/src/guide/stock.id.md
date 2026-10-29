# Stok: adjust, stock opname dan pemakaian

**[Operations → Stock](/stock)** menampilkan semua barang yang disimpan sebagai stok: **stock items** (dipakai hotel — beras, telur, sabun…) dan **Sales items** yang *Track stock*-nya aktif (dijual apa adanya — air mineral, minibar). Perlu izin **Stock** (owner selalu punya).

Stok bertambah saat **dibeli** (di Purchasing), berkurang saat **dijual**, dan lewat **Adjust** untuk hal lain. Klik barangnya untuk melihat riwayatnya: setiap perubahan, siapa, kapan, dan sisa setelahnya.

Di bagian atas, pilih **Hotel stock** atau **Restaurant stock** (kalau aplikasi restoran sudah terhubung). Semua di bawah ini tentang stok hotel; stok restoran dijelaskan di bagian akhir.

## Adjust — satu barang, kejadian yang diketahui

Tekan **Adjust** pada barangnya lalu pilih alasannya:

- **Waste / spoiled** — pecah, rusak, kedaluwarsa, dibuang.
- **Used (not sold)** — welcome drink, makan staf, dipakai di kamar.
- **Correction** — stok di PMS salah (salah ketik, ternyata ada lebih). Wajib tulis alasannya.

Lalu isi **berapa banyak** dan simpan. Stok langsung berubah.

Catat yang terbuang dan terpakai **pada hari kejadiannya**. Yang tidak dicatat nanti muncul sebagai selisih yang *tidak jelas* di stock opname.

## Stock opname — semua barang dihitung dalam satu hari

Mingguan atau bulanan.

1. Tab **Stock opname** → **+ Start stock opname**. Semua barang terdaftar.
2. **Print count sheet** lalu bawa keliling gudang. Lembarnya berisi kotak kosong, supaya hitungannya tidak terpengaruh angka di PMS.
3. Ketik jumlah yang ada di rak di samping tiap barang. Tersimpan sendiri, jadi bisa berhenti dan lanjut nanti. Selisihnya langsung terlihat.
4. Barang yang tidak dihitung: biarkan kosong. Stoknya tetap.
5. **Finish…** — di hari yang sama dengan penghitungan, sebelum ada yang terpakai atau terjual lagi.

Setelah selesai, setiap barang yang dihitung diubah menjadi jumlah hitungan dan selisihnya dicatat sebagai *Stock opname*. Stock opname yang sudah selesai tidak bisa diubah. Hanya satu yang bisa terbuka; **Cancel opname** membatalkan yang salah dimulai (stok tidak berubah).

Ringkasannya dikirim ke Telegram (nilai stok, selisih, selisih terbesar) dan daftar lengkapnya lewat email — ke yang mencentang *Stock opname finished* di **Settings → Notifications**.

## Adjust atau stock opname?

| | Adjust | Stock opname |
|---|---|---|
| Apa | satu barang | semua barang |
| Kapan | saat kejadian | mingguan atau bulanan |
| Kenapa | diketahui: terbuang, terpakai, koreksi | hitungan — sisanya **tidak jelas** |

Di laporan pemakaian keduanya dipisah: yang terbuang dan terpakai lewat Adjust itu wajar; **selisih opname** yang besar tiap periode berarti ada stok yang keluar tanpa catatan.

## Pemakaian (Usage)

Tab **Usage**: dari satu stock opname yang selesai ke berikutnya (atau sampai sekarang).

- **Used in total** = stok awal + dibeli − stok akhir.
- Dipisah menjadi **Sold**, **Used (not sold)**, **Waste**, **Corrections** dan **Opname difference**.
- Dalam Rupiah dengan harga rata-rata tiap barang, per kategori atau per barang. **⬇ Excel** untuk tabel lengkap.

Perlu minimal satu stock opname yang sudah selesai sebagai awal.

## Nilai stok

Tab **Stock value**: nilai stok yang ada, per kategori, tiap barang dengan harga rata-ratanya (harga belinya) — stok hotel dan restoran bersama, dengan satu total. Untuk pembukuan, accountant memakai nilai stock opname yang sudah selesai sebagai stok akhir.

## Stok restoran

Bahan dapur dan bar beserta perlengkapannya disimpan di **aplikasi restoran (POS)**: resepnya mengurangi stok setiap ada penjualan, dan **chef yang menghitung dan menyesuaikannya di sana** (Inventory → Stock Opname). Di sini hanya **ditampilkan**:

- **Stock items** — setiap barang dengan sisanya (dalam kg / L), harga rata-rata dan nilainya. Klik barangnya untuk melihat **riwayatnya**: setiap penjualan (dengan nomor bill), pembelian, stock opname, bill yang diubah.
- **Usage** — di antara dua stock opname chef: **by recipe** (yang seharusnya terpakai untuk menu yang terjual) dan **used** (awal + beli − akhir). **Selisihnya** adalah yang hilang saat dihitung — terbuang, porsi, resep yang salah. Tanyakan ke chef kalau ada angka merah yang besar.
- Pembelian untuk restoran dilakukan di sini oleh purchasing (purchase request, PO, atau Bought without a PO dengan jenis *Restaurant (POS)*). Barangnya masuk ke stok POS dengan sendirinya — chef tidak pernah menambah pembelian di POS.

## Write-off di Telegram

Barang terbuang, atau koreksi turun, yang nilainya lebih dari batas tertentu (diatur di **Settings → Notifications → Stock written off**) dikirim ke owner: barangnya, berapa, alasannya dan siapa.
