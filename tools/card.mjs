import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readJSON, safeFile } from './lib/files.mjs';
import { newCard, MODULES } from './lib/templates.mjs';
import { splitCard, loadProject, listProjects, semanticDiff, migrateProject } from './lib/project.mjs';
import { checkProject } from './lib/validation.mjs';
import { buildCard } from './lib/build.mjs';
import { organizeWorldbook } from './lib/organize.mjs';
import { arrangeWorldbook } from './lib/arrange.mjs';
import { worldbookInventory } from './lib/worldbook-inventory.mjs';

export async function main(args = process.argv.slice(2), root = ROOT) {
  const [command, target, ...rest] = args;
  if (!command || ['help', '--help', '-h'].includes(command)) {
    return { usage: ['pnpm card new <name> [--modules worldbook,regex,script,mvu,html,vue]', 'pnpm card split <PNG-or-JSON-file> [--name name]', 'pnpm card organize <name|all>', 'pnpm card arrange <name|all> [--order prompt|index]', 'pnpm card migrate <name|all>', 'pnpm card map <name|all>', 'pnpm card check <name|all>', 'pnpm card build <name|all>', 'pnpm card diff <name|all>'], defaults: 'New and split projects use English YAML authoring keys. Without --modules, new creates a text-only card. Use character fields or a worldbook for your setting; the scaffold does not invent character content. Choose either html or vue for the initial interface.', modules: MODULES };
  }
  if (!target) throw new Error('Missing card name or input file. Run pnpm card help for usage.');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--modules', '--name', '--order'].includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${rest[i]}`);
    if (options[rest[i]] !== undefined) throw new Error(`Duplicate option: ${rest[i]}`);
    options[rest[i]] = rest[i + 1];
  }
  if (command === 'new') {
    if (options['--order']) throw new Error('new does not accept --order; new entries use consecutive order values.');
    if (options['--name']) throw new Error('new takes its name as a positional argument.');
    const directory = await newCard(target, { root, modules: options['--modules']?.split(/[,\s]+/).filter(Boolean) ?? [] });
    return { ok: true, action: 'new', directory };
  }
  if (command === 'split') {
    if (options['--order']) throw new Error('split does not accept --order; use arrange after importing.');
    if (options['--modules']) throw new Error('split preserves existing content and does not apply new-card modules.');
    return { ok: true, action: 'split', directory: await splitCard(path.resolve(target), { root, name: options['--name'] }) };
  }
  if (rest.length && (command !== 'arrange' || Object.keys(options).some(key => key !== '--order'))) throw new Error(`${command} does not accept these options.`);
  if (!['check', 'build', 'diff', 'migrate', 'map', 'organize', 'arrange'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const names = target === 'all' ? await listProjects(root) : [target];
  const results = [];
  for (const name of names) {
    try {
      if (command === 'organize') results.push(await organizeWorldbook(name, root));
      if (command === 'arrange') results.push(await arrangeWorldbook(name, root, { order: options['--order'] ?? 'prompt' }));
      if (command === 'migrate') results.push(await migrateProject(name, root));
      if (command === 'map') {
        const loaded = await loadProject(name, root);
        const { project, sources, unreferenced } = loaded;
        results.push({ name, ok: true, index: project.source ?? 'src/card.json', settings: (sources ?? []).filter(f => /\.ya?ml$/.test(f)), contents: project.fields.map(f => f.file), builds: project.builds.map(({ kind, entry }) => ({ kind, entry })), unreferenced: unreferenced ?? [], ...await worldbookInventory(loaded) });
      }
      if (command === 'check') results.push((await checkProject(name, root)).report);
      if (command === 'build') results.push(await buildCard(name, root));
      if (command === 'diff') {
        const { project, dir, card } = await loadProject(name, root);
        const before = await readJSON(await safeFile(dir, project.original.baseline));
        const changes = semanticDiff(before, card);
        results.push({ name, ok: true, comparison: 'Editable source field semantics; see build-report.json for generated content', changes, pendingBuilds: project.builds });
      }
    } catch (error) { results.push({ name, ok: false, errors: [error.message] }); }
  }
  return { ok: results.every(r => r.ok), action: command, results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result = await main(); console.log(JSON.stringify(result, null, 2)); if (result.ok === false) process.exitCode = 1; }
  catch (error) { console.error(JSON.stringify({ ok: false, errors: [error.message] }, null, 2)); process.exitCode = 1; }
}
