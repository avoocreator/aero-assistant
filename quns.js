// Apakah pengguna sedang bisa diajak bicara? Memakai status notifikasi Windows (SHQueryUserNotificationState):
// layar penuh (game/video), mode presentasi, aplikasi sibuk, atau layar terkunci berarti jangan diganggu.
const { execFile } = require('child_process');

const PS = "Add-Type -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int s);' -Name N -Namespace W; $s = 0; [void][W.N]::SHQueryUserNotificationState([ref]$s); $s";
// 1 = tidak ada pengguna/terkunci, 2 = sibuk, 3 = Direct3D layar penuh, 4 = presentasi, 5 = boleh notifikasi, 6 = tenang, 7 = aplikasi UWP layar penuh
const BLOCK = new Set([1, 2, 3, 4, 7]);

let cache = { at: 0, ok: true };

function interruptible(maxAgeMs = 15000) {
  if (process.platform !== 'win32') return Promise.resolve(true);
  if (Date.now() - cache.at < maxAgeMs) return Promise.resolve(cache.ok);
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS], { windowsHide: true, timeout: 6000 }, (err, out) => {
      const n = parseInt(String(out || '').trim(), 10);
      // gagal membaca: anggap boleh (jangan membuat Aero bisu selamanya karena error kecil)
      const ok = err || !Number.isFinite(n) ? true : !BLOCK.has(n);
      cache = { at: Date.now(), ok };
      resolve(ok);
    });
  });
}

module.exports = { interruptible };
