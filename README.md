# BotDown — Bot Telegram di Vercel

Bot downloader berbasis library pada folder `lib/`, Node.js 22, dan webhook Telegram. Kirim tautan publik ke bot; bot mengambil hasil dari provider, menampilkan tombol unduh, dan mencoba mengirim satu media utama langsung ke Telegram.

## Fitur

- Deteksi platform otomatis dari tautan, termasuk tautan tersembunyi pada teks Telegram.
- Provider cadangan untuk platform yang memiliki beberapa provider HTTP.
- Menu awal bergaya HTML dengan tombol Download, YouTube MP3, Resolver, Platform, dan Cara Pakai. Navigasi tombol memperbarui pesan menu.
- `/start`, `/help`, `/download`, `/resolve`, `/mp3`, `/mp4`, dan `/platforms`.
- Resolver lengkap: MediaFire, Sfile, Safelinku, Sub2Unlock, Rekonise, dan Unshorten.
- `/resolve <tautan>` menampilkan tautan tujuan/direct download tanpa mengambil media lanjut. Tautan resolver yang dikirim biasa otomatis dilanjutkan ke platform media atau resolver berikutnya jika didukung.
- Tombol input meminta balasan tautan (ForceReply), sehingga pilihan YouTube MP3 dan Resolver tetap dikenali tanpa menyimpan sesi di Vercel.
- `/mp3` khusus audio YouTube. Platform musik cukup dikirimi tautannya langsung.
- Hingga 8 tombol unduh per hasil. Album/playlist mengirim satu media utama; hasil lain diakses melalui tombol.
- Tidak menyimpan atau mengunggah file besar lewat Vercel: Telegram mengambil media dari URL provider.
- Webhook dilindungi `secret_token`, dengan pemrosesan background menggunakan `waitUntil` milik Vercel.

Platform media: TikTok, Instagram, YouTube, Facebook, Twitter/X, Spotify, SoundCloud, Apple Music, Bandcamp, Pinterest, Reddit, Threads, Douyin, Bilibili, Pixiv, RedNote, dan TeraBox. Resolver: MediaFire, Sfile (`.mobi` dan `.co`), Safelinku, Sub2Unlock, Rekonise, dan Unshorten. Keberhasilan tiap tautan bergantung pada provider library dan akses konten.

Shortlink umum seperti `bit.ly`, `tinyurl.com`, `t.co`, `cutt.ly`, dan `s.id` dikenali otomatis. Untuk domain shortlink lain, gunakan `/resolve`. Unshorten mengikuti redirect HTTP dan meta-refresh; shortlink yang hanya memakai JavaScript atau captcha belum tentu dapat dibuka. Jika tidak ditemukan redirect, bot menyatakan bahwa URL tetap sama. Resolver umum memeriksa alamat IP/DNS publik pada setiap langkah dan membatasi respons halaman hingga 2 MB.

## 1. Buat bot

1. Buka **@BotFather** di Telegram.
2. Kirim `/newbot`, lalu pilih nama dan username.
3. Simpan token bot untuk environment variable `TELEGRAM_BOT_TOKEN`.

## 2. Pasang dependency

Gunakan Node.js 22 dan jalankan di folder project:

```powershell
npm install
npm test
```

Buat file `.env` dengan menyalin isi `.env.example`, lalu isi:

```dotenv
TELEGRAM_BOT_TOKEN=token_bot_dari_BotFather
TELEGRAM_WEBHOOK_SECRET=string_acak_yang_sama_di_lokal_dan_vercel
BOT_BASE_URL=https://nama-project.vercel.app
```

Untuk membuat secret acak:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Secret harus 32–256 karakter, hanya huruf, angka, `_`, atau `-`. `.env` sudah masuk `.gitignore`.

## 3. Deploy ke Vercel

1. Upload project ke repository GitHub, lalu **Add New → Project** di Vercel dan impor repository.
2. Pilih **Framework Preset: Other**, **Node.js: 22.x**, dan root directory folder project ini.
3. Install Command: `npm install`. Biarkan Build Command tanpa override dan Output Directory default.
4. Tambahkan environment variable untuk **Production**:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
5. Deploy. Jika environment variable diubah setelah deployment, redeploy agar konfigurasi baru digunakan.

Gunakan domain production tetap, misalnya `https://nama-project.vercel.app`, sebagai `BOT_BASE_URL` di `.env` lokal. Deployment dan perubahan environment variable dilakukan melalui dashboard Vercel.

Pastikan `/api/webhook` dapat diakses publik tanpa login atau Deployment Protection. Endpoint root `/` menampilkan status layanan; status ini tidak menguji token atau provider.

## 4. Pasang webhook

Setelah deployment selesai dan `.env` lokal terisi:

