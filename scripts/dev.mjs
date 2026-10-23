import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { launchRust, stopRust, root } from './rust.mjs';

const backend = launchRust(['run', '--release', '-p', 'jinglun-server']);
let frontend;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  stopRust(backend);
  if (frontend?.exitCode === null) frontend.kill('SIGTERM');
}
function watch(child) {
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
}
watch(backend);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());

// Do not expose a front page that immediately fails while Rust is compiling.
// This is dev orchestration only; world computation remains entirely in Rust.
console.log('等待 Rust 后端就绪，随后启动页面…');
while (!stopping) {
  try {
    const response = await fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(1000) });
    if (response.ok) break;
  } catch { /* A first build can take longer; backend exit is handled above. */ }
  await setTimeout(250);
}
if (!stopping) {
  frontend = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--config', 'frontend/vite.config.ts'], {
    cwd: root, stdio: 'inherit', env: process.env,
  });
  watch(frontend);
}
