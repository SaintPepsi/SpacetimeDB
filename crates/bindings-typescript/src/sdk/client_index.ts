import { AlgebraicType, deepEqual, type ComparablePrimitive } from '../';

/**
 * Where an index hears about rows entering and leaving the client cache.
 * The table cache calls these listeners after it changes its own rows; an
 * update is a delete of the old row and an insert of the new one.
 */
export interface InternalTableEvents<Row> {
  onInternalInsert(listener: (row: Row) => void): void;
  onInternalDelete(listener: (row: Row) => void): void;
}

/**
 * Column types whose map key is the value itself (`AlgebraicType.intoMapKey`).
 * A `Map` finds such a key by `SameValueZero`, which is the scan's `===` for
 * every value but `NaN`.
 */
const SELF_KEYED = new Set<AlgebraicType['tag']>([
  'Bool',
  'String',
  'U8',
  'U16',
  'U32',
  'U64',
  'U128',
  'U256',
  'I8',
  'I16',
  'I32',
  'I64',
  'I128',
  'I256',
  'F32',
  'F64',
]);

const NO_ROWS: readonly never[] = [];

/**
 * An index on one column of a cached table, in the shape of the C# SDK's
 * `IndexBase` (`sdks/csharp/src/Table.cs`): the rows grouped by their value.
 *
 * A lookup answers exactly as the table scan it replaces, which compares the
 * column with `deepEqual`. Rows are grouped by `AlgebraicType.intoMapKey`,
 * which gives values the scan calls equal the same key (an `Identity` keys by
 * its number). The reverse does not hold for every type: the serializer
 * behind the other keys coerces what it is given (`{x: 1.9}` writes as
 * `{x: 1}`, a string iterates as an array of its characters), so for those a
 * group's rows are checked with `deepEqual` before they are returned.
 */
abstract class IndexBase<Row extends object> {
  readonly #column: string;
  readonly #keyType: AlgebraicType;
  readonly #selfKeyed: boolean;
  readonly #groups = new Map<ComparablePrimitive, Set<Row>>();

  constructor(
    table: InternalTableEvents<Row>,
    column: string,
    keyType: AlgebraicType
  ) {
    this.#column = column;
    this.#keyType = keyType;
    this.#selfKeyed = SELF_KEYED.has(keyType.tag);
    table.onInternalInsert(row => {
      const key = this.#keyOf(this.#valueOf(row));
      let group = this.#groups.get(key);
      if (!group) {
        group = new Set();
        this.#groups.set(key, group);
      }
      group.add(row);
    });
    // The delete names the row object the cache held, so it leaves its group
    // even when another row has taken its value meanwhile: the table cache
    // applies a transaction's inserts before its deletes (C# deletes first).
    table.onInternalDelete(row => {
      const key = this.#keyOf(this.#valueOf(row));
      const group = this.#groups.get(key);
      if (!group) return;
      group.delete(row);
      if (group.size === 0) this.#groups.delete(key);
    });
  }

  #valueOf(row: Row): unknown {
    return (row as Record<string, unknown>)[this.#column];
  }

  #keyOf(value: unknown): ComparablePrimitive {
    return AlgebraicType.intoMapKey(this.#keyType, value);
  }

  /** The rows whose column the scan's `deepEqual` calls equal to `value`. */
  protected rowsWith(value: unknown): Iterable<Row> {
    if (this.#selfKeyed) {
      // NaN is the one value a Map finds that `===` does not
      if (value !== value) return NO_ROWS;
      return this.#groups.get(value as ComparablePrimitive) ?? NO_ROWS;
    }
    let key: ComparablePrimitive;
    try {
      key = this.#keyOf(value);
    } catch {
      // A value the serializer can't write (`identity.find(conn.identity)`
      // before the connection has its identity passes `undefined`) matches
      // nothing, as in the scan, instead of throwing. C#'s typed
      // `Find(Column value)` can't be given one.
      return NO_ROWS;
    }
    const group = this.#groups.get(key);
    if (!group) return NO_ROWS;
    const rows: Row[] = [];
    for (const row of group) {
      if (deepEqual(this.#valueOf(row), value)) rows.push(row);
    }
    return rows;
  }
}

/**
 * A unique index: each value has at most one row once a transaction is
 * applied. C#'s `UniqueIndexBase`. It keeps a group per value as the BTree
 * index does: two rows hold one value while a transaction moves it, and on a
 * float column `0` and `-0` are two values but one Map key. Like the scan, it
 * returns the first row that matches.
 */
export class UniqueIndex<Row extends object> extends IndexBase<Row> {
  find(value: unknown): Row | null {
    for (const row of this.rowsWith(value)) return row;
    return null;
  }
}

/**
 * An index where many rows can share a value. C#'s `BTreeIndexBase`, which
 * also answers only one value at a time; a range still scans the table.
 */
export class BTreeIndex<Row extends object> extends IndexBase<Row> {
  filter(value: unknown): Iterable<Row> {
    return this.rowsWith(value);
  }
}
