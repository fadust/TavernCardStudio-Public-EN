import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectEnvironment, formatReport, ROOT } from './setup.mjs';

// Keep this entry independent of installed dependencies so a broken install can be diagnosed.
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--json')) {
  console.error('Usage: node tools/doctor.mjs [--json]'); process.exitCode = 1;
} else {
  try {
    const report = await inspectEnvironment();
    const required = ['AGENTS.md', 'templates/base/card.json', 'tools/card.mjs', 'tools/studio-ui/index.html', 'maintenance/references.lock.json'];
    report.workspace = { missing: [] };
    for (const file of required) try { await fs.access(path.join(ROOT, file)); } catch { report.workspace.missing.push(file); }
    if (report.workspace.missing.length) { report.ok = false; report.problems.push('Missing workspace files: ' + report.workspace.missing.join(', ')); }
    let referenceCache = false;
    try { referenceCache = (await fs.readdir(path.join(ROOT, 'references/upstream'))).length > 0; } catch {}
    report.references = { present: referenceCache, requiredToBuild: false, hint: 'Run pnpm refs restore when runtime reference material is needed.' };
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      for (const line of formatReport(report)) console.log(line);
      for (const line of report.guidance) console.log('[Operation] ' + line);
      if (report.workspace.missing.length) console.log('[ERROR] ' + report.problems.at(-1));
      console.log(referenceCache ? '[REFERENCES] Local cache is present. Verify with pnpm refs check.' : '[REFERENCES] Not downloaded; writing and building cards still works. Run pnpm refs restore when needed.');
      console.log(report.ok ? '[OK] Environment ready.' : '[ERROR] Follow the guidance above. This check did not install dependencies or modify files.');
    }
    if (!report.ok) process.exitCode = 1;
  } catch (error) { console.error('Environment check failed: ' + error.message); process.exitCode = 1; }
}