```powershell
npm run webhook:set
npm run webhook:info
```

Script mendaftarkan `https://nama-project.vercel.app/api/webhook`, memasang secret, dan mengatur menu perintah Telegram. `BOT_BASE_URL` hanya diperlukan oleh script pemasangan webhook lokal.

Pada hasil `webhook:info`, periksa `url`, `pending_update_count`, dan `last_error_message` jika ada. Setelah itu buka bot di Telegram, kirim `/start`, lalu kirim tautan media publik.

Contoh:

```text
/download https://www.instagram.com/reel/...
/mp3 https://www.youtube.com/watch?v=...
/mp4 https://youtu.be/...
/resolve https://bit.ly/...
```

Setelah memperbarui kode bot, deploy ulang lalu jalankan `npm run webhook:set` agar webhook menerima `callback_query` untuk tombol menu dan daftar perintah Telegram ikut diperbarui.

Untuk grup, gunakan `/download@username_bot <tautan>`. Agar bot juga menerima pesan tautan biasa di grup, atur `/setprivacy` menjadi **Disable** melalui BotFather; perubahan dapat memerlukan penambahan ulang bot ke grup.

Menghapus webhook:

```powershell
npm run webhook:delete
```

## Cara kerja dan batas runtime

- `api/webhook.js` memvalidasi request lalu segera mengembalikan HTTP 200. `waitUntil` menjaga pemrosesan tetap berjalan setelah respons dikirim.
- `vercel.json` mengatur durasi maksimum 300 detik. Pastikan pengaturan Functions/Fluid Compute dan paket Vercel mendukung durasi tersebut.
- Resolusi provider dibatasi sekitar 170 detik total, maksimal 60 detik untuk menunggu satu provider. Timeout wrapper berhenti menunggu; request internal library yang sudah dimulai dapat tetap berjalan sampai timeout bawaan provider.
- Dedup update bersifat best-effort dalam satu instance selama 5 menit. Background task bukan antrean persisten: restart atau penghentian function dapat menyebabkan pekerjaan hilang. Untuk kebutuhan volume tinggi/reliabilitas ketat, perlu antrean dan dedup persisten.
- Provider `fdown`, `snapinsta`, `savetik`, dan `tikdownloader` tidak diaktifkan karena memerlukan browser/executable lokal. Library aslinya tetap tersedia di `lib/`.
- Library playlist YouTube belum dihubungkan ke bot ini. Rantai resolver dibatasi agar tidak berulang; jika unduhan lanjutan gagal, bot tetap mengembalikan tautan tujuan yang sudah ditemukan.
- Telegram dapat menolak media karena ukuran, format, hotlink protection, atau URL kedaluwarsa. Bot tetap menyediakan tombol unduh. HLS dan file umum ditampilkan sebagai tautan, bukan dikirim sebagai video.

## Struktur

```text
api/index.js          Endpoint status
api/webhook.js        Entry point Vercel
src/webhook.js        Validasi webhook dan background task
src/bot.js            Perintah bot dan pengiriman hasil
src/menu.js           Tampilan HTML, navigasi tombol, dan menu perintah
src/platforms.js      Pemetaan domain, provider, dan normalisasi
src/public-url.js     Validasi alamat publik untuk resolver umum
src/telegram.js       Client Telegram Bot API
scripts/webhook.js    Pasang/periksa/hapus webhook
lib/                 Library downloader yang sudah tersedia
test/bot.test.js      Pengujian lokal dengan mock, tanpa token
```

## Troubleshooting

- **Bot tidak merespons:** cek `npm run webhook:info`, environment variable Production, akses publik endpoint, dan log function Vercel.
- **Tombol terus memuat/menghubungkan:** periksa `allowed_updates` pada `webhook:info`. Harus ada `message` dan `callback_query`; jalankan `npm run webhook:set` jika belum. Pastikan kode terbaru yang menangani `callback_query` sudah di-deploy, kemudian kirim `/start` untuk mendapatkan menu baru.
- **401:** secret `.env` lokal tidak sama dengan yang dipakai deployment. Samakan, redeploy, lalu jalankan `webhook:set` kembali.
- **503:** token atau secret belum tersedia pada deployment aktif.
- **Media gagal diambil:** coba tautan publik lain. Provider scraper dapat berubah atau memblokir IP server; lihat pemetaan provider di `src/platforms.js`.
- **Hanya tombol unduh yang muncul:** URL mungkin tidak bisa diambil Telegram atau hasilnya berupa file/HLS.

`npm test` menggunakan mock dan tidak memanggil layanan downloader maupun Telegram; pengujian end-to-end membutuhkan token serta deployment aktif.
# Omni-Scrapr
