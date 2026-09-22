import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkRelease, exportRelease } from '../tools/release.mjs';
import { writeJSON, write, sha256 } from '../tools/lib/files.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tcs-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeJSON(path.join(root, 'maintenance/public-release.json'), { schemaVersion: 1, files: ['package.json', 'README.md'], directories: ['tools'], examples: [], emptyDirectories: ['work'] });
  await writeJSON(path.join(root, 'maintenance/references.lock.json'), { sources: {} });
  await writeJSON(path.join(root, 'package.json'), { version: '0.0.0' });
  await write(path.join(root, 'README.md'), '[tool](tools/tool.mjs)');
  await write(path.join(root, 'tools/tool.mjs'), '// example');
  await write(path.join(root, 'cards/personal/story.md'), 'personal-content');
  await write(path.join(root, 'work/session.json'), '{"token":"private"}');
  return root;
}

test('公开导出只包含明确清单，排除作品与会话，并校验实际字节', async t => {
  const root = await fixture(t); const out = path.join(root, 'work/export');
  assert.equal((await checkRelease(root)).ok, true);
  await exportRelease(out, root);
  const manifest = JSON.parse(await fs.readFile(path.join(out, 'release-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.files).sort(), ['README.md', 'package.json', 'tools/tool.mjs', 'work/.gitkeep'].sort());
  for (const [file, record] of Object.entries(manifest.files)) assert.equal(sha256(await fs.readFile(path.join(out, file))), record.sha256);
  await assert.rejects(fs.access(path.join(out, 'cards')));
  await assert.rejects(fs.access(path.join(out, 'work/session.json')));
  await assert.rejects(exportRelease(out, root), /EEXIST/);
});

test('公开检查拒绝断链和越界清单', async t => {
  const root = await fixture(t);
  await write(path.join(root, 'README.md'), '[missing](docs/missing.md)');
  assert.equal((await checkRelease(root)).ok, false);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'maintenance/public-release.json'), 'utf8'));
  manifest.files.push('../secret.json'); await writeJSON(path.join(root, 'maintenance/public-release.json'), manifest);
  await assert.rejects(checkRelease(root), /无效发布路径/);
});

test('公开检查拒绝清单目录中的符号链接', async t => {
  const root = await fixture(t);
  try { await fs.symlink(path.join(root, 'cards'), path.join(root, 'tools/link'), 'junction'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('当前系统不允许创建测试链接'); throw error; }
  await assert.rejects(checkRelease(root), /符号链接/);
});
