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

  // ---- Onboarding, official example badges, and copying in an isolated workspace ----
  const examplesRoot = await fs.mkdtemp(path.join(ROOT, 'work/test-studio-examples-'));
  const examples = await createStudioServer({ root: examplesRoot, openFolder: async () => {} });
  try {
    assert.equal((await apiPost(examples, '/api/new', { name: 'example-fogharbor-bureau', modules: ['worldbook'] })).ok, true);
    assert.equal((await apiPost(examples, '/api/new', { name: 'my-test-card', modules: [] })).ok, true);
    const exampleContext = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
    const examplePage = await exampleContext.newPage();
    const exampleErrors = [];
    examplePage.on('pageerror', error => exampleErrors.push(error.message));
    await examplePage.goto(examples.url + '/#token=' + examples.token);
    await expect(examplePage.locator('#app')).toBeVisible();

    // All three onboarding actions explain the source and output locations.
    await expect(examplePage.locator('#onboarding')).toBeVisible();
    await expect(examplePage.locator('#onboardingNewBtn')).toBeVisible();
    await expect(examplePage.locator('#onboardingImportBtn')).toBeVisible();
    await expect(examplePage.locator('#onboardingExampleBtn')).toBeVisible();
    await expect(examplePage.locator('#onboarding')).toContainText('cards/project-name/src');
    await expect(examplePage.locator('#onboarding')).toContainText('dist/project-name');
    await examplePage.screenshot({ path: path.join(output, 'onboarding-entry.png'), fullPage: true });

    // Count user cards and official examples separately and mark examples.
    await expect(examplePage.locator('#listMeta')).toContainText('My cards: 1 · Official examples: 1 cards');
    await expect(examplePage.locator('#cardList .chip-example')).toHaveCount(1);
    await expect(examplePage.locator('#cardList button', { hasText: 'example-fogharbor-bureau' })).toContainText('Official example');
    await examplePage.locator('#cardList button', { hasText: 'example-fogharbor-bureau' }).click();
    await expect(examplePage.locator('#detailPanel')).toContainText('Official example (copy before editing)');
    await expect(examplePage.locator('#detailPanel .alert-note')).toContainText('Copy as my card');

    // Copy examples without their prefix and retain the original.
    await examplePage.locator('#onboardingExampleBtn').click();
    await expect(examplePage.locator('#exampleDialog')).toBeVisible();
    await expect(examplePage.locator('#exampleList input')).toHaveCount(1);
    await expect(examplePage.locator('#exampleName')).toHaveValue('fogharbor-bureau');
    await expect(examplePage.locator('#exampleNote')).toContainText('cards/new-project/src');
    await examplePage.locator('#exampleForm button[type=submit]').click();
    await expect(examplePage.locator('#detailPanel h2')).toHaveText('fogharbor-bureau');
    await expect(examplePage.locator('#onboarding')).toBeHidden();
    await expect(examplePage.locator('#listMeta')).toContainText('My cards: 2 · Official examples: 1 cards');
    await expect(examplePage.locator('#cardList .chip-example')).toHaveCount(1);
    const copied = await loadProject('fogharbor-bureau', examplesRoot);
    assert.equal(copied.project.schemaVersion, 2);
    await fs.access(path.join(examplesRoot, 'cards/example-fogharbor-bureau/src'));
    await examplePage.screenshot({ path: path.join(output, 'onboarding.png'), fullPage: true });
    await examplePage.reload();
    await expect(examplePage.locator('#onboarding')).toBeHidden();
    assert.deepEqual(exampleErrors, [], 'No unhandled errors in the example flow');
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
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('TavernCardStudio · Card Studio');
  await expect(page.locator('#listEmpty')).toBeVisible();
  await expect(page).toHaveURL(app.url + '/');
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('#newBtn').click();
  await page.locator('#newName').fill('lighthouse-bookshop');
  await page.locator('#newForm input[value=worldbook]').check();
  await page.locator('#newForm button[type=submit]').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('lighthouse-bookshop');
  await page.locator('#detailPanel').getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.locator('#resultsBody')).toContainText('Check passed');
  // —— Check no-op organization, then flatten one entry to verify relocation, backup, and references ——
  const organizeBtn = () => page.locator('#detailPanel').getByRole('button', { name: 'Organize worldbook', exact: true });
  await organizeBtn().click();
  await expect(page.locator('#resultsBody')).toContainText('No organization needed');
  const bookstore = path.join(root, 'cards/lighthouse-bookshop');
  const bookstoreIndex = path.join(bookstore, 'src/index.yaml');
  const entryBefore = 'src/worldbook/setting/World setting.yaml';
  const bodyBefore = 'src/worldbook/setting/World setting.md';
  const entryLegacy = 'src/worldbook/001-World setting.yaml';
  const bodyLegacy = 'src/worldbook/001-World setting.md';
  const indexDocument = parseDocument(await fs.readFile(bookstoreIndex, 'utf8'));
  let relocated = 0;
  for (const item of indexDocument.getIn(['worldbook', 'entries'], true).items) {
    if (String(item.value) === entryBefore) { item.value = entryLegacy; relocated += 1; }
  }
  assert.equal(relocated, 1, 'Index must contain this worldbook reference');
  await fs.writeFile(bookstoreIndex, indexDocument.toString({ lineWidth: 0 }));
  await fs.rename(path.join(bookstore, entryBefore), path.join(bookstore, entryLegacy));
  await fs.rename(path.join(bookstore, bodyBefore), path.join(bookstore, bodyLegacy));
  const entryDocument = parseDocument(await fs.readFile(path.join(bookstore, entryLegacy), 'utf8'));
  entryDocument.set('file', bodyLegacy);
  await fs.writeFile(path.join(bookstore, entryLegacy), entryDocument.toString({ lineWidth: 0 }));
  await organizeBtn().click();
  await expect(page.locator('#resultsBody')).toContainText('Organized 1 worldbook entries');
  await expect(page.locator('#resultsBody .result').first()).toContainText('Worldbook categories are complete');
  const backups = await fs.readdir(path.join(root, 'work/layout-backups'));
  assert.equal(backups.length, 1, 'Organizing must retain one backup');
  assert.match(backups[0], /^lighthouse-bookshop-/);
  await expect(page.locator('#resultsBody')).toContainText('Original project backup: work/layout-backups/' + backups[0]);
  await fs.access(path.join(bookstore, entryBefore));
  await fs.access(path.join(bookstore, bodyBefore));
  await fs.access(path.join(root, 'work/layout-backups', backups[0], entryLegacy));
  await assert.rejects(fs.access(path.join(bookstore, entryLegacy)));
  await assert.rejects(fs.access(path.join(bookstore, bodyLegacy)));
  assert.equal(parseDocument(await fs.readFile(path.join(bookstore, entryBefore), 'utf8')).get('file'), bodyBefore);
  assert.ok((await fs.readFile(bookstoreIndex, 'utf8')).includes(entryBefore), 'Organized index must reference the category directory');
  // —— Restore old numbering to verify reordering, backups, and API results ——
  const arrangeBtn = () => page.locator('#detailPanel').getByRole('button', { name: 'Number in prompt order', exact: true });
  async function setEntryValue(relative, key, value) {
    const file = path.join(bookstore, relative);
    const document = parseDocument(await fs.readFile(file, 'utf8'));
    document.set(key, value);
    await fs.writeFile(file, document.toString({ lineWidth: 0 }));
  }
  await setEntryValue('src/worldbook/setting/World setting.yaml', 'order', 300);
  await setEntryValue('src/worldbook/geography/Geography overview.yaml', 'order', 200);
  await setEntryValue('src/worldbook/geography/Used bookshop.yaml', 'order', 100);
  await arrangeBtn().click();
  const arrangeResult = page.locator('#resultsBody .result').first();
  await expect(arrangeResult).toContainText('Number in prompt order · lighthouse-bookshop');
  await expect(arrangeResult).toContainText('Numbered in prompt order');
  await expect(arrangeResult).toContainText('Entries with changed order');
  const ordered = await loadProject('lighthouse-bookshop', root);
  assert.deepEqual(ordered.card.data.character_book.entries.map((entry) => entry.comment), ['Used bookshop', 'Geography overview', 'World setting', 'Character overview', 'Bookseller', 'Knowledge boundaries'], 'Reordered index must follow prompt order');
  assert.deepEqual(ordered.card.data.character_book.entries.map((entry) => entry.insertion_order), [1, 2, 3, 4, 5, 6], 'Reordered entries must be consecutively numbered 1..N');
  await fs.access(path.join(bookstore, 'src/worldbook/geography/Used bookshop.yaml'));
  // Restore old numbering again to check API results, backup paths, and idempotence.
  await setEntryValue('src/worldbook/setting/World setting.yaml', 'order', 900);
  const reshuffled = await apiPost(app, '/api/arrange', { name: 'lighthouse-bookshop' });
  assert.equal(reshuffled.arranged, true);
  assert.equal(reshuffled.order, 'prompt');
  assert.ok(reshuffled.changes.length >= 1, 'Reordering must report changed entries');
  assert.ok(reshuffled.backup, 'Reordering must return a backup path');
  await fs.access(path.isAbsolute(reshuffled.backup) ? reshuffled.backup : path.join(root, reshuffled.backup));
  const settled = await apiPost(app, '/api/arrange', { name: 'lighthouse-bookshop' });
  assert.equal(settled.arranged, false, 'Repeating an already ordered operation must be a no-op');
  assert.deepEqual(settled.changes, []);
  // Complex positions such as author notes and outlets require explicit index order.
  await setEntryValue('src/worldbook/rules/Knowledge boundaries.yaml', 'position', 'outlet');
  const refused = await apiPost(app, '/api/arrange', { name: 'lighthouse-bookshop' });
  assert.equal(refused.ok, false);
  assert.match(String(refused.error), /--order index/);
  await setEntryValue('src/worldbook/rules/Knowledge boundaries.yaml', 'position', 'at_depth');
  const jpegData = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 560;
    const ctx = canvas.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 400, 560);
    g.addColorStop(0, '#b6a3d9'); g.addColorStop(1, '#26395d'); ctx.fillStyle = g; ctx.fillRect(0, 0, 400, 560);
    ctx.fillStyle = '#fff4d7'; ctx.beginPath(); ctx.arc(295, 130, 55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f6f3ff'; ctx.fillRect(158, 220, 82, 230); ctx.fillStyle = '#54486e'; ctx.fillRect(143, 211, 112, 18); ctx.fillRect(180, 350, 38, 100);
    ctx.fillStyle = '#fff4d7'; ctx.font = '26px sans-serif'; ctx.fillText('lighthouse-bookshop', 145, 510);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.locator('#detailPanel').getByRole('button', { name: 'Change cover', exact: true }).click();
  await page.locator('#coverFile').setInputFiles({ name: 'Cover.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegData, 'base64') });
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
  await page.locator('#detailPanel').getByRole('button', { name: 'Change cover', exact: true }).click();
  await page.locator('#coverFile').setInputFiles({ name: 'second-cover.webp', mimeType: 'image/webp', buffer: Buffer.from(webpData, 'base64') });
  await expect(page.locator('#coverSubmit')).toBeEnabled();
  await page.locator('#coverSubmit').click();
  await expect(page.locator('#coverDialog')).not.toBeVisible();
  await expect.poll(() => page.locator('#detailPanel img').evaluate(img => img.naturalWidth)).toBe(200);
  await page.locator('#detailPanel').getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('#resultsBody')).toContainText('Generated PNG: lighthouse-bookshop.png');
  const built = await readJSON(path.join(root, 'dist/lighthouse-bookshop/lighthouse-bookshop.json'));
  assert.deepEqual(readCardPNG(await fs.readFile(path.join(root, 'dist/lighthouse-bookshop/lighthouse-bookshop.png'))).card, built);
  const png = parsePNG(await fs.readFile(path.join(root, 'dist/lighthouse-bookshop/lighthouse-bookshop.png')));
  assert.equal(png[0].data.readUInt32BE(0), 200); assert.equal(png[0].data.readUInt32BE(4), 280);
  await page.locator('#detailPanel').getByRole('button', { name: 'Copy card', exact: true }).click();
  await page.locator('#duplicateName').fill('lighthouse-bookshop-copy');
  await page.locator('#duplicateForm button[type=submit]').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('lighthouse-bookshop-copy');
  await page.locator('#detailPanel').getByRole('button', { name: 'Rename', exact: true }).click();
  await page.locator('#renameProject').fill('seaside-bookshop');
  await page.locator('#renameCharacter').fill('Erin');
  await page.locator('#renameForm button[type=submit]').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('seaside-bookshop');
  assert.equal((await loadProject('seaside-bookshop', root)).card.data.name, 'Erin');
  assert.equal((await loadProject('lighthouse-bookshop', root)).card.data.name, 'lighthouse-bookshop');
  await page.locator('#importFileInput').setInputFiles(path.join(root, 'dist/lighthouse-bookshop/lighthouse-bookshop.png'));
  await page.locator('#importName').fill('imported-lighthouse-bookshop');
  await page.locator('#importForm button[type=submit]').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('imported-lighthouse-bookshop');
  assert.deepEqual((await loadProject('imported-lighthouse-bookshop', root)).card, built);
  const imported = await loadProject('imported-lighthouse-bookshop', root);
  assert.equal(imported.project.original.importPath, 'imports/lighthouse-bookshop.png');
  assert.deepEqual(await fs.readFile(path.join(root, 'imports/lighthouse-bookshop.png')), await fs.readFile(path.join(root, 'dist/lighthouse-bookshop/lighthouse-bookshop.png')));
  await expect(page.locator('#detailPanel')).toContainText('imports/lighthouse-bookshop.png');
  // Import results explain uncategorized entries and AI batching without implying semantic classification.
  const importResult = page.locator('#resultsBody .result').first();
  await expect(importResult).toContainText('Import card · imported-lighthouse-bookshop');
  await expect(importResult).toContainText(/Uncategorized: \d+ entries/);
  await expect(importResult).toContainText('src/worldbook/uncategorized/');
  await expect(importResult).toContainText('never from body content');
  await expect(importResult).toContainText('then run “Organize worldbook”');
  await page.locator('#detailPanel').getByRole('button', { name: 'Remove cover', exact: true }).click();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#detailPanel')).toContainText('No cover');
  await page.locator('#detailPanel').getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('#resultsBody')).toContainText('Generated JSON: imported-lighthouse-bookshop.json');
  assert.equal((await fs.readdir(path.join(root, 'dist/imported-lighthouse-bookshop'))).some(f => f.endsWith('.png')), false);
  await page.locator('#detailPanel').getByRole('button', { name: /^(Open )?Source folder$/, exact: true }).click();
  await expect.poll(() => opened.length).toBe(1);
  assert.equal(opened[0], path.join(root, 'cards/imported-lighthouse-bookshop/src'));
  await page.locator('#importsDirBtn').click();
  await expect.poll(() => opened.length).toBe(2);
  assert.equal(opened[1], path.join(root, 'imports'));
  await page.locator('#searchInput').fill('Erin');
  await expect(page.locator('#cardList button')).toHaveCount(1);
  await page.locator('#cardList button').click();
  await expect(page.locator('#detailPanel h2')).toHaveText('seaside-bookshop');
  await page.locator('#searchInput').fill('');
  await page.locator('#newBtn').click();
  await page.locator('#newName').fill('lighthouse-bookshop');
  await page.locator('#newForm button[type=submit]').click();
  await expect(page.locator('#newError')).toContainText('A project with that name already exists');
  await expect(page.locator('#newDialog')).toBeVisible();
  await page.locator('#newDialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#cardList button')).toHaveCount(3);
  await page.locator('#resultsClear').click();
  await expect(page.locator('#detailPanel img')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow at mobile width');
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, [], 'Unhandled browser errors'); assert.deepEqual(external, [], 'No external resource requests');
  await page.locator('#shutdownBtn').click(); await page.locator('#confirmOk').click();
  await expect(page.locator('#shutdownNotice')).toBeVisible();
  const result = { ok: true, flow: ['entry guidance', 'official example badge', 'copy example', 'new', 'check', 'organize worldbook (no-op + relocate with backup + classification)', 'arrange worldbook order (prompt renumber + backup + refusal)', 'JPEG cover', 'replace WebP cover + preview', 'build PNG + JSON', 'duplicate', 'rename', 'import PNG', 'pending classification feedback', 'remove cover', 'build JSON', 'open folder callback', 'search', 'name collision error', 'refresh session', 'responsive', 'shutdown'], errors, external, realTavern: false };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  await browser?.close(); await app.close(); await fs.rm(root, { recursive: true, force: true });
}
