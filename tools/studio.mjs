import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/files.mjs';
import { createOperations, MAX_UPLOAD } from './lib/studio-operations.mjs';

const UI = path.join(import.meta.dirname, 'studio-ui');
const APP = 'TavernCardStudio-local';
export function openLocal(target) {
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === 'win32') {
      // Pass a literal string through an encoded PowerShell command, never through cmd interpolation.
      const literal = target.replaceAll("'", "''");
      const command = `Start-Process -FilePath '${literal}'`;
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    } else child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('无法自动打开，请使用页面显示的文件夹路径。')));
  });
}
async function body(req) {
  const maximum = Math.ceil(MAX_UPLOAD / 3) * 4 + 64 * 1024;
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new Error('请求必须为 JSON。');
  const parts = []; let size = 0;
  for await (const bytes of req) {
    size += bytes.length;
    if (size > maximum) throw new Error('文件超过 64 MB，请缩小后重试。');
    parts.push(bytes);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new Error('请求数据无效。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('请求数据必须为对象。');
  return data;
}

export async function createStudioServer({ root = ROOT, token = randomBytes(32).toString('hex'), port = 0, openFolder = openLocal } = {}) {
  const operations = createOperations({ root, openFolder });
  let busy = false; let url; let closed = false;
  const routes = {
    '/api/import': 'importCard', '/api/new': 'newCard', '/api/rename': 'renameCard', '/api/duplicate': 'duplicateCard',
    '/api/cover': 'setCover', '/api/remove-cover': 'removeCover', '/api/check': 'checkCard', '/api/build': 'buildCard',
    '/api/organize': 'organizeCard', '/api/arrange': 'arrangeCard', '/api/open': 'open',
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== new URL(url).host) return json(403, { ok: false, error: '请使用启动器打开本地工具。' });
      const request = new URL(req.url, url);
      if (request.pathname.startsWith('/api/')) {
        if (req.headers['x-studio-token'] !== token || (req.headers.origin && req.headers.origin !== url)) return json(403, { ok: false, error: '连接已失效，请从仓库根目录重新打开工具。' });
        if (req.method === 'GET' && request.pathname === '/api/ping') return json(200, { ok: true, app: APP, root: path.resolve(root) });
        if (busy) return json(409, { ok: false, error: '正在处理上一项操作，请完成后再试。' });
        if (req.method === 'GET' && request.pathname === '/api/cards') {
          busy = true;
          try { return json(200, await operations.listCards()); } finally { busy = false; }
        }
        if (req.method === 'GET' && request.pathname === '/api/cover') {
          const bytes = await operations.cover(request.searchParams.get('name'));
          res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(bytes);
        }
        if (req.method !== 'POST') return json(404, { ok: false, error: '未知操作。' });
        // Hold the lock during body reception too: two browser tabs cannot mutate one card concurrently.
        busy = true;
        try {
          const data = await body(req);
          if (request.pathname === '/api/shutdown') {
            json(200, { ok: true });
            setTimeout(() => close(), 100);
            return;
          }
          const method = routes[request.pathname];
          if (!method) return json(404, { ok: false, error: '未知操作。' });
          return json(200, await operations[method](data));
        } finally { busy = false; }
      }
      if (req.method !== 'GET') return json(405, { ok: false, error: '不支持此操作。' });
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const item = files[request.pathname];
      if (!item) { res.writeHead(404); return res.end(); }
      const bytes = await fs.readFile(path.join(UI, item[0]));
      res.writeHead(200, { 'Content-Type': item[1] + '; charset=utf-8' }); res.end(bytes);
    } catch (error) {
      if (!res.headersSent) json(400, { ok: false, error: error.message });
      else res.end();
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${server.address().port}`;
  async function close() {
    if (closed) return;
    closed = true;
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
  }
  return { server, url, token, close };
}

export async function launch({ root = ROOT, open = false } = {}) {
  root = path.resolve(root);
  const work = path.join(root, 'work'); await fs.mkdir(work, { recursive: true });
  if ((await fs.lstat(work)).isSymbolicLink()) throw new Error('work 文件夹不能是链接。');
  const sessionFile = path.join(work, 'studio-session.json');
  const lockFile = path.join(work, 'studio-launch.lock');
  async function existing() {
    try {
      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(session.url) || !/^[a-f0-9]{64}$/.test(session.token)) return null;
      const response = await fetch(session.url + '/api/ping', { headers: { 'X-Studio-Token': session.token }, signal: AbortSignal.timeout(1500) });
      const data = await response.json();
      if (data.app === APP && data.root === root) return session;
    } catch {}
    return null;
  }
  async function show(session) {
    const address = session.url + '/#token=' + session.token;
    if (open) { try { await openLocal(address); } catch (error) { console.warn(error.message); console.log(address); } }
    else console.log(address);
  }
  const running = await existing();
  if (running) { await show(running); console.log('已打开正在运行的创作工具。'); return; }
  let lock;
  try { lock = await fs.open(lockFile, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    for (let i = 0; i < 15; i++) {
      const session = await existing();
      if (session) { await show(session); return; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    let live = false;
    try { const pid = Number(await fs.readFile(lockFile, 'utf8')); if (pid > 0) { process.kill(pid, 0); live = true; } } catch {}
    if (live) throw new Error('另一个工具正在启动，请稍后再双击。');
    await fs.unlink(lockFile); lock = await fs.open(lockFile, 'wx');
  }
  await lock.writeFile(String(process.pid)); await lock.close();
  let app;
  try {
    app = await createStudioServer({ root });
    const stopped = new Promise(resolve => app.server.once('close', resolve));
    await fs.writeFile(sessionFile, JSON.stringify({ url: app.url, token: app.token, pid: process.pid }));
    console.log('角色卡创作工具已启动。保留此窗口；关闭窗口或点击页面中的“关闭工具”即可停止。');
    console.log(`工作区：${root}`);
    await show(app);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close());
    await stopped;
  } finally {
    await app?.close();
    await fs.rm(sessionFile, { force: true }); await fs.rm(lockFile, { force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  launch({ open: process.argv.includes('--open') }).catch(error => { console.error('启动失败：' + error.message); process.exitCode = 1; });
}
