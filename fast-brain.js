// Modul Fast Brain: Respons percakapan instan (<1 detik) via Gemini Flash Lite SSE.
// Digunakan sebagai Tier 1 (Default) untuk percakapan santai, tanya jawab cepat,
// dan transkripsi audio tanpa overhead booting CLI.
const fs = require('fs');
const path = require('path');

class FastBrain {
  constructor(apiKey) {
    this.apiKey = apiKey || this.findApiKey();
    this.history = [];
    this.maxTurns = 8;
  }

  findApiKey() {
    const candidatePaths = [
      path.join(__dirname, '.env'),
      path.join(__dirname, '..', 'nova-assistant', '.env')
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const txt = fs.readFileSync(p, 'utf8');
          for (const line of txt.split(/\r?\n/)) {
            const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.*?)\s*$/i);
            if (m) {
              const val = m[1].replace(/^["']|["']$/g, '').trim();
              if (val) return val;
            }
          }
        } catch {}
      }
    }
    return process.env.GEMINI_API_KEY || '';
  }

  hasKey() {
    return Boolean(this.apiKey);
  }

  clearHistory() {
    this.history = [];
  }

  /** Transkripsi audio WAV/MP3 cepat (1-2 detik) */
  async transcribeAudio(audioBuffer, mimeType = 'audio/wav') {
    if (!this.hasKey()) {
      throw new Error('GEMINI_API_KEY tidak ditemukan untuk transkripsi audio.');
    }

    const b64 = Buffer.isBuffer(audioBuffer)
      ? audioBuffer.toString('base64')
      : Buffer.from(audioBuffer).toString('base64');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Transkripsikan persis apa yang diucapkan dalam audio ini dalam teks biasa tanpa tanda petik, tanpa awalan/akhiran, dan tanpa penjelasan. Jika audio kosong atau hanya suara hening, tulis persis: [kosong]' },
            { inlineData: { mimeType, data: b64 } }
          ]
        }]
      }),
      signal: AbortSignal.timeout(10000)
    });

    const json = await res.json();
    const transcript = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (transcript === '[kosong]' || !transcript) return '';
    return transcript;
  }

  /** Alur percakapan streaming instan (<1 detik time to first token) */
  async askStream(prompt, onDelta, signal) {
    if (!this.hasKey()) {
      throw new Error('GEMINI_API_KEY tidak ditemukan.');
    }

    // Bangun payload percakapan
    this.history.push({ role: 'user', parts: [{ text: prompt }] });
    if (this.history.length > this.maxTurns * 2) {
      this.history = this.history.slice(-this.maxTurns * 2);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: [
              'Kamu adalah Aero, asisten desktop pintar, santai, dan cerdas milik Kira (Avoo Creator).',
              'ATURAN BALASAN LISAN:',
              '- Balas dalam Bahasa Indonesia yang alami, ringkas (1-3 kalimat) karena jawabanmu akan LANGSUNG DIUCAPKAN lewat suara (TTS).',
              '- Jangan gunakan markdown tabel, tanda bintang, atau blok kode kecuali diminta khusus.',
              '- Langsung ke inti, ramah seperti teman yang jago ngoding, tanpa basa-basi klise seperti "Tentu saja!", "Halo!".',
              '- Untuk instruksi tugas berat (membaca file, terminal, git, coding proyek), beri tahu Kira bahwa kamu siap mengerjakannya lewat mode task Antigravity.'
            ].join('\n')
          }]
        },
        contents: this.history
      }),
      signal
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop(); // Sisa baris yang belum utuh

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));
            const delta = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (delta) {
              fullResponse += delta;
              onDelta(delta);
            }
          } catch {}
        }
      }
    }

    if (fullResponse) {
      this.history.push({ role: 'model', parts: [{ text: fullResponse }] });
    }

    return fullResponse;
  }
}

module.exports = { FastBrain };
