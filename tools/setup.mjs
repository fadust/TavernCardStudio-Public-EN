import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ---------------------------------------------------------------------------
   TavernCardStudio 启动前环境检查

   - `node tools/setup.mjs`（或 --ensure）：检查环境；缺依赖或锁文件漂移时用
     pnpm --frozen-lockfile 安装一次；不满足条件就打印操作指导并以退出码 1 结束。
   - `node tools/setup.mjs --check`（doctor）：只读检查，任何情况下都不安装、
     不写文件；问题通过退出码 1 与文字说明报告。

   这里只检查与安装依赖，不会下载或安装 Node.js，也不会全局改动 pnpm。
   --------------------------------------------------------------------------- */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_ARGS = ['install', '--frozen-lockfile'];

/* ===================== 版本比较 ===================== */

export function parseVersion(text) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(text === undefined || text === null ? '' : text).trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
  };
}

export function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a;
  const right = typeof b === 'string' ? parseVersion(b) : b;
  if (!left || !right) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  return 0;
}

// 只解析 package.json 里常见的 >= 写法；无法解析时返回 null，表示交给调用方决定。
export function satisfiesRange(version, range) {
  const text = String(range === undefined || range === null ? '' : range).trim();
  const match = /^(>=|>|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const compared = compareVersions(version, { major: Number(match[2]), minor: Number(match[3] || 0), patch: Number(match[4] || 0) });
  if (compared === null) return null;
  const operator = match[1] || '=';
  if (operator === '>=') return compared >= 0;
  if (operator === '>') return compared > 0;
  return compared === 0;
}

export function parsePackageManager(spec) {
  const match = /^([a-z0-9@._\-\/]+)@(.+)$/i.exec(String(spec || '').trim());
  if (!match) return null;
  return { name: match[1], version: match[2] };
}

/* ===================== 命令 ===================== */

export function defaultRunCommand(command, args, options) {
  const settings = options || {};
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: settings.cwd,
        env: settings.env || process.env,
        shell: false,
        stdio: settings.stdio || 'pipe',
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', error: error.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk; });
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish({
      code: null,
      stdout,
      stderr,
      error: error && error.code === 'ENOENT' ? '找不到命令：' + command : (error ? error.message : String(error)),
    }));
    child.once('close', (code) => finish({ code, stdout, stderr }));
  });
}

// Windows 的 .cmd 文件必须经 cmd.exe 启动；这里用参数数组交给 cmd，
// 不自己拼接命令行字符串，参数也只允许普通字符，避免注入。
function assertPlainArguments(args) {
  for (const arg of args) {
    if (!/^[A-Za-z0-9@=._,:\/\\-]+$/.test(String(arg))) {
      throw new Error('内部错误：不安全的命令行参数 ' + JSON.stringify(String(arg)));
    }
  }
}

// 导出给测试与 doctor 复用：确认 Windows 走 cmd.exe + pnpm.cmd，其他平台直接调用 pnpm。
export function pnpmInvocation(platform, args) {
  assertPlainArguments(args);
  if (platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', ...args],
      display: 'pnpm.cmd ' + args.join(' '),
    };
  }
  return { command: 'pnpm', args: [...args], display: 'pnpm ' + args.join(' ') };
}

function locatePnpm(platform, runCommand, options) {
  const command = platform === 'win32' ? 'where.exe' : 'which';
  return runCommand(command, ['pnpm'], { ...options }).catch(() => null);
}

/* ===================== 环境报告 ===================== */

async function readJSONFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    return null;
  }
}

async function readTextFile(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    return null;
  }
}

function normalizeLock(text) {
  return String(text).replace(/\r\n/g, '\n').trim();
}

