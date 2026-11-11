# Tamu kelebihan bayar — kembalikan uangnya

Tamu transfer **lebih dari tagihan** (hotel salah menagih, atau tamu membulatkan ke atas). Cara yang benar: **kembalikan kelebihannya**, supaya pembukuan menunjukkan uang yang benar-benar diterima hotel. **Jangan menambah biaya di folio hanya supaya saldo jadi nol** — itu membuat pendapatan yang tidak pernah ada.

> Contoh: tagihan Rp 22.500.000, tamu transfer Rp 22.775.000. Kembalikan **Rp 275.000**. Jangan menambah baris "Rp 275.000".

## 1. Cek berapa yang diterima dan berapa tagihannya

- **Satu booking:** tab Folio → *Estimated Balance Due* dan *Payments received*.
- **Grup dengan satu tagihan:** halaman grup → kartu **Group Bill** (tagihan, dibayar, kelebihan).

Selisihnya adalah **kelebihan (credit)** — jumlah yang dikembalikan. Kalau saldonya bukan credit, ada masalah lain (baris yang salah, bukan kelebihan bayar): perbaiki tagihannya dulu.

## 2. Kalau sudah ada biaya yang ditambah untuk menutup selisih, hapus dulu

Kalau ada yang sudah menambah baris supaya saldo nol (item seperti "Other charge" atau "Refund"):

1. Tab Folio → void baris itu (alasan wajib), **atau** Sales → History → **Void** pada penjualan itu (alasan wajib). Void penjualan juga mem-void baris folionya.
2. Tagihan kembali ke jumlah yang benar dan muncul **credit**.

## 3. Kembalikan credit-nya

- **Satu booking, atau grup yang dibayar per kamar:** halaman booking → ⋮ → **Refund**.
- **Grup dengan satu tagihan:** halaman grup → **💸 Refund** di kartu Group Bill.

Isi:
- **Jumlah** — tidak boleh lebih dari credit.
- **Metode** — cara uang benar-benar kembali: *Bank transfer* kalau ditransfer, *Cash* kalau dari laci kas.
- **Tanggal** — hari uang benar-benar dikembalikan.
- **Referensi** — nomor referensi transfer (atau siapa yang menerima uang tunai).
- **Alasan** — misalnya "tamu transfer Rp 22.775.000 untuk tagihan Rp 22.500.000".

> Perlu izin **Corrections** (atau owner) untuk void dan refund.

## 4. Cek hasilnya

- Saldo **0** dan credit hilang.
- **Cashier Closing** dan **Daily Close** hari refund menunjukkan baris **minus** untuk refund, di bawah metode yang dipilih.
- Pembayaran awal tetap di harinya. Pembukuan menjumlahkan keduanya, jadi finance melihat Rp 22.500.000 yang tersisa.

## Yang harus dihindari

- **Jangan** memakai item Sales sebagai "refund" — itu menambah tagihan positif dan dihitung sebagai pendapatan.
- **Jangan** mengubah jumlah pembayaran yang sudah diterima. Batalkan lalu catat ulang, atau refund selisihnya.
- Refund **tunai**: uangnya harus benar-benar ada di laci — closing mencatatnya sebagai uang keluar.
