# TheMoon Login + Hak Akses (Cloudflare Pages)

Project ini berisi:

- Tampilan login dan dashboard responsif.
- Akun master dengan akses seluruh menu.
- Master dapat membuat, mengedit, menonaktifkan, dan menghapus akun.
- Hak akses menu berbeda untuk setiap akun.
- Cloudflare D1 sebagai database.
- Password di-hash dengan PBKDF2-SHA256 + salt.
- Sesi memakai cookie `HttpOnly`, `Secure`, dan `SameSite=Strict`.
- Pemeriksaan izin dilakukan di server, bukan hanya menyembunyikan tombol.

## Struktur file

Semua file ini diletakkan langsung di root repository GitHub:

```text
index.html
styles.css
app.js
_worker.js
README.md
```

`_worker.js` memakai Cloudflare Pages Functions Advanced Mode.

---

## 1. Upload ke GitHub

Di repository `yanrfx/TheMoon`:

1. Ganti `index.html` lama dengan file dari project ini.
2. Upload `styles.css`, `app.js`, dan `_worker.js`.
3. Commit ke branch `main`.

Cloudflare akan melakukan deploy otomatis.

Build setting yang digunakan:

```text
Framework preset: None
Build command: exit 0
Build output directory: /
```

---

## 2. Buat database D1

Di dashboard Cloudflare:

1. Buka **Workers & Pages**.
2. Buka bagian **D1 SQL Database**.
3. Pilih **Create database**.
4. Nama database: `themoon-users`.
5. Selesaikan pembuatan database.

Tabel database akan dibuat otomatis oleh `_worker.js` saat API pertama kali dipanggil. Tidak perlu menjalankan SQL manual.

---

## 3. Hubungkan D1 ke project Pages

1. Buka **Workers & Pages**.
2. Pilih project Pages kamu, misalnya `themoon2`.
3. Buka **Settings**.
4. Buka **Bindings**.
5. Pilih **Add binding** → **D1 database**.
6. Isi nama binding persis:

```text
DB
```

7. Pilih database `themoon-users`.
8. Simpan untuk environment **Production**. Tambahkan juga untuk **Preview** bila diperlukan.

Nama binding harus `DB` dengan huruf besar.

---

## 4. Buat akun master melalui Cloudflare Secret

Buka:

**Project Pages → Settings → Variables and Secrets → Add**

Tambahkan:

```text
MASTER_USERNAME = Rfxfly
```

Tambahkan lagi:

```text
MASTER_PASSWORD = 123asd
```

Untuk `MASTER_PASSWORD`, aktifkan pilihan **Encrypt** agar menjadi secret.

Setelah itu lakukan **Retry deployment** atau push commit baru ke GitHub. Secret harus tersedia sebelum deployment yang menggunakannya.

Saat database masih kosong, sistem akan otomatis membuat akun master dari kedua nilai tersebut.

> Penting: password `123asd` mudah ditebak dan sudah pernah dibagikan. Setelah login pertama, klik akun di kanan atas lalu segera ganti password dengan password yang kuat.

Setelah akun master sudah masuk ke D1, mengubah `MASTER_PASSWORD` di Cloudflare tidak otomatis mengubah password akun. Gunakan menu **Ganti password** di panel.

---

## 5. Login

Buka website Pages kamu, misalnya:

```text
https://themoon2.pages.dev
```

Login awal:

```text
Username: Rfxfly
Password: 123asd
```

Master dapat membuka **User Admin**, membuat akun baru, dan memilih menu yang dapat diakses setiap akun.

---

## Menambahkan isi asli ke menu

Tampilan halaman modul ada di fungsi `renderModule()` dalam `app.js`.

Pemeriksaan hak akses server ada di endpoint:

```text
GET /api/module/:nama-menu
```

Di `_worker.js`, daftar menu ada pada konstanta `MENUS`.

Saat kamu menambahkan API baru yang berisi data penting, panggil pemeriksaan sesi dan izin pada server. Jangan hanya mengandalkan menu yang disembunyikan di browser.

---

## Pemecahan masalah

### Pesan: “Binding database belum ditemukan”

Binding D1 belum ada atau namanya bukan `DB`.

### Pesan: “Akun master belum dapat dibuat”

Periksa:

- `MASTER_USERNAME`
- `MASTER_PASSWORD`
- D1 binding `DB`
- Secret dibuat untuk environment Production
- Sudah deploy ulang setelah menambah secret

### Website lama masih tampil

Tunggu deployment selesai, kemudian refresh dengan:

```text
Ctrl + F5
```

### Ingin reset seluruh akun

Hapus database D1 lama atau hapus seluruh isi tabel `sessions` dan `users`. Setelah tabel `users` kosong, master akan dibuat kembali dari secret Cloudflare pada request berikutnya.
