# Tablet kamar — koneksi WiFi

**Settings → Property → Room Tablets** menunjukkan seberapa stabil koneksi setiap tablet kamar, supaya titik WiFi yang lemah ketahuan dan bisa dicek apakah perubahan WiFi membantu.

> Owner selalu bisa melihat. Yang lain perlu izin **Room Tablets** (Roles & Permissions → Settings).

## Apa yang dihitung sebagai putus

Setiap tablet kamar meminta layarnya ke PMS setiap 10 detik. Kalau tablet diam **lebih dari satu menit**, itu satu kali **putus** (drop). Saat tersambung lagi, PMS mencatat berapa lama tablet hilang.

Kalau **5 tablet atau lebih** diam dalam 90 detik yang sama, penyebabnya bukan WiFi satu kamar, tapi **jalur internet, router atau server PMS**. Itu dicatat terpisah di **Many rooms at the same time** dan **tidak** dihitung untuk kamar mana pun.

Riwayat disimpan **30 hari**.

## Overview

- **Now**: satu kotak per kamar — online atau offline, kekuatan sinyal (**Good** / **Weak** / **Poor**), 2.4 atau 5 GHz, access point dan baterai. Tekan kotaknya untuk membuka kamar.
- **Drops per day**: kamar ke bawah, hari ke samping. Makin gelap kotaknya, makin sering putus hari itu. Arahkan kursor ke kotak untuk detailnya. Kotak bergaris putus-putus berarti tablet tidak terdengar hari itu (mati atau belum dipasang). **Sort → Most drops first** menaruh kamar paling lemah di atas.
- **Many rooms at the same time**: kapan, berapa lama dan kamar mana saja.

## Kekuatan sinyal

| dBm | Artinya |
| --- | --- |
| −67 atau lebih tinggi | **Good** (bagus) |
| −67 sampai −75 | **Weak** (lemah) — kadang putus |
| di bawah −75 | **Poor** (buruk) — sering putus; dekatkan access point atau tambah satu |

> **Tablet offline:** sinyal, access point dan baterai yang tampil adalah **laporan terakhirnya** (ditandai "Last known" / "last report"), bukan kondisi sekarang — tablet yang offline tidak bisa mengirim apa pun.
>
> **"⚠ WiFi but no internet"**: tablet tersambung ke WiFi (sering dengan sinyal bagus) tetapi jaringannya tidak tembus ke internet. Itu masalah pengaturan access point atau router (DHCP, gateway, firewall), bukan sinyal lemah.

Sinyal dan access point hanya datang dari tablet yang memakai **aplikasi kiosk**. Tablet yang hanya berjalan di browser tetap dihitung putusnya.

## Satu kamar

Tekan sebuah kamar (kotaknya atau namanya di tabel): sinyal dalam **24 jam terakhir**, **7 hari** atau **30 hari** (tanda merah di bawah = putus), kapan **pindah access point**, dan setiap putus dengan jamnya — **Alone** (sendiri) atau bersama kamar lain.

## Sebelum / sesudah perubahan WiFi

1. Buka **Before / after**.
2. **Changed at**: tanggal dan jam pekerjaan selesai.
3. Centang kamar yang mendapat WiFi baru.
4. **Compare**.

Setiap baris menunjukkan:

| Kolom | Artinya |
| --- | --- |
| **Online before / after** | berapa persen waktu tablet bisa terhubung ke PMS — 100% = tidak pernah putus |
| **Offline a day** | berapa lama layarnya terputus dalam sehari rata-rata |
| **Drops a day** | berapa kali putus dalam sehari |
| **Result** | **Better** / **Worse** / **About the same** menurut lamanya offline; **Too early** selama perubahan belum 12 jam; **Not heard from since …** = tablet itu mati atau tidak bisa masuk WiFi sekarang — perlu dicek ke kamar |

Lamanya offline lebih penting daripada jumlah putus: banyak putus sebentar (semenit) bisa lebih baik daripada sedikit putus berjam-jam. **Kamar lain** adalah pembanding: kalau kamar lain juga membaik, berarti ada hal lain yang berubah (misalnya jalur internet). Pilihan Anda diingat di perangkat ini.

## Access point

**Access points** menampilkan semua access point yang dipakai tablet dalam 7 hari terakhir, kamar yang sedang tersambung, serta sinyal rata-rata dan terburuknya. Ketik nama yang mudah dikenali (misalnya "Koridor Blok 200") lalu **Save** — nama itu muncul di semua tempat, menggantikan alamat perangkat.
