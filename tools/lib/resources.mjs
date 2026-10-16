import path from 'node:path';
import fs from 'node:fs/promises';
import { parse } from 'acorn';
import { inside, safeFile } from './files.mjs';

function literal(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}
// jQuery loaders accept the URL as their first argument or in options.url.
const JQUERY_CALLERS = new Set(['$', 'jQuery']);
const JQUERY_AJAX = new Set(['ajax', 'get', 'post', 'getJSON']);
// URL constructors and object.url() calls are not CSS resource references.
function isJavaScriptCallSite(source, index) {
  const before = source.slice(0, index).replace(/\s+$/, '');
  return /[.$]$/.test(before) || /(?:^|[^\w$])new$/.test(before);
}
function ajaxUrlProperties(node) {
  if (node?.type !== 'ObjectExpression') return null;
  return node.properties.filter(property => property.type === 'Property' && !property.computed && (property.key?.name === 'url' || property.key?.value === 'url'));
}
// Audit all literal absolute URLs; relative API endpoints require host-side verification.
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
        if (value === null) dynamic.push('dynamic import()'); else add(value, 'js:import');
      }
      if (node.type === 'CallExpression' || node.type === 'NewExpression') {
        const name = node.callee?.name ?? node.callee?.property?.name;
        if (['fetch', 'load', 'getScript', 'Worker', 'WebSocket', 'EventSource'].includes(name)) {
          const value = literal(node.arguments[0]);
          if (value === null) dynamic.push(`dynamic ${name}()`); else add(value, `js:${name}`);
        }
        if (JQUERY_AJAX.has(name) && JQUERY_CALLERS.has(node.callee?.object?.name)) {
          const argument = node.arguments[0];
          const properties = ajaxUrlProperties(argument);
          const known = literal(argument) !== null ? [literal(argument)]
            : properties?.length ? properties.map(property => literal(property.value)) : null;
          // Options without url may inherit ajaxSetup configuration; they are not URL evidence.
          if (known === null && argument && argument.type !== 'ObjectExpression') dynamic.push(`dynamic ${name}() address`);
          for (const address of (known ?? [])) {
            if (address !== null && isAbsoluteAddress(address)) add(address, `js:${name}`);
            else dynamic.push(`${name}() address ${address ?? '(non-literal)'} is not an external URL`);
          }
        }
        if (name === 'setAttribute' && ['src', 'href', 'poster', 'data'].includes(literal(node.arguments[0]))) {
          const value = literal(node.arguments[1]);
          if (value === null) dynamic.push('dynamic setAttribute() resource'); else add(value, 'js:attribute');
        }
      }
      if (node.type === 'AssignmentExpression' && ['src', 'href', 'poster'].includes(node.left?.property?.name)) {
        const value = literal(node.right);
        if (value === null) dynamic.push('dynamic resource property'); else add(value, 'js:attribute');
      }
      for (const [key, child] of Object.entries(node)) if (key !== 'start' && key !== 'end') {
        if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
      }
    };
    visit(ast);
  }
  if (/<%|\{\{/.test(text) && references.some(r => /<%|\{\{/.test(r.url))) dynamic.push('template-generated resource URL');
  return { references: [...new Map(references.map(r => [`${r.kind}:${r.url}`, r])).values()], dynamic: [...new Set(dynamic)] };
}
export function validateDependencies(dependencies) {
  const errors = []; const urls = new Set();
  for (const item of dependencies) {
    if (!item || typeof item.url !== 'string' || typeof item.purpose !== 'string' || !item.purpose.trim() || typeof item.version !== 'string' || !item.version.trim()) { errors.push('External dependencies must declare url, purpose, and version.'); continue; }
    let url; try { url = new URL(item.url); } catch { errors.push(`Invalid dependency URL: ${item.url}`); continue; }
    if (url.protocol !== 'https:' || url.username || url.password) errors.push(`Public dependencies require credential-free HTTPS URLs: ${item.url}`);
    if (urls.has(item.url)) errors.push(`Duplicate dependency: ${item.url}`); urls.add(item.url);
    if (!decodeURIComponent(item.url).includes(item.version) || /^(latest|main|master|beta|dev|head)$/i.test(item.version)) errors.push(`Dependency URL must include a pinned version or commit: ${item.url}`);
    if (/\b(token|access_token|authorization|key|secret)=/i.test(url.search)) errors.push(`Resource URLs must not contain credentials: ${url.origin}${url.pathname}`);
  }
  return errors;
}
export async function auditResources(text, { file, dir, dependencies = [], javascript = false, bundled = false } = {}) {
  const { references, dynamic } = findResourceReferences(text, { javascript });
  const errors = []; const warnings = dynamic.map(item => `${file}: ${item}; manually verify the final URL.`); const external = [];
  for (const reference of references) {
    const { url, kind } = reference;
    if (/^(data:|#)/i.test(url)) continue;
    // Blob URLs expire with the originating session and cannot be distributed with a card.
    if (/^blob:/i.test(url)) { warnings.push(`${file}: blob: URLs only work in their originating session and cannot be card resource URLs: ${url}`); continue; }
    if (/^(?:file:|[a-z]:[\\/]|\\\\)/i.test(url)) { errors.push(`${file}: cannot depend on a local-machine resource: ${url}`); continue; }
    if (/<%|\{\{|\$\{/.test(url)) { warnings.push(`${file}: review dynamic resource URL: ${url}`); continue; }
    if (/^(https?:)?\/\//i.test(url)) {
      let parsed; try { parsed = new URL(url.startsWith('//') ? 'https:' + url : url); } catch { errors.push(`${file}: invalid URL: ${url}`); continue; }
      if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) errors.push(`${file}: distributed cards cannot load development or LAN URLs: ${url}`);
      // Match protocol-relative references against their required HTTPS dependency declaration.
      const normalized = url.startsWith('//') ? `https:${url}` : url;
      if (!dependencies.some(d => d.url === url || d.url === normalized)) errors.push(`${file}: undeclared external resource: ${url}. Embed private resources; declare a pinned version in dependencies for public resources.`);
      external.push(url); continue;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(url)) { errors.push(`${file}: resource protocol cannot be packaged automatically: ${url}`); continue; }
    // Bare module imports are resolved by the bundler; they may not survive in a single-file output.
    if (kind === 'js:import' && !url.startsWith('.') && !url.startsWith('/')) {
      if (bundled) errors.push(`${file}: unresolved module in build output: ${url}`);
      continue;
    }
    if (bundled) { errors.push(`${file}: relative resource remains in build output: ${url}`); continue; }
    if (!dir || !file) continue;
    const clean = decodeURIComponent(url.split(/[?#]/)[0]);
    const relative = path.relative(dir, path.resolve(path.dirname(path.join(dir, file)), clean)).split(path.sep).join('/');
    try { await safeFile(dir, relative); } catch { errors.push(`${file}: missing resource or path outside project: ${url}`); }
  }
  return { errors, warnings, external: [...new Set(external)], references };
}
