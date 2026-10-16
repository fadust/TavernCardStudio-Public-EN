import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ---------------------------------------------------------------------------
   TavernCardStudio pre-launch environment check

   - `node tools/setup.mjs`(or --ensure): check the environment; install missing or outdated dependencies once with
     pnpm --frozen-lockfile; print guidance and exit with code 1 if requirements are unmet.
   - `node tools/setup.mjs --check`(doctor): read-only inspection; never install dependencies
     or write files. Report problems through exit code 1 and explanatory text.

   Only inspect and install project dependencies; never install Node.js or change global pnpm.
   --------------------------------------------------------------------------- */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_ARGS = ['install', '--frozen-lockfile'];

/* ===================== Version comparison ===================== */

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

// Parse common package.json >= ranges only; return null for the caller to handle unsupported ranges.
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

/* ===================== Commands ===================== */

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
      error: error && error.code === 'ENOENT' ? 'Command not found: ' + command : (error ? error.message : String(error)),
    }));
    child.once('close', (code) => finish({ code, stdout, stderr }));
  });
}

// Windows .cmd files must launch through cmd.exe; pass an argument array
// and allow only plain argument characters to prevent command injection.
function assertPlainArguments(args) {
  for (const arg of args) {
    if (!/^[A-Za-z0-9@=._,:\/\\-]+$/.test(String(arg))) {
      throw new Error('Internal error: unsafe command argument ' + JSON.stringify(String(arg)));
    }
  }
}

// Shared with tests and doctor: Windows uses cmd.exe + pnpm.cmd; other platforms call pnpm directly.
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

