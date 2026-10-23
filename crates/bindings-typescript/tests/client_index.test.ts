import { describe, expect, test } from 'vitest';
import { AlgebraicType, Identity } from '../src';
import { BTreeIndex, UniqueIndex } from '../src/sdk/client_index';

type Score = { id: number; player: number };

// A stand-in for the table cache's internal insert and delete events.
function fakeTable<Row>() {
  const inserts: ((row: Row) => void)[] = [];
  const deletes: ((row: Row) => void)[] = [];
  return {
    onInternalInsert: (listener: (row: Row) => void) => inserts.push(listener),
    onInternalDelete: (listener: (row: Row) => void) => deletes.push(listener),
    insert: (row: Row) => inserts.forEach(listener => listener(row)),
    delete: (row: Row) => deletes.forEach(listener => listener(row)),
  };
}

const ids = (rows: Iterable<Score>) => [...rows].map(row => row.id);

describe('UniqueIndex', () => {
  test('finds the row with a value, and null for a value it lacks', () => {
    const table = fakeTable<Score>();
    const index = new UniqueIndex(table, 'id', AlgebraicType.U32);
    const row = { id: 1, player: 7 };
    table.insert(row);
    expect(index.find(1)).toBe(row);
    expect(index.find(2)).toBeNull();
    table.delete(row);
    expect(index.find(1)).toBeNull();
  });
});

describe('BTreeIndex', () => {
  test('finds every row with a value, and none for a value it lacks', () => {
    const table = fakeTable<Score>();
    const index = new BTreeIndex(table, 'player', AlgebraicType.U32);
    table.insert({ id: 1, player: 7 });
    table.insert({ id: 2, player: 7 });
    table.insert({ id: 3, player: 8 });
    expect(ids(index.filter(7))).toEqual([1, 2]);
    expect(ids(index.filter(8))).toEqual([3]);
    expect(ids(index.filter(9))).toEqual([]);
  });

  test('a deleted row is gone, and so is a value with no rows left', () => {
    const table = fakeTable<Score>();
    const index = new BTreeIndex(table, 'player', AlgebraicType.U32);
    const one = { id: 1, player: 7 };
    const two = { id: 2, player: 7 };
    table.insert(one);
    table.insert(two);
    table.delete(one);
    expect(ids(index.filter(7))).toEqual([2]);
    table.delete(two);
    expect(ids(index.filter(7))).toEqual([]);
  });

  test('an update, a delete of the old row and an insert of the new, moves it', () => {
    const table = fakeTable<Score>();
    const index = new BTreeIndex(table, 'player', AlgebraicType.U32);
    const before = { id: 1, player: 7 };
    table.insert(before);
    table.delete(before);
    table.insert({ id: 1, player: 8 });
    expect(ids(index.filter(7))).toEqual([]);
    expect(ids(index.filter(8))).toEqual([1]);
  });

  test('values that are objects match by content, not by reference', () => {
    const table = fakeTable<{ id: number; owner: Identity }>();
    const index = new BTreeIndex(table, 'owner', Identity.getAlgebraicType());
    table.insert({ id: 1, owner: Identity.fromString('ab'.repeat(32)) });
    const sameOwner = Identity.fromString('ab'.repeat(32));
    expect([...index.filter(sameOwner)].map(row => row.id)).toEqual([1]);
  });
});
