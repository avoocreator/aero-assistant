// Agen latar belakang: menjalankan Antigravity CLI (agy) dalam mode headless untuk riset baca-saja.
const { spawn } = require('child_process');
const fs = require('fs');

function buildPrompt(task) {
  return [
    'Kamu adalah agen riset otonom untuk asisten desktop bernama Aero. Kerjakan tugas berikut HANYA dengan mencari dan membaca informasi di web/komputer.',
    'JANGAN membuat, mengubah, memindahkan, atau menghapus file sistem tanpa izin.',
    `TUGAS: ${task}`,
    'FORMAT JAWABAN (Bahasa Indonesia):',
    '1) Baris pertama: ringkasan lisan maksimal 2 kalimat pendek, tanpa markdown, tanpa daftar, tanpa link.',
    '2) Lalu satu baris persis tiga tanda minus: ---',
    '3) Lalu detail lengkap yang rapi, sertakan judul dan URL sumber bila ada.'
  ].join(' ').replace(/\s+/g, ' ');
}

/** Pisahkan jawaban agen menjadi ringkasan lisan dan detail */
function splitResult(text) {
  const t = String(text || '').trim();
  const m = /\n?\s*-{3,}\s*\n?/.exec(t);
  if (m) {
    const summary = t.slice(0, m.index).trim();
    const details = t.slice(m.index + m[0].length).trim();
    if (summary) return { summary, details: details || t };
  }
  const first = t.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return { summary: first.length > 320 ? first.slice(0, 317) + '…' : first, details: t };
}

function parseOutput(stdout) {
  const raw = stdout.trim();
  if (!raw) return { error: 'empty' };
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') {
      const status = String(j.status || '').toUpperCase();
      if (status && status !== 'SUCCESS' && status !== 'COMPLETED' && status !== 'OK' && status !== 'DONE' && j.error) {
        return { error: typeof j.error === 'string' ? j.error : JSON.stringify(j.error) };
      }
      if (j.error && !j.response) return { error: typeof j.error === 'string' ? j.error : JSON.stringify(j.error) };
      if (typeof j.response === 'string') return { text: j.response };
    }
  } catch {}
  return { text: raw };
}

class AgentManager {
  constructor({ command = 'agy', extraArgs = [], cwd, timeoutMs = 240000, maxTasks = 3, onEvent }) {
    this.command = command;
    this.extraArgs = extraArgs || [];
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.maxTasks = maxTasks;
    this.onEvent = onEvent;
    this.tasks = new Map();
    this.seq = 0;
    fs.mkdirSync(cwd, { recursive: true });
  }

  start(task) {
    const title = task.length > 48 ? task.slice(0, 45) + '…' : task;
    const id = `t${++this.seq}`;
    if (this.tasks.size >= this.maxTasks) {
      this.onEvent({ type: 'error', id, title, error: `Masih ada ${this.tasks.size} tugas berjalan. Tunggu salah satu selesai.` });
      return null;
    }
    const entry = { id, title, child: null, canceled: false, timer: null };
    this.tasks.set(id, entry);
    this.onEvent({ type: 'started', id, title });
    this._run(entry, task);
    return id;
  }

  _run(entry, task) {
    const prompt = buildPrompt(task);
    const args = ['-p', prompt, '--output-format', 'json', ...this.extraArgs];
    let stdout = '', stderr = '', finished = false;

    const finish = (ev) => {
      if (finished) return;
      finished = true;
      clearTimeout(entry.timer);
      this.tasks.delete(entry.id);
      this.onEvent({ id: entry.id, title: entry.title, ...ev });
    };

    let child;
    try {
      child = spawn(this.command, args, {
        cwd: this.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      });
    } catch (e) {
      return finish({ type: 'error', error: `Gagal menjalankan ${this.command}: ${e.message}` });
    }

    entry.child = child;

    entry.timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ type: 'error', error: `Pencarian terlalu lama (melebihi ${Math.round(this.timeoutMs / 1000)} detik), kuhentikan.` });
    }, this.timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString('utf8'); });
    child.stderr.on('data', d => { stderr += d.toString('utf8'); });

    child.on('close', code => {
      if (entry.canceled) return finish({ type: 'canceled' });
      const parsed = parseOutput(stdout);
      if (parsed.error && !parsed.text) {
        return finish({ type: 'error', error: parsed.error });
      }
      const rawText = parsed.text || stdout.trim();
      if (!rawText && code !== 0) {
        return finish({ type: 'error', error: stderr.trim() || `Proses keluar dengan kode ${code}.` });
      }
      const { summary, details } = splitResult(rawText);
      finish({ type: 'done', summary, details });
    });

    child.on('error', e => finish({ type: 'error', error: e.message }));
  }

  cancel(id) {
    const entry = this.tasks.get(id);
    if (!entry) return false;
    entry.canceled = true;
    try { entry.child?.kill(); } catch {}
    return true;
  }

  cancelAll() {
    for (const [id] of this.tasks) {
      this.cancel(id);
    }
  }
}

module.exports = { AgentManager, buildPrompt, splitResult };
