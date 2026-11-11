# Voucher menginap

Voucher adalah **satu paket menginap yang sudah dibayar** — misalnya 2 malam, Deluxe Pool View, dengan sarapan, seharga Rp X. Pembeli menerima dokumen PDF berisi kode, apa yang termasuk, masa berlaku, dan syarat & ketentuan. Tamu memakainya **sekali**, kapan saja dalam aturannya, dengan menyebutkan kodenya saat booking.

Halamannya: **[Sales → Vouchers](/vouchers)**. Perlu izin **Vouchers** (owner selalu punya).

> **Menjual voucher bukan pendapatan.** Uangnya diterima, tapi hotel masih berhutang satu paket menginap. Pendapatan baru tercatat malam demi malam saat tamu menginap, seperti booking biasa.

## 1. Membuat jenis voucher (owner atau staf dengan izin *Voucher types*)

1. **Vouchers → Voucher types → New voucher type**.
2. Isi nama, jumlah malam, tipe kamar, meal plan, maksimal tamu, harga, dan berlaku berapa bulan.
3. Tempel **Terms & conditions** dari dokumen voucher yang lama — teks ini dicetak di PDF.
4. **Aturan** (opsional): periode **blackout** (malam yang tidak boleh dipakai), hari check-in yang boleh, minimal pemberitahuan, apakah no-show menghabiskan voucher.
5. **Biaya tambahan saat penjualan** (opsional), misalnya biaya kartu / QRIS: pembeli membayarnya di atas harga, dan tidak mengurangi paket menginap.

Voucher **tidak dikenakan service charge dan pajak**: tamu membayar harganya, dan kamar + meal plan tertutup penuh. Extras yang dibeli tamu dibayar seperti biasa.

Perubahan jenis voucher **tidak mengubah voucher yang sudah terjual** — aturan dan syaratnya disimpan saat dijual.

## 2. Menjual voucher

1. **Vouchers → Sell voucher**.
2. Pilih jenis, pembeli (cari tamu atau ketik nama baru), untuk siapa (kalau bukan pembeli), cara bayar, hari bayar, dan nomor referensi.
3. **Sell voucher** → muncul kodenya. Tekan **⬇ Voucher PDF** dan berikan ke pembeli.

Uang yang diterima muncul di **Cashier Closing** hari itu (metode sesuai yang dipilih) dan di Daily Close.

## Beberapa voucher sekaligus, atau ditagihkan ke kamar

- **Jumlah:** di jendela Sell, *How many* membuat sampai 20 voucher sejenis sekaligus, masing-masing dengan kode dan PDF sendiri.
- **Tagihkan ke kamar (dibayar bersama tagihan):** pilih *Payment → Charge to a room*, lalu cari reservasinya (sudah dibooking atau sedang menginap). Voucher langsung terbit dan **satu baris per voucher masuk ke folio tamu**, tanpa service charge dan pajak. Hari itu tidak ada uang yang diterima: tamu membayarnya bersama sisa tagihan (Record Payment, atau saat check-out), seperti extras lain. Di pembukuan ini adalah hutang hotel (liability), bukan pendapatan.
- Boleh dicampur: tamu yang mau 8 voucher, jual 5 sebagai *Paid now* dan 3 sebagai *Charge to a room*.
- Voucher yang ditagihkan ke kamar **dibatalkan di halaman Vouchers** (owner atau izin Corrections): barisnya hilang dari tagihan. Kalau tamu sudah membayar tagihannya, kembalikan uangnya lewat ⋮ → Refund di reservasi. Barisnya tidak bisa di-void atau dipindah dari tab Folio.
- Tidak bisa untuk menginap yang ditagih ke agen, menginap complimentary untuk semuanya, atau kamar di tagihan grup yang mencakup semuanya. Jendelanya akan memberi tahu, dan pembayaran diterima sekarang.
- Voucher yang ditagihkan ke kamar bisa dipakai sebelum tamu membayar tagihan, jadi pastikan tagihan sudah lunas sebelum check-out.

## 3. Booking dengan kode voucher

1. **New Booking** (satu kamar): pilih tanggal, kamar, dan jumlah tamu **dulu**.
2. Di kotak **🎟 Voucher**, ketik kodenya lalu tekan **Check**.
3. Kalau cocok, tertulis berapa yang dibayar voucher. Harga, meal plan, dan pembayaran **diatur oleh voucher** — tidak ada yang perlu diketik atau ditagih untuk menginapnya.
4. **Review booking** → buat. Booking langsung **Confirmed** dan halaman booking menampilkan **Paid by voucher**.

Check-in tidak menunggu pembayaran. Saat check-out, voucher menjadi **Used**.

### Kalau kode ditolak

Pesannya menyebut alasannya:

