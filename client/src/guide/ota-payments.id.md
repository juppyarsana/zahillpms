# Pembayaran dari OTA

Uang kamar dari booking OTA datang lewat salah satu dari tiga cara. PMS mencatat cara itu di setiap booking: **Edit Details → Room paid by**.

| Room paid by | Artinya | Siapa yang mengurus |
|---|---|---|
| **The OTA — paid to the hotel by its payout** | Tamu sudah bayar ke OTA (mis. Agoda, Traveloka). Front desk menarik (withdraw) uangnya dari OTA tiap minggu — sudah dipotong komisi. | Front desk, di **OTA payouts** |
| **The OTA — with a virtual card the hotel charges** | OTA memberi kartu virtual (VCC). Hotel sendiri yang men-charge kartu itu di mesin EDC. | Front desk |
| **The guest, at the hotel** | Tamu bayar di hotel, seperti booking langsung. OTA kemudian mengirim tagihan komisi. | Front desk (kamar), akuntan (tagihan komisi) |

Channel manager mengisi ini sendiri dari OTA. Kalau OTA tidak menyebutkan, PMS menganggap **tamu bayar di hotel** dan menaruh poin di **To check** — cek di extranet OTA lalu ubah di Edit Details kalau OTA yang menagih. Booking OTA yang diketik manual mengikuti source-nya (source OTA = dibayar OTA) sampai diubah.

> Satu OTA bisa memakai dua cara (mis. Booking.com: sebagian dibayar Booking.com, sebagian bayar di hotel). Yang menentukan adalah **booking itu sendiri**, bukan OTA-nya.

## Front desk: dibayar OTA (payout)

- Booking langsung **Confirmed**, tamu bisa check-in tanpa membayar kamar.
- **Jangan tagih kamar ke tamu** dan jangan tandai kamar sebagai diterima. Tagih hanya extra (minibar, extra bed, laundry…).
- Saat **check-out**, sisa harga kamar otomatis masuk ke **akun OTA itu di Receivables** (akunnya dibuat sendiri oleh PMS kalau belum ada). Tidak ada yang perlu ditekan.

## Front desk: kartu virtual (VCC)

1. Lihat tanggal kartu bisa di-charge di extranet OTA, isi di **Edit Details → Card can be charged from** (boleh kosong).
2. Pada tanggal itu (atau saat check-in / check-out), **charge kartu di mesin EDC**.
3. Di booking: **Room Payment → Record payment on the folio**. Baris kamar sudah tercentang dan metode sudah **OTA virtual card** — isi jumlah yang **benar-benar ter-charge**, lalu **Receive**.
4. Kalau saldo kartu kurang dari harga kamar (biasanya karena komisi OTA sudah dipotong), sisanya masuk ke akun OTA di Receivables saat check-out. Akuntan menutupnya sebagai komisi.

Uang dari kartu virtual muncul di **Cashier Closing** sebagai *OTA virtual card*, seperti pembayaran kartu lain.

## Front desk: withdraw mingguan

Setelah menarik (withdraw) uang dari extranet OTA:

1. Buka **OTA payouts** di menu Front Desk (owner / akuntan: **Receivables**) → OTA-nya (mis. *Agoda*). **Open Items** = stay yang sudah check-out dan belum dibayar OTA.
2. Tekan **Record payout**.
3. **Centang booking** yang tercantum di withdrawal OTA (atau **Tick all**).
4. Isi **Amount received in the bank** = jumlah bersih yang ditarik (sudah dipotong komisi), tanggal, dan nomor withdrawal di **Reference**.
5. **Commission kept back** terisi sendiri = total stay yang dicentang − uang yang masuk (dengan persentasenya). Bisa diubah kalau perlu.
6. **Record payout**. Stay yang dicentang jadi *Paid by agent*.

Hasilnya:

- **Money received** (Daily Close, Cashier Closing, Reports) hanya menghitung uang yang masuk ke bank.
- Komisi masuk ke biaya **5120 Rooms — OTA commission** di jurnal dan **Profit & Loss**.
- Sisa kartu virtual yang tidak ter-charge: **Record payout** dengan *Amount received* **0** dan komisi = sisanya.

Payout salah catat: minta owner / akuntan untuk **Void** (dengan alasan) — stay-nya kembali terbuka, lalu catat ulang.

## Akuntan: tagihan komisi (tamu bayar di hotel)

Untuk booking yang tamunya bayar di hotel, OTA mengirim tagihan komisi (mis. Booking.com tiap bulan). Catat di **Finance → Expenses** dengan kategori **OTA Commission**. Masuk ke biaya yang sama (**5120 Rooms — OTA commission**) di Profit & Loss.

## Laporan

**Reports → Money → Still owed**: uang kamar booking OTA yang belum check-out tertulis sebagai utang **OTA**, bukan utang tamu. Setelah check-out, utang itu ada di baris OTA-nya di tabel agen.

## Hak akses

- **OTA payouts** (Roles & Permissions → Front Desk): front desk melihat akun OTA saja dan mencatat withdrawal. Tidak bisa void, membuat invoice, atau membuka agen lain.
- **Receivables** (Roles & Permissions → Finance): seluruh halaman Receivables — untuk akuntan. **Expenses** (grup yang sama) untuk mencatat tagihan komisi OTA.
