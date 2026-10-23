import { AlgebraicType, type ComparablePrimitive } from '../';

/**
 * An index on one column of a cached table: the rows grouped by that
 * column's value, so looking up one value reads its group instead of
 * scanning the whole table.
 *
 * The table cache calls `add` when a row enters the cache and `remove` when
 * it leaves; an update is a `remove` of the old row and an `add` of the new.
 */
export class ColumnIndex<Row extends object> {
  readonly #column: string;
  readonly #keyType: AlgebraicType;
  /** Column value → (row id → row). */
  readonly #groups = new Map<
    ComparablePrimitive,
    Map<ComparablePrimitive, Row>
  >();

  constructor(column: string, keyType: AlgebraicType) {
    this.#column = column;
    this.#keyType = keyType;
  }

  /** Every row whose column equals `value`. */
  rowsWith(value: unknown): Iterable<Row> {
    return this.#groups.get(this.#keyOf(value))?.values() ?? [];
  }

  add(rowId: ComparablePrimitive, row: Row): void {
    const key = this.#keyOfRow(row);
    let group = this.#groups.get(key);
    if (!group) {
      group = new Map();
      this.#groups.set(key, group);
    }
    group.set(rowId, row);
  }

  remove(rowId: ComparablePrimitive, row: Row): void {
    const key = this.#keyOfRow(row);
    const group = this.#groups.get(key);
    if (!group) return;
    group.delete(rowId);
    if (group.size === 0) this.#groups.delete(key);
  }

  #keyOfRow(row: Row): ComparablePrimitive {
    return this.#keyOf((row as Record<string, unknown>)[this.#column]);
  }

  // Equal values give equal keys, the same encoding the cache uses for row ids.
  #keyOf(value: unknown): ComparablePrimitive {
    return AlgebraicType.intoMapKey(this.#keyType, value);
  }
}
