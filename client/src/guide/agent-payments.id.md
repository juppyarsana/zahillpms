# Pembayaran dari agen

**Uang dari agen sebelum tamu check-out → catat di reservasi. Uang dari agen setelah check-out → catat di Agent Billing.**

| Kapan uang masuk | Catat di mana |
| --- | --- |
| Sebelum check-out (biasanya H-7) | Reservasi: **Room Payment → Mark Received** (grup: **Record Group Payment**) |
| Setelah check-out | [Agent Billing](/agents) → agen → **Record Payment** |

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

Satu transfer untuk beberapa reservasi terpisah: catat di setiap reservasi dengan referensi yang sama.

## Saat check-out

Check-out seperti biasa. PMS hanya menagihkan ke agen **sisa yang belum dibayar** — tidak perlu memilih apa-apa.

| Sudah dibayar agen sebelum check-out | Masuk ke tagihan agen | Label di Agent Billing |
| --- | --- | --- |
| Lunas | Tidak ada | Paid before check-out |
| Sebagian, mis. 40% | Sisanya, mis. 60% | On the bill · not invoiced |
| Belum ada | Seluruh harga menginap | On the bill · not invoiced |

Tamu tidak membayar kamar — hanya ekstra yang ia bayar sendiri di meja depan (minibar, laundry, dll.). Reservasi tetap tercatat milik agen itu di laporan (By agent), walaupun sudah lunas sebelum check-out.

## Setelah check-out

Kalau agen membayar setelah tamu pulang, catat di **Agent Billing**, bukan di reservasi.

1. Buka [Agent Billing](/agents) → klik nama agen.
2. Klik **Record Payment**.
3. Isi jumlah, metode, tanggal transfer dan referensi.
4. PMS mencocokkan pembayaran ke menginap yang paling lama dulu — cek dan ubah kalau perlu.

Setelah dicocokkan, menginap itu berlabel **Paid by agent** dan hilang dari daftar tunggakan (aging).

## Kalau salah catat

| Kesalahan | Akibatnya | Perbaikan |
| --- | --- | --- |
| Transfer H-7 dicatat di Agent Billing | Reservasi terlihat belum dibayar; uangnya menunggu sebagai kredit agen | Void pembayaran di Agent Billing (dengan alasan), lalu catat di reservasi |
| Pembayaran setelah check-out dicatat di reservasi | Tagihan agen ikut turun, tapi angka "Agent ledger" di Cashier Closing hari check-out berubah | Beri tahu owner; lain kali catat di Agent Billing |

> Tanda bantu di PMS: reservasi dengan agen yang ditagih menampilkan kotak biru di kartu **Room Payment** (di sini sebelum check-out, di Agent Billing setelahnya). Jendela **Record Payment** di Agent Billing mengingatkan bahwa itu hanya untuk menginap yang sudah check-out.
