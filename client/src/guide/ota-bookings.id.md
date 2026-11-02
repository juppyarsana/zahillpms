# Booking dari OTA

Kalau hotel sudah terhubung ke channel manager, booking dari Agoda, Booking.com, Traveloka dan OTA lain masuk ke PMS **sendiri**, biasanya dalam beberapa detik (paling lama satu menit). Perubahan dan pembatalan di OTA juga masuk sendiri. Tidak perlu diketik.

## Cara melihatnya

- **Pop-up** di kanan atas setiap halaman: *New Agoda booking*, *booking changed*, *booking cancelled* atau *needs you*, dengan nama tamu, kamar dan tanggal, plus bunyi singkat. **Open** membuka booking-nya, **OK** menutupnya — untuk semua orang di front desk, jadi cukup satu orang yang menekan. **All seen** menutup semuanya.
- Tab **Reservations → OTA bookings** (angka merah tampil di Reservations pada menu dan di tab selama ada yang baru atau butuh Anda): yang butuh Anda paling atas, lalu hari ini, lalu sebelumnya. **↻ Check now** langsung membaca channel manager.
- Kotak di halaman **Today** *From the OTAs — today*: berapa yang baru / diubah / dibatalkan hari ini dan apa yang butuh Anda.

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

Di booking OTA biasa tamu sudah bayar ke OTA, jadi booking langsung **Confirmed** dan kamar tidak ditagih di front desk (PMS menulis "Room — paid by Agoda"). **Jangan tandai pembayaran kamar sebagai diterima** saat check-in atau check-out: baris kamar yang masih terbuka adalah utang OTA ke hotel. Saat check-out PMS memindahkannya ke **akun OTA itu di Receivables**, dan front desk mencatat withdrawal mingguan OTA di sana (menu OTA payouts). Extra tetap dibayar tamu. Kalau OTA membayar dengan **kartu virtual**, lihat [Pembayaran dari OTA](/guide/ota-payments).

Booking *Guest pays at the hotel* tetap **Pending** sampai tamu membayar, seperti booking langsung. Kalau OTA kemudian mengubah booking dari yang satu ke yang lain, pop-up menulis *needs you* dan status ikut berubah.

## Diubah atau dibatalkan di OTA

- **Diubah** (tanggal, tipe kamar, jumlah tamu, harga): booking ikut diubah. Kalau kamarnya tidak kosong di tanggal baru, PMS memindahkan ke kamar kosong lain dengan tipe yang sama. Edit History mencatat perubahannya.
- **Dibatalkan**: booking dibatalkan. Kalau sudah ada uang masuk, daftar To check memberi tahu — kembalikan atau simpan sesuai aturan pembatalan OTA.
- **Dibatalkan, untuk booking yang diketik manual atau dari sistem lama**: kalau nomor reservasi OTA ada di catatan booking, PMS membatalkannya. Kalau hanya nama tamu dan tanggal datang yang cocok, booking **tidak** dibatalkan: item *needs you* dan poin To check menyebut booking-nya, jadi Anda cek dan batalkan sendiri. Kalau tidak ada yang cocok, Anda juga mendapat item *needs you*.
- **Diubah, untuk booking yang diketik manual atau dari sistem lama**: kalau nomor reservasi OTA ada di catatan booking, booking pindah ke tanggal baru. Kalau hanya nama tamu yang cocok dengan kedatangan dalam 60 hari, PMS juga membuat booking untuk tanggal baru, supaya kamarnya tertahan, dan item *needs you* menyebut kedua booking. **Kalau itu tamu yang sama, batalkan booking yang lama**, kalau tidak kamarnya tetap terblokir. Kalau tidak ada kamar kosong di tanggal baru, tidak ada booking yang dibuat dan item *needs you* memberi tahu.

## Booking yang sudah ada di PMS

Saat OTA pertama kali dihubungkan, channel manager bisa mengirim booking yang sudah ada di PMS (diketik manual, atau dari sistem lama). PMS mengenalinya — tipe kamar sama, tanggal sama, dan nomor reservasi OTA di catatan atau nama tamu yang sama — lalu **menautkannya**, tidak membuat booking kedua. Satu kata yang sama seperti *Made* atau *Putu* tidak cukup: PMS tetap membuat booking dan item *needs you* menyebut kedua booking, jadi batalkan salah satunya kalau itu tamu yang sama. Booking itu muncul di **To check** ("…was matched to this booking"), dengan harga dari OTA kalau berbeda dengan PMS. Setelah itu, perubahan di OTA mengubah booking tersebut.

## Kalau PMS butuh Anda

Beberapa hal tidak dikerjakan PMS sendiri:

- **tidak ada kamar kosong** untuk booking baru (overbooked),
- perubahan atau pembatalan untuk tamu yang **sudah check-in**,
- tipe kamar yang belum di-link,
- perubahan pada booking yang dulu dimasukkan manual.

Semua itu muncul sebagai pop-up *needs you*, paling atas di **Reservations → OTA bookings**, di Today dan di Telegram. Selesaikan (pindahkan tamu, telepon OTA, masukkan atau ubah booking secara manual), lalu tekan **Done — handled**.

> Jangan mengetik booking OTA secara manual kalau hotel sudah terhubung — booking-nya jadi dua. Masukkan manual hanya kalau PMS memintanya.

