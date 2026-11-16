// Kursor Virtual Pixel-Art Aero: Bergerak melintasi layar ke target, melakukan ripple klik & spark.
(() => {
  const canvas = document.getElementById('cursorCanvas');
  const badge = document.getElementById('actionBadge');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let dpr = window.devicePixelRatio || 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  resize();

  // Bitmap 12x12 Pixel Pointer Drone Aero
  // 0: transparan, 1: outline (#3a1410), 2: emas (#f1bd57), 3: highlight (#fbe88c), 4: visor cyan (#19c8ff)
  const POINTER = [
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 3, 4, 4, 1, 0, 0, 0, 0, 0, 0, 0],
    [1, 3, 4, 4, 2, 1, 0, 0, 0, 0, 0, 0],
    [1, 3, 2, 2, 2, 2, 1, 0, 0, 0, 0, 0],
    [1, 3, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0],
    [1, 2, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 0, 1, 2, 1, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]
  ];

  const PALETTE = {
    1: '#3a1410', // Outline cokelat pekat khas Aero
    2: '#f1bd57', // Emas
    3: '#fbe88c', // Kilau emas terang
    4: '#19c8ff'  // Visor cyan bersinar
  };

  const PIXEL_SCALE = 2; // Setiap pixel grid digambar 2x2px di layar

  // State kursor
  let active = false;
  let cursorX = 0;
  let cursorY = 0;
  let opacity = 0;
  let ripples = [];
  let sparks = [];

  function drawPixelPointer(x, y, scale = PIXEL_SCALE, pressOffset = 0) {
    const px = Math.round(x) + pressOffset;
    const py = Math.round(y) + pressOffset;

    for (let r = 0; r < POINTER.length; r++) {
      for (let c = 0; c < POINTER[r].length; c++) {
        const val = POINTER[r][c];
        if (!val) continue;
        ctx.fillStyle = PALETTE[val];
        ctx.fillRect(px + c * scale, py + r * scale, scale, scale);
      }
    }
  }

  function spawnRipple(cx, cy) {
    ripples.push({ cx: Math.round(cx), cy: Math.round(cy), size: 4, max: 32, alpha: 1 });
  }

  function spawnSparks(cx, cy, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5);
      const spd = 1.5 + Math.random() * 2.5;
      sparks.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1.0,
        color: Math.random() > 0.4 ? '#19c8ff' : '#f1bd57',
        size: Math.random() > 0.5 ? 3 : 2
      });
    }
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  let fadeTimer = null;

  /**
   * Menjalankan animasi kursor virtual Aero
   * @param {Object} opts
   * @param {{x: number, y: number}} opts.from - Titik awal (koordinat drone atau titik sebelumnya)
   * @param {{x: number, y: number}} opts.to - Titik tujuan (koordinat tombol / UI)
   * @param {string} [opts.label] - Teks aksi (misal "Klik: Tambah Alarm")
   * @param {string} [opts.type] - Jenis aksi ('click'|'toggle'|'type')
   */
  async function performAction({ from, to, label = '', type = 'click' }) {
    clearTimeout(fadeTimer);
    active = true;
    opacity = 1;

    // Titik awal: pakai posisi kursor terakhir jika kursor masih di layar, atau dari titik 'from'
    const startX = (cursorX && opacity > 0.3) ? cursorX : (from?.x ?? (window.innerWidth - 80));
    const startY = (cursorY && opacity > 0.3) ? cursorY : (from?.y ?? (window.innerHeight - 80));
    const targetX = to?.x ?? (window.innerWidth / 2);
    const targetY = to?.y ?? (window.innerHeight / 2);

    cursorX = startX;
    cursorY = startY;

    // Fase 1: Kursor meluncur ke target (380 ms)
    const flyDuration = 380;
    const t0 = performance.now();

    await new Promise(res => {
      function fly(now) {
        const p = Math.min(1, (now - t0) / flyDuration);
        const t = easeOutCubic(p);
        cursorX = startX + (targetX - startX) * t;
        cursorY = startY + (targetY - startY) * t;

        if (p < 1) {
          requestAnimationFrame(fly);
        } else {
          res();
        }
      }
      requestAnimationFrame(fly);
    });

    cursorX = targetX;
    cursorY = targetY;

    // Tampilkan label aksi
    if (label && badge) {
      badge.textContent = `✦ Aero: ${label}`;
      badge.style.left = `${Math.round(targetX)}px`;
      badge.style.top = `${Math.round(targetY)}px`;
      badge.style.display = 'block';
    }

    // Fase 2: Tekan / Klik + Ripple gelombang pixel
    spawnRipple(targetX, targetY);
    spawnSparks(targetX, targetY, type === 'click' ? 10 : 6);

    // Tahan sejenak di target agar terlihat jelas aksinya (~320ms)
    await new Promise(r => setTimeout(r, 320));

    // Jadwalkan fade-out jika tidak ada aksi berikutnya yang masuk
    fadeTimer = setTimeout(async () => {
      if (badge) badge.style.display = 'none';

      const fadeDuration = 350;
      const tRet = performance.now();
      const originX = from?.x ?? (window.innerWidth - 80);
      const originY = from?.y ?? (window.innerHeight - 80);

      await new Promise(res => {
        function ret(now) {
          const p = Math.min(1, (now - tRet) / fadeDuration);
          opacity = 1 - p;
          cursorX = targetX + (originX - targetX) * p * 0.3;
          cursorY = targetY + (originY - targetY) * p * 0.3;

          if (p < 1) {
            requestAnimationFrame(ret);
          } else {
            res();
          }
        }
        requestAnimationFrame(ret);
      });

      active = false;
      opacity = 0;
    }, 450);
  }

  // Loop Render Canvas
  function loop() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Gambar ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.size += 1.8;
      r.alpha = Math.max(0, 1 - r.size / r.max);

      ctx.strokeStyle = `rgba(25, 200, 255, ${r.alpha.toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.cx - r.size / 2, r.cy - r.size / 2, r.size, r.size);

      // Ring dalam
      if (r.size > 8) {
        ctx.strokeStyle = `rgba(241, 189, 87, ${(r.alpha * 0.8).toFixed(2)})`;
        ctx.strokeRect(r.cx - (r.size - 6) / 2, r.cy - (r.size - 6) / 2, r.size - 6, r.size - 6);
      }

      if (r.alpha <= 0) ripples.splice(i, 1);
    }

    // Gambar sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.life -= 0.04;

      if (s.life > 0) {
        ctx.fillStyle = s.color;
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
        ctx.globalAlpha = 1;
      } else {
        sparks.splice(i, 1);
      }
    }

    // Gambar pointer jika aktif
    if (active && opacity > 0) {
      ctx.globalAlpha = opacity;
      drawPixelPointer(cursorX, cursorY, PIXEL_SCALE);
      ctx.globalAlpha = 1;
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Sambungkan ke IPC Electron jika ada
  window.assistant?.onCursorAction?.(opts => {
    performAction(opts);
  });

  // Ekspor global untuk pengujian / pemanggilan lokal
  window.AeroCursor = {
    performAction
  };
})();
