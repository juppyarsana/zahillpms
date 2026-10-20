# Booking dari OTA

Kalau hotel sudah terhubung ke channel manager (Channex), booking dari Agoda, Booking.com, Traveloka dan OTA lain masuk ke PMS **sendiri**, dalam sekitar satu menit. Perubahan dan pembatalan di OTA juga masuk sendiri. Tidak perlu diketik.

## Booking OTA baru

PMS:

- memilih **kamar kosong pertama** dari tipe kamar yang dipesan,
- mencari tamu (email dan nama yang sama) atau menambah tamu baru,
- mengisi OTA sebagai **source**, harga dari OTA, meal plan, dewasa dan anak,
- memasukkan catatan dari OTA ke **Special requests**,
- mengirim alert **New booking** di Telegram.

Setiap booking muncul di **Reservations → ⚠ To check** dengan poin:

- **Room picked automatically** — pindahkan dengan **Change Room** kalau ada kamar yang lebih cocok (poinnya hilang sendiri), atau tekan **✓ Checked**.
- **Guest pays at the hotel** — di sebagian booking Booking.com / Expedia hotel yang menagih, bukan OTA. **Tagih harga kamar** saat check-in atau check-out seperti booking langsung; PMS akan memintanya.

Di booking OTA biasa tamu sudah bayar ke OTA: kamar tidak ditagih di front desk (PMS menulis "Room — paid by Agoda"). Extra tetap dibayar tamu.

## Diubah atau dibatalkan di OTA

- **Diubah** (tanggal, tipe kamar, jumlah tamu, harga): booking ikut diubah. Kalau kamarnya tidak kosong di tanggal baru, PMS memindahkan ke kamar kosong lain dengan tipe yang sama. Edit History mencatat perubahannya.
- **Dibatalkan**: booking dibatalkan. Kalau sudah ada uang masuk, daftar To check memberi tahu — kembalikan atau simpan sesuai aturan pembatalan OTA.

## Kalau PMS butuh Anda

Beberapa hal tidak dikerjakan PMS sendiri:

- **tidak ada kamar kosong** untuk booking baru (overbooked),
- perubahan atau pembatalan untuk tamu yang **sudah check-in**,
- tipe kamar yang belum di-link,
- perubahan pada booking yang dulu dimasukkan manual.

Semua itu muncul di **Settings → Channel Manager → 4. Bookings from the OTAs** (owner) dan di Telegram. Selesaikan (pindahkan tamu, telepon OTA, masukkan atau ubah booking secara manual), lalu tekan **Done — handled**.

> Jangan mengetik booking OTA secara manual kalau hotel sudah terhubung — booking-nya jadi dua. Masukkan manual hanya kalau PMS memintanya.
