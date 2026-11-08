# Pesanan room service di Telegram

Tamu memesan makanan dari **tablet kamar**. Pesanan masuk ke **POS** dan restoran harus **menerimanya** di sana. Kalau komputer POS sedang tidur, pesanan tidak terlihat dan tamu menunggu. Karena itu setiap pesanan juga dikirim ke Telegram.

## Yang dikirim

| Kapan | Isi | Ke siapa |
| --- | --- | --- |
| Langsung saat tamu memesan | 🛎 kamar, tamu, item, total, cara bayar | **Room service orders** |
| Masih belum diterima setelah 5 menit | ⏰ pengingat | **Room service orders** |
| Setelah 10 menit, lalu tiap 5 menit | ⏰ pengingat | **Room service orders** + **Room service not accepted** |

Pengingat berhenti begitu pesanan **diterima**, **ditolak** atau **dibatalkan** di POS, atau setelah 30 menit (pesan terakhir: telepon kamarnya).

## Saat menerima pengingat

1. Buka POS dan terima pesanannya. Kalau layarnya gelap, nyalakan komputernya.
2. Kalau pesanan tidak bisa dibuat, tolak di POS dengan alasannya. Tamu melihat alasannya di tablet.
3. Kalau sudah lebih dari 10 menit, front desk bisa menelepon kamar untuk minta maaf dan memberi tahu waktunya.

## Mengatur siapa yang menerima

**Settings → Notifications** → centang **Room service orders** untuk grup restoran / dapur, dan **Room service not accepted** untuk front desk dan manager. Bahasa pesan mengikuti pilihan **Language** tiap penerima.
