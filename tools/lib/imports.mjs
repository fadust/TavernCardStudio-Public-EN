import fs from 'node:fs/promises';
import path from 'node:path';
import { safeName } from './files.mjs';

// The inbox keeps complete source cards. A project's original/ is a separate, portable validation baseline.
export async function archiveImport(root, filename, bytes) {
  safeName(filename);
  const directory = path.join(root, 'imports');
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('imports must be a regular directory inside the workspace.');
  const extension = path.extname(filename); const stem = filename.slice(0, -extension.length);
  for (let index = 1; index <= 10000; index++) {
    const candidate = index === 1 ? filename : `${stem} (${index})${extension}`;
    const file = path.join(directory, candidate);
    try {
      const handle = await fs.open(file, 'wx');
      try { await handle.writeFile(bytes); }
      catch (error) { await handle.close(); await fs.unlink(file); throw error; }
      await handle.close();
      return { file, relative: 'imports/' + candidate, created: true };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.lstat(file);
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error(`Import path is not a regular file: imports/${candidate}`);
      if ((await fs.readFile(file)).equals(bytes)) return { file, relative: 'imports/' + candidate, created: false };
    }
  }
  throw new Error('Too many original cards with the same name; rename the input file.');
}
