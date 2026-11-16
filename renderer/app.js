(async () => {
  const $ = s => document.querySelector(s);
  const stage = $('#stage');
  const stateLabel = $('#stateLabel');
  const tasksEl = $('#tasks');
  const typeForm = $('#typeForm');
  const typeInput = $('#typeInput');
  const btnEye = $('#btnEye');
  const btnThink = $('#btnThink');
  const btnMic = $('#btnMic');
  const btnType = $('#btnType');
  const btnReset = $('#btnReset');
  const btnHide = $('#btnHide');
  const btnQuit = $('#btnQuit');

  const userBub = $('#userBub');
  const aeroBub = $('#aeroBub');
  const userTxt = userBub.querySelector('.txt');
  const aeroTxt = aeroBub.querySelector('.txt');
  const aeroExtra = aeroBub.querySelector('.extra');

  const api = window.assistant || window.nova;
  const cfg = await api.getConfig();

  let state = 'idle';
  let turn = 0;
  let currentAskId = null;
  let stopRecording = null;
  const announcements = [];
  let hideTimer = 0;
  let detailOpen = false;

  const LABELS = {
    idle: '',
    listening: 'Mendengarkan…',
    thinking: 'Berpikir… (klik untuk batal)',
    speaking: '',
    error: 'Terjadi kendala'
  };

  function setState(s) {
    state = s;
    document.body.dataset.state = s;
    stateLabel.textContent = LABELS[s] || '';
    if (s === 'listening') {
      btnMic.classList.add('active');
    } else {
      btnMic.classList.remove('active');
    }
  }

  const neutralSoon = (ms = 0) => setTimeout(() => {
    if (state === 'idle') window.Avatar?.setMood('neutral');
  }, ms);

  // =====================================================================
  //  MANAJEMEN BUBBLE CHAT
  // =====================================================================
  const Bubble = {
    user(text) {
      userTxt.textContent = text;
      userBub.classList.remove('hidden');
    },
    hideUser() {
      userBub.classList.add('hidden');
    },

    _open(err = false) {
      clearTimeout(hideTimer);
      aeroBub.classList.remove('hidden');
      aeroBub.classList.toggle('err', err);
      aeroExtra.replaceChildren();
      detailOpen = false;
    },

    thinking() {
      this._open();
      const d = document.createElement('span');
      d.className = 'pdots';
      for (let i = 0; i < 3; i++) d.appendChild(document.createElement('span'));
      aeroTxt.classList.remove('caret');
      aeroTxt.replaceChildren(d);
    },

    text(t, streaming = false) {
      if (aeroBub.classList.contains('hidden')) this._open();
      aeroTxt.textContent = t;
      aeroTxt.classList.toggle('caret', streaming);
      aeroTxt.scrollTop = aeroTxt.scrollHeight;
    },

    error(t, ms = 9000) {
      this._open(true);
      aeroTxt.classList.remove('caret');
      aeroTxt.textContent = t;
      this.scheduleHide(ms);
    },

    note(t, ms = 4000) {
      this._open();
      aeroTxt.classList.remove('caret');
      aeroTxt.textContent = t;
      this.scheduleHide(ms);
    },

    agent(title, summary, details, ms = 35000) {
      this._open();
      aeroTxt.classList.remove('caret');

      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `✦ Riset Antigravity · ${title}`;

      aeroTxt.replaceChildren(tag, document.createTextNode(summary));

      if (details && details.trim() && details.trim() !== summary.trim()) {
        const d = document.createElement('details');
        const sm = document.createElement('summary');
        sm.textContent = 'Lihat detail riset';
        const body = document.createElement('div');
        body.className = 'detail';
        body.textContent = details;
        d.append(sm, body);
        d.addEventListener('toggle', () => {
          detailOpen = d.open;
          if (d.open) clearTimeout(hideTimer);
        });
        aeroExtra.appendChild(d);
      }
      this.scheduleHide(ms);
    },

    hide() {
      clearTimeout(hideTimer);
      aeroBub.classList.add('hidden');
      userBub.classList.add('hidden');
      detailOpen = false;
    },

    scheduleHide(ms) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!detailOpen) Bubble.hide();
      }, ms);
    }
  };

  aeroBub.addEventListener('click', e => {
    if (!e.target.closest('details')) Bubble.hide();
  });
  userBub.addEventListener('click', () => Bubble.hideUser());

  const addSys = (text, ms) => Bubble.note(text, ms);
  const addError = text => Bubble.error(text);

  // =====================================================================
  //  SUARA KELUAR (Streaming Edge Neural TTS + Sinkronisasi Visor Equalizer)
  // =====================================================================
  const Speaker = (() => {
    let epoch = 0;
    let ctx = null;
    let curSource = null;
    let raf = 0;
    let sysSpeaking = 0;
    let mouthTimer = 0;
    let edgeOk = true;

    const cleanForSpeech = t => t.replace(/[*_`#>~]/g, '').replace(/\s+/g, ' ').trim();

    function voices() { return speechSynthesis.getVoices(); }
    function findVoice() {
      const lang = (cfg.voiceLang || 'id-ID').toLowerCase().replace('_', '-');
      const base = lang.split('-')[0];
      const vs = voices();
      const byName = cfg.voiceName ? vs.find(v => v.name.toLowerCase().includes(cfg.voiceName.toLowerCase())) : null;
      return byName
        || vs.find(v => v.lang.toLowerCase().replace('_', '-') === lang)
        || vs.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(base))
        || null;
    }
    speechSynthesis.addEventListener?.('voiceschanged', () => {});

    function mouthStart() {
      clearInterval(mouthTimer);
      mouthTimer = setInterval(() => window.Avatar?.setMouth(0.2 + Math.random() * 0.7), 100);
    }
    function mouthStop() {
      clearInterval(mouthTimer);
      window.Avatar?.setMouth(0);
    }

    // Fallback: Suara bawaan sistem operasi (SpeechSynthesis)
    function utter(text) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = cfg.voiceLang || 'id-ID';
      const v = findVoice();
      if (v) u.voice = v;
      u.rate = 1.05;
      u.pitch = 1.08;
      const done = new Promise(res => {
        u.onstart = () => { if (sysSpeaking++ === 0) mouthStart(); };
        u.onend = u.onerror = () => { if (--sysSpeaking <= 0) { sysSpeaking = 0; mouthStop(); } res(); };
      });
      speechSynthesis.speak(u);
      return done;
    }

    // Suara utama: Edge Neural TTS (Indonesia Gadis/Ardi) via AudioContext
    const b64ToBytes = b64 => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    };

    async function fetchEdgeAudio(text) {
      ctx ??= new AudioContext();
      const r = await api.ttsEdge(text);
      if (!r.ok) throw new Error(r.error);
      const bytes = b64ToBytes(r.audioB64);
      return ctx.decodeAudioData(bytes.buffer);
    }

    async function playBuffer(buf) {
      await ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      const td = new Uint8Array(an.fftSize);
      src.connect(an);
      an.connect(ctx.destination);
      curSource = src;

      return new Promise(res => {
        const tick = () => {
          an.getByteTimeDomainData(td);
          let sum = 0;
          for (const v of td) {
            const x = (v - 128) / 128;
            sum += x * x;
          }
          const rms = Math.sqrt(sum / td.length);
          window.Avatar?.setMouth(Math.min(1, rms * 4.5));
          raf = requestAnimationFrame(tick);
        };

        src.onended = () => {
          cancelAnimationFrame(raf);
          window.Avatar?.setMouth(0);
          if (curSource === src) curSource = null;
          res();
        };

        src.start();
        tick();
      });
    }

    function hardStop() {
      speechSynthesis.cancel();
      sysSpeaking = 0;
      mouthStop();
      try { curSource?.stop(); } catch {}
      curSource = null;
      cancelAnimationFrame(raf);
      window.Avatar?.setMouth(0);
    }

    function stop() {
      epoch++;
      hardStop();
    }

    function start() {
      const my = ++epoch;
      hardStop();
      let pending = '';
      let firstDone = false;
      let chain = Promise.resolve();

      const enqueue = raw => {
        const text = cleanForSpeech(raw);
        if (!text) return;
        firstDone = true;

        if (edgeOk) {
          const prefetch = fetchEdgeAudio(text);
          prefetch.catch(() => {});
          chain = chain.then(async () => {
            if (my !== epoch) return;
            try {
              await playBuffer(await prefetch);
            } catch (e) {
              console.warn('Edge TTS playback gagal, fallback sistem:', e.message);
              edgeOk = false;
              if (my === epoch) await utter(text);
            }
          });
        } else {
          const p = utter(text);
          chain = chain.then(() => p);
        }
      };

      const lastBoundary = s => {
        let end = -1, m;
        const re = /[.!?…]+["')\]]?(?=\s)|\n/g;
        while ((m = re.exec(s))) end = m.index + m[0].length;
        return end;
      };

      return {
        push(delta) {
          if (my !== epoch) return;
          pending += delta;

          let end = lastBoundary(pending);
          if (end <= 0 && !firstDone && pending.length >= 15 && /[.!?…]["')\]]?$/.test(pending)) {
            end = pending.length;
          }
          if (end > 0) {
            enqueue(pending.slice(0, end));
            pending = pending.slice(end);
            return;
          }
          if (!firstDone && pending.length >= 45) {
            const cut = Math.max(pending.lastIndexOf(','), pending.lastIndexOf(' '));
            if (cut >= 25) {
              enqueue(pending.slice(0, cut + 1));
              pending = pending.slice(cut + 1);
            }
          }
        },

        async end() {
          if (my === epoch && pending.trim()) {
            enqueue(pending);
          }
          pending = '';
          await chain;
        },

        stop
      };
    }

    return { start, stop };
  })();

  // =====================================================================
  //  SUARA MASUK (Web Audio RMS VAD -> WAV 16 kHz)
  // =====================================================================
  async function recordUtterance(onReady) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);

    // Ring buffer untuk pre-roll (~250ms) agar konsonan awal tidak hilang
    const preRoll = [];
    const maxPreRollChunks = 3;
    const speechChunks = [];

    let heardSpeech = false;
    let readyNotified = false;
    const t0 = performance.now();
    let lastVoice = t0;
    const THRESH = 0.014;

    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stopRecording = null;
        proc.disconnect();
        source.disconnect();
        stream.getTracks().forEach(t => t.stop());
        const rate = ctx.sampleRate;
        ctx.close();
        resolve(heardSpeech && speechChunks.length > 0 ? { samples: merge(speechChunks), rate } : null);
      };

      stopRecording = finish;

      proc.onaudioprocess = e => {
        if (!readyNotified) {
          readyNotified = true;
          onReady?.();
        }

        const data = e.inputBuffer.getChannelData(0);
        const copy = new Float32Array(data);

        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);

        const now = performance.now();
        if (rms > THRESH) {
          if (!heardSpeech) {
            heardSpeech = true;
            for (const c of preRoll) speechChunks.push(c);
            preRoll.length = 0;
          }
          speechChunks.push(copy);
          lastVoice = now;
        } else if (heardSpeech) {
          speechChunks.push(copy);
        } else {
          preRoll.push(copy);
          if (preRoll.length > maxPreRollChunks) preRoll.shift();
        }

        const silenceLimit = cfg.silenceMs || 1000;
        if (heardSpeech && now - lastVoice > silenceLimit) {
          finish();
        } else if (!heardSpeech && now - t0 > 8000) {
          finish();
        } else if (now - t0 > 30000) {
          finish();
        }
      };
    });
  }

  function merge(chunks) {
    const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  function toWav16k(samples, rate) {
    const target = 16000;
    let pcm = samples;
    if (rate !== target) {
      const ratio = rate / target;
      const n = Math.floor(samples.length / ratio);
      pcm = new Float32Array(n);
      const win = Math.max(1, Math.round(ratio));
      for (let i = 0; i < n; i++) {
        const center = Math.floor(i * ratio);
        let sum = 0, count = 0;
        const start = Math.max(0, center - Math.floor(win / 2));
        const end = Math.min(samples.length, start + win);
        for (let j = start; j < end; j++) {
          sum += samples[j];
          count++;
        }
        pcm[i] = count > 0 ? sum / count : samples[center];
      }
    }

    // Normalisasi digital: angkat suara lemah mendekati batas dinamis 16-bit
    let maxPeak = 0;
    for (let i = 0; i < pcm.length; i++) {
      const abs = Math.abs(pcm[i]);
      if (abs > maxPeak) maxPeak = abs;
    }
    const gain = maxPeak > 0.02 ? Math.min(8.0, 0.88 / maxPeak) : 1.0;

    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, target, true); v.setUint32(28, target * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);

    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i] * gain));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  // =====================================================================
  //  ALUR UTAMA (RESPON & STREAMING)
  // =====================================================================
  function abortCurrent() {
    turn++;
    Speaker.stop();
    if (currentAskId) {
      api.cancelAsk(currentAskId);
      currentAskId = null;
    }
    if (aeroTxt.querySelector('.pdots')) Bubble.hide();
    aeroTxt.classList.remove('caret');
  }

  function backToIdle() {
    setState('idle');
    window.Avatar?.setMood('neutral');
    flushAnnouncements();
  }

  async function respondTo({ text, audio }) {
    const myTurn = ++turn;
    setState('thinking');
    window.Avatar?.setMood('thinking');

    if (text) Bubble.user(text);
    else Bubble.hideUser();
    Bubble.thinking();

    let acc = '';
    let session = null;
    const askId = crypto.randomUUID?.() || String(Date.now() + Math.random());
    currentAskId = askId;

    const watchdog = setTimeout(() => api.cancelAsk(askId), 90000);

    const res = await api.askStream(askId, {
      text,
      audioB64: audio ? toBase64(audio) : undefined,
      audioMime: audio ? 'audio/wav' : undefined
    }, ev => {
      if (myTurn !== turn) return;

      if (ev.kind === 'meta') {
        if (ev.emotion) window.Avatar?.setMood(ev.emotion);
        if (ev.heard && !text) {
          Bubble.user(ev.heard);
        }
      } else if (ev.kind === 'delta') {
        if (!session) {
          session = Speaker.start();
          setState('speaking');
        }
        acc += ev.text;
        Bubble.text(acc, true);
        session.push(ev.text);
      }
    });

    clearTimeout(watchdog);
    if (myTurn !== turn) return;
    currentAskId = null;

    if (!res.ok) {
      session?.stop();
      if (res.canceled) {
        backToIdle();
        Bubble.note('Dibatalkan.', 2000);
        return;
      }
      setState('error');
      window.Avatar?.setMood('sad');
      Bubble.error(res.error || 'Terjadi kesalahan sistem.');
      setTimeout(() => {
        if (state === 'error' && myTurn === turn) backToIdle();
      }, 4000);
      return;
    }

    if (!session) {
      Bubble.hide();
      backToIdle();
      return;
    }

    Bubble.text(acc, false);
    await session.end();
    if (myTurn !== turn) return;

    Bubble.scheduleHide(6000 + acc.length * 45);
    backToIdle();
  }

  async function startListening() {
    abortCurrent();
    Bubble.hide();
    window.Avatar?.setMood('surprised');

    let rec;
    try {
      rec = await recordUtterance(() => {
        setState('listening');
        setTimeout(() => { if (state === 'listening') window.Avatar?.setMood('neutral'); }, 350);
      });
    } catch (err) {
      console.warn('Gagal akses mic:', err);
      setState('error');
      window.Avatar?.setMood('sad');
      addError('Mikrofon tidak dapat diakses. Cek izin mikrofon Windows.');
      setTimeout(() => { if (state === 'error') backToIdle(); }, 3000);
      return;
    }

    if (state !== 'listening') return;
    if (!rec) {
      backToIdle();
      addSys('Suara tidak terdengar. Coba klik lagi ya.', 3500);
      return;
    }

    await respondTo({ audio: toWav16k(rec.samples, rec.rate) });
  }

  function toggleListening() {
    if (state === 'listening') {
      stopRecording?.();
      return;
    }
    if (state === 'thinking') {
      abortCurrent();
      backToIdle();
      addSys('Dibatalkan.', 2500);
      return;
    }
    // Jika sedang speaking, langsung dipotong (barge-in)
    startListening();
  }

  // =====================================================================
  //  AGEN LATAR BELAKANG (CHIPS & NOTIFIKASI)
  // =====================================================================
  const chips = new Map();

  function addChip(id, title) {
    const c = document.createElement('button');
    c.className = 'chip interactive';
    c.title = 'Klik untuk batalkan tugas';

    const sp = document.createElement('span');
    sp.className = 'spin';

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = `Riset: ${title}`;

    c.append(sp, t);
    c.addEventListener('click', () => api.cancelAgent(id));
    tasksEl.appendChild(c);
    chips.set(id, c);
  }

  function dropChip(id) {
    chips.get(id)?.remove();
    chips.delete(id);
  }

  async function announce(summary) {
    const myTurn = ++turn;
    setState('speaking');
    window.Avatar?.setMood('happy');
    const s = Speaker.start();
    s.push(summary + ' ');
    await s.end();
    if (myTurn === turn) backToIdle();
  }

  function flushAnnouncements() {
    if (state !== 'idle' || !announcements.length) return;
    announce(announcements.shift());
  }

  api.onAgentEvent(ev => {
    if (ev.type === 'started') {
      addChip(ev.id, ev.title);
      return;
    }
    dropChip(ev.id);

    if (ev.type === 'done') {
      Bubble.agent(ev.title, ev.summary, ev.details);
      announcements.push(`Hasil riset untuk ${ev.title} sudah selesai. ${ev.summary}`);
      flushAnnouncements();
    } else if (ev.type === 'error') {
      Bubble.error(`Riset Antigravity gagal: ${ev.error}`);
    } else if (ev.type === 'canceled') {
      addSys('Riset dibatalkan.', 3000);
    }
  });

  let hintTimer = null;
  const hint = text => {
    stateLabel.textContent = String(text).slice(0, 40);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { stateLabel.textContent = LABELS[state] || ''; }, 3500);
  };
  api.onActionEvent(ev => {
    if (ev.progress) return hint(ev.progress);
    if (!ev.ok) Bubble.error(`Gagal menjalankan aksi: ${ev.error}`, 12000);
    else if (ev.label) Bubble.note(ev.label, 7000);
  });

  // =====================================================================
  //  KONTROL TOOLBAR & INTERAKSI
  // =====================================================================
  stage.addEventListener('click', toggleListening);
  btnMic.addEventListener('click', toggleListening);
  api.onHotkey(toggleListening);

  btnType.addEventListener('click', () => {
    typeForm.classList.toggle('hidden');
    if (!typeForm.classList.contains('hidden')) {
      typeInput.focus();
    }
  });

  typeForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = typeInput.value.trim();
    if (!text) return;
    typeInput.value = '';
    abortCurrent();
    respondTo({ text });
  });

  typeInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') typeForm.classList.add('hidden');
  });

  const THINK_HINT = {
    fast: 'Cepat: respon kilat (~1s), cocok untuk obrolan langsung',
    balanced: 'Seimbang: analisa lebih teliti dengan kecepatan seimbang',
    deep: 'Dalam: analisa menyeluruh untuk tugas kompleks'
  };
  const THINK_LABEL = { fast: 'Cepat', balanced: 'Seimbang', deep: 'Dalam' };

  function renderThink(m, announceMode = false) {
    btnThink.title = `Mode Berpikir: ${THINK_HINT[m]} (klik untuk ganti)`;
    btnThink.dataset.mode = m;
    if (announceMode) {
      Bubble.note(`Mode Berpikir: ${THINK_LABEL[m]}. ${THINK_HINT[m].split(': ')[1]}.`, 3500);
    }
  }

  renderThink(cfg.thinkMode || 'fast');
  btnThink.addEventListener('click', async () => renderThink(await api.cycleThink(), true));
  api.onThinkChanged(v => renderThink(v.mode, true));

  function renderVision(on) {
    btnEye.setAttribute('aria-pressed', String(on));
    btnEye.title = on
      ? 'Aero boleh melihat layar monitor (klik untuk matikan)'
      : 'Aero TIDAK melihat layar monitor (klik untuk nyalakan)';
  }

  renderVision(cfg.seeScreen);
  btnEye.addEventListener('click', async () => {
    const nextVal = btnEye.getAttribute('aria-pressed') !== 'true';
    renderVision(await api.setVision(nextVal));
  });
  api.onVisionChanged(renderVision);

  btnReset.addEventListener('click', async () => {
    await api.clearHistory();
    Bubble.note('Riwayat percakapan telah dibersihkan.', 3000);
  });
  api.onClearHistory(() => Bubble.note('Riwayat percakapan telah dibersihkan.', 3000));

  btnHide.addEventListener('click', () => api.hide());
  btnQuit.addEventListener('click', () => api.quit());

  // Mouse Passthrough (Area transparan tembus klik ke window di bawahnya)
  let ignoring = null;
  const setIgnore = v => {
    if (ignoring !== v) {
      ignoring = v;
      api.setIgnoreMouse(v);
    }
  };

  window.addEventListener('mousemove', e => {
    setIgnore(!e.target.closest('.interactive, .bub, .chip'));

    // Gaze / Look tracking untuk avatar Aero
    if (window.Avatar?.setLook) {
      const rect = stage.getBoundingClientRect();
      const avatarCenterX = rect.left + rect.width / 2;
      const avatarCenterY = rect.top + rect.height / 2;
      const dx = (e.clientX - avatarCenterX) / 100;
      const dy = (e.clientY - avatarCenterY) / 100;
      window.Avatar.setLook(dx, dy);
    }
  });

  document.addEventListener('mouseleave', () => {
    setIgnore(true);
    window.Avatar?.setLook?.(0, 0);
  });
  setIgnore(true);

  // =====================================================================
  //  SAPAAN AWAL
  // =====================================================================
  if (!cfg.hasKey) {
    setState('error');
    window.Avatar?.setMood('sad');
    addError('Kunci API belum ditemukan. Pastikan GEMINI_API_KEY ada di .env.');
  } else {
    window.Avatar?.setMood('happy');
    Bubble.note(`Halo Kira! Aku ${cfg.assistantName}. Tekan ${cfg.hotkey} atau klik aku untuk bicara.`, 6000);
    neutralSoon(2500);
  }
})();