async function inspectDependencies(root, manifest) {
  const declared = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
  const names = Object.keys(declared).sort();
  const result = { ok: false, declared: names.length, checked: 0, missing: [], mismatched: [], lockDrift: false, reason: '' };
  const modulesMarker = await readTextFile(path.join(root, 'node_modules', '.modules.yaml'));
  if (modulesMarker === null) {
    result.reason = 'no-node-modules';
    result.missing = names;
    return result;
  }
  for (const name of names) {
    const installed = await readJSONFile(path.join(root, 'node_modules', name, 'package.json'));
    if (!installed || typeof installed.version !== 'string') {
      result.missing.push(name);
      continue;
    }
    result.checked += 1;
    const wanted = String(declared[name]);
    // 只对手写的确切版本做精确比对；带范围符的声明交给锁文件漂移检查负责。
    if (/^v?\d+\.\d+\.\d+$/.test(wanted)) {
      const compared = compareVersions(installed.version, wanted);
      if (compared !== 0) result.mismatched.push(name + '：已安装 ' + installed.version + '，package.json 要求 ' + wanted);
    }
  }
  const lock = await readTextFile(path.join(root, 'pnpm-lock.yaml'));
  const installedLock = await readTextFile(path.join(root, 'node_modules', '.pnpm', 'lock.yaml'));
  if (lock === null) {
    result.reason = 'lockfile-missing';
    return result;
  }
  if (installedLock === null || normalizeLock(installedLock) !== normalizeLock(lock)) {
    result.lockDrift = true;
    result.reason = 'lockfile-drift';
    return result;
  }
  result.ok = result.missing.length === 0 && result.mismatched.length === 0;
  if (result.ok) result.reason = 'ok';
  else result.reason = result.missing.length ? 'missing' : 'version-mismatch';
  return result;
}

/**
 * 只读检查：读 package.json / 锁文件 / node_modules，运行 pnpm --version 与 where/which。
 * 不安装依赖，不写任何文件。doctor 与测试复用这个函数。
 */
