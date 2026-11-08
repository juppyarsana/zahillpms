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

## Kalau tidak dijawab

Setelah 45 detik tamu melihat "No one answered", dan grup Telegram **Room service orders** mendapat pesan "Panggilan tak terjawab" agar restoran menelepon balik kamarnya.
