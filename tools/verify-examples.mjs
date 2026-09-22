import path from 'node:path';
import { ROOT, readJSON, jsonText } from './lib/files.mjs';
import { buildCard } from './lib/build.mjs';

const { examples } = await readJSON(path.join(ROOT, 'maintenance/public-release.json'));
const results = [];
for (const name of examples) {
  try {
    const report = await buildCard(name);
    results.push({ name, ok: true, output: report.output ?? `dist/${name}/` });
  } catch (error) { results.push({ name, ok: false, error: error.message }); }
}
const ok = results.every(item => item.ok);
process.stdout.write(jsonText({ ok, scope: 'official-examples', runtimeVerified: false, results }));
if (!ok) process.exitCode = 1;
