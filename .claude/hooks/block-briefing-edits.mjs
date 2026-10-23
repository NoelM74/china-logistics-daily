// PreToolUse hook: refuse hand edits to the daily briefings.
//
// src/content/briefings/*.json is written by the pipeline and has already
// passed the publish gate (scripts/lib/validate.mjs). A hand edit skips that
// gate. To change a briefing, regenerate it:
//   gh workflow run "Daily briefing" -f date=YYYY-MM-DD -f force=true
// Deliberate fix by a human: start Claude Code with ALLOW_BRIEFING_EDIT=1.
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let file = '';
  try {
    file = JSON.parse(raw).tool_input?.file_path ?? '';
  } catch {
    process.exit(0); // not our input, never block on a parse error
  }
  const hit = /(^|\/)src\/content\/briefings\/[^/]+\.json$/.test(file.replace(/\\/g, '/'));
  if (!hit || process.env.ALLOW_BRIEFING_EDIT === '1') process.exit(0);

  console.error(
    `Blocked: ${file} is written by the daily pipeline and checked by the publish gate. ` +
      'Do not hand-edit it. Regenerate it: gh workflow run "Daily briefing" -f date=YYYY-MM-DD -f force=true. ' +
      'If the user really wants a manual fix, they must restart Claude Code with ALLOW_BRIEFING_EDIT=1.',
  );
  process.exit(2); // exit 2 = block the tool call and show stderr to Claude
});