- **Kode tidak ketemu** — periksa ketikannya (kode 12 huruf/angka).
- **Sudah dipakai / sudah di-booking** — voucher hanya sekali pakai. Kalau bookingnya dibatalkan, voucher kembali aktif.
- **Jumlah malam, tipe kamar, atau jumlah tamu tidak sesuai** — voucher untuk paket yang persis seperti yang dijual.
- **Malam jatuh di periode blackout, hari check-in tidak boleh, kurang pemberitahuan, atau lewat masa berlaku** — hanya **manager** (owner atau izin Corrections) yang bisa membuat pengecualian: ia mengisi alasan, dan alasannya tercatat di voucher dan booking.

## 4. Setelah booking dibuat

- **Tanggal, tipe kamar, jumlah tamu, harga** pada booking voucher **tidak bisa diubah**. Kalau perlu, **batalkan booking** — voucher kembali aktif — lalu booking lagi dengan kode yang sama. Pindah ke kamar lain **dengan tipe yang sama** boleh.
- **Booking dibatalkan:** voucher kembali **Active**.
- **No-show:** tergantung jenisnya, voucher **habis terpakai** atau kembali aktif. Biaya no-show tidak berlaku untuk booking voucher.
- **Tamu pulang lebih awal:** harga tetap, tidak ada pengembalian.

## 5. Voucher tidak terpakai sampai batas akhir

Setelah **hari terakhir berlaku** lewat, voucher otomatis menjadi **Expired** (tiap malam jam 03:40) dan nilainya menjadi **pendapatan breakage** di pembukuan. Voucher yang sudah di-booking tidak pernah kedaluwarsa.

## 6. Pengecualian (owner / izin Corrections)

Buka vouchernya (klik barisnya):

- **Extend…** — perpanjang hari terakhir, dengan alasan. Hanya untuk voucher yang belum kedaluwarsa.
- **Cancel voucher…** — voucher dijual karena salah. Isi alasan; kalau uang dikembalikan ke pembeli, isi jumlah dan caranya (uang keluar tercatat di Cashier Closing); kalau tidak, hotel menyimpannya sebagai pendapatan. Voucher yang sudah di-booking harus dilepas dulu (batalkan bookingnya).

## 7. Voucher gratis (complimentary)

Satu jenis voucher yang sama bisa **diberikan gratis** — misalnya untuk survei agen travel, famtrip, atau hadiah dari hotel. Tidak perlu membuat jenis baru.

1. **Vouchers → Sell voucher**, pilih jenis voucher, lalu centang **🎁 Give it free (complimentary)**.
2. Pilih **apa yang ditanggung**: *Room only* (meal plan dan extras dibayar tamu), *Room + meals* (extras dibayar tamu), atau *Everything* (kamar, meal plan, dan extras).
3. Isi **alasan** dan **diberikan kepada siapa**.
4. Tombolnya tergantung izin Anda:
   - **Owner atau izin Complimentary:** *Give free voucher* — voucher langsung terbit, dan owner mendapat pemberitahuan.
   - **Tanpa izin itu:** *Ask for approval* — para approver (yang dicentang *Approve complimentary stays & free vouchers* di Settings → Notifications) menerima pesan di Telegram dengan tombol **Approve / Decline**. Jendela ini menunggu; begitu disetujui, kodenya muncul. Permintaan yang masih menunggu tampil di atas daftar voucher (bisa **Withdraw**), dan yang ditolak tampil selama sehari. Permintaan berlaku 24 jam.

Tidak ada uang yang diterima dan tidak ada yang ditahan — voucher gratis tidak muncul di Cashier Closing maupun di hutang voucher.

**Memakainya:** sama seperti voucher biasa (kode di New Booking, aturan yang sama). Bedanya, **isi harga normal kamar** (pakai saran harga): booking dibuat lalu otomatis dijadikan **complimentary** sesuai yang ditanggung, dan harga itu tercatat sebagai **nilai yang diberikan** di laporan, seperti stay complimentary biasa. Voucher gratis yang tidak terpakai sampai batas akhir hanya kedaluwarsa — tidak ada pendapatan breakage.

## 8. Laporan dan pembukuan

Tab **Report**: voucher terjual yang belum di-booking (uang yang ditahan), yang sudah di-booking, terjual / dipakai / kedaluwarsa pada periode, dan voucher yang segera kedaluwarsa. Bila Accounting aktif, ada **garis cek**: saldo akun *Deferred Income (vouchers)* harus sama dengan voucher terjual yang belum di-booking.

Untuk akuntan: penjualan → uang masuk, hutang voucher; booking dengan voucher → hutang voucher berpindah ke Advance deposits / Guest ledger (bukan uang masuk); pendapatan kamar & meal plan tercatat per malam tanpa service charge/pajak; kedaluwarsa → pendapatan breakage.
