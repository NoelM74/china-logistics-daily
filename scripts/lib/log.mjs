/** Tiny structured logger. Keeps GitHub Actions output readable and greppable. */

const t0 = Date.now();
const stamp = () => `${String((Date.now() - t0) / 1000).padStart(6, ' ')}s`;

export const log = {
  info: (msg, extra) => console.log(`[${stamp()}] ${msg}${fmt(extra)}`),
  warn: (msg, extra) => console.warn(`[${stamp()}] WARN  ${msg}${fmt(extra)}`),
  error: (msg, extra) => console.error(`[${stamp()}] ERROR ${msg}${fmt(extra)}`),
  step: (msg) => console.log(`\n[${stamp()}] ── ${msg} ${'─'.repeat(Math.max(0, 48 - msg.length))}`),
};

function fmt(extra) {
  if (extra === undefined) return '';
  if (typeof extra === 'string') return ` ${extra}`;
  return ` ${Object.entries(extra)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')}`;
}

/** Emits a GitHub Actions job summary line when running in CI. */
export function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  return import('node:fs/promises').then((fs) =>
    fs.appendFile(file, `${lines.join('\n')}\n`, 'utf8').catch(() => {}),
  );
}
