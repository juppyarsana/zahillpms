# Telepon restoran dari kamar

Tamu bisa menelepon **restoran** langsung dari tablet kamar, dengan tombol **Call Restaurant** di bawah **Call Front Desk**. Telepon ini berdering di **layar POS**, bukan di PMS. Telepon ke front desk tidak berubah.

## Menyalakan (owner)

**Settings → Property Details → POS Integration → Restaurant phone line** → centang **Rooms can call the restaurant**. Modul **Calling** dan **POS Integration** harus menyala. POS harus sudah tersambung ke PMS (POS: Setup → Hotel PMS).

## Di POS

- **Kamar menelepon:** semua layar POS berdering dan menampilkan nomor kamar dan nama tamu. Tekan **Answer**. Layar pertama yang menjawab yang mendapat teleponnya; layar lain berhenti berdering.
- **Not now** hanya membuat layar ini diam. Layar lain tetap berdering.
- Selama telepon: kotak kecil di kiri bawah dengan **Mute** dan **Hang up**. Kasir tetap bisa memakai POS.
- **Menelepon kamar:** tombol **📞 Call a room** di bagian atas → pilih kamar (kamar dengan tamu diberi warna).
- Layar yang tidak boleh berdering (misalnya di dapur): buka **Call a room** → hilangkan centang **Ring on this screen**.
- Pertama kali, browser bertanya izin **mikrofon** → pilih **Allow**. Komputer POS butuh speaker dan mikrofon (atau headset).

## Front desk ↔ restoran

Front desk dan restoran bisa saling menelepon, seperti telepon internal.

- **Front desk → restoran:** tombol 📞 (PMS) atau HP front desk → **Call the restaurant** di atas *Call a Room*. Semua layar restoran yang *Ring on this screen*-nya menyala akan berdering, dengan tulisan **Front desk calling** dan siapa yang menelepon.
- **Restoran → front desk:** **📞 Call a room** di POS (atau tablet waiter) → **Call the front desk**. PC front desk dan HP front desk berdering, dengan tulisan **Restaurant calling**.
- Layar pertama yang menjawab yang mendapat teleponnya; layar lain berhenti berdering. Mute dan Hang up seperti biasa.
- Tidak dijawab dalam 45 detik → masuk ke daftar **Missed calls** pihak yang ditelepon sebagai *Restaurant* atau *Front Desk*, dengan **Call back**. Tidak ada pesan Telegram untuk ini.

## Panggilan tak terjawab

Telepon yang tidak dijawab dalam 45 detik masuk ke daftar **Missed calls**, terpisah untuk front desk dan restoran:

- **Front desk (PMS):** tombol 📞 di kanan bawah mendapat angka merah. Buka → **Missed calls** di atas daftar kamar: kamar, nama tamu, jam dan berapa lama yang lalu.
- **Today:** setiap panggilan front desk yang belum ditelepon balik juga muncul di **Needs you now**, dengan **Call back** dan **Done**.
- **Restoran (POS):** tombol **📞 Call a room** di atas menampilkan "1 missed". Buka → daftar yang sama.
- **Call back** menelepon kamar itu. Begitu ada yang berbicara dengan kamar itu lagi (Anda menelepon balik, atau kamar menelepon lagi dan dijawab), panggilan hilang dari daftar dengan sendirinya.
- **Done** kalau sudah diselesaikan dengan cara lain (misalnya tamu datang ke meja).
- **Show handled** menunjukkan yang sudah selesai: siapa yang menelepon balik dan jam berapa. Daftar menyimpan 24 jam terakhir.
- Telegram juga mengirim pesan "Panggilan tak terjawab" (front desk: **Guest requests**, restoran: **Room service orders**).
