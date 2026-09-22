import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectEnvironment, formatReport, ROOT } from './setup.mjs';

// Keep this entry independent of installed dependencies so a broken install can be diagnosed.
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--json')) {
  console.error('用法: node tools/doctor.mjs [--json]'); process.exitCode = 1;
} else {
  try {
    const report = await inspectEnvironment();
    const required = ['AGENTS.md', 'templates/base/card.json', 'tools/card.mjs', 'tools/studio-ui/index.html', 'maintenance/references.lock.json'];
    report.workspace = { missing: [] };
    for (const file of required) try { await fs.access(path.join(ROOT, file)); } catch { report.workspace.missing.push(file); }
    if (report.workspace.missing.length) { report.ok = false; report.problems.push('工作区文件缺失：' + report.workspace.missing.join('、')); }
    let referenceCache = false;
    try { referenceCache = (await fs.readdir(path.join(ROOT, 'references/upstream'))).length > 0; } catch {}
    report.references = { present: referenceCache, requiredToBuild: false, hint: '需要检索运行时资料时运行 pnpm refs restore。' };
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      for (const line of formatReport(report)) console.log(line);
      for (const line of report.guidance) console.log('[操作] ' + line);
      if (report.workspace.missing.length) console.log('[错误] ' + report.problems.at(-1));
      console.log(referenceCache ? '[资料] 已存在本地缓存，可用 pnpm refs check 校验。' : '[资料] 尚未下载，不影响写卡和打包；需要时运行 pnpm refs restore。');
      console.log(report.ok ? '[正常] 环境就绪。' : '[错误] 请按以上提示处理；本次检查未安装依赖或修改文件。');
    }
    if (!report.ok) process.exitCode = 1;
  } catch (error) { console.error('环境检查失败：' + error.message); process.exitCode = 1; }
}
