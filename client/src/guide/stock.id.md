# Stok: adjust, stock opname dan pemakaian

**[Operations → Stock](/stock)** menampilkan semua barang yang disimpan sebagai stok: **stock items** (dipakai hotel — beras, telur, sabun…) dan **Sales items** yang *Track stock*-nya aktif (dijual apa adanya — air mineral, minibar). Perlu izin **Stock** (owner selalu punya).

Stok bertambah saat **dibeli** (di Purchasing), berkurang saat **dijual**, dan lewat **Adjust** untuk hal lain. Klik barangnya untuk melihat riwayatnya: setiap perubahan, siapa, kapan, dan sisa setelahnya.

Di bagian atas, pilih **Hotel stock** atau **Restaurant stock** (kalau aplikasi restoran sudah terhubung). Semua di bawah ini tentang stok hotel; stok restoran dijelaskan di bagian akhir.

## Gudang (store)

Stok hotel disimpan per **gudang**: **Main Store**, **Engineering**, **Housekeeping** (owner bisa menambah atau mengganti nama lewat tombol **Stores**). **Kitchen** dan **Resto** adalah stok restoran, disimpan dan dihitung di aplikasi restoran (POS).

- **Semua barang yang dibeli masuk ke gudang hotel dulu**: **Main Store**, kecuali dipilih gudang hotel lain saat **Receive** PO atau **Buy without a PO** (*Into store*). Kalau PO punya beberapa baris, tiap baris bisa diubah lewat **Change** di bawahnya. Kitchen dan Resto tidak bisa dipilih di sini.
- **Barang restoran** (bahan dapur, minuman bar) juga masuk ke Main Store dan menunggu di sana sebagai stok hotel, sampai dipindahkan ke Kitchen atau Resto (lihat di bawah).
- Di atas daftar barang, pilih **All stores** (total, dengan rincian per gudang di bawah jumlahnya) atau satu gudang (hanya yang ada di gudang itu).
- **Adjust** selalu untuk satu gudang — pilih gudangnya di jendela Adjust.
- **Stock opname** dihitung per gudang. Main Store menampilkan semua barang; gudang lain hanya barang yang pernah ada di sana. Satu gudang hanya bisa punya satu stock opname yang sedang dihitung.
- **Pemakaian** dihitung dari dua stock opname gudang yang sama.
- Batas *Low stock* dinilai dari total semua gudang (itu yang menentukan pembelian).

### Memindahkan barang antar gudang

**Stock → Transfers → + Move stock**: pilih dari gudang mana, ke gudang mana, barang dan jumlahnya, lalu **Send**.

- Barang langsung keluar dari gudang pengirim dan tercatat **on the way** (masih dihitung di nilai stok).
- Gudang penerima membuka transfernya, menghitung yang datang, lalu **Confirm what arrived**. Kalau yang datang kurang, ketik jumlah yang datang dan alasannya — sisanya kembali ke gudang pengirim.
- Pengirim bisa **Cancel transfer** selama belum dikonfirmasi; barangnya kembali.
- Kepala Housekeeping / Engineering cukup diberi izin **Receive transfers** (Roles & Permissions → Operations): mereka hanya melihat tab Transfers dan bisa mengkonfirmasi.
- Telegram *Stock moved between stores* memberi tahu saat barang dikirim dan saat yang datang kurang.

### Mengirim barang restoran ke Kitchen / Resto

**Stock → Transfers → + Move stock**, dari Main Store ke **Kitchen** atau **Resto** *(restaurant app)*. Hanya barang restoran yang bisa dikirim ke sana.

- Transfernya langsung dikirim ke aplikasi restoran (POS). Chef atau resto menghitung yang datang di **POS → Inventory → Incoming** dan mengonfirmasinya; baru saat itu barangnya masuk ke stok restoran.
- Kalau yang datang kurang, mereka mengetik jumlah yang datang dan alasannya di POS; sisanya kembali ke Main Store.
- Kalau POS sedang tidak bisa dihubungi, transfernya tetap tersimpan dengan tanda **Not sent to the POS**: buka transfernya dan tekan **Send to the POS**.
- **Cancel transfer** hanya bisa selama POS belum menerima barangnya. Setelah itu, koreksi dilakukan saat konfirmasi di POS.

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
- **Buffet sarapan** tidak punya resep, jadi dapur mengetik bahan yang dimasak di POS: **Inventory → Kitchen use → Add kitchen use**. Satu lembar per hari per keperluan; buka lagi untuk menambah atau mengubah, dan stok bergerak sebesar selisihnya. Lembar terkunci setelah ada stock opname sesudahnya. Lembar buffet menunjukkan biaya per tamu. **Show All / Food / Drink** mempersempit daftar, jadi resto bisa memilih Drink dan tidak melihat item dapur; item bertanda Both muncul di keduanya. Tab **Usage** punya kolom *Kitchen use*.
- Pembelian untuk restoran dilakukan di sini oleh purchasing (purchase request, PO, atau Bought without a PO dengan jenis *Restaurant (POS)*). Barangnya masuk ke **Main Store** dulu, lalu dikirim ke Kitchen / Resto dengan **Move stock**. Di POS barangnya menunggu di Inventory → Incoming dan masuk ke stok saat chef mengonfirmasi — chef tidak pernah menambah pembelian secara manual.
- Saat chef membuat **Request to buy** di POS, barang yang masih ada di Main Store ditunjukkan ("The hotel has N in Main Store"), jadi tidak perlu dibeli lagi — minta saja dikirim.

## Write-off di Telegram

Barang terbuang, atau koreksi turun, yang nilainya lebih dari batas tertentu (diatur di **Settings → Notifications → Stock written off**) dikirim ke owner: barangnya, berapa, alasannya dan siapa.
