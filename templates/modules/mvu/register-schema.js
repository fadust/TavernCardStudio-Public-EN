import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource@69abb272d46bed4057a0dfb31758f6164cb7ecef/dist/util/mvu_zod.js';
import { Schema } from '../schema.ts';

// Register src/schema.ts with MVU. Local esbuild inlines the schema during the build;
// no local file is loaded at runtime. The import is pinned and declared in project.json dependencies.
// Load the MVU framework (loader.js) before registering the schema.
// Register early: the helper subscribes immediately. Waiting for Mvu first can miss the initial initialization event.
$(() => {
  registerMvuSchema(Schema);
});
