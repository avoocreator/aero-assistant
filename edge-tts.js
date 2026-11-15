// Edge Neural TTS sintesis audio buffer
let lib = null;
try {
  lib = require('msedge-tts');
} catch {}

function available() {
  return Boolean(lib?.MsEdgeTTS);
}

async function synth(text, voice = 'id-ID-GadisNeural', options = {}) {
  if (!available()) {
    throw new Error('Paket msedge-tts belum terpasang.');
  }
  const { MsEdgeTTS, OUTPUT_FORMAT } = lib;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const rate = options.rate || '+25%';
  const pitch = options.pitch || '+0Hz';
  const volume = options.volume || '+0%';

  const r = tts.toStream(text, { rate, pitch, volume });
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
