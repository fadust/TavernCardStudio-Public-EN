import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { parseDocument } from 'yaml';
import { createStudioServer } from './studio.mjs';
import { ROOT, readJSON } from './lib/files.mjs';
import { loadProject } from './lib/project.mjs';
import { parsePNG, readCardPNG } from './lib/png.mjs';

const output = path.join(ROOT, 'work/studio-verification');
await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(path.join(ROOT, 'work/test-studio-browser-'));
const opened = [];
const app = await createStudioServer({ root, openFolder: async folder => opened.push(folder) });
let browser;

async function apiPost(server, route, payload) {
  const response = await fetch(server.url + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Token': server.token },
    body: JSON.stringify(payload),
  });
  return response.json();
}

try {
  const channel = process.env.TAVERN_TEST_BROWSER || 'chrome';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });

  // ---- 入门引导、官方示例标识与「复制示例」：独立临时工作区，不碰真实 cards/ ----
  const examplesRoot = await fs.mkdtemp(path.join(ROOT, 'work/test-studio-examples-'));
  const examples = await createStudioServer({ root: examplesRoot, openFolder: async () => {} });
  try {
    assert.equal((await apiPost(examples, '/api/new', { name: '示例-雾港调查局', modules: ['worldbook'] })).ok, true);
    assert.equal((await apiPost(examples, '/api/new', { name: '我的测试卡', modules: [] })).ok, true);
    const exampleContext = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
    const examplePage = await exampleContext.newPage();
    const exampleErrors = [];
    examplePage.on('pageerror', error => exampleErrors.push(error.message));
    await examplePage.goto(examples.url + '/#token=' + examples.token);
    await expect(examplePage.locator('#app')).toBeVisible();

    // 三条入门入口都在，且说明写清了 src 与 dist 的位置。
    await expect(examplePage.locator('#onboarding')).toBeVisible();
    await expect(examplePage.locator('#onboardingNewBtn')).toBeVisible();
    await expect(examplePage.locator('#onboardingImportBtn')).toBeVisible();
    await expect(examplePage.locator('#onboardingExampleBtn')).toBeVisible();
    await expect(examplePage.locator('#onboarding')).toContainText('cards/工程名/src');
    await expect(examplePage.locator('#onboarding')).toContainText('dist/工程名');
    await examplePage.screenshot({ path: path.join(output, 'onboarding-entry.png'), fullPage: true });

    // 用户卡与官方示例在列表里分开计数，示例带标识。
    await expect(examplePage.locator('#listMeta')).toContainText('我的卡 1 张 · 官方示例 1 张');
    await expect(examplePage.locator('#cardList .chip-example')).toHaveCount(1);
    await expect(examplePage.locator('#cardList button', { hasText: '示例-雾港调查局' })).toContainText('官方示例');
    await examplePage.locator('#cardList button', { hasText: '示例-雾港调查局' }).click();
    await expect(examplePage.locator('#detailPanel')).toContainText('官方示例（复制后再改）');
    await expect(examplePage.locator('#detailPanel .alert-note')).toContainText('复制成我的卡');

    // 复制示例：默认去掉「示例-」前缀，示例原卡保持不动。
    await examplePage.locator('#onboardingExampleBtn').click();
    await expect(examplePage.locator('#exampleDialog')).toBeVisible();
    await expect(examplePage.locator('#exampleList input')).toHaveCount(1);
    await expect(examplePage.locator('#exampleName')).toHaveValue('雾港调查局');
    await expect(examplePage.locator('#exampleNote')).toContainText('cards/新工程名/src');
    await examplePage.locator('#exampleForm button[type=submit]').click();
    await expect(examplePage.locator('#detailPanel h2')).toHaveText('雾港调查局');
    await expect(examplePage.locator('#onboarding')).toBeHidden();
    await expect(examplePage.locator('#listMeta')).toContainText('我的卡 2 张 · 官方示例 1 张');
    await expect(examplePage.locator('#cardList .chip-example')).toHaveCount(1);
    const copied = await loadProject('雾港调查局', examplesRoot);
    assert.equal(copied.project.schemaVersion, 2);
    await fs.access(path.join(examplesRoot, 'cards/示例-雾港调查局/src'));
    await examplePage.screenshot({ path: path.join(output, 'onboarding.png'), fullPage: true });
    await examplePage.reload();
    await expect(examplePage.locator('#onboarding')).toBeHidden();
    assert.deepEqual(exampleErrors, [], '示例流程没有未处理错误');
    await exampleContext.close();
  } finally {
    await examples.close();
    await fs.rm(examplesRoot, { recursive: true, force: true });
  }

  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await context.newPage(); const errors = []; const external = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (route.request().url().startsWith(app.url + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(app.url + '/#token=' + app.token);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#listEmpty')).toBeVisible();
  await expect(page).toHaveURL(app.url + '/');
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('#newBtn').click();
  await page.locator('#newName').fill('灯塔书店');
  await page.locator('#newForm input[value=worldbook]').check();
  await page.locator('#newForm button[type=submit]').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('灯塔书店');
  await page.locator('#detailPanel').getByRole('button', { name: '检查', exact: true }).click();
  await expect(page.locator('#resultsBody')).toContainText('检查通过');
  // —— 整理世界书：新卡已按分类目录生成，先核对“无需整理”，再改回旧式平铺路径核对整理数、备份与引用 ——
  const organizeBtn = () => page.locator('#detailPanel').getByRole('button', { name: '整理世界书', exact: true });
  await organizeBtn().click();
  await expect(page.locator('#resultsBody')).toContainText('无需整理');
  const bookstore = path.join(root, 'cards/灯塔书店');
  const bookstoreIndex = path.join(bookstore, 'src/index.yaml');
  const entryBefore = 'src/worldbook/世界设定/世界观.yaml';
  const bodyBefore = 'src/worldbook/世界设定/世界观.md';
  const entryLegacy = 'src/worldbook/001-世界观.yaml';
  const bodyLegacy = 'src/worldbook/001-世界观.md';
  const indexDocument = parseDocument(await fs.readFile(bookstoreIndex, 'utf8'));
  let relocated = 0;
  for (const item of indexDocument.getIn(['世界书', '条目'], true).items) {
    if (String(item.value) === entryBefore) { item.value = entryLegacy; relocated += 1; }
  }
  assert.equal(relocated, 1, '索引里应能找到这一条世界书引用');
  await fs.writeFile(bookstoreIndex, indexDocument.toString({ lineWidth: 0 }));
  await fs.rename(path.join(bookstore, entryBefore), path.join(bookstore, entryLegacy));
  await fs.rename(path.join(bookstore, bodyBefore), path.join(bookstore, bodyLegacy));
  const entryDocument = parseDocument(await fs.readFile(path.join(bookstore, entryLegacy), 'utf8'));
  entryDocument.set('文件', bodyLegacy);
  await fs.writeFile(path.join(bookstore, entryLegacy), entryDocument.toString({ lineWidth: 0 }));
  await organizeBtn().click();
  await expect(page.locator('#resultsBody')).toContainText('已整理 1 项世界书');
  const backups = await fs.readdir(path.join(root, 'work/layout-backups'));
  assert.equal(backups.length, 1, '整理应留下一份备份');
  assert.match(backups[0], /^灯塔书店-/);
  await expect(page.locator('#resultsBody')).toContainText('原工程备份：work/layout-backups/' + backups[0]);
  await fs.access(path.join(bookstore, entryBefore));
  await fs.access(path.join(bookstore, bodyBefore));
  await fs.access(path.join(root, 'work/layout-backups', backups[0], entryLegacy));
  await assert.rejects(fs.access(path.join(bookstore, entryLegacy)));
  await assert.rejects(fs.access(path.join(bookstore, bodyLegacy)));
  assert.equal(parseDocument(await fs.readFile(path.join(bookstore, entryBefore), 'utf8')).get('文件'), bodyBefore);
  assert.ok((await fs.readFile(bookstoreIndex, 'utf8')).includes(entryBefore), '整理后索引应指回分类目录');
  const jpegData = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 560;
    const ctx = canvas.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 400, 560);
    g.addColorStop(0, '#b6a3d9'); g.addColorStop(1, '#26395d'); ctx.fillStyle = g; ctx.fillRect(0, 0, 400, 560);
    ctx.fillStyle = '#fff4d7'; ctx.beginPath(); ctx.arc(295, 130, 55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f6f3ff'; ctx.fillRect(158, 220, 82, 230); ctx.fillStyle = '#54486e'; ctx.fillRect(143, 211, 112, 18); ctx.fillRect(180, 350, 38, 100);
    ctx.fillStyle = '#fff4d7'; ctx.font = '26px sans-serif'; ctx.fillText('灯塔书店', 145, 510);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.locator('#detailPanel').getByRole('button', { name: '换封面', exact: true }).click();
  await page.locator('#coverFile').setInputFiles({ name: '封面.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegData, 'base64') });
  await expect(page.locator('#coverSubmit')).toBeEnabled();
  await page.locator('#coverSubmit').click();
  await expect(page.locator('#coverDialog')).not.toBeVisible();
  await expect(page.locator('#detailPanel img')).toBeVisible();
  await expect.poll(() => page.locator('#detailPanel img').evaluate(img => img.naturalWidth)).toBe(400);
  const webpData = await page.evaluate(async data => {
    const source = new Image(); source.src = 'data:image/jpeg;base64,' + data; await source.decode();
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 280;
    canvas.getContext('2d').drawImage(source, 0, 0, 200, 280);
    return canvas.toDataURL('image/webp').split(',')[1];
  }, jpegData);
  await page.locator('#detailPanel').getByRole('button', { name: '换封面', exact: true }).click();
  await page.locator('#coverFile').setInputFiles({ name: '第二张封面.webp', mimeType: 'image/webp', buffer: Buffer.from(webpData, 'base64') });
  await expect(page.locator('#coverSubmit')).toBeEnabled();
  await page.locator('#coverSubmit').click();
  await expect(page.locator('#coverDialog')).not.toBeVisible();
  await expect.poll(() => page.locator('#detailPanel img').evaluate(img => img.naturalWidth)).toBe(200);
  await page.locator('#detailPanel').getByRole('button', { name: '打包', exact: true }).click();
  await expect(page.locator('#resultsBody')).toContainText('生成 PNG：灯塔书店.png');
  const built = await readJSON(path.join(root, 'dist/灯塔书店/灯塔书店.json'));
  assert.deepEqual(readCardPNG(await fs.readFile(path.join(root, 'dist/灯塔书店/灯塔书店.png'))).card, built);
  const png = parsePNG(await fs.readFile(path.join(root, 'dist/灯塔书店/灯塔书店.png')));
  assert.equal(png[0].data.readUInt32BE(0), 200); assert.equal(png[0].data.readUInt32BE(4), 280);
  await page.locator('#detailPanel').getByRole('button', { name: '复制卡', exact: true }).click();
  await page.locator('#duplicateName').fill('灯塔书店-副本');
  await page.locator('#duplicateForm button[type=submit]').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('灯塔书店-副本');
  await page.locator('#detailPanel').getByRole('button', { name: '重命名', exact: true }).click();
  await page.locator('#renameProject').fill('海边旧书店');
  await page.locator('#renameCharacter').fill('艾琳');
  await page.locator('#renameForm button[type=submit]').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('海边旧书店');
  assert.equal((await loadProject('海边旧书店', root)).card.data.name, '艾琳');
  assert.equal((await loadProject('灯塔书店', root)).card.data.name, '灯塔书店');
  await page.locator('#importFileInput').setInputFiles(path.join(root, 'dist/灯塔书店/灯塔书店.png'));
  await page.locator('#importName').fill('导入的灯塔书店');
  await page.locator('#importForm button[type=submit]').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('导入的灯塔书店');
  assert.deepEqual((await loadProject('导入的灯塔书店', root)).card, built);
  const imported = await loadProject('导入的灯塔书店', root);
  assert.equal(imported.project.original.importPath, 'imports/灯塔书店.png');
  assert.deepEqual(await fs.readFile(path.join(root, 'imports/灯塔书店.png')), await fs.readFile(path.join(root, 'dist/灯塔书店/灯塔书店.png')));
  await expect(page.locator('#detailPanel')).toContainText('imports/灯塔书店.png');
  await page.locator('#detailPanel').getByRole('button', { name: '去封面', exact: true }).click();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#detailPanel')).toContainText('无封面');
  await page.locator('#detailPanel').getByRole('button', { name: '打包', exact: true }).click();
  await expect(page.locator('#resultsBody')).toContainText('生成 JSON：导入的灯塔书店.json');
  assert.equal((await fs.readdir(path.join(root, 'dist/导入的灯塔书店'))).some(f => f.endsWith('.png')), false);
  await page.locator('#detailPanel').getByRole('button', { name: /^(打开 )?内容文件夹$/, exact: true }).click();
  await expect.poll(() => opened.length).toBe(1);
  assert.equal(opened[0], path.join(root, 'cards/导入的灯塔书店/src'));
  await page.locator('#importsDirBtn').click();
  await expect.poll(() => opened.length).toBe(2);
  assert.equal(opened[1], path.join(root, 'imports'));
  await page.locator('#searchInput').fill('艾琳');
  await expect(page.locator('#cardList button')).toHaveCount(1);
  await page.locator('#cardList button').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('海边旧书店');
  await page.locator('#searchInput').fill('');
  await page.locator('#newBtn').click();
  await page.locator('#newName').fill('灯塔书店');
  await page.locator('#newForm button[type=submit]').click();
  await expect(page.locator('#newError')).toContainText('同名');
  await expect(page.locator('#newDialog')).toBeVisible();
  await page.locator('#newDialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#cardList button')).toHaveCount(3);
  await page.locator('#resultsClear').click();
  await expect(page.locator('#detailPanel img')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '手机宽度横向溢出');
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, [], '浏览器未处理错误'); assert.deepEqual(external, [], '不请求外部资源');
  await page.locator('#shutdownBtn').click(); await page.locator('#confirmOk').click();
  await expect(page.locator('#shutdownNotice')).toBeVisible();
  const result = { ok: true, flow: ['entry guidance', 'official example badge', 'copy example', 'new', 'check', 'organize worldbook (no-op + relocate with backup)', 'JPEG cover', 'replace WebP cover + preview', 'build PNG + JSON', 'duplicate', 'rename', 'import PNG', 'remove cover', 'build JSON', 'open folder callback', 'search', 'name collision error', 'refresh session', 'responsive', 'shutdown'], errors, external, realTavern: false };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  await browser?.close(); await app.close(); await fs.rm(root, { recursive: true, force: true });
}
