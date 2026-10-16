import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonText = data => JSON.stringify(data, null, 2) + '\n';
export async function readJSON(file) {
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`Cannot read JSON ${file}: ${error.message}`); }
}
export async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
export const writeJSON = (file, data) => write(file, jsonText(data));
export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
export function safeName(name) {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name === '.' || name === '..' || name.startsWith('.tmp-')) {
    throw new Error(`Unsafe directory name: ${JSON.stringify(name)}; use a plain name without paths or Windows reserved names.`);
  }
  return name;
}
export function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0')) throw new Error(`Use a project-relative path: ${relative}`);
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error(`Path escapes project: ${relative}`);
  return resolved;
}
export async function safeFile(root, relative) {
  const file = inside(root, relative);
  const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
  const rel = path.relative(realRoot, realFile);
  if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error(`Symbolic link escapes project: ${relative}`);
  return file;
}
export async function walk(root) {
  const output = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(file));
    else if (entry.isFile()) output.push(file);
    else throw new Error(`Links or special files are unsupported: ${file}`);
  }
  return output;
}
export function pointerParts(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw new Error(`Invalid JSON Pointer: ${pointer}`);
  return pointer.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'));
}
export const pointerKey = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
export function getPointer(object, pointer) {
  let item = object;
  for (const key of pointerParts(pointer)) {
    if (!item || typeof item !== 'object' || !Object.hasOwn(item, key)) throw new Error(`Field does not exist: ${pointer}`);
    item = item[key];
  }
  return item;
}
export function setPointer(object, pointer, value) {
  const keys = pointerParts(pointer); const last = keys.pop();
  let item = object;
  for (const key of keys) {
    if (!item || typeof item !== 'object' || !Object.hasOwn(item, key)) throw new Error(`Field does not exist: ${pointer}`);
    item = item[key];
  }
  if (!item || typeof item !== 'object' || !Object.hasOwn(item, last)) throw new Error(`Field does not exist: ${pointer}`);
  Object.defineProperty(item, last, { value, enumerable: true, configurable: true, writable: true });
}
