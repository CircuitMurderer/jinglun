import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function launchRust(args) {
  const bin = join(homedir(), '.cargo', 'bin');
  const cargo = existsSync(join(bin, 'cargo')) ? join(bin, 'cargo') : 'cargo';
  // Keep fetched crates inside the project; do not change global shell settings.
  const cargoHome = process.env.CARGO_HOME || join(root, '.cache', 'cargo');
  mkdirSync(cargoHome, { recursive: true });
  return spawn(cargo, args, {
    cwd: root,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: { ...process.env, CARGO_HOME: cargoHome, PATH: `${bin}:${process.env.PATH || ''}` },
  });
}

export function stopRust(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || !child.pid) return;
  try {
    // Cargo may have started the server or compiler as a child process.
    // Stop the whole owned process group rather than leaving it behind.
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const child = launchRust(process.argv.slice(2));
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopRust(child, signal));
}
