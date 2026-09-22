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
  for (const [name, kind] of [['示例-独立状态栏', 'html'], ['示例-Vue', 'vue'], ['示例-MVU-Vue', 'mvu']]) {
    for (const width of [375, 1100]) {
      const context = await browser.newContext({ viewport: { width, height: 700 } });
      const page = await context.newPage(); const errors = []; const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
      await context.setOffline(true);
      if (kind === 'mvu') {
        await page.addInitScript(() => {
          window.__testState = { 场景: { 地点: '码头旧书店', 阶段: '会面' }, 角色: { 心情: '平静', 信任: 12 } };
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
      const regex = card.data.extensions.regex_scripts.find(r => r.scriptName === '内嵌状态栏');
      const rendered = applyRegexFixture(regex, kind === 'mvu' ? '<StatusPlaceHolderImpl/>' : '<CardStatus/>').replace(/^```html\n/, '').replace(/\n```$/, '');
      await page.setContent(rendered, { waitUntil: 'load' });
      await page.getByRole('button').click();
      if (kind === 'html') await page.getByText('编辑本卡 src/ui/html/ 下的文件，然后重新打包即可。').waitFor({ state: 'visible' });
      if (kind === 'vue') await page.getByText('这里可以放入物品、关系、任务或其他内容。').waitFor({ state: 'visible' });
      if (kind === 'mvu') {
        await page.getByRole('heading', { name: '码头旧书店' }).waitFor();
        await page.evaluate(() => { window.__testState = { ...window.__testState, 场景: { 地点: '海边', 阶段: '散步' } }; });
        await page.getByRole('heading', { name: '海边' }).waitFor();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${name} ${width}px 横向溢出`);
      assert.deepEqual(errors, [], `${name} 浏览器错误`);
      assert.deepEqual(requests, [], `${name} 内嵌界面试图请求外部资源`);
      const screenshot = path.join(output, `${kind}-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ name, width, cardSha256, interaction: 'passed', networkRequests: requests, screenshot, environment: kind === 'mvu' ? 'headless Chrome + mocked MVU, offline' : 'headless Chrome, offline' });
      await context.close();
    }
  }
  await writeJSON(path.join(output, 'report.json'), { ok: true, realTavern: false, results });
  console.log(JSON.stringify({ ok: true, cases: results.length, report: path.join(output, 'report.json'), note: '本地离线浏览器／模拟 MVU 验证；不是实际酒馆实测。' }, null, 2));
} finally { await browser?.close(); }
