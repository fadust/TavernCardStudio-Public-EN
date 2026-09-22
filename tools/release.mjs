import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readJSON, jsonText, sha256, safeName } from './lib/files.mjs';

const FORBIDDEN = new Set(['.git', 'node_modules', '.workbuddy', '.codex', '.claude', '.cursor', '.vscode']);
const ALLOWED_EXTENSIONS = new Set(['.md', '.mjs', '.js', '.cjs', '.ts', '.vue', '.css', '.html', '.json', '.yaml', '.yml', '.txt', '.cmd', '.sh', '.svg', '.png', '.jpg', '.webp']);

// Every path comes from the reviewed manifest. Refuse links, including ancestor links.
async function checkedPath(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '..' || p === '.')) throw new Error(`无效发布路径: ${relative}`);
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`发布内容不允许符号链接: ${relative}`);
  }
  return current;
}

export async function releaseFiles(root = ROOT) {
  const config = await readJSON(path.join(root, 'maintenance/public-release.json'));
  if (config.schemaVersion !== 1 || !['files', 'directories', 'examples', 'emptyDirectories'].every(k => Array.isArray(config[k]))) throw new Error('公开发布清单结构无效。');
  const files = new Set();
  async function visit(relative) {
    if (relative.split('/').some(p => FORBIDDEN.has(p)) || /(?:^|\/)\.env(?:\.|$)|\.local\.(?:json|yaml)$|\.log$/i.test(relative)) throw new Error(`公开清单包含本地文件: ${relative}`);
    const full = await checkedPath(root, relative); const stat = await fs.lstat(full);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(full)).sort()) await visit(`${relative}/${name}`);
    } else if (stat.isFile()) {
      const ext = path.extname(relative).toLowerCase();
      if (ext && !ALLOWED_EXTENSIONS.has(ext) && !['.gitattributes', '.gitignore'].includes(path.basename(relative))) throw new Error(`发布文件类型未审核: ${relative}`);
      files.add(relative);
    } else throw new Error(`不支持的发布文件: ${relative}`);
  }
  for (const file of config.files) await visit(file);
  for (const directory of config.directories) await visit(directory);
  for (const name of config.examples) await visit(`cards/${safeName(name)}`);
  for (const name of config.emptyDirectories) {
    if (!['imports', 'dist', 'work', 'references'].includes(name)) throw new Error(`不支持的空目录: ${name}`);
  }
  return { config, files: [...files].sort() };
}

export async function checkRelease(root = ROOT) {
  const { config, files } = await releaseFiles(root);
  const allowed = new Set(files); const errors = []; let bytes = 0;
  const locked = await readJSON(path.join(root, 'maintenance/references.lock.json'));
  const referencePaths = new Set(Object.values(locked.sources).flatMap(source => Object.values(source.files).map(file => file.local)));
  for (const file of files) {
    const buffer = await fs.readFile(path.join(root, file)); bytes += buffer.length;
    if (/\.(png|jpg|webp)$/i.test(file)) continue;
    const text = buffer.toString('utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) errors.push(`${file}: 检测到私钥标记`);
    if (/(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,})/.test(text)) errors.push(`${file}: 检测到凭据形状`);
    if (!file.endsWith('.md')) continue;
    const markdown = text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
    for (const match of markdown.matchAll(/\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      let link = match[1].replace(/^<|>$/g, '');
      if (/^[a-z][a-z\d+.-]*:|^#|^\/\//i.test(link)) continue;
      link = link.split('#')[0]; if (!link || /[<>{}*|]/.test(link)) continue;
      try { link = decodeURIComponent(link); } catch { errors.push(`${file}: 链接编码错误`); continue; }
      const target = path.relative(root, path.resolve(root, path.dirname(file), link)).split(path.sep).join('/');
      if (!allowed.has(target) && !referencePaths.has(target) && !files.some(name => name.startsWith(target.replace(/\/$/, '') + '/'))) errors.push(`${file}: 发布包中没有链接目标 ${target}`);
    }
  }
  return { ok: errors.length === 0, files: files.length, bytes, examples: config.examples.length, errors };
}

export async function exportRelease(destination, root = ROOT) {
  const checked = await checkRelease(root);
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  const { config, files } = await releaseFiles(root);
  const output = path.resolve(destination);
  if (output === path.resolve(root)) throw new Error('不能覆盖工作区本身。');
  // Never reuse or recursively remove an existing destination, even after a failed export.
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(output);
  const manifest = { schemaVersion: 1, version: (await readJSON(path.join(root, 'package.json'))).version, files: {} };
  for (const file of files) {
    const data = await fs.readFile(await checkedPath(root, file));
    const target = path.join(output, file);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data, { flag: 'wx' });
    manifest.files[file] = { bytes: data.length, sha256: sha256(data) };
  }
  for (const directory of config.emptyDirectories) {
    await fs.mkdir(path.join(output, directory), { recursive: true });
    await fs.writeFile(path.join(output, directory, '.gitkeep'), '');
    manifest.files[`${directory}/.gitkeep`] = { bytes: 0, sha256: sha256(Buffer.alloc(0)) };
  }
  await fs.writeFile(path.join(output, 'release-manifest.json'), jsonText(manifest), { flag: 'wx' });
  return { ok: true, directory: output, files: Object.keys(manifest.files).length, version: manifest.version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command = 'check', destination, ...extra] = process.argv.slice(2);
    if (extra.length || !['check', 'export'].includes(command) || (command === 'check' && destination) || (command === 'export' && !destination)) throw new Error('用法: pnpm release:check 或 pnpm release:export <不存在的目标目录>');
    const result = command === 'check' ? await checkRelease() : await exportRelease(destination);
    process.stdout.write(jsonText(result)); if (!result.ok) process.exitCode = 1;
  } catch (error) { process.stderr.write(jsonText({ ok: false, error: error.message })); process.exitCode = 1; }
}