export async function inspectEnvironment(options) {
  const settings = options || {};
  const root = path.resolve(settings.root || ROOT);
  const platform = settings.platform || process.platform;
  const nodeVersion = settings.nodeVersion || process.versions.node;
  const runCommand = settings.runCommand || defaultRunCommand;
  const runOptions = { cwd: root, env: settings.env || process.env };
  const report = {
    ok: false,
    root,
    platform,
    problems: [],
    warnings: [],
    guidance: [],
    node: { ok: false, current: String(nodeVersion), required: null, message: '' },
    pnpm: { ok: false, found: false, version: null, required: null, command: null, locatedAt: null, message: '' },
    lockfile: { ok: false, present: false, message: '' },
    dependencies: { ok: false, declared: 0, checked: 0, missing: [], mismatched: [], lockDrift: false, message: '' },
  };

  const manifest = await readJSONFile(path.join(root, 'package.json'));
  if (!manifest) {
    report.problems.push('读不到 package.json，请确认在完整的 TavernCardStudio 仓库里运行。');
    return report;
  }

  const nodeRange = manifest.engines && manifest.engines.node ? String(manifest.engines.node) : null;
  report.node.required = nodeRange;
  const nodeSatisfied = nodeRange ? satisfiesRange(nodeVersion, nodeRange) : true;
  if (nodeSatisfied === false) {
    report.node.message = 'Node.js 版本过低：当前 ' + nodeVersion + '，要求 ' + nodeRange + '。';
    report.problems.push(report.node.message);
    report.guidance.push('请安装 Node.js ' + nodeRange.replace(/^[>=^~\s]+/, '') + ' 或更高版本（https://nodejs.org/），安装后重新打开启动器。');
  } else if (nodeSatisfied === null) {
    report.node.ok = true;
    report.node.message = 'Node.js ' + nodeVersion + ' 无法自动比较 engines.node（' + nodeRange + '），已跳过版本判断。';
  } else {
    report.node.ok = true;
    report.node.message = 'Node.js ' + nodeVersion + ' 正常' + (nodeRange ? '（要求 ' + nodeRange + '）' : '') + '。';
  }

  // pnpm 问题先记下来：依赖已经就绪时它只是提醒，需要安装依赖时才是阻断问题。
  let pnpmIssue = '';
  const pnpmGuidance = [];
  const manager = parsePackageManager(manifest.packageManager);
  if (!manager) {
    pnpmIssue = 'package.json 里缺少可识别的 packageManager 字段，无法确认 pnpm 版本。';
  } else if (manager.name !== 'pnpm') {
    pnpmIssue = 'packageManager 写的是 ' + manager.name + '，本工具需要 pnpm。';
  } else {
    report.pnpm.required = manager.version;
  }

  const located = await locatePnpm(platform, runCommand, runOptions);
  const locatedLines = located && located.stdout ? located.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  const windowsEntry = locatedLines.find((line) => /\.cmd$/i.test(line));
  report.pnpm.locatedAt = (platform === 'win32' ? windowsEntry : locatedLines[0]) || null;

  const probeCall = pnpmInvocation(platform, ['--version']);
  report.pnpm.command = probeCall.display;
  let probe = null;
  try {
    probe = await runCommand(probeCall.command, probeCall.args, { ...runOptions, stdio: 'pipe' });
  } catch (error) {
    probe = { code: null, stdout: '', stderr: '', error: error.message };
  }
  const foundVersion = probe && probe.code === 0 && probe.stdout ? String(probe.stdout).trim().split(/\s+/)[0] : '';
  if (!foundVersion) {
    report.pnpm.found = false;
    const detail = probe && (probe.error || String(probe.stderr || '').trim()) ? '（' + String(probe.error || probe.stderr).trim().split(/\r?\n/)[0] + '）' : '';
    if (!pnpmIssue) pnpmIssue = '没有找到可用的 pnpm' + detail + '。';
    report.pnpm.message = pnpmIssue;
    pnpmGuidance.push('如已安装 Corepack，可在本仓库根目录运行 corepack enable pnpm，然后运行：corepack prepare pnpm@' + (manager ? manager.version : '<版本>') + ' --activate');
    pnpmGuidance.push('也可以自己安装对应版本：npm install -g pnpm@' + (manager ? manager.version : '<版本>') + '。本工具不会替你全局安装或改版本。');
  } else {
    report.pnpm.found = true;
    report.pnpm.version = foundVersion;
    if (report.pnpm.required && compareVersions(foundVersion, report.pnpm.required) !== 0) {
      if (!pnpmIssue) pnpmIssue = 'pnpm 版本不一致：当前 ' + foundVersion + '，packageManager 要求 ' + report.pnpm.required + '。';
      report.pnpm.message = pnpmIssue;
      pnpmGuidance.push('请切到 package.json 指定的版本：corepack prepare pnpm@' + report.pnpm.required + ' --activate；或 npm install -g pnpm@' + report.pnpm.required + '。');
    } else {
      report.pnpm.ok = true;
      report.pnpm.message = 'pnpm ' + foundVersion + (report.pnpm.required ? '（要求 ' + report.pnpm.required + '）' : '') + ' 正常。';
    }
  }

  const lockText = await readTextFile(path.join(root, 'pnpm-lock.yaml'));
  report.lockfile.present = lockText !== null;
  report.lockfile.ok = lockText !== null;
  report.lockfile.message = lockText !== null ? 'pnpm-lock.yaml 存在。' : '缺少 pnpm-lock.yaml，无法做固定锁安装；请重新获取完整仓库。';
  if (!report.lockfile.ok) report.problems.push(report.lockfile.message);

  const dependencies = await inspectDependencies(root, manifest);
  dependencies.message = (() => {
    if (dependencies.ok) return '依赖 ' + dependencies.checked + '/' + dependencies.declared + ' 就绪，且与 pnpm-lock.yaml 一致。';
    if (dependencies.reason === 'no-node-modules') return '还没有安装依赖（node_modules 不存在）。';
    if (dependencies.reason === 'lockfile-missing') return '缺少 pnpm-lock.yaml，无法确认依赖状态。';
    if (dependencies.reason === 'lockfile-drift') return '依赖与 pnpm-lock.yaml 不一致（package.json 或锁文件更新过）。';
    if (dependencies.missing.length) return '缺少 ' + dependencies.missing.length + ' 个依赖：' + dependencies.missing.slice(0, 6).join('、') + (dependencies.missing.length > 6 ? ' 等' : '') + '。';
    if (dependencies.mismatched.length) return dependencies.mismatched.length + ' 个依赖版本与 package.json 不一致。';
    return '依赖状态异常。';
  })();
  report.dependencies = dependencies;
  const dependenciesReady = dependencies.ok;
  if (!dependenciesReady && report.lockfile.ok) {
    report.problems.push('依赖需要安装或更新：' + dependencies.message);
  }

  if (pnpmIssue) {
    for (const line of pnpmGuidance) report.guidance.push(line);
    if (dependenciesReady) {
      report.pnpm.message = pnpmIssue.replace(/。$/, '') + '（依赖已就绪，这次启动不需要 pnpm；以后重装或升级依赖时会用到）。';
      report.warnings.push(report.pnpm.message);
    } else {
      report.problems.push(pnpmIssue);
    }
  }

  report.ok = report.node.ok && report.lockfile.ok && dependenciesReady;
  report.needsInstall = Boolean(report.lockfile.ok && !dependenciesReady && report.node.ok && report.pnpm.ok);
  return report;
}

