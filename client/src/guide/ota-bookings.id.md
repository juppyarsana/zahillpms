# Booking dari OTA

Kalau hotel sudah terhubung ke channel manager, booking dari Agoda, Booking.com, Traveloka dan OTA lain masuk ke PMS **sendiri**, biasanya dalam beberapa detik (paling lama satu menit). Perubahan dan pembatalan di OTA juga masuk sendiri. Tidak perlu diketik.

## Cara melihatnya

- **Pop-up** di kanan atas setiap halaman: *New Agoda booking*, *booking changed*, *booking cancelled* atau *needs you*, dengan nama tamu, kamar dan tanggal, plus bunyi singkat. **Open** membuka booking-nya, **OK** menutupnya — untuk semua orang di front desk, jadi cukup satu orang yang menekan. **All seen** menutup semuanya.
- **🌐 OTA bookings** di menu (Front Desk), dengan angka merah selama ada yang baru atau butuh Anda: yang butuh Anda paling atas, lalu hari ini, lalu sebelumnya. **↻ Check now** langsung membaca channel manager.
- Kotak **Dashboard** *From the OTAs — today*: berapa yang baru / diubah / dibatalkan hari ini dan apa yang butuh Anda.

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

Di booking OTA biasa tamu sudah bayar ke OTA, jadi booking langsung **Confirmed** dan kamar tidak ditagih di front desk (PMS menulis "Room — paid by Agoda"). **Jangan tandai pembayaran kamar sebagai diterima** saat check-in atau check-out: baris kamar yang masih terbuka adalah utang OTA ke hotel. Saat check-out PMS memindahkannya ke **akun OTA itu di Agent Billing**, dan front desk mencatat withdrawal mingguan OTA di sana (menu OTA payouts). Extra tetap dibayar tamu. Kalau OTA membayar dengan **kartu virtual**, lihat [Pembayaran dari OTA](/guide/ota-payments).

Booking *Guest pays at the hotel* tetap **Pending** sampai tamu membayar, seperti booking langsung. Kalau OTA kemudian mengubah booking dari yang satu ke yang lain, pop-up menulis *needs you* dan status ikut berubah.

## Diubah atau dibatalkan di OTA

- **Diubah** (tanggal, tipe kamar, jumlah tamu, harga): booking ikut diubah. Kalau kamarnya tidak kosong di tanggal baru, PMS memindahkan ke kamar kosong lain dengan tipe yang sama. Edit History mencatat perubahannya.
- **Dibatalkan**: booking dibatalkan. Kalau sudah ada uang masuk, daftar To check memberi tahu — kembalikan atau simpan sesuai aturan pembatalan OTA.

## Booking yang sudah ada di PMS

Saat OTA pertama kali dihubungkan, channel manager bisa mengirim booking yang sudah ada di PMS (diketik manual, atau dari sistem lama). PMS mengenalinya — tipe kamar sama, tanggal sama, dan nama tamu atau nomor reservasi OTA di catatan — lalu **menautkannya**, tidak membuat booking kedua. Booking itu muncul di **To check** ("…was matched to this booking"), dengan harga dari OTA kalau berbeda dengan PMS. Setelah itu, perubahan di OTA mengubah booking tersebut.

## Kalau PMS butuh Anda

Beberapa hal tidak dikerjakan PMS sendiri:

- **tidak ada kamar kosong** untuk booking baru (overbooked),
- perubahan atau pembatalan untuk tamu yang **sudah check-in**,
- tipe kamar yang belum di-link,
- perubahan pada booking yang dulu dimasukkan manual.

Semua itu muncul sebagai pop-up *needs you*, paling atas di **🌐 OTA bookings**, di Dashboard dan di Telegram. Selesaikan (pindahkan tamu, telepon OTA, masukkan atau ubah booking secara manual), lalu tekan **Done — handled**.

> Jangan mengetik booking OTA secara manual kalau hotel sudah terhubung — booking-nya jadi dua. Masukkan manual hanya kalau PMS memintanya.

## Harga lain untuk satu meal plan di OTA (owner)

Biasanya OTA mendapat harga PMS: harga kamar ditambah meal plan, sudah termasuk service & pajak. Untuk memberi OTA harga lain untuk satu meal plan, misalnya promo Bed & Breakfast:

1. **Pricing** → **🌐 OTA prices**.
2. Di tiap baris pilih **tipe kamar**, **meal plan**, **malam pertama** dan **malam terakhir** (keduanya termasuk), lalu **harga** per kamar per malam, sudah termasuk service & pajak.
3. Lebih dari satu? **+ Add line**, lalu **Save … — send together**. Semuanya sampai ke OTA bersama dalam sekitar 20 detik.

> Harga ini hanya untuk OTA. New Booking dan tagihan tamu tetap memakai harga PMS.

Harga bisa diisi sampai 5 tahun ke depan: OTA melihat sekitar 16 bulan, dan malam berikutnya dikirim saat masuk jangkauan itu. Kalau dua harga OTA mencakup malam yang sama, yang disimpan terakhir yang berlaku. **✕** pada harga yang tersimpan menghapusnya; malam-malam itu kembali ke harga normal.
