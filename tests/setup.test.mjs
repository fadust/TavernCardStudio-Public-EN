import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../tools/lib/files.mjs';
import { inspectEnvironment, ensureEnvironment, main, pnpmInvocation, parseVersion, satisfiesRange } from '../tools/setup.mjs';

const LOCK = "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n";

async function workspace(t) {
  await fs.mkdir(path.join(ROOT, 'work'), { recursive: true });
  const root = await fs.mkdtemp(path.join(ROOT, 'work/test-setup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function writeManifest(root, { node = '>=22.12', packageManager = 'pnpm@11.17.0', dependencies = { yaml: '2.8.1' }, devDependencies = {} } = {}) {
  const manifest = { name: 'fixture', private: true, engines: node ? { node } : undefined, packageManager, dependencies, devDependencies };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), LOCK);
  return manifest;
}

// 用真实的包目录结构模拟 pnpm 安装结果：node_modules/.modules.yaml 标记 + 每个依赖的 package.json + 锁文件副本。
async function installFixture(root, { versions = { yaml: '2.8.1' }, lock = LOCK } = {}) {
  await fs.mkdir(path.join(root, 'node_modules/.pnpm'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules/.modules.yaml'), 'hoistPattern:\n  - "*"\n');
  await fs.writeFile(path.join(root, 'node_modules/.pnpm/lock.yaml'), lock);
  for (const [name, version] of Object.entries(versions)) {
    const dir = path.join(root, 'node_modules', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  }
}

// 伪造命令执行：区分 where/which、pnpm --version 与 pnpm install，并记录每次调用。
function fakeRunner({ found = 'C:\\Users\\demo\\npm\\pnpm.cmd', version = '11.17.0', installCode = 0 } = {}) {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args: [...args], options: options || {} });
    if (command === 'where.exe' || command === 'which') {
      return found ? { code: 0, stdout: found + '\n', stderr: '' } : { code: 1, stdout: '', stderr: '' };
    }
    if (args.includes('--version')) {
      return version ? { code: 0, stdout: version + '\n', stderr: '' } : { code: 1, stdout: '', stderr: "'pnpm' 不是内部或外部命令" };
    }
    if (args.includes('install')) return { code: installCode, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected command' };
  };
  run.calls = calls;
  run.installs = () => calls.filter((call) => call.args.includes('install'));
  return run;
}

async function tree(root) {
  const names = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      names.push(path.relative(root, full));
      await walk(full);
    }
  }
  await walk(root);
  return names.sort();
}

test('parseVersion / satisfiesRange 只解析声明的写法，无法解析时交给调用方', () => {
  assert.deepEqual(parseVersion('v24.18.0'), { major: 24, minor: 18, patch: 0 });
  assert.equal(parseVersion('nope'), null);
  assert.equal(satisfiesRange('24.18.0', '>=22.12'), true);
  assert.equal(satisfiesRange('22.12.0', '>=22.12'), true);
  assert.equal(satisfiesRange('22.11.9', '>=22.12'), false);
  assert.equal(satisfiesRange('22.12.0', 'completely-unparsable-range'), null);
});

test('完整环境通过检查，且锁定版本一致', async t => {
  const root = await workspace(t);
  await writeManifest(root);
  await installFixture(root);
  const run = fakeRunner();
  const report = await inspectEnvironment({ root, platform: 'win32', nodeVersion: '24.18.0', runCommand: run });
  assert.equal(report.ok, true);
  assert.equal(report.dependencies.ok, true);
  assert.equal(report.dependencies.checked, 1);
  assert.equal(report.pnpm.version, '11.17.0');
  assert.equal(report.pnpm.locatedAt, 'C:\\Users\\demo\\npm\\pnpm.cmd');
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(run.installs().length, 0);
});