export function formatReport(report) {
  const lines = [];
  lines.push((report.node.ok ? '[正常] ' : '[问题] ') + report.node.message);
  lines.push((report.pnpm.ok ? '[正常] ' : (report.warnings.includes(report.pnpm.message) ? '[注意] ' : '[问题] ')) + report.pnpm.message);
  lines.push((report.lockfile.ok ? '[正常] ' : '[问题] ') + report.lockfile.message);
  lines.push((report.dependencies.ok ? '[正常] ' : '[问题] ') + report.dependencies.message);
  if (report.dependencies.lockDrift) lines.push('[问题] 依赖与锁文件不一致，需要按锁文件重新安装。');
  return lines;
}

/**
 * 检查环境；允许安装时，用 package.json 指定的 pnpm 做一次固定锁安装。
 * 返回 { ok, installed, report, problems, guidance }，不抛异常。
 */
export async function ensureEnvironment(options) {
  const settings = options || {};
  const allowInstall = settings.allowInstall !== false;
  const runCommand = settings.runCommand || defaultRunCommand;
  const log = settings.log || ((line) => console.log(line));
  const logError = settings.logError || ((line) => console.error(line));
  let report = await inspectEnvironment(settings);
  for (const line of formatReport(report)) log(line);
  if (report.ok) {
    log('[正常] 环境就绪，可以启动创作工具。');
    return { ok: true, installed: false, report, problems: [], guidance: [] };
  }
  const canInstall = allowInstall && report.needsInstall && report.node.ok && report.pnpm.ok;
  if (canInstall) {
    const install = pnpmInvocation(settings.platform || process.platform, INSTALL_ARGS);
    log('[进行中] 依赖缺失或已更新，正在按锁文件安装：' + install.display);
    const result = await runCommand(install.command, install.args, {
      cwd: report.root,
      env: settings.env || process.env,
      stdio: 'inherit',
    });
    if (!result || result.code !== 0) {
      const detail = result && result.error ? '：' + result.error : '';
      // pnpm 会因为跳过的构建脚本（例如 esbuild 的提示）返回非零；以实际依赖状态为准，别误判成失败。
      const after = await inspectEnvironment(settings);
      if (after.ok) {
        for (const line of formatReport(after)) log(line);
        log('[注意] pnpm 结束时返回非零' + detail + '，但依赖已经就绪（pnpm 的构建脚本提示常见于此），本次继续启动。');
        return { ok: true, installed: true, report: after, problems: [], guidance: [] };
      }
      logError('[错误] 依赖安装失败' + detail + '。请检查网络与上面的 pnpm 输出，然后重新打开启动器。');
      return { ok: false, installed: false, report: after, problems: ['依赖安装失败。'], guidance: ['确认网络可用后重新打开启动器；仍然失败时在本仓库根目录运行：' + install.display + '，并把输出发给维护者。'] };
    }
    report = await inspectEnvironment(settings);
    for (const line of formatReport(report)) log(line);
    if (!report.ok) {
      logError('[错误] 安装完成后依赖检查仍未通过，请把上面的输出发给维护者。');
      return { ok: false, installed: true, report, problems: report.problems, guidance: report.guidance };
    }
    log('[正常] 依赖已就绪，可以启动创作工具。');
    return { ok: true, installed: true, report, problems: [], guidance: [] };
  }
  if (!allowInstall && report.needsInstall) {
    report.guidance.unshift('只读检查不会安装依赖；需要安装时在仓库根目录运行：pnpm install --frozen-lockfile。');
  }
  return { ok: false, installed: false, report, problems: report.problems, guidance: report.guidance };
}