/* ===================== Environment report ===================== */

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
    // Compare exact declared versions; lockfile drift detects changes to ranges.
    if (/^v?\d+\.\d+\.\d+$/.test(wanted)) {
      const compared = compareVersions(installed.version, wanted);
      if (compared !== 0) result.mismatched.push(name + ': installed ' + installed.version + '; package.json requires ' + wanted);
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
 * Read-only inspection of package.json, lockfile, and node_modules; run pnpm --version and where/which.
 * Never install dependencies or write files. Shared with doctor and tests.
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
    report.problems.push('Cannot read package.json. Run this in a complete TavernCardStudio repository.');
    return report;
  }

  const nodeRange = manifest.engines && manifest.engines.node ? String(manifest.engines.node) : null;
  report.node.required = nodeRange;
  const nodeSatisfied = nodeRange ? satisfiesRange(nodeVersion, nodeRange) : true;
  if (nodeSatisfied === false) {
    report.node.message = 'Node.js version is too old: current ' + nodeVersion + '; required ' + nodeRange + '.';
    report.problems.push(report.node.message);
    report.guidance.push('Install Node.js ' + nodeRange.replace(/^[>=^~\s]+/, '') + ' or newer (https://nodejs.org/), then reopen the launcher.');
  } else if (nodeSatisfied === null) {
    report.node.ok = true;
    report.node.message = 'Node.js ' + nodeVersion + ' cannot automatically compare engines.node (' + nodeRange + '); version comparison skipped.';
  } else {
    report.node.ok = true;
    report.node.message = 'Node.js ' + nodeVersion + ' OK' + (nodeRange ? ' (required ' + nodeRange + ')' : '') + '.';
  }

  // Record pnpm issues as warnings when dependencies are ready, or blockers when installation is needed.
  let pnpmIssue = '';
  const pnpmGuidance = [];
  const manager = parsePackageManager(manifest.packageManager);
  if (!manager) {
    pnpmIssue = 'package.json lacks a recognized packageManager field; cannot determine the pnpm version.';
  } else if (manager.name !== 'pnpm') {
    pnpmIssue = 'packageManager specifies ' + manager.name + '; this tool requires pnpm.';
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
    const detail = probe && (probe.error || String(probe.stderr || '').trim()) ? ' (' + String(probe.error || probe.stderr).trim().split(/\r?\n/)[0] + ')' : '';
    if (!pnpmIssue) pnpmIssue = 'No usable pnpm found' + detail + '.';
    report.pnpm.message = pnpmIssue;
    pnpmGuidance.push('If Corepack is installed, run corepack enable pnpm in the repository root, then: corepack prepare pnpm@' + (manager ? manager.version : '<Version>') + ' --activate');
    pnpmGuidance.push('Alternatively, install the matching version yourself: npm install -g pnpm@' + (manager ? manager.version : '<Version>') + '. This tool never installs or changes global versions.');
  } else {
    report.pnpm.found = true;
    report.pnpm.version = foundVersion;
    if (report.pnpm.required && compareVersions(foundVersion, report.pnpm.required) !== 0) {
      if (!pnpmIssue) pnpmIssue = 'pnpm version mismatch: current ' + foundVersion + '; packageManager requires ' + report.pnpm.required + '.';
      report.pnpm.message = pnpmIssue;
      pnpmGuidance.push('Switch to the version in package.json: corepack prepare pnpm@' + report.pnpm.required + ' --activate; or npm install -g pnpm@' + report.pnpm.required + '.');
    } else {
      report.pnpm.ok = true;
      report.pnpm.message = 'pnpm ' + foundVersion + (report.pnpm.required ? ' (required ' + report.pnpm.required + ')' : '') + ' OK.';
    }
  }

  const lockText = await readTextFile(path.join(root, 'pnpm-lock.yaml'));
  report.lockfile.present = lockText !== null;
  report.lockfile.ok = lockText !== null;
  report.lockfile.message = lockText !== null ? 'pnpm-lock.yaml is present.' : 'Missing pnpm-lock.yaml; cannot install with a frozen lockfile. Obtain the complete repository.';
  if (!report.lockfile.ok) report.problems.push(report.lockfile.message);

  const dependencies = await inspectDependencies(root, manifest);
  dependencies.message = (() => {
    if (dependencies.ok) return 'Dependencies ' + dependencies.checked + '/' + dependencies.declared + ' are ready and match pnpm-lock.yaml.';
    if (dependencies.reason === 'no-node-modules') return 'Dependencies are not installed (node_modules is missing).';
    if (dependencies.reason === 'lockfile-missing') return 'Missing pnpm-lock.yaml; cannot determine dependency status.';
    if (dependencies.reason === 'lockfile-drift') return 'Dependencies differ from pnpm-lock.yaml (package.json or the lockfile changed).';
    if (dependencies.missing.length) return 'Missing ' + dependencies.missing.length + ' dependencies: ' + dependencies.missing.slice(0, 6).join(', ') + (dependencies.missing.length > 6 ? ' and others' : '') + '.';
    if (dependencies.mismatched.length) return dependencies.mismatched.length + ' dependency versions differ from package.json.';
    return 'Unexpected dependency state.';
  })();
  report.dependencies = dependencies;
  const dependenciesReady = dependencies.ok;
  if (!dependenciesReady && report.lockfile.ok) {
    report.problems.push('Dependencies need installation or updates: ' + dependencies.message);
  }

  if (pnpmIssue) {
    for (const line of pnpmGuidance) report.guidance.push(line);
    if (dependenciesReady) {
      report.pnpm.message = pnpmIssue.replace(/\.$/, '') + ' (dependencies are ready; pnpm is needed only for future dependency installs or upgrades).';
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
  lines.push((report.node.ok ? '[OK] ' : '[PROBLEM] ') + report.node.message);
  lines.push((report.pnpm.ok ? '[OK] ' : (report.warnings.includes(report.pnpm.message) ? '[WARNING] ' : '[PROBLEM] ')) + report.pnpm.message);
  lines.push((report.lockfile.ok ? '[OK] ' : '[PROBLEM] ') + report.lockfile.message);
  lines.push((report.dependencies.ok ? '[OK] ' : '[PROBLEM] ') + report.dependencies.message);
  if (report.dependencies.lockDrift) lines.push('[PROBLEM] Dependencies differ from the lockfile; reinstall using the lockfile.');
  return lines;
}

/**
 * Check the environment; if allowed, install once with the declared pnpm and a frozen lockfile.
 * Return { ok, installed, report, problems, guidance } without throwing.
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
    log('[OK] Environment ready. The creator tool can start.');
    return { ok: true, installed: false, report, problems: [], guidance: [] };
  }
  const canInstall = allowInstall && report.needsInstall && report.node.ok && report.pnpm.ok;
  if (canInstall) {
    const install = pnpmInvocation(settings.platform || process.platform, INSTALL_ARGS);
    log('[WORKING] Dependencies are missing or outdated. Installing with the lockfile: ' + install.display);
    const result = await runCommand(install.command, install.args, {
      cwd: report.root,
      env: settings.env || process.env,
      stdio: 'inherit',
    });
    if (!result || result.code !== 0) {
      const detail = result && result.error ? ': ' + result.error : '';
      // pnpm may exit nonzero for skipped build scripts such as esbuild; inspect actual dependency state before reporting failure.
      const after = await inspectEnvironment(settings);
      if (after.ok) {
        for (const line of formatReport(after)) log(line);
        log('[WARNING] pnpm exited with a nonzero status' + detail + ', but dependencies are ready (often caused by build-script notices). Continuing startup.');
        return { ok: true, installed: true, report: after, problems: [], guidance: [] };
      }
      logError('[ERROR] Dependency installation failed' + detail + '. Check the network and pnpm output above, then reopen the launcher.');
      return { ok: false, installed: false, report: after, problems: ['Dependency installation failed.'], guidance: ['Confirm network access, then reopen the launcher. If it still fails, run in the repository root: ' + install.display + ', and send the output to the maintainer.'] };
    }
    report = await inspectEnvironment(settings);
    for (const line of formatReport(report)) log(line);
    if (!report.ok) {
      logError('[ERROR] Dependency checks still fail after installation. Send the output above to the maintainer.');
      return { ok: false, installed: true, report, problems: report.problems, guidance: report.guidance };
    }
    log('[OK] Dependencies ready. The creator tool can start.');
    return { ok: true, installed: true, report, problems: [], guidance: [] };
  }
  if (!allowInstall && report.needsInstall) {
    report.guidance.unshift('Read-only checks do not install dependencies. To install, run in the repository root: pnpm install --frozen-lockfile.');
  }
  return { ok: false, installed: false, report, problems: report.problems, guidance: report.guidance };
}

/* ===================== CLI entry point ===================== */

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
    log('Usage: node tools/setup.mjs [--ensure|--check] [--json] [--root <repository-directory>]');
    log('  --ensure  Check environment and install missing/outdated dependencies using pnpm-lock.yaml (default)');
    log('  --check   Read-only checks; do not install dependencies (used by doctor)');
    log('  --json    Print check results as JSON');
    return { exitCode: 0, report: null };
  }
  if (parsed.unknown.length) {
    logError('[ERROR] Unknown arguments: ' + parsed.unknown.join(' '));
    logError('[Operation] Usage: node tools/setup.mjs [--ensure|--check] [--json] [--root <repository-directory>]');
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
      if (report.ok) log('[OK] Environment ready. The creator tool can start.');
      else {
        if (report.needsInstall) log('[Operation] Read-only checks do not install dependencies. To install, run in the repository root: pnpm install --frozen-lockfile.');
        for (const line of report.guidance) log('[Operation] ' + line);
        logError('[ERROR] Environment check failed (read-only; no dependencies installed).');
      }
    }
    return { exitCode: report.ok ? 0 : 1, report };
  }
  const result = await ensureEnvironment({ ...shared, log, logError });
  if (parsed.json) log(JSON.stringify({ ok: result.ok, installed: result.installed, report: result.report }, null, 2));
  if (!result.ok) {
    for (const line of result.guidance) logError('[Operation] ' + line);
    logError('[ERROR] Environment preparation incomplete; startup stopped.');
  }
  return { exitCode: result.ok ? 0 : 1, report: result.report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((result) => {
    process.exitCode = result.exitCode;
  }).catch((error) => {
    console.error('[ERROR] Environment check error: ' + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  });
}
