import { describe, expect, test } from 'vitest';
import { AlgebraicType, Identity } from '../src';
import { ColumnIndex } from '../src/sdk/column_index';

type Score = { id: number; player: number };

const scores = () => new ColumnIndex<Score>('player', AlgebraicType.U32);

describe('ColumnIndex', () => {
  test('finds every row with a value, and nothing for a value it lacks', () => {
    const index = scores();
    index.add(1, { id: 1, player: 7 });
    index.add(2, { id: 2, player: 7 });
    index.add(3, { id: 3, player: 8 });
    expect([...index.rowsWith(7)].map(row => row.id)).toEqual([1, 2]);
    expect([...index.rowsWith(8)].map(row => row.id)).toEqual([3]);
    expect([...index.rowsWith(9)]).toEqual([]);
  });

  test('a removed row is gone, and so is a value with no rows left', () => {
    const index = scores();
    index.add(1, { id: 1, player: 7 });
    index.add(2, { id: 2, player: 7 });
    index.remove(1, { id: 1, player: 7 });
    expect([...index.rowsWith(7)].map(row => row.id)).toEqual([2]);
    index.remove(2, { id: 2, player: 7 });
    expect([...index.rowsWith(7)]).toEqual([]);
  });

  test('an update that keeps its value keeps its place; one that changes it moves', () => {
    const index = scores();
    index.add(1, { id: 1, player: 7 });
    index.add(2, { id: 2, player: 7 });
    index.update(1, { id: 1, player: 7 }, { id: 1, player: 7 });
    expect([...index.rowsWith(7)].map(row => row.id)).toEqual([1, 2]);
    index.update(1, { id: 1, player: 7 }, { id: 1, player: 8 });
    expect([...index.rowsWith(7)].map(row => row.id)).toEqual([2]);
    expect([...index.rowsWith(8)].map(row => row.id)).toEqual([1]);
  });

  test('values that are objects match by content, not by reference', () => {
    const index = new ColumnIndex<{ id: number; owner: Identity }>(
      'owner',
      Identity.getAlgebraicType()
    );
    const owner = Identity.fromString('ab'.repeat(32));
    index.add(1, { id: 1, owner });
    const sameOwner = Identity.fromString('ab'.repeat(32));
    expect([...index.rowsWith(sameOwner)].map(row => row.id)).toEqual([1]);
  });
});
