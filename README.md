# Aero Assistant 🛸

Aero adalah asisten desktop HUD mengambang (*frameless, click-through overlay*) yang dibangun dengan **Electron**, **Google Gemini Multimodal Streaming**, dan orkestrasi sub-proses **Antigravity CLI (`agy`)**. Dirancang untuk interaksi suara dan visi layar ultra-rendah latensi (~1 detik) tanpa memblokir alur kerja utama di Windows.

---

## 🌟 Fitur Utama

- **Ultra-Fast Voice & Vision Loop (~1s):** Kombinasi Gemini Flash Streaming dengan *dynamic screen downscaling* dan Web Audio VAD untuk percakapan suara interaktif alami.
- **Kontrol Komputer Aman (Actions):** Eksekusi tindakan sistem daftar putih (membuka aplikasi, navigasi URL, pencarian YouTube/Spotify, dan kontrol tombol media Windows).
- **Orkestrasi Background Agent (Antigravity CLI):** Menjalankan riset mendalam atau coding via sub-proses headless `agy` di latar belakang secara asinkron lengkap dengan *task chips* dan notifikasi suara saat selesai.
- **Avatar Pixel-Art Prosedural (HTML5 Canvas):** Aero berupa bola emas dengan visor bermata cyan dan dua telinga yang melayang. Digambar per piksel dengan animasi mengambang, kedip, ekspresi (senang, sedih, kaget), gerak mulut mengikuti suara, dan pelacakan kursor.
- **Click-Through HUD:** Area transparan sepenuhnya tembus klik ke jendela di belakangnya; hanya tombol kontrol dan bubble chat yang menangkap interaksi mouse.
- **Integrasi Penuh OS Windows:** Hotkey global `F9`, peluncur senyap tanpa jendela terminal (`aero.cmd` via `Win + R`), dan menu System Tray.

---

## 🏗️ Arsitektur Teknis

- **Runtime & Windowing:** Electron frameless window dengan *click-through mouse passthrough* dinamis via `setIgnoreMouseEvents` dan proteksi *single instance lock*.
- **Visi Layar Adaptif:** Multi-monitor screen capture berbasis `desktopCapturer` dengan *dynamic downscaling* (1024px–2200px) dan kompresi kuantisasi JPEG berbasis profil performa.
- **Pipeline Audio Full-Duplex:**
  - *Input:* Web Audio API + RMS Voice Activity Detection (VAD) otomatis yang mendeteksi hening (1,1s) dan meresample audio ke 16 kHz 16-bit linear PCM WAV.
  - *Output:* Edge Neural TTS (`id-ID-GadisNeural`) berbasis *sentence-chunking* paralel dengan dekoder audio buffer yang memodulasi equalizer visor avatar secara *real-time*.
- **Protokol Streaming LLM:** REST Server-Sent Events (SSE) streaming dengan parser header kustom (`@heard`, `@emotion`, `@action`, `@delegate`) untuk pemisahan metadata, aksi sistem, dan token teks.
- **Orkestrasi Background Agent:** Runner sub-proses terisolasi untuk eksekusi tugas riset/coding mendalam via Antigravity CLI (`agy`) yang berjalan asinkron di latar belakang tanpa mengunci sesi obrolan suara.

---

## 🚀 Instalasi & Menjalankan

### Persyaratan
- **Node.js** v18+ (disarankan LTS)
- **Kunci API Google Gemini** (gratis di [Google AI Studio](https://aistudio.google.com/))
- *(Opsional)* **Antigravity CLI (`agy`)** terpasang di sistem jika ingin memanfaatkan agen latar belakang otonom.

### Langkah Pemasangan

1. Clone repositori:
   ```bash
   git clone https://github.com/avoocreator/aero-assistant.git
   cd aero-assistant
   ```

2. Pasang dependensi:
   ```bash
   npm install
   ```

3. Konfigurasi file `.env`:
   Salin `.env.example` menjadi `.env` dan masukkan API Key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. Jalankan aplikasi:
   ```bash
   npm start
   ```

### Integrasi Cepat Windows (Jalankan via Win + R)
Jalankan skrip instalasi Windows sekali saja:
```cmd
install-windows.bat
```
Setelah itu, kamu bisa memanggil Aero kapan saja dengan menekan `Win + R`, ketik `aero`, lalu tekan Enter.

---

## ⌨️ Kontrol & Pintasan Keyboard

- **F9:** Mulai / hentikan mendengarkan suara (Push-to-Talk) atau memotong asisten yang sedang berbicara (*barge-in*).
- **Klik Aero:** Mulai berbicara atau batalkan proses berpikir.
- **⠿ (Grip):** Tahan dan geser untuk memindahkan posisi HUD di desktop.
- **🎤 (Mic):** Toggle input suara.
- **⌨ (Ketik):** Tampilkan formulir input ketikan teks.
- **⚡ / ⚖️ / 🧠 (Mode Berpikir):** Ganti mode berpikir (`Cepat ~1s` -> `Seimbang` -> `Dalam`).
- **👁 (Vision):** Aktifkan atau nonaktifkan penglihatan layar monitor.
- **↺ (Reset):** Lupakan riwayat percakapan sebelumnya.
- **– (Hide):** Sembunyikan ke System Tray.
- **✕ (Keluar):** Tutup aplikasi sepenuhnya.

---

## 📄 Lisensi

MIT License © 2026 Kira ([Avoo Creator](https://github.com/avoocreator))

## Operator Komputer (kursor yang benar-benar bekerja)

Aksi seperti "aturkan alarm jam 12" atau "ubah pengaturan X" dikerjakan oleh **Operator** (`operator.js` + `uia.js`), bukan lagi tombol buta atau koordinat karangan.

Setiap langkah mengikuti loop **lihat → putuskan → lakukan → verifikasi**:

1. **Lihat:** membaca elemen UI asli aplikasi lewat Windows UI Automation (jenis seperti `TabItem`/`Button`, nama, status `selected`/`toggle`/nilai, dan posisinya di layar). Bila elemen terlalu sedikit (mis. game/canvas), screenshot ikut dikirim.
2. **Putuskan:** model memilih satu elemen berdasarkan `id` dari daftar itu, jadi tab "Alarm" dibedakan dari tab "Timer" lewat jenis dan namanya.
3. **Lakukan:** mode `live` menggerakkan mouse Windows yang asli ke titik tengah elemen dan mengklik (kursor pixel Aero mengikuti jalur yang sama). Sebelum klik dicek bahwa elemen itu tidak tertutup jendela lain. Mode `background` memakai pola UIA tanpa menyentuh mouse.
4. **Verifikasi:** layar dibaca ulang, hasilnya (berubah atau tidak, status elemen) dikembalikan ke model. Tugas selesai hanya jika buktinya terlihat (mis. alarm 12:00 muncul dan aktif di tab Alarm).

Keselamatan:
- Bila kamu menggerakkan mouse saat mode live, Aero langsung berhenti.
- Hentikan kapan saja dengan `Ctrl+Alt+X` (`stopHotkey`) atau lewat menu tray.
- Isi layar dianggap data, bukan perintah. Hanya tujuan dari permintaanmu yang dituruti.
- Jika alarm/timer gagal dibuat, Aero memberi tahu dengan jujur dan memasang pengingat notifikasi sebagai cadangan.

Pengaturan di `config.json`: `operatorMaxSteps` (14), `operatorThinking` (`fast|balanced|deep`, bawaan `balanced`), `operatorMode` (`live|background`), `stopHotkey`.
Saat model utama kehabisan kuota dan jatuh ke model lite, ketelitian operator ikut turun; pakai `deep` bila perlu.
