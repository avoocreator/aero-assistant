const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class AgentBridge {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this.loadConfig();
    this.activeChild = null;
    this.timeoutTimer = null;
  }

  loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch {
      return {};
    }
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.error('Gagal menyimpan config.json:', e.message);
    }
  }

  getConversationId() {
    return this.config.conversationId || '';
  }

  setConversationId(id) {
    if (this.config.conversationId !== id) {
      this.config.conversationId = id;
      this.saveConfig();
    }
  }

  clearSession() {
    this.config.conversationId = '';
    this.saveConfig();
    return true;
  }

  cancel() {
    if (this.activeChild) {
      try {
        this.activeChild.kill('SIGTERM');
      } catch {}
      this.activeChild = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  askStream(prompt, onEvent) {
    return new Promise((resolve) => {
      this.cancel(); // Pastikan proses sebelumnya berhenti

      const cmd = this.config.agentCommand || 'agy';
      const extraArgs = this.config.agentArgs || ['--dangerously-skip-permissions'];
      const timeoutMs = (this.config.agentTimeoutSec || 180) * 1000;

      const args = ['-p', prompt, '--output-format', 'stream-json', ...extraArgs];
      const convId = this.getConversationId();
      if (convId) {
        args.push('--conversation', convId);
      }

      let stdoutBuf = '';
      let stderrBuf = '';
      let fullResponse = '';
      let finished = false;

      const finish = (result) => {
        if (finished) return;
        finished = true;
        if (this.timeoutTimer) {
          clearTimeout(this.timeoutTimer);
          this.timeoutTimer = null;
        }
        this.activeChild = null;
        resolve(result);
      };

      this.timeoutTimer = setTimeout(() => {
        this.cancel();
        finish({ ok: false, error: 'Waktu tunggu habis (timeout).' });
      }, timeoutMs);

      let child;
      try {
        child = spawn(cmd, args, {
          cwd: path.dirname(this.configPath),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false
        });
      } catch (err) {
        return finish({ ok: false, error: `Gagal menjalankan ${cmd}: ${err.message}` });
      }

      this.activeChild = child;

      const processLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) return;

        try {
          const ev = JSON.parse(trimmed);
          if (ev.event === 'init') {
            const newId = ev.conversation_id || ev.init?.conversation_id;
            if (newId) {
              this.setConversationId(newId);
              onEvent({ kind: 'init', conversationId: newId });
            }
          } else if (ev.event === 'step_update') {
            const step = ev.step_update || {};
            if (step.text_delta) {
              fullResponse += step.text_delta;
              onEvent({ kind: 'delta', text: step.text_delta });
            }
            if (step.step_type === 'tool_call') {
              onEvent({ kind: 'tool', name: step.tool_name || 'Menjalankan alat' });
            }
          } else if (ev.event === 'result') {
            const res = ev.result || {};
            if (res.conversation_id) {
              this.setConversationId(res.conversation_id);
            }
            if (res.status === 'SUCCESS') {
              onEvent({ kind: 'done', text: res.response || fullResponse });
              finish({ ok: true, text: res.response || fullResponse });
            } else {
              finish({ ok: false, error: res.error || 'Terjadi kesalahan sistem.' });
            }
          }
        } catch {}
      };

      child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString('utf8');
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop(); // Sisa potongan yang belum lengkap
        for (const line of lines) {
          processLine(line);
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString('utf8');
      });

      child.on('close', (code) => {
        if (stdoutBuf.trim()) {
          processLine(stdoutBuf);
        }

        if (finished) return;

        // Cek jika sesi kedaluwarsa atau percakapan hilang
        if (stderrBuf.includes('conversation not found') || stderrBuf.includes('unknown conversation')) {
          this.clearSession(); // Reset dan beritahu
          return finish({
            ok: false,
            error: 'Sesi sebelumnya kedaluwarsa. ID sesi telah direset, coba lagi.'
          });
        }

        if (code === 0 && fullResponse) {
          finish({ ok: true, text: fullResponse });
        } else {
          finish({
            ok: false,
            error: stderrBuf.trim() || `Proses selesai dengan kode keluar ${code}.`
          });
        }
      });

      child.on('error', (err) => {
        finish({ ok: false, error: err.message });
      });
    });
  }
}

module.exports = { AgentBridge };
