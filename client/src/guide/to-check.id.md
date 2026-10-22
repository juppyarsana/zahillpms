# Daftar To check

Booking yang datanya belum lengkap ditandai **To check** — misalnya reservasi yang dipindahkan dari VHP: kamar dipilih otomatis, agen belum ada, nama tamu belum ada, harga 0, deposit belum dicatat. Tugas FO: periksa, perbaiki, lalu tandai **✓ Checked**.

> Booking To check sudah memegang kamar, jadi kamar itu tidak bisa dijual lagi. Statusnya **Pending** sampai pembayaran dicatat. Tidak ada email atau pesan yang terkirim ke tamu atau agen.

## Cara kerja

1. Buka [Reservations](/reservations?view=tocheck) → tombol **⚠ To check**. Angka di tombol = jumlah reservasi yang belum dicek (satu grup = satu).
2. Satu baris = satu reservasi. Grup tampil satu baris dengan semua kamarnya.
3. Klik baris untuk membuka booking (atau halaman grup). Kotak kuning **To check** berisi apa yang perlu diperiksa.
4. Cari reservasinya di VHP (nomor ResNo ada di **Edit Details → Internal Notes** dan di **Edit History**), lalu perbaiki setiap poin — caranya di bawah.
5. Poin yang sudah diperbaiki **dicoret sendiri** oleh PMS.
6. Kalau semua sudah beres, tekan **✓ Checked** (grup: **✓ Checked whole group**, di daftar atau di halaman grup).

Kerjakan mulai dari **tanggal kedatangan terdekat**.

## Tiga tab

| Tab | Isinya |
| --- | --- |
| **To check** | Reservasi yang masih perlu dikerjakan |
| **Waiting for guest names** | Sudah dicek, tinggal menunggu nama tamu dari agen. Hilang sendiri setelah nama diisi |
| **Done** | Sudah selesai. **Put back** mengembalikan ke daftar To check |

Nama tamu boleh menunggu: tekan Checked setelah hal lain beres, reservasinya pindah ke **Waiting for guest names**.

## Arti setiap poin dan cara memperbaikinya

**Room picked automatically** — kamar dipilih otomatis

- Kalau kamarnya sudah cocok: tidak perlu diubah (cukup tekan Checked).
- Perlu kamar lain: **⋮ → Change Room**. Kamar dengan **tipe yang sama**: harga tidak berubah, alasan boleh kosong.

**Agent not in the PMS** — agen belum ada di PMS

1. Buka [Receivables](/agents) → **+ New agent** → isi nama, tipe, kontak. Cukup sekali per agen.
2. Kembali ke booking → **⋮ → Edit Details** → kolom **Agent** → pilih agennya → simpan. Untuk grup: di setiap kamar.

**Agent … was created by the import** — agen dibuat otomatis

- Untuk owner: lengkapi kontak dan syarat kredit agen di [Receivables](/agents). Poin ini dicoret sendiri setelah agen punya kontak.

**Guest name not known yet** — nama tamu belum ada

- Satu kamar: **⋮ → Change Guest** → cari tamu atau tambah tamu baru.
- Grup: halaman grup → **Assign Guests** → isi nama di setiap kamar sekaligus.

**No rate in VHP (Rp 0)** — harga 0

Sampai diisi, harganya hanya harga sarapan (contoh Rp 200.000 untuk 2 orang).

- Satu kamar: **⋮ → Edit Price** → harga seluruh menginap (sudah termasuk service & tax dan sarapan).
- Grup: halaman grup → **⋮ → Set Prices** → centang kamar, isi **harga per malam**, **Apply** untuk semua kamar sekaligus (bisa per tipe kamar) → isi alasan → simpan.
- Perlu izin **Edit Price** (owner atau peran yang diberi izin itu).

**Complimentary in VHP** — gratis

- **⋮ → Make Complimentary** → pilih yang gratis (kamar saja / kamar + makan / semuanya) → isi alasan. Kalau perlu persetujuan, permintaan dikirim ke approver lewat Telegram.

**Number of guests guessed** — jumlah tamu ditebak (2 per kamar)

- Cek jumlah yang benar → **⋮ → Edit Details** → **Number of Guests**.
- 3 orang di kamar untuk 2: kartu **Extras for this stay** → **+ Add item** → Extra Bed → pilih malamnya.

**Check in VHP whether a deposit was paid** — deposit

- Cek di VHP: sudah bayar berapa, tanggal berapa, lewat apa. Tidak ada pembayaran → tidak perlu apa-apa.
- Ada pembayaran → catat dengan **tanggal tamu/agen membayar, bukan tanggal hari ini**. Untuk reservasi agen, lihat bab [Pembayaran dari agen](/guide/agent-payments).
- Satu kamar: kartu **Room Payment** → **Mark Received**, atau tab Folio → **💳 Record Payment**. Grup: halaman grup → **Record Group Payment**.

**VHP listed this stay night by night** — menginap digabung

- VHP mencatat menginap ini per malam; PMS menggabungkannya menjadi satu booking. Cocokkan malam dan kamarnya dengan VHP.

## Salah tekan Checked?

Di halaman booking: **put back on the list**. Di tab **Done**: **Put back**. Siapa yang menekan Checked tercatat di **Edit History**.
