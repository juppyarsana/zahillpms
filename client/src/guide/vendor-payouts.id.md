# Bayar vendor tur & transport

Beberapa tur dan transfer (jeep tracking, antar ke Amed…) dijalankan oleh **vendor** dari luar. Tamu selalu membayar ke hotel; hotel lalu membayar bagian vendor. **[Keuangan → Vendor payouts](/vendor-payouts)** menunjukkan berapa tiap trip berhutang ke tiap vendor dan mencatat uang yang dibayarkan.

Perlu izin **Vendor prices & payouts** (owner selalu punya). Staf tanpa izin ini hanya melihat harga tamu, tidak pernah harga vendor.

## 1. Atur aktivitasnya (sekali saja)

1. **Activities → Catalog → Edit** aktivitasnya.
2. Di **Vendor**, pilih vendornya (atau ketik nama lalu tekan **Add new vendor**).
3. Cara bayar vendor: **per trip**, **per person**, atau **typed for each trip** (kalau harganya berubah-ubah).
4. **The vendor's part in the books**: *Taken off revenue (rebate)* — biasanya ini — atau *Booked as a cost*. Tanyakan ke akuntan.
5. Pajak: pilih **Included in the price (all-in)**, lalu:
   - **Service charge** — *None on this activity* kalau hotel tidak mengenakan service.
   - **Tax worked out on** — *Hotel's part only*: pajak hanya dari bagian yang diterima hotel (harga dikurangi bagian vendor), bukan dari seluruh harga.
6. **Save**. Berlaku untuk booking mulai sekarang.

Satu aktivitas bisa punya lebih dari satu vendor (misalnya jeep + guide).

## 2. Booking trip

Booking aktivitas seperti biasa (Activities → New Booking, atau tab Activities di reservasi). Jumlah untuk tiap vendor terisi sendiri. Untuk tamu tidak ada yang berubah.

Trip berhutang ke vendor begitu statusnya **Confirmed** atau **Completed**. Kalau **cancelled** atau **no-show**, vendor tidak dibayar, kecuali Anda centang *the vendor is still owed this amount (a fee)* di trip itu.

## 3. Harga yang belum diisi

Kalau harga vendor *typed for each trip*, trip menunjukkan **to set** (tab Vendors: "1 price to set"; tab Trips: **Price to set**). Buka trip dengan **Edit**, ketik jumlahnya, **Save**.

Di **Edit** juga bisa mengubah harga satu trip (misalnya setelah tawar-menawar), menambah catatan, menambah vendor lain untuk trip itu, atau melepas vendor dari trip yang belum dibayar.

## 4. Membayar vendor

1. Tab **Vendors** → **Pay** di vendornya.
2. Trip yang sudah berjalan sudah dicentang; centang juga trip mendatang kalau membayar di muka.
3. Bayar sebagian? Ketik di **Amount paid**: dibagi ke trip yang dicentang, yang paling lama dulu. Bisa juga ubah **Pay now** per trip.
4. **Paid with** (biasanya Cash), **Date paid**, referensi kalau ada → **Pay**.
5. **Print slip** — vendor menandatangani sebagai tanda terima.

Ini uang dari akuntan: tidak masuk laci kas front office atau Cashier Closing.

**Salah bayar?** Tab **Payouts** → **Void** dengan alasan. Pembayaran tetap di daftar (dicoret) dan trip-tripnya berhutang lagi.

## Tampil di mana

- **Reports → Revenue**: tiap aktivitas menunjukkan bagian vendor dan bagian hotel.
- **Accounting**: pada hari trip, bagian vendor dikurangkan dari pendapatan (atau dicatat sebagai biaya) dan tercatat sebagai hutang ke vendor; pembayaran menutupnya. Tidak perlu input manual.
