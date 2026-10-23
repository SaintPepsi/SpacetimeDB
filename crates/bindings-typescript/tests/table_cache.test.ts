import { describe, expect, test, vi } from 'vitest';
import { AlgebraicType, Identity, schema, t, table, type Infer } from '../src';
import { type Operation, TableCacheImpl } from '../src/sdk/table_cache';
import { tables } from '../test-app/src/module_bindings/index.ts';
import { Player } from '../test-app/src/module_bindings/types';
import UnindexedPlayer from '../test-app/src/module_bindings/unindexed_player_table.ts';

interface ApplyOperations {
  ops: Operation[];
  ctx: any;
}

interface CallbackEvent {
  type: 'insert' | 'delete' | 'update';
  ctx: any;
  row: any;
  oldRow?: any; // Only there for updates.
}

function insertEvent(row: any, ctx: any = {}): CallbackEvent {
  return {
    type: 'insert',
    ctx,
    row,
  };
}

function updateEvent(oldRow: any, row: any, ctx: any = {}): CallbackEvent {
  return {
    type: 'update',
    ctx,
    row,
    oldRow,
  };
}

function deleteEvent(row: any, ctx: any = {}): CallbackEvent {
  return {
    type: 'delete',
    ctx,
    row,
  };
}

interface AssertionInput {
  // The state of the table cache.
  tableCache: TableCacheImpl<any, string>;
  // The sequence of callbacks that were fired from the last applyOperations.
  callbackHistory: CallbackEvent[];
}

type Assertion = (arg0: AssertionInput) => void;

interface TestStep {
  // The operations to apply.
  ops: ApplyOperations;
  // The assertions to make after applying the operations.
  assertions: Assertion[];
}

function runTest(
  tableCache: TableCacheImpl<any, string>,
  testSteps: TestStep[]
) {
  const callbackHistory: CallbackEvent[] = [];
  tableCache.onInsert((ctx, row) => {
    callbackHistory.push({
      type: 'insert',
      ctx,
      row,
    });
  });
  tableCache.onDelete((ctx, row) => {
    callbackHistory.push({
      type: 'delete',
      ctx,
      row,
    });
  });
  tableCache.onUpdate((ctx, oldRow, row) => {
    callbackHistory.push({
      type: 'update',
      ctx,
      row,
      oldRow,
    });
  });

  for (const step of testSteps) {
    const { ops: applyOperations, assertions } = step;
    const { ops, ctx } = applyOperations;
    const callbacks = tableCache.applyOperations(ops, ctx);
    callbacks.forEach(cb => cb.cb());
    for (const assertion of assertions) {
      assertion({ tableCache, callbackHistory });
    }
    // Clear the callback history for the next step.
    callbackHistory.length = 0;
  }
}

