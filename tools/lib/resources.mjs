import path from 'node:path';
import fs from 'node:fs/promises';
import { parse } from 'acorn';
import { inside, safeFile } from './files.mjs';

function literal(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}
// jQuery 的 ajax 系列把地址写在第一个参数，或选项对象的 url 字段里。
const JQUERY_CALLERS = new Set(['$', 'jQuery']);
const JQUERY_AJAX = new Set(['ajax', 'get', 'post', 'getJSON']);
// `new URL(...)` 与 `foo.url(...)` 只是构造或访问地址的 JS 调用，不是 CSS 的 url() 资源引用。
function isJavaScriptCallSite(source, index) {
  const before = source.slice(0, index).replace(/\s+$/, '');
  return /[.$]$/.test(before) || /(?:^|[^\w$])new$/.test(before);
}
function ajaxUrlProperties(node) {
  if (node?.type !== 'ObjectExpression') return null;
  return node.properties.filter(property => property.type === 'Property' && !property.computed && (property.key?.name === 'url' || property.key?.value === 'url'));
}
// 字面量绝对地址都审计（包括不受支持的协议）；相对 API 地址留给宿主核对。
const isAbsoluteAddress = value => /^(?:[a-z][a-z\d+.-]*:|\/\/|\\\\)/i.test(value);
export function findResourceReferences(text, { javascript = false } = {}) {
  const references = []; const dynamic = [];
  const add = (url, kind) => { if (typeof url === 'string' && url.trim()) references.push({ url: url.trim(), kind }); };
  // Only resource-loading tags: ordinary narrative links are not runtime dependencies.
  for (const tag of text.matchAll(/<(?:script|img|link|source|video|audio|iframe|object|embed)\b[^>]*>/gi)) {
    for (const attr of tag[0].matchAll(/\b(src|href|poster|data)\s*=\s*(["'])(.*?)\2/gi)) add(attr[3], `html:${attr[1]}`);
    for (const attr of tag[0].matchAll(/\bsrcset\s*=\s*(["'])(.*?)\1/gi)) {
      if (!attr[2].startsWith('data:')) for (const value of attr[2].split(',')) add(value.trim().split(/\s+/)[0], 'html:srcset');
    }
  }
  for (const match of text.matchAll(/\burl\(\s*(["']?)([^)"']+)\1\s*\)/gi)) {
    if (!isJavaScriptCallSite(text, match.index)) add(match[2], 'css:url');
  }
  for (const match of text.matchAll(/@import\s+(["'])(.*?)\1/gi)) add(match[2], 'css:import');
  const scripts = javascript ? [text] : [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  for (const code of scripts) {
    let ast;
    try { ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }); }
    catch { continue; } // Syntax errors are reported by validation, not mistaken for URL evidence.
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) add(literal(node.source), 'js:import');
      if (node.type === 'ImportExpression') {
        const value = literal(node.source);
        if (value === null) dynamic.push('动态 import()'); else add(value, 'js:import');
      }
      if (node.type === 'CallExpression' || node.type === 'NewExpression') {
        const name = node.callee?.name ?? node.callee?.property?.name;
        if (['fetch', 'load', 'getScript', 'Worker', 'WebSocket', 'EventSource'].includes(name)) {
          const value = literal(node.arguments[0]);
          if (value === null) dynamic.push(`动态 ${name}()`); else add(value, `js:${name}`);
        }
        if (JQUERY_AJAX.has(name) && JQUERY_CALLERS.has(node.callee?.object?.name)) {
          const argument = node.arguments[0];
          const properties = ajaxUrlProperties(argument);
          const known = literal(argument) !== null ? [literal(argument)]
            : properties?.length ? properties.map(property => literal(property.value)) : null;
          // 选项对象没写 url 时可能是就地配置（地址来自 ajaxSetup 等），不当作证据。
          if (known === null && argument && argument.type !== 'ObjectExpression') dynamic.push(`动态 ${name}() 地址`);
          for (const address of (known ?? [])) {
            if (address !== null && isAbsoluteAddress(address)) add(address, `js:${name}`);
            else dynamic.push(`${name}() 地址 ${address ?? '（非字面量）'} 不是外链`);
          }
        }
        if (name === 'setAttribute' && ['src', 'href', 'poster', 'data'].includes(literal(node.arguments[0]))) {
          const value = literal(node.arguments[1]);
          if (value === null) dynamic.push('动态 setAttribute() 资源'); else add(value, 'js:attribute');
        }
      }
      if (node.type === 'AssignmentExpression' && ['src', 'href', 'poster'].includes(node.left?.property?.name)) {
        const value = literal(node.right);
        if (value === null) dynamic.push('动态资源属性'); else add(value, 'js:attribute');
      }
      for (const [key, child] of Object.entries(node)) if (key !== 'start' && key !== 'end') {
        if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
      }
    };
    visit(ast);
  }
  if (/<%|\{\{/.test(text) && references.some(r => /<%|\{\{/.test(r.url))) dynamic.push('模板生成的资源地址');
  return { references: [...new Map(references.map(r => [`${r.kind}:${r.url}`, r])).values()], dynamic: [...new Set(dynamic)] };
}
export function validateDependencies(dependencies) {
  const errors = []; const urls = new Set();
  for (const item of dependencies) {
    if (!item || typeof item.url !== 'string' || typeof item.purpose !== 'string' || !item.purpose.trim() || typeof item.version !== 'string' || !item.version.trim()) { errors.push('外部依赖必须声明 url、purpose、version。'); continue; }
    let url; try { url = new URL(item.url); } catch { errors.push(`依赖地址无效: ${item.url}`); continue; }
    if (url.protocol !== 'https:' || url.username || url.password) errors.push(`公开依赖必须使用无凭据的 HTTPS 地址: ${item.url}`);
    if (urls.has(item.url)) errors.push(`重复依赖: ${item.url}`); urls.add(item.url);
    if (!decodeURIComponent(item.url).includes(item.version) || /^(latest|main|master|beta|dev|head)$/i.test(item.version)) errors.push(`依赖地址必须包含固定版本或提交: ${item.url}`);
    if (/\b(token|access_token|authorization|key|secret)=/i.test(url.search)) errors.push(`资源地址不能携带凭据: ${url.origin}${url.pathname}`);
  }
  return errors;
}
export async function auditResources(text, { file, dir, dependencies = [], javascript = false, bundled = false } = {}) {
  const { references, dynamic } = findResourceReferences(text, { javascript });
  const errors = []; const warnings = dynamic.map(item => `${file}: ${item}，需要人工核对最终地址。`); const external = [];
  for (const reference of references) {
    const { url, kind } = reference;
    if (/^(data:|#)/i.test(url)) continue;
    // blob: 地址只在生成它的那次页面会话里有效，写进卡里对玩家没有意义。
    if (/^blob:/i.test(url)) { warnings.push(`${file}: blob: 地址只在生成它的会话里有效，不能作为卡内资源地址 ${url}`); continue; }
    if (/^(?:file:|[a-z]:[\\/]|\\\\)/i.test(url)) { errors.push(`${file}: 不能依赖本机资源 ${url}`); continue; }
    if (/<%|\{\{|\$\{/.test(url)) { warnings.push(`${file}: 动态资源地址需复核 ${url}`); continue; }
    if (/^(https?:)?\/\//i.test(url)) {
      let parsed; try { parsed = new URL(url.startsWith('//') ? 'https:' + url : url); } catch { errors.push(`${file}: 无效地址 ${url}`); continue; }
      if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) errors.push(`${file}: 成品不能加载开发或局域网地址 ${url}`);
      // 协议相对地址按 HTTPS 使用；声明处只能写完整地址，比较时两种写法都算已声明。
      const normalized = url.startsWith('//') ? `https:${url}` : url;
      if (!dependencies.some(d => d.url === url || d.url === normalized)) errors.push(`${file}: 未声明的外部资源 ${url}。私有资源请内嵌，公开资源请在 dependencies 声明固定版本。`);
      external.push(url); continue;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(url)) { errors.push(`${file}: 不支持自动打包的资源协议 ${url}`); continue; }
    // Bare module imports are resolved by the bundler; they may not survive in a single-file output.
    if (kind === 'js:import' && !url.startsWith('.') && !url.startsWith('/')) {
      if (bundled) errors.push(`${file}: 成品残留未解析模块 ${url}`);
      continue;
    }
    if (bundled) { errors.push(`${file}: 成品残留相对资源 ${url}`); continue; }
    if (!dir || !file) continue;
    const clean = decodeURIComponent(url.split(/[?#]/)[0]);
    const relative = path.relative(dir, path.resolve(path.dirname(path.join(dir, file)), clean)).split(path.sep).join('/');
    try { await safeFile(dir, relative); } catch { errors.push(`${file}: 缺失或越界的资源 ${url}`); }
  }
  return { errors, warnings, external: [...new Set(external)], references };
}
