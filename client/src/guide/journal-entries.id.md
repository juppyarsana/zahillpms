# Jurnal manual, neraca & neraca saldo

PMS mencatat sendiri kegiatan hotel: tagihan tamu, pembayaran, agen, restoran, pengeluaran. **Journal entries** (jurnal manual) untuk semua yang lain yang dibukukan akuntan: gaji, penyusutan, sewa, service charge yang dibagikan ke staf, biaya bank, pemindahan uang antar rekening.

Semuanya ada di [Accounting](/accounting?tab=entries). Perlu izin **Accounting** (owner selalu punya).

## Sebelum jurnal pertama: hari pertama pembukuan

1. **Accounting → Journal entries** → **First day of the books**.
2. Pilih hari pembukuan pindah dari sistem lama ke PMS → **Save**.
3. **Opening balances…** → ketik saldo tiap akun dari neraca sistem lama per akhir hari sebelumnya.

| Akun | Angka dari mana |
| --- | --- |
| Kas, bank | Neraca sistem lama |
| Akun bertanda ★ (tamu, deposit, agen, service charge, pajak, komisi) | Biasanya angka PMS: **Use the PMS figures for ★ accounts** |
| Aset tetap, utang supplier, modal | Neraca sistem lama |

> Selisihnya masuk ke 310-00-003 Opening Balance Equity, jadi pembukuan selalu seimbang. Saldo awal bisa disimpan ulang selama hari pertama belum ditutup.

## Membuat jurnal

1. **+ New entry**.
2. Tanggal, keterangan (mis. *Gaji Oktober*), referensi (boleh kosong).
3. Satu baris per akun: debit **atau** kredit. Ketik angka tanpa titik.
4. Debit harus sama dengan kredit. Tombol **=** menaruh selisihnya di baris itu.
5. **Save entry**.

> Jurnal bulanan (gaji, penyusutan): buka jurnal bulan lalu → **Copy as a new entry** → ganti tanggal dan angkanya.

## Mengoreksi jurnal

Jurnal tidak pernah diubah.

| Hari jurnal itu | Yang dilakukan |
| --- | --- |
| Masih terbuka | Buka → **Void** → alasan. Tetap di daftar, dicoret. |
| Sudah ditutup (🔒) | Buka → **Reverse** → tanggal. Jurnal baru membalik semua barisnya. Lalu buat jurnal yang benar. |

## Neraca & neraca saldo

- **⚖ Balance sheet** (neraca): yang dimiliki dan yang menjadi utang hotel per akhir suatu hari. ✓ berarti aset = kewajiban + ekuitas. Excel atau PDF.
- **🧮 Trial balance** (neraca saldo): saldo tiap akun sebelum periode, debit dan kreditnya, dan saldo di akhir. Excel.
- Akun pendapatan dan biaya mulai dari nol tiap tahun; laba tahun-tahun sebelumnya tampil di ekuitas.

## Chart of accounts standar

Kode akun berbentuk **GGG-DD-NNN**: kelompok, departemen, nomor. Di biaya departemen, nomor yang sama berarti biaya yang sama (002 = guest supplies: Housekeeping 602-12-002, Restoran 622-21-002). Daftar lengkapnya di **Accounting → Accounts**; akun yang belum dipakai tersembunyi, centang *Show accounts not in use* untuk melihatnya, lalu **Use again**.

- **Expenses dan Payables** memilih akun sendiri dari kategori dan departemen. Guest supplies, laundry, supplies dan other mengikuti departemen biayanya. Memilih akun untuk kategori itu di bagian atas halaman Accounts akan menimpa aturan ini.
- **Metode pembayaran** dengan nama bank (*EDC BCA*, *QRIS BCA*) masuk ke akun *EDC/QRIS Settlement – BCA* kalau akun itu ada.
- **Bunga bank** ada di bawah GOP, di baris Non-operating pada Profit & Loss.
- **Service charge split** (halaman Accounts): bagian Loss & Breakage dan HR Development, dalam % dari service charge. Dengan service charge 10%, 3 poin = 30%. Berlaku untuk hari yang belum ditutup.