describe('TableCache', () => {
  describe('Unindexed player table', () => {
    const newTable = () => new TableCacheImpl(tables.unindexedPlayer.tableDef);
    const mkOperation = (
      type: 'insert' | 'delete',
      row: Infer<typeof UnindexedPlayer>
    ) => {
      const rowId = AlgebraicType.intoMapKey(
        { tag: 'Product', value: tables.unindexedPlayer.rowType },
        row
      );
      return {
        type,
        rowId,
        row,
      };
    };

    test('Insert one', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const player = {
        id: 1,
        ownerId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter()).length).toEqual(1);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Inserting one twice only triggers one event', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const player = {
        id: 1,
        ownerId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [mkOperation('insert', player), mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter()).length).toEqual(1);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Insert dupe is a noop', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const player = {
        id: 1,
        ownerId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter()).length).toEqual(1);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter()).length).toEqual(1);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(0);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Insert once and delete', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const player = {
        id: 1,
        ownerId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('delete', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(0n);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('delete');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Insert twice and delete', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const mkPlayer = () => ({
        id: 1,
        ownerId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      });
      const player = {
        id: 1,
        ownerId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [
            mkOperation('insert', mkPlayer()),
            mkOperation('insert', player),
          ],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('delete', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            // We still have one reference left, so it isn't actually deleted.
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(0);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('delete', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            // Now it is actually deleted.
            expect(tableCache.count()).toEqual(0n);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('delete');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      // Now we are going to insert again, so we can delete both refs at once.
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory).toEqual([insertEvent(player)]);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory).toEqual([]);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('delete', player), mkOperation('delete', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(0n);
            expect(callbackHistory).toEqual([deleteEvent(mkPlayer())]);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Insert one', () => {
      const tableCache = newTable();
      const op = mkOperation('insert', {
        id: 1,
        ownerId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      });
      let rowsInserted = 0;
      const callbacks = tableCache.applyOperations([op], {} as any);
      tableCache.onInsert((ctx, row) => {
        rowsInserted++;
        expect(row).toEqual(op.row);
      });
      expect(callbacks.length).toEqual(1);
      expect(tableCache.count()).toEqual(1n);
      callbacks.forEach(cb => {
        cb.cb();
      });
      expect(rowsInserted).toEqual(1);
    });
  });
  describe('Indexed player table', () => {
    const newTable = () => new TableCacheImpl(tables.player.tableDef);
    const mkOperation = (
      type: 'insert' | 'delete',
      row: Infer<typeof Player>
    ) => {
      const rowId = AlgebraicType.intoMapKey(
        Player.elements['id'].algebraicType,
        row['id']
      );
      return {
        type,
        rowId,
        row,
      };
    };

    test('Insert one', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const player = {
        id: 1,
        userId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter()).length).toEqual(1);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Inserting one twice only triggers one event', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const player = {
        id: 1,
        userId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [mkOperation('insert', player), mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter()).length).toEqual(1);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Insert dupe is a noop', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const player = {
        id: 1,
        userId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter()).length).toEqual(1);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter()).length).toEqual(1);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(0);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Insert once and delete', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const player = {
        id: 1,
        userId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('delete', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(0n);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('delete');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Update smoke test', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const mkPlayer = (name: string) => ({
        id: 1,
        userId: Identity.zero(),
        name: name,
        location: {
          x: 1,
          y: 2,
        },
      });
      steps.push({
        ops: {
          ops: [mkOperation('insert', mkPlayer('jeff'))],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(mkPlayer('jeff'));
            expect(callbackHistory).toEqual([insertEvent(mkPlayer('jeff'))]);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [
            mkOperation('delete', mkPlayer('jeff')),
            mkOperation('insert', mkPlayer('jeffv2')),
          ],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(
              mkPlayer('jeffv2')
            );
            expect(callbackHistory).toEqual([
              updateEvent(mkPlayer('jeff'), mkPlayer('jeffv2')),
            ]);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Insert twice and delete', () => {
      const tableCache = newTable();
      const steps: TestStep[] = [];
      const mkPlayer = () => ({
        id: 1,
        userId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      });
      const player = {
        id: 1,
        userId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      };
      steps.push({
        ops: {
          ops: [
            mkOperation('insert', mkPlayer()),
            mkOperation('insert', player),
          ],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('insert');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('delete', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            // We still have one reference left, so it isn't actually deleted.
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory.length).toEqual(0);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('delete', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            // Now it is actually deleted.
            expect(tableCache.count()).toEqual(0n);
            expect(callbackHistory.length).toEqual(1);
            expect(callbackHistory[0].type).toEqual('delete');
            expect(callbackHistory[0].row).toEqual(player);
          },
        ],
      });
      // Now we are going to insert again, so we can delete both refs at once.
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory).toEqual([insertEvent(player)]);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('insert', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(1n);
            expect(Array.from(tableCache.iter())[0]).toEqual(player);
            expect(callbackHistory).toEqual([]);
          },
        ],
      });
      steps.push({
        ops: {
          ops: [mkOperation('delete', player), mkOperation('delete', player)],
          ctx: {} as any,
        },
        assertions: [
          ({ tableCache, callbackHistory }) => {
            expect(tableCache.count()).toEqual(0n);
            expect(callbackHistory).toEqual([deleteEvent(mkPlayer())]);
          },
        ],
      });
      runTest(tableCache, steps);
    });

    test('Insert one', () => {
      const tableCache = newTable();
      const op = mkOperation('insert', {
        id: 1,
        userId: Identity.zero(),
        name: 'Player 1',
        location: {
          x: 1,
          y: 2,
        },
      });
      let rowsInserted = 0;
      const callbacks = tableCache.applyOperations([op], {} as any);
      tableCache.onInsert((ctx, row) => {
        rowsInserted++;
        expect(row).toEqual(op.row);
      });
      expect(callbacks.length).toEqual(1);
      expect(tableCache.count()).toEqual(1n);
      callbacks.forEach(cb => {
        cb.cb();
      });
      expect(rowsInserted).toEqual(1);
    });
  });

  describe('index lookups', () => {
    // A score per row: `id` the primary key, `player` an index (not unique),
    // `name` a unique column that is not the primary key.
    const { score } = schema({
      score: table(
        {
          name: 'score',
          indexes: [
            {
              accessor: 'player',
              name: 'score_player_idx_btree',
              algorithm: 'btree',
              columns: ['player'],
            },
            {
              accessor: 'name',
              name: 'score_name_idx_btree',
              algorithm: 'btree',
              columns: ['name'],
            },
          ],
          constraints: [
            { name: 'score_name_key', constraint: 'unique', columns: ['name'] },
          ],
        },
        t.row({
          id: t.u32().primaryKey(),
          player: t.u32(),
          name: t.string(),
          points: t.u32(),
        })
      ),
    }).schemaType.tables;
    type Score = { id: number; player: number; name: string; points: number };
    const mk = (id: number, player: number, points = 0): Score => ({
      id,
      player,
      name: `score ${id}`,
      points,
    });
    const op = (type: 'insert' | 'delete', row: Score) => ({
      type,
      rowId: row.id,
      row,
    });
    const cacheOf = (rows: Score[]) => {
      const cache: any = new TableCacheImpl(score as any);
      cache.applyOperations(
        rows.map(r => op('insert', r)),
        {} as any
      );
      return cache;
    };
    const ids = (rows: Iterable<Score>) => [...rows].map(r => r.id).sort();

    test('find on the primary key does not scan the table', () => {
      const cache = cacheOf([mk(1, 7), mk(2, 7), mk(3, 8)]);
      const iter = vi.spyOn(cache, 'iter');
      expect(cache.id.find(2)).toEqual(mk(2, 7));
      expect(cache.id.find(4)).toBeNull();
      expect(iter).not.toHaveBeenCalled();
    });

    test('find on a unique column that is not the primary key does not scan', () => {
      const cache = cacheOf([mk(1, 7), mk(2, 7)]);
      const iter = vi.spyOn(cache, 'iter');
      expect(cache.name.find('score 2')).toEqual(mk(2, 7));
      expect(cache.name.find('score 3')).toBeNull();
      expect(iter).not.toHaveBeenCalled();
    });

    test('filter on one value does not scan the table', () => {
      const cache = cacheOf([mk(1, 7), mk(2, 7), mk(3, 8)]);
      const iter = vi.spyOn(cache, 'iter');
      expect(ids(cache.player.filter(7))).toEqual([1, 2]);
      expect(ids(cache.player.filter(9))).toEqual([]);
      expect(iter).not.toHaveBeenCalled();
    });

    test('a row a second subscription also holds stays as it was, in the cache and its index', () => {
      const cache = cacheOf([mk(1, 7), mk(2, 7)]);
      const held = cache.id.find(1);
      cache.applyOperations([op('insert', mk(1, 7))], {} as any); // a second subscription
      cache.applyOperations([op('delete', mk(1, 7))], {} as any); // one lets go
      expect(cache.id.find(1)).toBe(held);
      expect([...cache.player.filter(7)].map((r: Score) => r.id)).toEqual([
        1, 2,
      ]);
      cache.applyOperations([op('delete', mk(1, 7))], {} as any); // the other lets go
      expect(ids(cache.player.filter(7))).toEqual([2]);
      expect(cache.id.find(1)).toBeNull();
    });

    test('a unique value moving to another row in one transaction is found on the new row', () => {
      const cache = cacheOf([mk(1, 7)]);
      const renamed = { ...mk(2, 7), name: 'score 1' };
      // inserts are applied before deletes
      cache.applyOperations(
        [op('delete', mk(1, 7)), op('insert', renamed)],
        {} as any
      );
      expect(cache.name.find('score 1')).toEqual(renamed);
    });

    test('find on a unique array column takes the array as the value', () => {
      const { tagged } = schema({
        tagged: table(
          {
            name: 'tagged',
            indexes: [
              {
                accessor: 'tags',
                name: 'tagged_tags_idx_btree',
                algorithm: 'btree',
                columns: ['tags'],
              },
            ],
            constraints: [
              {
                name: 'tagged_tags_key',
                constraint: 'unique',
                columns: ['tags'],
              },
            ],
          },
          t.row({ id: t.u32().primaryKey(), tags: t.array(t.string()) })
        ),
      }).schemaType.tables;
      const cache: any = new TableCacheImpl(tagged as any);
      const one = { id: 1, tags: ['a', 'b'] };
      const two = { id: 2, tags: ['ab'] };
      cache.applyOperations(
        [one, two].map(row => ({ type: 'insert', rowId: row.id, row })),
        {} as any
      );
      expect(cache.tags.find(['a', 'b'])).toEqual(one);
      expect(cache.tags.find(['ab'])).toEqual(two);
      expect(cache.tags.find(['b'])).toBeNull();
    });

    test('a key wrapped as a one-element tuple answers as before', () => {
      const cache = cacheOf([mk(1, 7), mk(2, 8)]);
      expect(cache.id.find([2])).toEqual(mk(2, 8));
      expect(cache.name.find(['score 1'])).toEqual(mk(1, 7));
      expect(cache.id.find([1, 2])).toBeNull();
      expect(ids(cache.player.filter([7]))).toEqual([1]);
    });

    test('an index on a table without a primary key', () => {
      const { tally } = schema({
        tally: table(
          {
            name: 'tally',
            indexes: [
              {
                accessor: 'player',
                name: 'tally_player_idx_btree',
                algorithm: 'btree',
                columns: ['player'],
              },
            ],
          },
          t.row({ player: t.u32(), points: t.u32() })
        ),
      }).schemaType.tables;
      const cache: any = new TableCacheImpl(tally as any);
      // without a primary key a row's id is the row itself
      const tallyOp = (type: 'insert' | 'delete', row: object) => ({
        type,
        rowId: JSON.stringify(row),
        row,
      });
      cache.applyOperations(
        [
          tallyOp('insert', { player: 7, points: 1 }),
          tallyOp('insert', { player: 7, points: 2 }),
          tallyOp('insert', { player: 8, points: 3 }),
        ],
        {} as any
      );
      cache.applyOperations(
        [tallyOp('delete', { player: 7, points: 1 })],
        {} as any
      );
      expect([...cache.player.filter(7)]).toEqual([{ player: 7, points: 2 }]);
      expect([...cache.player.filter(8)]).toEqual([{ player: 8, points: 3 }]);
    });

    test('a range still answers, by scanning', () => {
      const cache = cacheOf([mk(1, 7), mk(2, 8), mk(3, 9)]);
      const range = {
        from: { tag: 'included', value: 8 },
        to: { tag: 'unbounded' },
      };
      expect(ids(cache.player.filter(range))).toEqual([2, 3]);
    });

    test('lookups follow inserts, updates that change the key, and deletes', () => {
      const cache = cacheOf([mk(1, 7), mk(2, 7)]);
      // an update arrives as a delete and an insert of the same primary key
      cache.applyOperations(
        [op('delete', mk(1, 7)), op('insert', mk(1, 8, 5))],
        {} as any
      );
      expect(ids(cache.player.filter(7))).toEqual([2]);
      expect(cache.player.filter(8).next().value).toEqual(mk(1, 8, 5));
      expect(cache.id.find(1)).toEqual(mk(1, 8, 5));
      cache.applyOperations([op('delete', mk(2, 7))], {} as any);
      expect(ids(cache.player.filter(7))).toEqual([]);
      expect(cache.name.find('score 2')).toBeNull();
    });

    test('a row held by two subscriptions stays until both let it go', () => {
      const cache = cacheOf([mk(1, 7)]);
      cache.applyOperations([op('insert', mk(1, 7))], {} as any);
      cache.applyOperations([op('delete', mk(1, 7))], {} as any);
      expect(ids(cache.player.filter(7))).toEqual([1]);
      cache.applyOperations([op('delete', mk(1, 7))], {} as any);
      expect(ids(cache.player.filter(7))).toEqual([]);
    });

    test('every lookup agrees with a scan through random changes', () => {
      const cache = cacheOf([]);
      const live = new Map<number, Score>();
      let seed = 1;
      const next = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed % n;
      };
      for (let round = 0; round < 200; round++) {
        const ops = [];
        const touched = new Set<number>();
        for (let k = 0; k < 5; k++) {
          const id = next(40);
          if (touched.has(id)) continue;
          touched.add(id);
          const had = live.get(id);
          const roll = next(3);
          if (!had) {
            const row = mk(id, next(6), round);
            ops.push(op('insert', row));
            live.set(id, row);
          } else if (roll === 0) {
            ops.push(op('delete', had));
            live.delete(id);
          } else {
            const row = mk(id, next(6), round);
            ops.push(op('delete', had), op('insert', row));
            live.set(id, row);
          }
        }
        cache.applyOperations(ops, {} as any);
        for (let player = 0; player < 6; player++) {
          const scanned = [...live.values()].filter(r => r.player === player);
          expect(ids(cache.player.filter(player))).toEqual(ids(scanned));
        }
        for (let id = 0; id < 40; id++) {
          expect(cache.id.find(id)).toEqual(live.get(id) ?? null);
          expect(cache.name.find(`score ${id}`)).toEqual(live.get(id) ?? null);
        }
      }
    });
  });

  test('should be empty on creation', () => {
    const tableCache = new TableCacheImpl(tables.player.tableDef);
    expect(tableCache.count()).toEqual(0n);
  });
});
