import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { z } from 'zod';
import { ROOT } from '../tools/lib/files.mjs';
import { loadProject } from '../tools/lib/project.mjs';

// Explicitly reviewed, repository-owned sample only. Never discover or run user schemas.
const dir = path.join(ROOT, 'cards/example-fogharbor-bureau');
const compiled = await build({ entryPoints: [path.join(dir, 'src/schema.ts')], bundle: true, write: false, format: 'cjs', logLevel: 'silent' });
const moduleObject = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, { module: moduleObject, exports: moduleObject.exports, z });
const { Schema } = moduleObject.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test('every complex-example greeting matches the schema and parses idempotently', async () => {
  const { card } = await loadProject('example-fogharbor-bureau');
  assert.equal(card.data.name, 'Fogharbor Bureau');
  const base = JSON.parse(card.data.character_book.entries.find(e => e.comment.includes('[initvar]')).content);
  const starts = [base, ...card.data.alternate_greetings.map(text => JSON.parse(text.match(/<initvar>([\s\S]*?)<\/initvar>/)[1]))];
  assert.equal(starts.length, 4);
  for (const initial of starts) {
    const parsed = Schema.parse(initial);
    assert.deepEqual(plain(parsed), { ...initial, bureau: { ...initial.bureau, _progress: parsed.bureau._progress } });
    assert.deepEqual(plain(Schema.parse(parsed)), plain(parsed));
    assert.equal(Object.keys(parsed.bureau.clues).length > 0, true);
  }
});

test('missing containers recover, clue changes recompute progress, invalid quantities and enums fail', () => {
  const initial = Schema.parse({});
  assert.equal(initial.bureau._progress, 'No records yet');
  initial.bureau.clues = { ledger: { status: 'Verified', description: 'Original and copy agree' } };
  initial.bureau._progress = 'Old summary';
  initial.investigator.energy = 130;
  const changed = Schema.parse(initial);
  assert.equal(changed.bureau._progress, 'Pending 0 · Verified 1 · RuledOut 0');
  assert.equal(changed.investigator.energy, 100);
  assert.deepEqual(plain(Schema.parse(changed)), plain(changed));
  assert.equal(Schema.safeParse({ bureau: { evidence: { ledger: { quantity: -1 } } } }).success, false);
  assert.equal(Schema.safeParse({ bureau: { caseFile: { phase: 'Instantly solved' } } }).success, false);
  assert.equal(Schema.safeParse({ bureau: { clues: { ledger: { status: 'Already closed' } } } }).success, false);
});

test('the complex-example JSON Schema projection matches its registered schema', async () => {
  const projection = JSON.parse(await fs.readFile(path.join(dir, 'src/variables/schema.json'), 'utf8'));
  assert.deepEqual(projection, plain(z.toJSONSchema(Schema, { io: 'input' })));
});