test('Node 版本过低时报告 engines.node 要求并给出安装指导', async t => {
  const root = await workspace(t);
  await writeManifest(root, { node: '>=22.12' });
  await installFixture(root);
  const report = await inspectEnvironment({ root, platform: 'linux', nodeVersion: '20.11.1', runCommand: fakeRunner({ found: '/usr/local/bin/pnpm' }) });
  assert.equal(report.ok, false);
  assert.equal(report.node.ok, false);
  assert.match(report.node.message, />=22\.12/);
  assert.ok(report.guidance.some((line) => line.includes('nodejs.org')));
  assert.equal(report.needsInstall, false);
});

test('依赖缺失时按 package.json 逐个列出，并标记需要安装', async t => {
  const root = await workspace(t);
  await writeManifest(root, { dependencies: { yaml: '2.8.1', acorn: '8.18.0' } });
  const report = await inspectEnvironment({ root, platform: 'linux', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '/usr/local/bin/pnpm' }) });
  assert.equal(report.ok, false);
  assert.equal(report.dependencies.reason, 'no-node-modules');
  assert.deepEqual(report.dependencies.missing, ['acorn', 'yaml']);
  assert.equal(report.needsInstall, true);
});

test('依赖存在但版本漂移或锁文件漂移都会被识别', async t => {
  const root = await workspace(t);
  await writeManifest(root);
  await installFixture(root, { versions: { yaml: '2.8.0' } });
  const drifted = await inspectEnvironment({ root, platform: 'linux', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '/usr/local/bin/pnpm' }) });
  assert.equal(drifted.ok, false);
  assert.match(drifted.dependencies.mismatched[0], /yaml：已安装 2\.8\.0/);
  assert.equal(drifted.needsInstall, true);

  await installFixture(root, { versions: { yaml: '2.8.1' }, lock: LOCK + '# changed\n' });
  const lockDrift = await inspectEnvironment({ root, platform: 'linux', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '/usr/local/bin/pnpm' }) });
  assert.equal(lockDrift.ok, false);
  assert.equal(lockDrift.dependencies.lockDrift, true);
  assert.equal(lockDrift.dependencies.reason, 'lockfile-drift');
  assert.equal(lockDrift.needsInstall, true);
});

test('缺少 pnpm 时：依赖已就绪只提醒，依赖缺失才阻断', async t => {
  const root = await workspace(t);
  await writeManifest(root);
  await installFixture(root);
  const ready = await inspectEnvironment({ root, platform: 'win32', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '', version: '' }) });
  assert.equal(ready.ok, true);
  assert.equal(ready.pnpm.ok, false);
  assert.ok(ready.warnings.some((line) => line.includes('没有找到可用的 pnpm')));
  assert.ok(ready.guidance.some((line) => line.includes('corepack prepare pnpm@11.17.0 --activate')));

  await fs.rm(path.join(root, 'node_modules'), { recursive: true, force: true });
  const broken = await inspectEnvironment({ root, platform: 'win32', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '', version: '' }) });
  assert.equal(broken.ok, false);
  assert.ok(broken.problems.some((line) => line.includes('没有找到可用的 pnpm')));
  assert.equal(broken.needsInstall, false, '没有 pnpm 时不能假装能安装');
});

test('pnpm 版本与 packageManager 不一致时给出精确版本，且不会用它安装', async t => {
  const root = await workspace(t);
  await writeManifest(root, { packageManager: 'pnpm@11.17.0' });
  const run = fakeRunner({ version: '11.16.2' });
  const result = await ensureEnvironment({ root, platform: 'linux', nodeVersion: '22.12.0', runCommand: run, log() {}, logError() {} });
  assert.equal(result.ok, false);
  assert.equal(result.installed, false);
  assert.equal(run.installs().length, 0);
  assert.ok(result.problems.some((line) => line.includes('pnpm 版本不一致：当前 11.16.2')));
  assert.ok(result.guidance.some((line) => line.includes('npm install -g pnpm@11.17.0')));
});

