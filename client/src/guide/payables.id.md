# Hutang ke supplier (Payables)

**[Finance → Payables](/payables)** menyimpan tagihan dari supplier dan berapa yang masih harus dibayar hotel. Perlu izin **Payables** (owner selalu punya).

**Payables atau Expenses?**

- **Payables**: tagihan datang sekarang, dibayar nanti (supplier memberi tempo 14 / 30 hari, atau kirim satu tagihan per bulan). Catat tagihan pada hari **tagihan datang**, pembayaran pada hari **dibayar**.
- **[Expenses](/expenses)**: dibayar langsung (tunai, atau transfer di hari yang sama). Satu baris, tidak ada hutang.

Jangan pernah mencatat tagihan yang sama di dua tempat.

## Mencatat tagihan

1. **New bill**.
2. Pilih **Supplier** (atau **+ New supplier…** di bawah daftar).
3. **Their invoice number** = nomor invoice seperti tertulis di tagihan.
4. **Bill date** = tanggal di tagihan. **Due date** terisi sendiri dari tempo supplier (boleh diubah).
5. **What it is for** (Food, Drinks, Laundry, Utilities, Maintenance…) — daftar yang sama dengan Expenses. Terisi sendiri kalau supplier sudah punya kategori biasanya.
6. **Department** — untuk departemen mana biaya ini (Front Office, Housekeeping, F&B, Engineering / Maintenance, Activities, Sales & Marketing, Admin & General). Terisi sendiri dari supplier atau kategori; ubah kalau perlu (mis. perbaikan kompor dapur = F&B).
7. **Amount** = total di tagihan, termasuk pajak.
8. **Save bill**.

Tagihan campuran (mis. nota pasar berisi makanan dan sabun): pilih yang paling besar, atau catat sebagai dua tagihan.

PMS memberi peringatan kalau nomor invoice yang sama dari supplier itu sudah pernah dicatat.

> Makanan dan minuman yang dibeli untuk gudang langsung jadi biaya. Di akhir bulan akuntan menyesuaikan sisa stok di gudang dengan satu jurnal manual.

## Dari purchase order

Di purchase order yang sudah diterima (**Operations → Purchasing & Stock → Purchase Orders**) tekan **Make bill**. Supplier dan jumlah terisi dari barang yang sudah diterima dan belum ditagihkan (daftar barang masuk ke catatan). Isi nomor invoice, perbaiki jumlah kalau tagihan berbeda, lalu simpan.

## Membayar supplier

1. **Pay a supplier** (atau **Pay** di baris supplier, atau **Pay this bill** di dalam tagihan).
2. Pilih supplier. Tagihan yang belum lunas tampil, jatuh tempo paling lama di atas.
3. Ketik **Amount paid**: jumlahnya dibagi ke tagihan, yang paling lama dulu. Atau isi **Paying now** per tagihan sendiri. Bayar sebagian boleh — sisanya tetap jadi hutang.
4. **Paid with** (mis. Bank Transfer), **Date paid**, nomor transfer di **Reference**.
5. **Record payment**.

## Melihat hutang

- Tab **Suppliers**: per supplier berapa hutangnya, yang belum jatuh tempo, terlambat 1–30 / 31–60 / lebih dari 60 hari, dan jatuh tempo berikutnya. **Edit** untuk mengatur tempo (hari) dan kategori biasa supplier itu.
- Tab **Bills**: Not paid / Overdue / Paid / Voided / All, per supplier, cari nomor bill atau nomor invoice. Klik tagihan untuk melihat baris dan pembayarannya.
- Tab **Payments**: semua pembayaran dan tagihan yang dibayarnya.

## Kalau salah

- Tagihan yang belum dibayar sama sekali: buka → **Edit**, atau **Void** (dengan alasan).
- Pembayaran salah catat: tab **Payments** → **Void** (dengan alasan). Tagihannya kembali terhutang; catat pembayaran yang benar.
- Tagihan yang sudah ada pembayarannya: void pembayarannya dulu.

Tidak ada yang dihapus: tagihan dan pembayaran yang di-void tetap tampil dengan siapa yang mem-void dan alasannya.

## Departemen mana yang biayanya paling besar

**Reports → Money → Costs by department**: semua expense dan tagihan supplier di periode itu per departemen, porsinya, untuk apa saja, dan perubahannya dibanding jumlah hari yang sama sebelumnya. Juga ada di laporan Excel dan PDF.

## Di pembukuan

- Tagihan: biaya tercatat pada **bill date** (di Laba Rugi dan Reports → Costs bulan itu), hutang di **2150 Accounts payable — suppliers**. Akun tiap kategori diatur sekali di **Accounting → Accounts** (sama seperti Expenses).
- Pembayaran: 2150 berkurang, uang keluar dari kas / bank pada **date paid**.
- Akun 2150 di neraca = total hutang di tab Suppliers.
