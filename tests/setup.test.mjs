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

// Simulate a pnpm install with .modules.yaml, dependency manifests, and a lockfile copy.
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

// Mock where/which, pnpm --version, and pnpm install, recording each call.
function fakeRunner({ found = 'C:\\Users\\demo\\npm\\pnpm.cmd', version = '11.17.0', installCode = 0 } = {}) {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args: [...args], options: options || {} });
    if (command === 'where.exe' || command === 'which') {
      return found ? { code: 0, stdout: found + '\n', stderr: '' } : { code: 1, stdout: '', stderr: '' };
    }
    if (args.includes('--version')) {
      return version ? { code: 0, stdout: version + '\n', stderr: '' } : { code: 1, stdout: '', stderr: "'pnpm' is not recognized as a command" };
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

test('parseVersion and satisfiesRange return unsupported ranges to the caller', () => {
  assert.deepEqual(parseVersion('v24.18.0'), { major: 24, minor: 18, patch: 0 });
  assert.equal(parseVersion('nope'), null);
  assert.equal(satisfiesRange('24.18.0', '>=22.12'), true);
  assert.equal(satisfiesRange('22.12.0', '>=22.12'), true);
  assert.equal(satisfiesRange('22.11.9', '>=22.12'), false);
  assert.equal(satisfiesRange('22.12.0', 'completely-unparsable-range'), null);
});

test('Complete environment passes with matching pinned versions', async t => {
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

test('Old Node versions report engines.node requirements and install guidance', async t => {
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

test('Missing dependencies are listed from package.json and require installation', async t => {
  const root = await workspace(t);
  await writeManifest(root, { dependencies: { yaml: '2.8.1', acorn: '8.18.0' } });
  const report = await inspectEnvironment({ root, platform: 'linux', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '/usr/local/bin/pnpm' }) });
  assert.equal(report.ok, false);
  assert.equal(report.dependencies.reason, 'no-node-modules');
  assert.deepEqual(report.dependencies.missing, ['acorn', 'yaml']);
  assert.equal(report.needsInstall, true);
});

test('Detect installed version drift and lockfile drift', async t => {
  const root = await workspace(t);
  await writeManifest(root);
  await installFixture(root, { versions: { yaml: '2.8.0' } });
  const drifted = await inspectEnvironment({ root, platform: 'linux', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '/usr/local/bin/pnpm' }) });
  assert.equal(drifted.ok, false);
  assert.match(drifted.dependencies.mismatched[0], /yaml: installed 2\.8\.0/);
  assert.equal(drifted.needsInstall, true);

  await installFixture(root, { versions: { yaml: '2.8.1' }, lock: LOCK + '# changed\n' });
  const lockDrift = await inspectEnvironment({ root, platform: 'linux', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '/usr/local/bin/pnpm' }) });
  assert.equal(lockDrift.ok, false);
  assert.equal(lockDrift.dependencies.lockDrift, true);
  assert.equal(lockDrift.dependencies.reason, 'lockfile-drift');
  assert.equal(lockDrift.needsInstall, true);
});

test('Missing pnpm warns when dependencies are ready and blocks when missing', async t => {
  const root = await workspace(t);
  await writeManifest(root);
  await installFixture(root);
  const ready = await inspectEnvironment({ root, platform: 'win32', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '', version: '' }) });
  assert.equal(ready.ok, true);
  assert.equal(ready.pnpm.ok, false);
  assert.ok(ready.warnings.some((line) => line.includes('No usable pnpm found')));
  assert.ok(ready.guidance.some((line) => line.includes('corepack prepare pnpm@11.17.0 --activate')));

  await fs.rm(path.join(root, 'node_modules'), { recursive: true, force: true });
  const broken = await inspectEnvironment({ root, platform: 'win32', nodeVersion: '22.12.0', runCommand: fakeRunner({ found: '', version: '' }) });
  assert.equal(broken.ok, false);
  assert.ok(broken.problems.some((line) => line.includes('No usable pnpm found')));
  assert.equal(broken.needsInstall, false, 'Cannot install dependencies without pnpm');
});

