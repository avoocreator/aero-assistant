// Modul suara saraf (neural) gratis lewat Microsoft Edge (msedge-tts).
let lib = null;
try {
  lib = require('msedge-tts');
} catch {
  // paket opsional
}

function available() {
  return Boolean(lib?.MsEdgeTTS);
}

/** Mengembalikan Buffer MP3 audio */
async function synth(text, voice = 'id-ID-GadisNeural') {
  if (!available()) {
    throw new Error('Paket msedge-tts belum terpasang.');
  }
  const { MsEdgeTTS, OUTPUT_FORMAT } = lib;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const r = tts.toStream(text);
  const stream = r?.audioStream || r;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { tts.close?.(); } catch {}
      if (err) reject(err);
      else if (!chunks.length) reject(new Error('Audio kosong dari Edge TTS.'));
      else resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => finish(new Error('Edge TTS timeout.')), 15000);
    stream.on('data', d => chunks.push(Buffer.from(d)));
    stream.on('end', () => finish());
    stream.on('close', () => finish());
    stream.on('error', e => finish(e));
  });
}

module.exports = { synth, available };