## Fixed OTA prices: satu harga untuk tanggal tertentu (owner)

Biasanya OTA mendapat harga PMS: harga kamar ditambah meal plan, sudah termasuk service & pajak. Untuk memberi OTA harga lain untuk satu meal plan, misalnya promo Bed & Breakfast:

1. **Pricing** → **📌 Fixed OTA prices**.
2. Di tiap baris pilih **tipe kamar**, **meal plan**, **malam pertama** dan **malam terakhir** (keduanya termasuk), lalu **harga** per kamar per malam, sudah termasuk service & pajak.
3. Lebih dari satu? **+ Add line**, lalu **Save … — send together**. Semuanya sampai ke OTA bersama dalam sekitar 20 detik.

> Harga ini hanya untuk OTA. New Booking dan tagihan tamu tetap memakai harga PMS.

Harga bisa diisi sampai 5 tahun ke depan: OTA melihat sekitar 16 bulan, dan malam berikutnya dikirim saat masuk jangkauan itu. Kalau dua harga tetap mencakup malam yang sama, yang disimpan terakhir yang berlaku. **✕** pada harga yang tersimpan menghapusnya; malam-malam itu kembali ke tangga harga atau harga normal.

## Tangga harga OTA — harga mengikuti kamar terjual (owner)

Harga di OTA bisa naik saat hotel makin penuh. Per meal plan, isi harga tiap tipe kamar untuk tiap tingkat **jumlah kamar terjual di seluruh hotel** pada malam itu:

1. **Pricing** → **My rules** → **📈 OTA price ladder**.
2. Pilih **meal plan** (misalnya Breakfast Non Refund).
3. Tiap baris: **Sold up to** (16, 20, 23, …) dan harga tiap tipe kamar, per kamar per malam, sudah termasuk service & pajak. Paling mudah: copy blok dari Excel (kolom "sold up to" + harganya, dengan urutan tipe kamar **sama** seperti kolom di sini) lalu paste ke kotak **Sold up to** pertama.
4. **Save ladder for …**. Ulangi untuk tiap meal plan.

Setiap malam OTA mendapat harga dari tingkat tempat kamar **berikutnya** berada: kalau sudah terjual 16 kamar, berikutnya kamar ke-17, jadi baris "up to 20". Setiap booking atau pembatalan dihitung ulang dan harganya sampai ke OTA dalam sekitar 20 detik — pembatalan bisa menurunkannya lagi.

> Dihitung terjual: semua booking kecuali cancelled dan no-show, termasuk yang belum bayar, di semua tipe kamar.

- Tipe kamar yang kolomnya dikosongkan tetap memakai harga normal.
- **📌 Fixed OTA price** mengalahkan tangga harga pada malam-malamnya (untuk tanggal khusus). Hapus harga tetap lama untuk meal plan itu, kalau tidak tangga harga tidak berlaku pada malam itu.
- **Remove ladder** mengembalikan meal plan ke harga normal.
- Setiap pengiriman tercatat di **Settings → Channel Manager → Last sends**, dengan tingkatnya ("sold up to 20").

### Season: tangga harga berbeda untuk tanggal tertentu

Untuk high season, tangga harga biasa tetap ada dan Anda menambah season. Harganya berlaku pada malam-malam season itu, dan sesudahnya tangga harga biasa kembali berlaku dengan sendirinya.

1. Di jendela **📈 OTA price ladder**, tekan **+ New season**.
2. Isi nama, **first night** (malam pertama) dan **last night** (malam terakhir). Last night adalah malam terakhir yang dijual dengan harga ini: kalau last night 15 Jan, tamu check-out 16 Jan.
3. Biarkan **Start from a copy of the All year ladders** tercentang supaya mulai dari harga sekarang, lalu **Add season**.
4. Cek baris **You are editing**, ubah harganya, lalu tekan **Save**. Ulangi untuk tiap meal plan.

Harga yang dikirim tiap malam adalah yang pertama berlaku dari urutan ini: **📌 Fixed OTA price**, tangga harga season, tangga harga **All year**, harga normal.

- Season tidak boleh tumpang tindih. Untuk mengubah tanggal atau menghapus season, tekan **Edit dates**.
- Tipe kamar yang dikosongkan di season, atau meal plan yang belum punya harga di season itu, memakai tangga harga All year pada malam-malam tersebut.
- Jendela ini menampilkan **Fixed OTA price** yang ada pada malam-malam season. Harga itu mengalahkan tangga harga, jadi hapus kalau tangga harga yang harus berlaku.

### Menghitung harga dengan %

1. Isi harga baris pertama, lalu **%** di tiap baris di bawahnya. Tiap % dihitung dari baris di atasnya.
2. Pilih **Round to** (Rp 1.000 kalau tidak diubah) lalu tekan **Work out prices**.
3. Cek harganya. Anda masih bisa mengubah harga mana pun, lalu **Save**.

Kalau ada harga yang Anda ubah sendiri, **Work out prices** akan bertanya dulu sebelum menimpanya.

### Menyalin dari tangga harga lain

Untuk rate yang selalu sekian persen di atas rate lain, misalnya Refundable 10% di atas Non Refund: pilih meal plan-nya, pilih tangga harga di **Copy from**, isi %, tekan **Copy into the grid**, cek harganya, lalu **Save**. Harga di OTA tidak berubah sebelum Anda menekan Save.
