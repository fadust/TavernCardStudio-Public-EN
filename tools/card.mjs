import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readJSON, safeFile } from './lib/files.mjs';
import { newCard, MODULES } from './lib/templates.mjs';
import { splitCard, loadProject, listProjects, semanticDiff, migrateProject } from './lib/project.mjs';
import { checkProject } from './lib/validation.mjs';
import { buildCard } from './lib/build.mjs';

export async function main(args = process.argv.slice(2), root = ROOT) {
  const [command, target, ...rest] = args;
  if (!command || ['help', '--help', '-h'].includes(command)) {
    return { usage: ['pnpm card new <名称> [--modules worldbook,regex,script,mvu,html,vue]', 'pnpm card split <PNG或JSON文件> [--name 名称]', 'pnpm card migrate <名称|all>', 'pnpm card map <名称|all>', 'pnpm card check <名称|all>', 'pnpm card build <名称|all>', 'pnpm card diff <名称|all>'], defaults: '新建和拆分生成中文 YAML 创作格式；无 --modules 时新建纯文字卡；可按目标填写传统角色字段或使用世界书组织设定，骨架不代填人物内容；html 与 vue 初始模板二选一。', modules: MODULES };
  }
  if (!target) throw new Error('缺少角色卡名称或输入文件。运行 pnpm card help 查看用法。');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--modules', '--name'].includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`未知或缺少值的参数: ${rest[i]}`);
    if (options[rest[i]] !== undefined) throw new Error(`重复参数: ${rest[i]}`);
    options[rest[i]] = rest[i + 1];
  }
  if (command === 'new') {
    if (options['--name']) throw new Error('new 使用位置参数指定名称。');
    const directory = await newCard(target, { root, modules: options['--modules']?.split(/[,\s]+/).filter(Boolean) ?? [] });
    return { ok: true, action: 'new', directory };
  }
  if (command === 'split') {
    if (options['--modules']) throw new Error('split 保留原有内容，不自动应用新卡模块。');
    return { ok: true, action: 'split', directory: await splitCard(path.resolve(target), { root, name: options['--name'] }) };
  }
  if (rest.length) throw new Error(`${command} 不接受这些选项。`);
  if (!['check', 'build', 'diff', 'migrate', 'map'].includes(command)) throw new Error(`未知命令: ${command}`);
  const names = target === 'all' ? await listProjects(root) : [target];
  const results = [];
  for (const name of names) {
    try {
      if (command === 'migrate') results.push(await migrateProject(name, root));
      if (command === 'map') {
        const { project, sources, unreferenced } = await loadProject(name, root);
        results.push({ name, ok: true, index: project.source ?? 'src/card.json', settings: (sources ?? []).filter(f => /\.ya?ml$/.test(f)), contents: project.fields.map(f => f.file), builds: project.builds.map(({ kind, entry }) => ({ kind, entry })), unreferenced: unreferenced ?? [] });
      }
      if (command === 'check') results.push((await checkProject(name, root)).report);
      if (command === 'build') results.push(await buildCard(name, root));
      if (command === 'diff') {
        const { project, dir, card } = await loadProject(name, root);
        const before = await readJSON(await safeFile(dir, project.original.baseline));
        const changes = semanticDiff(before, card);
        results.push({ name, ok: true, comparison: '编辑源字段语义；构建生成内容另见 build-report.json', changes, pendingBuilds: project.builds });
      }
    } catch (error) { results.push({ name, ok: false, errors: [error.message] }); }
  }
  return { ok: results.every(r => r.ok), action: command, results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result = await main(); console.log(JSON.stringify(result, null, 2)); if (result.ok === false) process.exitCode = 1; }
  catch (error) { console.error(JSON.stringify({ ok: false, errors: [error.message] }, null, 2)); process.exitCode = 1; }
}
