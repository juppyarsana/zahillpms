# Kredit agen — uang yang ditahan untuk kamar yang dibatalkan

Agen sering **membayar kamar di muka**. Kalau agen lalu membatalkan satu kamar, hotel masih memegang uang itu. Uang itu **bukan** pendapatan hotel dan **tidak hilang**: itu **kredit yang ditahan untuk agen**. Agen bisa memakainya untuk menginap lain, atau minta dikembalikan.

> Uangnya tetap tercatat di kamar yang dibatalkan. Pembukuan, Cashier Closing, dan Daily Close tidak berubah — PMS hanya menjumlahkan kredit tiap agen supaya bisa dilihat dan dipakai.

## 1. Batalkan kamar seperti biasa

Booking → ⋮ → **Cancel Booking**, dengan alasan (misalnya "cancel by agent"). Jendelanya menjelaskan bahwa untuk booking agen, uang yang sudah diterima **menjadi kredit yang ditahan untuk agen**. **Jangan** di-refund kecuali agen memintanya.

> Total grup berkurang sebesar kamar itu (bukan lagi kamar yang harus dibayar). Uangnya tidak hilang: muncul sebagai kredit.

## 2. Lihat kreditnya

- **Receivables → halaman agen:** kartu **Credit held** di atas — tiap kamar yang dibatalkan, untuk siapa, kapan dibatalkan, bagaimana dan kapan dibayar, dan jumlahnya.
- **Halaman grup** (kalau ada kamar grup yang dibatalkan) dan **booking lain dari agen yang sama** menampilkan kartu yang sama.

> Di halaman grup, **Paid** sudah termasuk uang yang diterima untuk kamar yang dibatalkan, dengan baris yang menyebut berapa yang ditahan. **Total** dan **Balance Due** tetap untuk kamar yang masih ada. Pro forma grup dan Master Folio juga menampilkan kotak **Cancelled rooms — not billed, not in the total**: tiap kamar yang dibatalkan dengan tanggalnya, harga booking, kapan dan kenapa dibatalkan, dan apa yang terjadi dengan uangnya (ditahan sebagai kredit, di-refund, atau ada biaya yang diambil). Di bawahnya, *Money received for the group* mencocokkan transfer agen: kamar di atas + kredit yang ditahan = total yang mereka bayar.

## 3. Pakai kredit untuk menginap lain

1. Buka booking lain dari agen itu yang masih ada yang harus dibayar (atau pakai kartu di halaman agen).
2. Di kartu **Credit held** tekan **Use here** (atau **Use on a stay** lalu pilih menginapnya).
3. Isi **jumlah** — paling banyak yang lebih kecil antara kredit dan sisa tagihan menginap itu — dan **alasan**. Boleh memakai sebagian kredit saja.
4. Simpan. Uangnya dicatat di menginap itu: deposit / saldo kamar yang belum dibayar dulu, lalu extras.

Pembayarannya tetap memakai **tanggal, metode, dan referensi aslinya**, jadi uang harian tidak berubah. Edit History kedua booking mencatat apa yang terjadi.

> Kredit hanya bisa dipakai untuk menginap **agen yang sama**, dan tidak untuk kamar grup yang dibayar satu tagihan (di sana pakai Record Group Payment).

## 4. Kembalikan kreditnya

Di kartu tekan **Refund**: jumlah (sampai batas kredit), **cara** uang dikembalikan (transfer, tunai…), **tanggal**, **referensi**, dan **alasan**. Tersimpan sebagai baris refund tersendiri di hari itu (minus di Cashier Closing dan Daily Close).

## Perlu diketahui

- Front desk boleh memakai atau me-refund kredit; setiap pemakaian atau refund wajib alasan dan mengirim peringatan ke owner.
- Tidak ada masa berlaku: kredit tetap ada sampai dipakai atau di-refund.
- Biaya no-show / pembatalan terlambat yang diambil hotel dikurangkan dari kredit lebih dulu.
- Pembayaran untuk penjualan, aktivitas, atau voucher tidak bisa dipakai sebagai kredit — hanya bisa di-refund.
- **OTA (Agoda, Booking.com…) tidak pernah punya kredit.** OTA menyelesaikan urusan dengan tamunya sendiri, jadi uang yang diterima hotel untuk booking OTA (misalnya kartu virtual yang di-charge) adalah milik tamu: batalkan booking, lalu kembalikan dengan ⋮ → **Refund** di booking.
