# OTA dashboard: tanggal sepi & harga

Buka **Sales → OTA dashboard**. Halaman ini menunjukkan tanggal mana yang perlu keputusan harga, dan harga yang kita kirim ke OTA. Angka merah di menu adalah jumlah tanggal sepi dalam 30 malam ke depan.

## Apa itu tanggal sepi

Sebuah tanggal disebut **sepi** kalau okupansinya di bawah target. Targetnya tergantung seberapa dekat tanggalnya:

| Hari sebelum menginap | Sepi kalau di bawah |
|---|---|
| 0–7 | 40% |
| 8–14 | 30% |
| 15–30 | 20% |

Ini angka awal. Owner bisa mengubahnya di **Pricing rules**.

## Next 30 nights

Setiap malam menunjukkan okupansi, dan di bawahnya harga yang kita kirim per tipe kamar, dalam juta rupiah.

| Warna | Artinya |
|---|---|
| Tanggal merah | Sepi. Tekan untuk mengubah harga |
| Tanggal hijau | On track |
| Tanggal marun | Terisi 70% atau lebih |
| Harga kuning | Harga manual yang diketik seseorang |

Arahkan kursor ke harga (atau tekan di HP) untuk melihat alasan harganya dan bedanya dengan malam sebelumnya. Pakai tombol di kanan atas untuk melihat meal plan lain. Ini harga yang kita kirim. Diskon dari OTA sendiri tidak termasuk, jadi tamu bisa melihat harga yang lebih rendah di OTA.

## Mengubah harga

1. Tekan **Change price** pada tanggal sepi, atau tekan tanggal merah di kalender.
2. Baca bagian kiri: posisi tanggal ini, perbandingannya, hal lain yang penting, dan saran harga.
3. Tekan harga saran untuk memakainya, atau **Use all suggested**. Anda juga bisa mengetik harga sendiri.
4. Kalau menjual lebih dari satu meal plan, ganti meal plan dan lakukan hal yang sama. **Will send** menunjukkan berapa harga yang akan dikirim.
5. Tekan **Save and send to OTAs**. Harga sampai ke OTA dalam sekitar 20 detik.

Owner mendapat pesan Telegram, dan perubahannya tercatat di **Pricing rules → Recent price changes**.

> Harga di bawah minimum tipe kamar tidak bisa disimpan. Tanya owner kalau memang perlu lebih rendah.

## Harga manual tetap berlaku sampai dihapus

Harga yang Anda ketik tetap berlaku di tanggal itu, **walaupun tanggalnya sudah terisi**. Ladder tidak akan menaikkannya. Kalau sudah tidak perlu, tekan **Remove manual price** di daftar Slow dates. Tanggal dengan harga manual tetap ada di daftar itu walaupun sudah on track, supaya mudah ditemukan.

## Cara kerja saran harga

Ini aturan tetap, bukan prediksi:

- Di bawah target seperempat atau lebih: turun 10%. Lebih dekat ke target: turun 5%.
- Sisa 3 hari atau kurang: tambah 5%.
- Sisa lebih dari 14 hari: kurangi 5%, tapi tidak pernah di bawah 5%.
- Tipe kamar yang sisa kurang dari 3 kamar tetap di harganya.
- Tidak pernah di bawah minimum.

"How it compares" baru menunjukkan kecepatan booking yang biasa setelah ada cukup tanggal lampau untuk dibandingkan. Sebelum itu hanya menunjukkan booking 7 hari terakhir.

## Pricing rules (owner)

**Pricing rules** berisi target okupansi dan harga minimum per tipe kamar. Sales bisa membaca, hanya owner yang bisa mengubah. Minimum berlaku saat harga atau ladder disimpan. Harga yang sudah ada tidak berubah.

## How each OTA is doing

Reservasi yang dibuat dalam 30 hari terakhir dibanding 30 hari sebelumnya. **Commission** hanya tampil untuk OTA yang mengirimnya lewat channel manager; yang lain tertulis **Not sent**.

## Since yesterday

Booking yang masuk atau berubah sejak kemarin pukul 00.00. Saat OTA dihubungkan, OTA sering mengirim ulang booking lama. Tamu yang sudah check-out dan booking yang sudah ada di PMS tidak dihitung sebagai baru; jumlahnya tertulis di bawah daftar.
