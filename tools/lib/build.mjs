import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, exists, safeFile, write, writeJSON, jsonText, setPointer, sha256, walk } from './files.mjs';
import { checkProject } from './validation.mjs';
import { auditResources } from './resources.mjs';
import { writeCardPNG } from './png.mjs';
import { publishDirectory } from './publish.mjs';

// Base64 keeps ST's $1/$<name>/{{macro}} substitution away from the compiled UI.
// This is transport encoding, not encryption. The document remains fully inspectable.
export function embedHTML(html) {
  const encoded = Buffer.from(html, 'utf8').toString('base64');
  return '```html\n<!doctype html><html><head><meta charset="utf-8"></head><body><script>(()=>{const html=new TextDecoder().decode(Uint8Array.from(atob("' + encoded + '"),c=>c.charCodeAt(0)));document.open();document.write(html);document.close();})();</script></body></html>\n```';
}
export async function compileEntry(build, dir, dependencies = []) {
  const entry = await safeFile(dir, build.entry);
  const external = dependencies.map(d => d.url);
  if (build.kind === 'script') {
    const { build: esbuild } = await import('esbuild');
    const output = await esbuild({ entryPoints: [entry], bundle: true, write: false, outfile: 'index.js', format: 'esm', platform: 'browser', target: 'es2022', minify: false, splitting: false, sourcemap: false, logLevel: 'silent', external,
      loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.svg': 'dataurl', '.webp': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.txt': 'text' },
      absWorkingDir: dir,
    });
    if (output.outputFiles.length !== 1) throw new Error(`${build.entry}: script produced multiple files (such as separate CSS); use an html/vue interface build instead.`);
    return { text: output.outputFiles[0].text, extension: 'js' };
  }
  const [{ build: vite }, { default: vue }, { viteSingleFile }] = await Promise.all([import('vite'), import('@vitejs/plugin-vue'), import('vite-plugin-singlefile')]);
  const result = await vite({
    configFile: false, envFile: false, root: path.dirname(entry), publicDir: false, base: './', logLevel: 'silent',
    plugins: [...(build.kind === 'vue' ? [vue()] : []), viteSingleFile({ useRecommendedBuildConfig: false })],
    resolve: { alias: { vue: path.join(ROOT, 'node_modules/vue/dist/vue.runtime.esm-bundler.js') } },
    build: { write: false, target: 'es2022', minify: true, cssCodeSplit: false, assetsInlineLimit: () => true, assetsDir: '', sourcemap: false, modulePreload: false,
      rolldownOptions: { input: entry, external, output: { codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output ?? []);
  if (outputs.length !== 1 || !outputs[0].fileName.endsWith('.html')) throw new Error(`${build.entry}: could not generate single-file HTML; remaining outputs: ${outputs.map(o => o.fileName).join(', ')}`);
  return { text: String(outputs[0].source), extension: 'html' };
}
export async function buildCard(name, root = ROOT) {
  const checked = await checkProject(name, root);
  const { project, dir, report } = checked;
  if (!report.ok) throw new Error(`${name} failed checks:\n${report.errors.join('\n')}`);
  const card = structuredClone(checked.card); const artifacts = [];
  for (const [index, build] of project.builds.entries()) {
    const output = await compileEntry(build, dir, project.dependencies);
    const audit = await auditResources(output.text, { file: build.entry, dependencies: project.dependencies, javascript: build.kind === 'script', bundled: true });
    if (audit.errors.length) throw new Error(`Build resource checks failed:\n${audit.errors.join('\n')}`);
    report.warnings.push(...audit.warnings); report.external.push(...audit.external);
    setPointer(card, build.pointer, build.kind === 'script' ? output.text : embedHTML(output.text));
    artifacts.push({ file: `${build.kind === 'script' ? 'scripts' : 'ui'}/${index + 1}.${output.extension}`, content: output.text });
  }
  // Inline imported resources also have to be self-contained. Do not make imports silently depend on local files.
  for (const field of project.fields) {
    if (project.builds.some(b => b.pointer === field.pointer)) continue;
    const content = await fs.readFile(await safeFile(dir, field.file), 'utf8');
    const audit = await auditResources(content, { file: field.file, dependencies: project.dependencies, javascript: /\.[cm]?js$/.test(field.file), bundled: true });
    if (audit.errors.length) throw new Error(`Packaged resource checks failed:\n${audit.errors.join('\n')}`);
    report.warnings.push(...audit.warnings);
  }
  artifacts.push({ file: `${name}.json`, content: jsonText(card) });
  if (project.avatar) artifacts.push({ file: `${name}.png`, content: writeCardPNG(await fs.readFile(await safeFile(dir, project.avatar)), card) });
  const inputs = {};
  for (const file of [path.join(dir, 'project.json'), ...(project.state ? [path.join(dir, project.state.file)] : []), ...await walk(path.join(dir, 'src'))]) inputs[path.relative(dir, file).split(path.sep).join('/')] = sha256(await fs.readFile(file));
  const buildReport = {
    schemaVersion: 1, name, generatedAt: new Date().toISOString(), format: card.spec,
    inputs, artifacts: Object.fromEntries(artifacts.map(a => [a.file, { bytes: Buffer.byteLength(a.content), sha256: sha256(a.content) }])),
    dependencies: project.dependencies, external: [...new Set(report.external)], warnings: [...new Set(report.warnings)],
    checks: { static: 'passed', localBuild: 'passed', realTavern: project.runtimeVerified ?? 'not-tested' },
  };
  const totalBytes = artifacts.reduce((sum, a) => sum + Buffer.byteLength(a.content), 0);
  if (totalBytes > 5 * 1024 * 1024) buildReport.warnings.push(`Total output: ${(totalBytes / 1024 / 1024).toFixed(1)} MiB; verify import and display performance on the target device.`);
  const dist = path.join(root, 'dist'); await fs.mkdir(dist, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(dist, '.tmp-')); const destination = path.join(dist, name); const backup = path.join(dist, '.backup-' + randomUUID());
  try {
    for (const artifact of artifacts) await write(path.join(temporary, artifact.file), artifact.content);
    await writeJSON(path.join(temporary, 'build-report.json'), buildReport);
    await write(path.join(temporary, "USAGE.md"), `# ${name}\n\nImport the ${project.avatar ? `${name}.png or ` : ''}${name}.json file from this folder. PNG and JSON contain the same card; import either one.\n\n${project.builds.some(b => b.kind !== 'script') ? 'The status panel requires TavernHelper frontend rendering and this card\'s regexes.\n\n' : ''}${card.data.extensions?.tavern_helper ? 'This card includes TavernHelper scripts. Install TavernHelper and enable card scripts before use.\n\n' : ''}${project.dependencies.length ? 'Public network dependencies:\n\n' + project.dependencies.map(d => `- ${d.purpose}\n  ${d.url}`).join('\n') + '\n\n' : 'Custom interfaces and scripts are embedded; no links to a separate project repository are required.\n\n'}Validation: local static checks and build passed. ${project.runtimeVerified ? 'See build-report.json for real-host verification records.' : 'No real SillyTavern/model session has been verified.'}\n\nDistribute the card file. ui/ and scripts/ are build inspection artifacts and need no separate deployment. Encoding is not encryption; card content can be read.\n`);
    const publication = await publishDirectory(temporary, destination, backup);
    return { name, ok: true, directory: destination, publication, files: Object.keys(buildReport.artifacts), warnings: buildReport.warnings, report: path.join(destination, 'build-report.json') };
  } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
}
