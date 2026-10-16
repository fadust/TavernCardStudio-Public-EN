import fs from 'node:fs/promises';
import path from 'node:path';
import { exists, walk } from './files.mjs';

// Explorer, indexers and editors can hold directory handles on Windows while allowing file moves.
// Keep the parent directory in that case and replace staged files with a rollback journal.
export async function replaceFiles(staging, destination, backup) {
  const oldFiles = await walk(destination);
  const newFiles = (await walk(staging)).sort((a, b) => Number(a.endsWith('build-report.json')) - Number(b.endsWith('build-report.json')));
  const saved = []; const installed = [];
  await fs.mkdir(backup, { recursive: true });
  try {
    for (const file of oldFiles) {
      const relative = path.relative(destination, file); const preserved = path.join(backup, relative);
      await fs.mkdir(path.dirname(preserved), { recursive: true });
      await fs.rename(file, preserved); saved.push(relative);
    }
    for (const file of newFiles) {
      const relative = path.relative(staging, file); const target = path.join(destination, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(file, target); installed.push(relative);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const relative of installed.reverse()) try { await fs.unlink(path.join(destination, relative)); } catch (failure) { rollbackErrors.push(failure); }
    for (const relative of saved.reverse()) try { await fs.rename(path.join(backup, relative), path.join(destination, relative)); } catch (failure) { rollbackErrors.push(failure); }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `Output replacement failed; partial backups remain at ${backup}; do not delete them.`);
    await fs.rm(backup, { recursive: true, force: true });
    throw error;
  }
  await fs.rm(staging, { recursive: true, force: true });
  await fs.rm(backup, { recursive: true, force: true });
  return 'file-transaction';
}

export async function publishDirectory(staging, destination, backup) {
  if (!await exists(destination)) { await fs.rename(staging, destination); return 'directory-swap'; }
  try { await fs.rename(destination, backup); }
  catch (error) {
    if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) return replaceFiles(staging, destination, backup);
    throw error;
  }
  try { await fs.rename(staging, destination); }
  catch (error) {
    try { await fs.rename(backup, destination); }
    catch (restoreError) { throw new AggregateError([error, restoreError], `Build switch failed; previous output remains at ${backup}.`); }
    throw error;
  }
  await fs.rm(backup, { recursive: true, force: true });
  return 'directory-swap';
}
