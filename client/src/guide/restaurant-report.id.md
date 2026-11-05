# Laporan restoran

Untuk mengecek pendapatan restoran: berapa yang dibayar di restoran, berapa yang dibebankan ke kamar dan ke event, dan apakah semua sesi dari POS sudah masuk.

## Membuka laporan

1. Buka **Restaurant → Report** ([buka](/restaurant?tab=report)).
2. Pilih periode: **This month**, **Last month**, **Last 7 days**, atau isi tanggal sendiri (maksimal satu tahun).
3. Klik **⬇ Download Excel** untuk semua detail.

Akuntan juga bisa download dari **Insights → Export / Print → Restaurant report**.

Yang bisa membuka: pemilik, staff dengan izin **Restaurant**, atau staff dengan izin **Accounting**.

## Yang ada di layar

- **Restaurant revenue (net)** — sama persis dengan F&B restoran di halaman Summary dan di jurnal.
- **Revenue** — dibagi tiga: dibayar di restoran, dibebankan ke kamar, dibebankan ke event. Masing-masing net, service + tax, dan total.
- **Paid by** — total per cara bayar (Cash, QRIS, bank, Room Charge).
- **By session** — Breakfast, Lunch, Dinner.
- **Not revenue** — diskon, complimentary per departemen, bill yang belum dibayar saat sesi dikirim.
- **Checks** — hal yang perlu dicek sebelum angka dianggap final.
- **Day by day** — total per hari. **Show sessions** menampilkan tiap sesi; klik sesi untuk membukanya.

## Checks

| Pesan | Artinya | Yang dilakukan |
|---|---|---|
| Sessions sent: 64 of 66 | Ada sesi yang tidak dikirim POS | Tanya kasir. Kalau restoran buka, kirim dari POS → Transactions → Send to hotel |
| Session whose totals don't add up | Total bill, cara bayar dan rincian tidak sama | Buka sesinya, cek dengan kasir |
| Amounts differ | Jumlah di POS beda dengan di folio tamu | Cek bill di POS dan folio tamu |
| Folio line voided | Front desk membatalkan baris restoran di folio | Pastikan bill-nya dibayar dengan cara lain atau memang dibatalkan |
| Not in the PMS | POS membebankan ke kamar, tapi PMS tidak menerima | Buka **Room charges**, kirim ulang dari POS |

> Dibayar di restoran dihitung pada hari sesi. Beban ke kamar dan event dihitung pada hari PMS menerimanya, dan hanya kalau masih ada di tagihan.

## Isi Excel

- **Summary** — sama dengan layar.
- **Daily by session** — tiap sesi tiap hari, dengan kolom per cara bayar, total harian dan total periode. Angka di sini seperti yang dikirim POS.
- **Bills** — setiap bill: nomor, jam buka/bayar, meja atau kamar, tamu, cara bayar, kasir, subtotal, diskon, net, service, tax, total.
- **Items sold** — setiap item di setiap bill.
- **Menu mix** — item terlaris.
- **Room & event charges** — tiap beban ke kamar/event dari POS dibandingkan dengan tagihan di PMS.
- **Complimentary** — tiap bill gratis (bukan pendapatan).
- **Checks** — hasil cek per sesi dan sesi yang tidak dikirim.

## Bill urut nomor (tab Bills)

Untuk mencocokkan bill yang dicetak dan mencari tahu kenapa ada nomor yang hilang.

1. Buka **Restaurant → Bills** ([buka](/restaurant?tab=bills)). Langsung tampil **kemarin**; pakai ‹ › untuk pindah hari, atau pilih tanggal.
2. Bill diurutkan **berdasarkan nomor bill**. Nomor yang hilang tampil sebagai baris merah dengan alasannya.
3. Klik bill untuk melihat item dan totalnya, lalu buka sesi, reservasi atau event-nya.
4. **⬇ Download Excel** berisi daftar yang sama.

Setiap bill dapat nomor saat dibayar, dihitung per bulan. Bill berikut juga punya nomor:

| Tampil sebagai | Artinya |
|---|---|
| 🛏 Room charge | Dibebankan ke kamar tamu; tamu menandatangani bill yang dicetak |
| 🗓 Event charge | Dibebankan ke meeting / event |
| Included breakfast | Sarapan termasuk harga kamar, tanpa pembayaran |
| 🎁 Complimentary | Gratis, dibebankan ke departemen |
| Reopened | Front desk membatalkan beban ke kamar; POS membuka lagi bill-nya dan belum diselesaikan |
| Deleted | Dihapus di POS — tertulis siapa yang menghapus, kapan dan alasannya |
| Missing | Tidak ada catatan di POS: dihapus sebelum POS menyimpan bill yang dihapus (5 Nov 2026) |

> **Session not sent yet** pada bill artinya kasir belum menekan *Send to hotel* untuk sesi itu. Bill-nya ada; ikut terhitung setelah sesinya dikirim.

Di POS, bill yang sudah punya nomor hanya bisa dihapus oleh Owner atau Manager, dan harus diisi alasannya.
