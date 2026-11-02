# Pembayaran dari agen

**Uang dari agen sebelum tamu check-out → catat di reservasi. Uang dari agen setelah check-out → catat di Receivables.**

| Kapan uang masuk | Catat di mana |
| --- | --- |
| Sebelum check-out (biasanya H-7) | Reservasi: **Room Payment → Mark Received** (grup: **Record Group Payment**) |
| Setelah check-out | [Receivables](/agents) → agen → **Record Payment** |

## Sebelum check-out (H-7)

Agen biasanya transfer penuh H-7. Catat transfer itu di reservasinya, dengan **tanggal transfer yang sebenarnya** dan nomor referensinya.

**Reservasi satu kamar**

1. Buka reservasi → kartu **Room Payment**.
2. Klik **Mark Received** pada baris yang belum dibayar.
3. Pilih metode, isi tanggal transfer dan referensi.
4. Bayar sebagian? Pakai **💳 Record payment** di tab Folio dan isi jumlahnya.

**Grup**

1. Halaman grup → **Record Group Payment**.
2. Isi jumlah yang diterima — PMS membaginya ke kamar-kamar.
3. Isi tanggal transfer dan referensi.
4. Transfer juga untuk ekstra (mis. extra bed)? Centang kamar itu di bagian **Extras on the rooms** di jendela yang sama. Ekstra yang dicentang dibayar di folio kamar itu dan tidak masuk tagihan agen. Biarkan tidak dicentang kalau tamu atau agen membayarnya nanti.

Satu transfer untuk beberapa reservasi terpisah: catat di setiap reservasi dengan referensi yang sama.

## Saat check-out

Check-out seperti biasa. PMS hanya menagihkan ke agen **sisa yang belum dibayar** — tidak perlu memilih apa-apa.

| Sudah dibayar agen sebelum check-out | Masuk ke tagihan agen | Label di Receivables |
| --- | --- | --- |
| Lunas | Tidak ada | Paid before check-out |
| Sebagian, mis. 40% | Sisanya, mis. 60% | On the bill · not invoiced |
| Belum ada | Seluruh harga menginap | On the bill · not invoiced |

Tamu tidak membayar kamar — hanya ekstra yang ia bayar sendiri di meja depan (minibar, laundry, dll.). Reservasi tetap tercatat milik agen itu di laporan (By agent), walaupun sudah lunas sebelum check-out.

## Grup satu tagihan dengan agen yang ditagih

Grup dengan satu tagihan menyimpan uang kamar di tagihan grup, bukan di kamar. Saat kamar yang agennya membayar belakangan (atau OTA yang menerima uang dari tamu) check-out, PMS otomatis mengubah grup menjadi **ditagih per kamar**: yang sudah dibayar grup pindah ke kamar, dan sisanya masuk ke tagihan agen. Closing hari itu tidak berubah.

Kalau di Receivables sebuah kamar berlabel **On the group's bill · not the agent's**, kamar itu masih tertinggal di grup:

1. Buka grup → kartu **Group Bill** → **🧾 Bill room by room** (owner, atau izin Corrections).
2. Baca **What will happen**, isi alasan, konfirmasi.
3. Kamar yang sudah check-out kini muncul di tagihan agen.

PMS menolak kalau grup punya refund, sudah membayar lebih dari harga kamarnya, atau ada kamar yang sudah masuk invoice agen atau sudah dibayar sebagian oleh agen. Jendelanya menyebutkan sebabnya; bereskan dulu. Kalau ini terjadi saat check-out, tamu tetap bisa check-out, kamar tetap di tagihan grup, dan alasannya tercatat di Edit History kamar.

> Cek ekstra dulu pada grup yang membayar **Everything**: angka di jendela hanya harga kamar, jadi ekstra yang dibebankan ke kamar ditambahkan di atasnya untuk kamar itu. Grup yang sudah membayar ekstra tidak bisa diubah.

## Setelah check-out

Kalau agen membayar setelah tamu pulang, catat di **Receivables**, bukan di reservasi.

1. Buka [Receivables](/agents) → klik nama agen.
2. Klik **Record Payment**.
3. Isi jumlah, metode, tanggal transfer dan referensi.
4. PMS mencocokkan pembayaran ke menginap yang paling lama dulu — cek dan ubah kalau perlu.

Setelah dicocokkan, menginap itu berlabel **Paid by agent** dan hilang dari daftar tunggakan (aging).

## Kalau salah catat

| Kesalahan | Akibatnya | Perbaikan |
| --- | --- | --- |
| Transfer H-7 dicatat di Receivables | Reservasi terlihat belum dibayar; uangnya menunggu sebagai kredit agen | Void pembayaran di Receivables (dengan alasan), lalu catat di reservasi |
| Pembayaran setelah check-out dicatat di reservasi | Tagihan agen ikut turun, tapi angka "Agent ledger" di Cashier Closing hari check-out berubah | Beri tahu owner; lain kali catat di Receivables |

> Tanda bantu di PMS: reservasi dengan agen yang ditagih menampilkan kotak biru di kartu **Room Payment** (di sini sebelum check-out, di Receivables setelahnya). Jendela **Record Payment** di Receivables mengingatkan bahwa itu hanya untuk menginap yang sudah check-out.
