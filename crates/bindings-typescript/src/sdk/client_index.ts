import { AlgebraicType, type ComparablePrimitive } from '../';

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
 * An index on one column of a cached table, in the shape of the C# SDK's
 * `IndexBase` (`sdks/csharp/src/Table.cs`).
 *
 * Column values are compared by `AlgebraicType.intoMapKey`, which turns equal
 * values (an `Identity`, say) into equal map keys.
 */
abstract class IndexBase<Row extends object> {
  readonly #column: string;
  readonly #keyType: AlgebraicType;

  constructor(column: string, keyType: AlgebraicType) {
    this.#column = column;
    this.#keyType = keyType;
  }

  protected getKey(row: Row): ComparablePrimitive {
    return this.keyOf((row as Record<string, unknown>)[this.#column]);
  }

  protected keyOf(value: unknown): ComparablePrimitive {
    return AlgebraicType.intoMapKey(this.#keyType, value);
  }
}

/** A unique index: each value has at most one row. C#'s `UniqueIndexBase`. */
export class UniqueIndex<Row extends object> extends IndexBase<Row> {
  readonly #cache = new Map<ComparablePrimitive, Row>();

  constructor(
    table: InternalTableEvents<Row>,
    column: string,
    keyType: AlgebraicType
  ) {
    super(column, keyType);
    table.onInternalInsert(row => this.#cache.set(this.getKey(row), row));
    // Only if the value is still this row's: the table cache applies a
    // transaction's inserts before its deletes (C# deletes first), so a value
    // moving from one row to another is already the new row's here.
    table.onInternalDelete(row => {
      const key = this.getKey(row);
      if (this.#cache.get(key) === row) this.#cache.delete(key);
    });
  }

  find(value: unknown): Row | null {
    return this.#cache.get(this.keyOf(value)) ?? null;
  }
}

/**
 * An index where many rows can share a value: the rows grouped by it.
 * C#'s `BTreeIndexBase`, which also answers only one value at a time; a range
 * still scans the table.
 */
export class BTreeIndex<Row extends object> extends IndexBase<Row> {
  readonly #cache = new Map<ComparablePrimitive, Set<Row>>();

  constructor(
    table: InternalTableEvents<Row>,
    column: string,
    keyType: AlgebraicType
  ) {
    super(column, keyType);
    table.onInternalInsert(row => {
      const key = this.getKey(row);
      let rows = this.#cache.get(key);
      if (!rows) {
        rows = new Set();
        this.#cache.set(key, rows);
      }
      rows.add(row);
    });
    table.onInternalDelete(row => {
      const key = this.getKey(row);
      const keyCache = this.#cache.get(key);
      if (!keyCache) return;
      keyCache.delete(row);
      if (keyCache.size === 0) this.#cache.delete(key);
    });
  }

  filter(value: unknown): Iterable<Row> {
    return this.#cache.get(this.keyOf(value)) ?? [];
  }
}
