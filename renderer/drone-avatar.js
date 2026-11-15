// Drone Avatar: Procedural Sci-Fi Drone Companion di Canvas
// Menghasilkan companion drone mengambang dengan efek neon glow, thruster partikel,
// cincin orbit holografik, dan sensor visor yang reaktif terhadap suara dan status.
const DroneAvatar = (() => {
  const cv = document.getElementById('avatar');
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;

  // Warna Palet Cyber Sci-Fi
  const PALETTE = {
    hullDark: '#12151e',
    hullMid: '#1e2433',
    hullLight: '#2f3b52',
    hullRim: '#4a5b7d',
    glassBase: '#0a0d14',
    accentIdle: '#00e5ff',      // Cyan futuristik
    accentListening: '#00ffa3', // Emerald sinyal
    accentThinking: '#b388ff',  // Violet plasma
    accentSpeaking: '#ff3388',  // Neon magenta audio wave
    accentError: '#ff3366',     // Crimson alert
    flameInner: '#ffffff',
    shadow: 'rgba(0, 0, 0, 0.45)'
  };

  let mood = 'neutral';
  let mouthOpen = 0;       // 0..1 untuk modulasi equalizer visor
  let blink = false;
  let blinkTimer = 0;
  let nextBlink = performance.now() + 2500;
  const look = { x: 0, y: 0 };
  let orbitAngle = 0;

  function setMood(m) {
    mood = m || 'neutral';
  }

  function setMouth(val) {
    mouthOpen = Math.max(0, Math.min(1, val));
  }

  function setLook(x, y) {
    look.x = Math.max(-1, Math.min(1, x));
    look.y = Math.max(-1, Math.min(1, y));
  }

  function getAccentColor(state) {
    switch (state) {
      case 'listening': return PALETTE.accentListening;
      case 'thinking': return PALETTE.accentThinking;
      case 'speaking': return PALETTE.accentSpeaking;
      case 'error': return PALETTE.accentError;
      default: return PALETTE.accentIdle;
    }
  }

  function render(now = performance.now()) {
    const state = document.body.dataset.state || 'idle';
    const accent = getAccentColor(state);

    // Kedipan mata natural
    if (now > nextBlink) {
      blink = true;
      if (now > nextBlink + 140) {
        blink = false;
        nextBlink = now + 2000 + Math.random() * 3000;
      }
    }

    // Fisika mengambang (Hovering Float)
    const hoverSpeed = state === 'speaking' ? 0.007 : state === 'listening' ? 0.004 : 0.003;
    const hoverY = Math.sin(now * hoverSpeed) * 3.5;
    const tilt = Math.cos(now * hoverSpeed * 0.8) * 0.04 + (look.x * 0.06);

    orbitAngle = (orbitAngle + (state === 'thinking' ? 0.08 : 0.02)) % (Math.PI * 2);

    g.clearRect(0, 0, W, H);
    g.save();

    const cx = W / 2;
    const cy = (H / 2) + hoverY - 2;

    // --- 1. Bayangan di Bawah Drone ---
    const shadowScale = 1 - (hoverY / 18);
    g.save();
    g.beginPath();
    g.ellipse(cx, H - 8, 18 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
    g.fillStyle = PALETTE.shadow;
    g.filter = 'blur(3px)';
    g.fill();
    g.filter = 'none';
    g.restore();

    // Transformasi Drone (pusat di cx, cy)
    g.translate(cx, cy);
    g.rotate(tilt);

    // --- 2. Cincin Partikel / Orbit Holografik Belakang ---
    g.save();
    g.scale(1, 0.42);
    g.beginPath();
    g.arc(0, 0, 32, orbitAngle, orbitAngle + Math.PI);
    g.strokeStyle = accent;
    g.lineWidth = 1.6;
    g.setLineDash([4, 6]);
    g.shadowColor = accent;
    g.shadowBlur = 6;
    g.stroke();
    g.restore();

    // --- 3. Thruster Samping Kiri & Kanan ---
    const drawThruster = (tx, ty, isLeft) => {
      g.save();
      g.translate(tx, ty);

      // Api Plasma Gravitasi (Bawah Thruster)
      const flameLen = 6 + Math.random() * 4 + (state === 'thinking' || state === 'speaking' ? 3 : 0);
      const flameGrad = g.createLinearGradient(0, 8, 0, 8 + flameLen);
      flameGrad.addColorStop(0, PALETTE.flameInner);
      flameGrad.addColorStop(0.35, accent);
      flameGrad.addColorStop(1, 'transparent');

      g.beginPath();
      g.moveTo(-3, 8);
      g.lineTo(0, 8 + flameLen);
      g.lineTo(3, 8);
      g.closePath();
      g.fillStyle = flameGrad;
      g.shadowColor = accent;
      g.shadowBlur = 8;
      g.fill();

      // Pod Fisik Thruster
      g.beginPath();
      g.roundRect(-4, -6, 8, 14, 4);
      g.fillStyle = PALETTE.hullMid;
      g.fill();
      g.strokeStyle = PALETTE.hullRim;
      g.lineWidth = 1.2;
      g.stroke();

      // Celah Lampu Thruster
      g.beginPath();
      g.roundRect(-2.5, -1, 5, 2.5, 1);
      g.fillStyle = accent;
      g.shadowColor = accent;
      g.shadowBlur = 4;
      g.fill();

      g.restore();
    };

    drawThruster(-24, 2, true);
    drawThruster(24, 2, false);

    // Sayap Penyambung Thruster ke Bodi
    g.beginPath();
    g.moveTo(-22, 2);
    g.lineTo(22, 2);
    g.strokeStyle = PALETTE.hullLight;
    g.lineWidth = 3.5;
    g.stroke();

    // --- 4. Bodi Utama Drone (Aerodynamic Pod) ---
    // Cangkang Luar
    g.beginPath();
    g.roundRect(-19, -17, 38, 34, [16, 16, 12, 12]);
    const bodyGrad = g.createLinearGradient(-19, -17, 19, 17);
    bodyGrad.addColorStop(0, PALETTE.hullLight);
    bodyGrad.addColorStop(0.4, PALETTE.hullMid);
    bodyGrad.addColorStop(1, PALETTE.hullDark);
    g.fillStyle = bodyGrad;
    g.fill();
    g.strokeStyle = PALETTE.hullRim;
    g.lineWidth = 1.8;
    g.stroke();

    // Antena Komunikasi di Atas
    g.beginPath();
    g.moveTo(0, -17);
    g.lineTo(0, -25);
    g.strokeStyle = PALETTE.hullRim;
    g.lineWidth = 2;
    g.stroke();

    // Ujung Antena (Beacon)
    g.beginPath();
    g.arc(0, -26, 2.5, 0, Math.PI * 2);
    g.fillStyle = state === 'listening' ? PALETTE.accentListening : accent;
    g.shadowColor = accent;
    g.shadowBlur = state === 'listening' ? 10 : 4;
    g.fill();
    g.shadowBlur = 0;

    // Sinyal berdenyut dari antena kalau sedang mendengarkan
    if (state === 'listening') {
      const p = (now % 1000) / 1000;
      g.beginPath();
      g.arc(0, -26, 4 + p * 10, -Math.PI * 0.8, -Math.PI * 0.2);
      g.strokeStyle = `rgba(0, 255, 163, ${1 - p})`;
      g.lineWidth = 1.5;
      g.stroke();
    }

    // --- 5. Visor Kaca Sensor (Layar Hitam Lengkung) ---
    g.beginPath();
    g.roundRect(-14, -8, 28, 18, 7);
    g.fillStyle = PALETTE.glassBase;
    g.fill();
    g.strokeStyle = '#182030';
    g.lineWidth = 1.2;
    g.stroke();

    // Pantulan Kilau Kaca (Specular Highlight)
    g.beginPath();
    g.moveTo(-11, -6);
    g.lineTo(5, -6);
    g.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    g.lineWidth = 1.5;
    g.stroke();

    // --- 6. Mata / Sensor Display Digital di Dalam Visor ---
    const eyeX = look.x * 2.5;
    const eyeY = look.y * 1.5;

    g.save();
    g.translate(eyeX, eyeY);

    if (blink && state !== 'speaking') {
      // Garis kedipan
      g.beginPath();
      g.moveTo(-8, 1);
      g.lineTo(-2, 1);
      g.moveTo(2, 1);
      g.lineTo(8, 1);
      g.strokeStyle = accent;
      g.lineWidth = 1.8;
      g.shadowColor = accent;
      g.shadowBlur = 6;
      g.stroke();
    } else if (state === 'speaking') {
      // Visor Equalizer Audio Waveform Dinamis
      const bars = 5;
      const spacing = 3.6;
      const startX = -((bars - 1) * spacing) / 2;
      g.fillStyle = accent;
      g.shadowColor = accent;
      g.shadowBlur = 8;

      for (let i = 0; i < bars; i++) {
        const offset = Math.abs(i - 2);
        const wave = Math.sin(now * 0.018 + i * 0.9) * 0.5 + 0.5;
        const h = Math.max(2, (wave * 8 + mouthOpen * 7) * (1 - offset * 0.22));
        g.beginPath();
        g.roundRect(startX + i * spacing - 1, 1 - h / 2, 2.2, h, 1);
        g.fill();
      }
    } else if (state === 'thinking') {
      // Visor Radar / Thinking Scan
      const scanPhase = (now % 1200) / 1200;
      g.beginPath();
      g.arc(0, 1, 5, 0, Math.PI * 2);
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.shadowColor = accent;
      g.shadowBlur = 6;
      g.stroke();

      g.beginPath();
      const dotAngle = scanPhase * Math.PI * 2;
      g.arc(Math.cos(dotAngle) * 5, 1 + Math.sin(dotAngle) * 5, 2, 0, Math.PI * 2);
      g.fillStyle = '#ffffff';
      g.fill();
    } else if (mood === 'happy') {
      // Mata Lengkung Bahagia (^_^)
      g.strokeStyle = accent;
      g.lineWidth = 2;
      g.shadowColor = accent;
      g.shadowBlur = 6;

      g.beginPath();
      g.arc(-5, 2, 3.5, Math.PI, 0);
      g.stroke();

      g.beginPath();
      g.arc(5, 2, 3.5, Math.PI, 0);
      g.stroke();
    } else if (mood === 'surprised') {
      // Mata Bulat Terkejut (o_o)
      g.fillStyle = accent;
      g.shadowColor = accent;
      g.shadowBlur = 8;

      g.beginPath();
      g.arc(-5, 1, 3.5, 0, Math.PI * 2);
      g.arc(5, 1, 3.5, 0, Math.PI * 2);
      g.fill();
    } else if (mood === 'sad') {
      // Mata Sedih / Sayu (\_/)
      g.strokeStyle = accent;
      g.lineWidth = 2;
      g.shadowColor = accent;
      g.shadowBlur = 5;

      g.beginPath();
      g.moveTo(-7, 3);
      g.lineTo(-3, 0);
      g.moveTo(7, 3);
      g.lineTo(3, 0);
      g.stroke();
    } else {
      // Mata Digital Normal (Dua Kapsul Glowing)
      g.fillStyle = accent;
      g.shadowColor = accent;
      g.shadowBlur = 7;

      // Mata Kiri
      g.beginPath();
      g.roundRect(-7, -2, 4.5, 6, 2);
      g.fill();

      // Mata Kanan
      g.beginPath();
      g.roundRect(2.5, -2, 4.5, 6, 2);
      g.fill();
    }
    g.restore();

    // --- 7. Cincin Orbit Holografik Depan ---
    g.save();
    g.scale(1, 0.42);
    g.beginPath();
    g.arc(0, 0, 32, orbitAngle + Math.PI, orbitAngle + Math.PI * 2);
    g.strokeStyle = accent;
    g.lineWidth = 1.6;
    g.setLineDash([4, 6]);
    g.shadowColor = accent;
    g.shadowBlur = 8;
    g.stroke();
    g.restore();

    g.restore();

    requestAnimationFrame(render);
  }

  // Mulai loop animasi
  requestAnimationFrame(render);

  return {
    setMood,
    setMouth,
    setLook
  };
})();

window.DroneAvatar = DroneAvatar;
window.Avatar = DroneAvatar;
