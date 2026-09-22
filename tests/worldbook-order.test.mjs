import test from 'node:test';
import assert from 'node:assert/strict';
import { planWorldbookOrder, orderNewWorldbook, entryPosition } from '../tools/lib/worldbook-order.mjs';

test('global order follows positions, descending depth, reversed runtime role buckets and ascending order', () => {
  const make = (name, position, depth, role, order = 100, enabled = true) => ({ comment: name, enabled, insertion_order: order, extensions: { position, depth, role } });
  const entries = [
    make('d0-system', 4, 0, 0, 2),
    make('after', 1, 4, 0, 1),
    make('disabled', 0, 4, 0, 0, false),
    make('d2-system', 4, 2, 0, 1),
    make('before-last', 0, 4, 0, 700),
    make('d2-user', 4, 2, 1, 80),
    make('d2-assistant', 4, 2, 2, 999),
    make('before-first', 0, 4, 0, 400),
  ];
  const plan = planWorldbookOrder(entries);
  assert.deepEqual(plan.map(({ index }) => entries[index].comment), ['before-first', 'before-last', 'after', 'd2-assistant', 'd2-user', 'd2-system', 'd0-system', 'disabled']);
  assert.deepEqual(plan.map(({ order }) => order), [1, 2, 3, 4, 5, 6, 7, 8]);
  const book = { entries: structuredClone(entries) };
  const folders = orderNewWorldbook(book, entries.map(e => e.comment));
  assert.deepEqual(folders, book.entries.map(e => e.comment));
  assert.deepEqual(book.entries.map(e => e.extensions.display_index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(entries[0].insertion_order, 2, 'planner must not mutate its input');
});

test('host-dependent or malformed active placements require reviewed index mode, disabled entries do not block', () => {
  for (const extensions of [{ position: 2 }, { position: 3 }, { position: 5 }, { position: 6 }, { position: 7 }, { position: 99 }, { position: 4, depth: -1 }, { position: 4, depth: 1.5 }, { position: 4, role: 9 }]) {
    const entries = [{ comment: '特殊', enabled: true, insertion_order: 100, extensions }];
    assert.throws(() => planWorldbookOrder(entries), /--order index/);
    assert.deepEqual(planWorldbookOrder(entries, { order: 'index' }), [{ index: 0, order: 1 }]);
    assert.deepEqual(planWorldbookOrder([{ ...entries[0], enabled: false }]), [{ index: 0, order: 1 }]);
  }
  assert.throws(() => planWorldbookOrder([], { order: 'invalid' }), /模式/);
  assert.equal(entryPosition({ position: 'before_char' }), 0);
  assert.equal(entryPosition({}), 1, 'matches convertCharacterBook fallback');
  assert.equal(entryPosition({ position: 'before_char', extensions: { position: 4 } }), 4);
  assert.throws(() => planWorldbookOrder([{ extensions: { position: 0 } }]), /缺失、异常的顺序/);
});