/* ===================== 命令行入口 ===================== */

function parseArgs(argv) {
  const values = Array.isArray(argv) ? argv : [];
  const options = { mode: 'ensure', json: false, root: null, unknown: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--check' || value === '--doctor') options.mode = 'check';
    else if (value === '--ensure') options.mode = 'ensure';
    else if (value === '--json') options.json = true;
    else if (value === '--help' || value === '-h') options.mode = 'help';
    else if (value.startsWith('--root=')) options.root = value.slice('--root='.length);
    else if (value === '--root' && values[index + 1]) {
      options.root = values[index + 1];
      index += 1;
    } else options.unknown.push(value);
  }
  return options;
}

export async function main(argv, options) {
  const settings = options || {};
  const parsed = parseArgs(argv === undefined ? process.argv.slice(2) : argv);
  const log = settings.log || ((line) => console.log(line));
  const logError = settings.logError || ((line) => console.error(line));
  if (parsed.mode === 'help') {
    log('用法：node tools/setup.mjs [--ensure|--check] [--json] [--root <仓库目录>]');
    log('  --ensure  检查环境，缺依赖或锁文件漂移时按 pnpm-lock.yaml 安装（默认）');
    log('  --check   只读检查，不安装任何依赖（doctor 使用）');
    log('  --json    以 JSON 输出检查结果');
    return { exitCode: 0, report: null };
  }
  if (parsed.unknown.length) {
    logError('[错误] 无法识别的参数：' + parsed.unknown.join(' '));
    logError('[操作] 用法：node tools/setup.mjs [--ensure|--check] [--json] [--root <仓库目录>]');
    return { exitCode: 1, report: null };
  }
  const shared = {
    root: parsed.root || settings.root || ROOT,
    platform: settings.platform,
    nodeVersion: settings.nodeVersion,
    runCommand: settings.runCommand,
    env: settings.env,
  };
  if (parsed.mode === 'check') {
    const report = await inspectEnvironment(shared);
    if (parsed.json) log(JSON.stringify(report, null, 2));
    else {
      for (const line of formatReport(report)) log(line);
      if (report.ok) log('[正常] 环境就绪，可以启动创作工具。');
      else {
        if (report.needsInstall) log('[操作] 只读检查不会安装依赖；需要安装时在仓库根目录运行：pnpm install --frozen-lockfile。');
        for (const line of report.guidance) log('[操作] ' + line);
        logError('[错误] 环境检查未通过（只读检查，未安装任何依赖）。');
      }
    }
    return { exitCode: report.ok ? 0 : 1, report };
  }
  const result = await ensureEnvironment({ ...shared, log, logError });
  if (parsed.json) log(JSON.stringify({ ok: result.ok, installed: result.installed, report: result.report }, null, 2));
  if (!result.ok) {
    for (const line of result.guidance) logError('[操作] ' + line);
    logError('[错误] 环境准备未完成，已停止启动。');
  }
  return { exitCode: result.ok ? 0 : 1, report: result.report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((result) => {
    process.exitCode = result.exitCode;
  }).catch((error) => {
    console.error('[错误] 环境检查本身出错：' + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  });
}
