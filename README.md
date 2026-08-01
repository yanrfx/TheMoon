# TheMoon Glass V3 — Login, Hak Akses, dan Background Link

Versi ini dibuat ulang agar cocok dengan Cloudflare Pages Advanced Mode.

## Fitur

- Login dengan database Cloudflare D1.
- Akun master memiliki akses seluruh menu.
- Master dapat membuat, mengedit, menonaktifkan, dan menghapus akun.
- Master dapat menentukan menu yang boleh dibuka setiap akun.
- Background dapat diganti menggunakan link gambar HTTPS.
- Efek glassmorphism/kaca buram pada login, sidebar, dashboard, modal, dan tabel.
- Background tersimpan di D1 dan berlaku untuk seluruh akun.
- Password disimpan sebagai hash PBKDF2-SHA256 + salt.
- Sesi menggunakan cookie HttpOnly, Secure, dan SameSite=Strict.
- Hak akses diperiksa oleh server.

## File yang harus berada di root repository

```text
index.html
styles.css
app.js
_worker.js
README.md
```

Jangan memasukkan file tersebut ke folder tambahan.

---

# CARA PASANG

## 1. Upload file baru ke GitHub

1. Download dan ekstrak ZIP.
2. Buka repository GitHub `yanrfx/TheMoon`.
3. Klik **Add file → Upload files**.
4. Upload dan timpa file:

```text
index.html
styles.css
app.js
_worker.js
README.md
```

5. Klik **Commit changes** ke branch `main`.

## 2. Build Settings Cloudflare

Buka:

```text
Cloudflare → Workers & Pages → themoon2
→ Settings → Build
```

Isi:

```text
Framework preset: None
Build command: exit 0
Build output directory: .
Root directory: kosong
```

Build output directory harus berupa satu titik:

```text
.
```

Bukan `/`.

## 3. Binding D1

Buka:

```text
themoon2 → Settings → Bindings
```

Pastikan ada:

```text
Type: D1 database
Name: DB
Value: themoon-users
```

Nama binding harus persis `DB`.

## 4. Variables and Secrets

Buka:

```text
themoon2 → Settings → Variables and secrets
```

Tambahkan untuk Production:

```text
MASTER_USERNAME
```

Nilai:

```text
Rfxfly
```

Tambahkan sebagai Secret:

```text
MASTER_PASSWORD
```

Nilai awal yang kamu tentukan sendiri.

Apabila database lama sudah memiliki akun master, secret ini tidak mengganti passwordnya. Login menggunakan password yang sudah tersimpan di database, lalu ganti password dari tombol akun di kanan atas.

## 5. Deploy ulang

Setelah binding atau secret diubah:

1. Buka tab **Deployments**.
2. Klik **Retry deployment** pada deployment terbaru.

Atau buat commit baru di GitHub.

Deployment yang benar harus mengunggah file, bukan `Uploaded 0 files`.

## 6. Tes API

Buka:

```text
https://themoon2.pages.dev/api/session
```

Hasil normal sebelum login:

```json
{
  "authenticated": false,
  "setupReady": true,
  "user": null,
  "menus": []
}
```

Buka juga:

```text
https://themoon2.pages.dev/api/public-settings
```

Hasil awal:

```json
{
  "backgroundUrl": ""
}
```

## 7. Login dan ganti background

1. Login sebagai master.
2. Buka menu **Settings**.
3. Tempel link gambar langsung yang memakai HTTPS.
4. Klik **Lihat preview**.
5. Klik **Simpan background**.

Contoh bentuk link yang benar:

```text
https://domain.com/background.jpg
https://domain.com/background.png
https://domain.com/background.webp
```

Link halaman Pinterest, Google Images, Facebook, dan halaman preview biasanya tidak bekerja.

---

# Kenapa versi ini berbeda?

Background memakai elemen `<img>` tetap, bukan CSS inline. Hal ini membuat link gambar eksternal bekerja dengan Content Security Policy:

```text
img-src 'self' data: https:
```

Versi lama dapat gagal menampilkan gambar eksternal karena CSP memblokir link background atau perubahan style inline.

---

# Troubleshooting

## `/api/session` menampilkan JSON tetapi desain tidak berubah

Pastikan deployment terbaru benar-benar mengunggah file:

```text
index.html
styles.css
app.js
_worker.js
```

Kemudian buka website dengan:

```text
Ctrl + Shift + R
```

## Settings tidak muncul

Menu Settings hanya tersedia untuk akun master.

## Link tersimpan tetapi gambar tidak tampil

Penyebab umum:

- Link bukan HTTPS.
- Link bukan file gambar langsung.
- Server gambar memblokir hotlink.
- Link membutuhkan login/cookie.
- Link sudah kedaluwarsa.

Coba gunakan link dari hosting gambar lain.

## Akun master tidak bisa login

Apabila database lama sudah memiliki master, `MASTER_PASSWORD` baru tidak otomatis mengganti password yang lama.

Pilihan:

- Gunakan password master lama.
- Hapus seluruh isi tabel `users` dan `sessions` untuk reset.
- Setelah tabel kosong, sistem membuat master baru dari secret pada request berikutnya.

Jangan menghapus database bila masih ada akun penting tanpa backup.
