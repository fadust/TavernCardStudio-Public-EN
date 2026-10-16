import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { ROOT, readJSON, writeJSON, sha256 } from './lib/files.mjs';
import { applyRegexFixture } from './lib/validation.mjs';

const output = path.join(ROOT, 'work/ui-verification');
await fs.mkdir(output, { recursive: true });
let browser;
const results = [];
try {
  // Use an installed browser; this test neither downloads browsers nor starts a dev server.
  browser = await chromium.launch({ channel: process.env.TAVERN_TEST_BROWSER || 'chrome', headless: true });
  for (const [name, kind] of [['example-status-panel', 'html'], ['example-vue', 'vue'], ['example-mvu-vue', 'mvu']]) {
    for (const width of [375, 1100]) {
      const context = await browser.newContext({ viewport: { width, height: 700 } });
      const page = await context.newPage(); const errors = []; const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
      await context.setOffline(true);
      if (kind === 'mvu') {
        await page.addInitScript(() => {
          window.__testState = { scene: { location: 'Dockside bookshop', phase: 'Meeting' }, character: { mood: 'Calm', trust: 12 } };
          window.waitGlobalInitialized = async () => {};
          window.getCurrentMessageId = () => 7;
          window.Mvu = { getMvuData: () => ({ stat_data: window.__testState }) };
        });
      }
      await page.goto('about:blank');
      // setContent uses the packed regex replacement, including its decoder, rather than a separate preview.
      const cardFile = path.join(ROOT, 'dist', name, name + '.json');
      const card = await readJSON(cardFile);
      const cardSha256 = sha256(await fs.readFile(cardFile));
      const regex = card.data.extensions.regex_scripts.find(r => r.scriptName === 'Embedded status panel');
      const rendered = applyRegexFixture(regex, kind === 'mvu' ? '<StatusPlaceHolderImpl/>' : '<CardStatus/>').replace(/^```html\n/, '').replace(/\n```$/, '');
      await page.setContent(rendered, { waitUntil: 'load' });
      await page.getByRole('button').click();
      if (kind === 'html') await page.getByText('Edit this card’s files under src/ui/html/, then rebuild.').waitFor({ state: 'visible' });
      if (kind === 'vue') await page.getByText('Add inventory, relationships, quests, or other information here.').waitFor({ state: 'visible' });
      if (kind === 'mvu') {
        await page.getByRole('heading', { name: 'Dockside bookshop' }).waitFor();
        await page.evaluate(() => { window.__testState = { ...window.__testState, scene: { location: 'Seaside', phase: 'Walking' } }; });
        await page.getByRole('heading', { name: 'Seaside' }).waitFor();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${name} ${width}px horizontal overflow`);
      assert.deepEqual(errors, [], `${name} browser errors`);
      assert.deepEqual(requests, [], `${name} embedded UI attempted an external request`);
      const screenshot = path.join(output, `${kind}-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ name, width, cardSha256, interaction: 'passed', networkRequests: requests, screenshot, environment: kind === 'mvu' ? 'headless Chrome + mocked MVU, offline' : 'headless Chrome, offline' });
      await context.close();
    }
  }
  await writeJSON(path.join(output, 'report.json'), { ok: true, realTavern: false, results });
  console.log(JSON.stringify({ ok: true, cases: results.length, report: path.join(output, 'report.json'), note: 'Local offline browser and mocked MVU verification; no real SillyTavern runtime test.' }, null, 2));
} finally { await browser?.close(); }