test('ensure 在 Windows 上用 cmd.exe 启动 pnpm.cmd，参数固定且安装后复查', async t => {
  const root = await workspace(t);
  await writeManifest(root);
  const run = fakeRunner();
  const original = run;
  const runner = async (command, args, options) => {
    const result = await original(command, args, options);
    if (args.includes('install') && result.code === 0) await installFixture(root);
    return result;
  };
  runner.calls = original.calls;
  runner.installs = original.installs;
  const result = await ensureEnvironment({ root, platform: 'win32', nodeVersion: '22.12.0', runCommand: runner, log() {}, logError() {} });
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  const install = runner.installs()[0];
  assert.deepEqual(install.args, ['/d', '/s', '/c', 'pnpm.cmd', 'install', '--frozen-lockfile']);
  assert.equal(install.options.cwd, root);
  assert.equal(install.options.stdio, 'inherit');
  assert.equal(result.report.dependencies.ok, true);
});

test('doctor（--check）只读：不安装、不写文件，问题以退出码 1 报告', async t => {
  const root = await workspace(t);
  await writeManifest(root);
  const run = fakeRunner();
  const before = await tree(root);
  const lines = [];
  const result = await main(['--check'], { root, platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: (line) => lines.push(line), logError: (line) => lines.push(line) });
  assert.equal(result.exitCode, 1);
  assert.equal(run.installs().length, 0);
  assert.deepEqual(await tree(root), before);
  assert.ok(lines.some((line) => line.includes('只读检查不会安装依赖')));

  const json = [];
  const jsonResult = await main(['--check', '--json'], { root, platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: (line) => json.push(line), logError: () => {} });
  assert.equal(jsonResult.exitCode, 1);
  const parsed = JSON.parse(json.join('\n'));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.needsInstall, true);

  // --root 必须真的生效，否则 doctor 会误检仓库以外的目录。
  const elsewhere = await main(['--check', '--root', root], { platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: () => {}, logError: () => {} });
  assert.equal(elsewhere.report.root, root);
  const spaced = await main(['--check', '--root=' + root], { platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: () => {}, logError: () => {} });
  assert.equal(spaced.report.root, root);
  const bogus = [];
  const unknown = await main(['--check', '--nope'], { root, platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: (line) => bogus.push(line), logError: (line) => bogus.push(line) });
  assert.equal(unknown.exitCode, 1);
  assert.equal(unknown.report, null);
  assert.ok(bogus.some((line) => line.includes('无法识别的参数：--nope')));
});

test('pnpmInvocation 拒绝带 shell 元字符的参数', () => {
  assert.deepEqual(pnpmInvocation('win32', ['install', '--frozen-lockfile']).args, ['/d', '/s', '/c', 'pnpm.cmd', 'install', '--frozen-lockfile']);
  assert.deepEqual(pnpmInvocation('linux', ['--version']).args, ['--version']);
  assert.throws(() => pnpmInvocation('win32', ['install', '--frozen-lockfile & calc.exe']), /不安全的命令行参数/);
  assert.throws(() => pnpmInvocation('linux', ['install', '$(id)']), /不安全的命令行参数/);
});

test('启动器先检查环境再启动，且换行格式符合平台要求', async () => {
  const cmd = await fs.readFile(path.join(ROOT, '打开角色卡工具.cmd'), 'utf8');
  const sh = await fs.readFile(path.join(ROOT, '打开角色卡工具.sh'), 'utf8');
  const setupAt = cmd.indexOf('tools\\setup.mjs');
  const studioAt = cmd.indexOf('tools\\studio.mjs');
  assert.ok(setupAt > 0, '.cmd 要调用 tools\\setup.mjs');
  assert.ok(studioAt > setupAt, '.cmd 要先检查环境再启动 Studio');
  assert.ok(sh.indexOf('tools/setup.mjs') > 0 && sh.indexOf('tools/studio.mjs') > sh.indexOf('tools/setup.mjs'), '.sh 要先检查环境再启动 Studio');
  // Windows 批处理的 if(...) 块在 LF-only 文件里会被拆错行，必须保持 CRLF。
  assert.ok(cmd.includes('\r\n'), '.cmd 需要 CRLF 换行');
  assert.equal(cmd.replace(/\r\n/g, '').includes('\n'), false, '.cmd 不能出现单独的 LF');
  assert.equal(sh.includes('\r'), false, '.sh 不能有 CR 字符');
});