test('Wrong pnpm versions report the required version and never install', async t => {
  const root = await workspace(t);
  await writeManifest(root, { packageManager: 'pnpm@11.17.0' });
  const run = fakeRunner({ version: '11.16.2' });
  const result = await ensureEnvironment({ root, platform: 'linux', nodeVersion: '22.12.0', runCommand: run, log() {}, logError() {} });
  assert.equal(result.ok, false);
  assert.equal(result.installed, false);
  assert.equal(run.installs().length, 0);
  assert.ok(result.problems.some((line) => line.includes('pnpm version mismatch: current 11.16.2')));
  assert.ok(result.guidance.some((line) => line.includes('npm install -g pnpm@11.17.0')));
});

test('Windows ensure launches pnpm.cmd through cmd.exe and checks after installation', async t => {
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

test('doctor is read-only and reports failures with exit code 1', async t => {
  const root = await workspace(t);
  await writeManifest(root);
  const run = fakeRunner();
  const before = await tree(root);
  const lines = [];
  const result = await main(['--check'], { root, platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: (line) => lines.push(line), logError: (line) => lines.push(line) });
  assert.equal(result.exitCode, 1);
  assert.equal(run.installs().length, 0);
  assert.deepEqual(await tree(root), before);
  assert.ok(lines.some((line) => line.includes('Read-only checks do not install dependencies')));

  const json = [];
  const jsonResult = await main(['--check', '--json'], { root, platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: (line) => json.push(line), logError: () => {} });
  assert.equal(jsonResult.exitCode, 1);
  const parsed = JSON.parse(json.join('\n'));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.needsInstall, true);

  // Honor --root so doctor inspects the requested workspace.
  const elsewhere = await main(['--check', '--root', root], { platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: () => {}, logError: () => {} });
  assert.equal(elsewhere.report.root, root);
  const spaced = await main(['--check', '--root=' + root], { platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: () => {}, logError: () => {} });
  assert.equal(spaced.report.root, root);
  const bogus = [];
  const unknown = await main(['--check', '--nope'], { root, platform: 'win32', nodeVersion: '22.12.0', runCommand: run, log: (line) => bogus.push(line), logError: (line) => bogus.push(line) });
  assert.equal(unknown.exitCode, 1);
  assert.equal(unknown.report, null);
  assert.ok(bogus.some((line) => line.includes('Unknown arguments: --nope')));
});

test('pnpmInvocation rejects shell metacharacters', () => {
  assert.deepEqual(pnpmInvocation('win32', ['install', '--frozen-lockfile']).args, ['/d', '/s', '/c', 'pnpm.cmd', 'install', '--frozen-lockfile']);
  assert.deepEqual(pnpmInvocation('linux', ['--version']).args, ['--version']);
  assert.throws(() => pnpmInvocation('win32', ['install', '--frozen-lockfile & calc.exe']), /unsafe command argument/);
  assert.throws(() => pnpmInvocation('linux', ['install', '$(id)']), /unsafe command argument/);
});

test('Launchers check the environment before startup and use platform line endings', async () => {
  const cmd = await fs.readFile(path.join(ROOT, 'Open-TavernCardStudio.cmd'), 'utf8');
  const sh = await fs.readFile(path.join(ROOT, 'Open-TavernCardStudio.sh'), 'utf8');
  const setupAt = cmd.indexOf('tools\\setup.mjs');
  const studioAt = cmd.indexOf('tools\\studio.mjs');
  assert.ok(setupAt > 0, '.cmd must call tools\\setup.mjs');
  assert.ok(studioAt > setupAt, '.cmd must check the environment before starting Studio');
  assert.ok(sh.indexOf('tools/setup.mjs') > 0 && sh.indexOf('tools/studio.mjs') > sh.indexOf('tools/setup.mjs'), '.sh must check the environment before starting Studio');
  // Windows batch if(...) blocks require CRLF line endings.
  assert.ok(cmd.includes('\r\n'), '.cmd requires CRLF line endings');
  assert.equal(cmd.replace(/\r\n/g, '').includes('\n'), false, '.cmd must not contain standalone LF');
  assert.equal(sh.includes('\r'), false, '.sh must not contain CR characters');
});
