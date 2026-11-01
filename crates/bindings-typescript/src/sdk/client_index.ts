import { deepEqual, type AlgebraicType } from '../';
import {
  isOptionType,
  isPrimitiveTag,
  isResultType,
  isSpecialProductField,
} from '../lib/algebraic_type';

/**
 * What an index reads of the cached table. The table cache calls the
 * listeners after it changes its own rows: a replace is a row's object
 * changing under one row id (an update, or a copy another subscription
 * delivers). `rows` is the table in the scan's order.
 */
export interface InternalTableEvents<Row> {
  onInternalInsert(listener: (row: Row) => void): void;
  onInternalDelete(listener: (row: Row) => void): void;
  onInternalReplace(listener: (oldRow: Row, newRow: Row) => void): void;
  rows(): Iterable<Row>;
}

/** A group's key: the value itself, or one value standing for it. */
type Key = unknown;

/**
 * How one column type keys its rows. `keyOf` gives every value the scan's
 * `deepEqual` calls equal the same key, and `undefined` for a lookup value the
 * scan can match to no row. When `exact` says so for a lookup value, every
 * row in its group equals it; otherwise each row is checked with `deepEqual`.
 */
interface KeyRule {
  keyOf(value: unknown): Key;
  exact(value: unknown): boolean;
}

/** The key stored NaN rows share: no lookup has it, as `NaN === NaN` is false. */
const NAN_ROWS = Symbol('NaN rows');

const selfKeyed: KeyRule = {
  keyOf: value => (value !== value ? NAN_ROWS : value),
  exact: () => true,
};

function specialKeyed(field: string): KeyRule {
  return {
    keyOf: value =>
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[field]
        : undefined,
    // A stored value's only own key is `field`, so a lookup equals every row
    // in its group exactly when that is its only own key too.
    exact: value => {
      const keys = Object.keys(value as object);
      return keys.length === 1 && keys[0] === field;
    },
  };
}

/** A plain enum (no variant has a payload) groups its rows by variant. */
const enumKeyed: KeyRule = {
  keyOf: value =>
    typeof value === 'object' && value !== null
      ? (value as { tag?: unknown }).tag
      : undefined,
  exact: () => false,
};

/**
 * The rule for a column type, or `undefined` for one an index does not key.
 * Primitives key by their value and the special products (`Identity`,
 * `ConnectionId`, `Timestamp`, `TimeDuration`, `Uuid`) by their one field, as
 * `AlgebraicType.intoMapKey` keys them; the deserializer makes each special
 * product an instance with that field as its only own key. Arrays, other
 * structs, options and sums with payloads keep the table scan. Their
 * only map key would come from the serializer, which coerces what it is given
 * (`{x: 1.9}` writes as `{x: 1}`, a string as the array of its characters)
 * and tells `0` from `-0` where `deepEqual` does not, so a lookup could miss
 * rows the scan finds. These are the column types the C# and Rust SDKs index,
 * plus plain enums, which modules can index (spacetimedb_lib's
 * `FilterableValue`).
 */
export function keyRuleFor(type: AlgebraicType): KeyRule | undefined {
  if (isPrimitiveTag(type.tag)) return selfKeyed;
  if (type.tag === 'Product') {
    const [only, ...rest] = type.value.elements;
    if (only?.name && rest.length === 0 && isSpecialProductField(only.name)) {
      return specialKeyed(only.name);
    }
    return undefined;
  }
  if (type.tag === 'Sum') {
    // The deserializer gives an option and a result shapes of their own, with
    // no `tag`.
    if (isOptionType(type.value) || isResultType(type.value)) return undefined;
    const plain = type.value.variants.every(
      variant =>
        variant.algebraicType.tag === 'Product' &&
        variant.algebraicType.value.elements.length === 0
    );
    return plain ? enumKeyed : undefined;
  }
  return undefined;
}

const NO_ROWS: readonly never[] = [];

/**
 * An index on one column of a cached table, in the shape of the C# SDK's
 * `IndexBase` (`sdks/csharp/src/Table.cs`): the rows grouped by their value.
 * A lookup answers exactly as the table scan it replaces.
 */
abstract class IndexBase<Row extends object> {
  protected readonly table: InternalTableEvents<Row>;
  readonly #column: string;
  readonly #rule: KeyRule;
  readonly #groups = new Map<Key, Set<Row>>();
  // Each row's key as it was filed, so a row leaves the group it is in even
  // if app code has since changed its column, as the scan would follow.
  readonly #keys = new Map<Row, Key>();

  constructor(table: InternalTableEvents<Row>, column: string, rule: KeyRule) {
    this.table = table;
    this.#column = column;
    this.#rule = rule;
    table.onInternalInsert(row => this.#add(row));
    // The delete names the row object the cache held, so it leaves its group
    // even when another row has taken its value meanwhile: the table cache
    // applies a transaction's inserts before its deletes (C# deletes first).
    table.onInternalDelete(row => this.#remove(row));
    table.onInternalReplace((oldRow, newRow) => {
      const oldKey = this.#keys.get(oldRow);
      const newKey = rule.keyOf(this.valueOf(newRow));
      const group = this.#groups.get(oldKey);
      // An update that leaves the column as it was swaps the object in its
      // group, with no group made or dropped.
      if (group && Object.is(oldKey, newKey) && group.delete(oldRow)) {
        this.#keys.delete(oldRow);
        this.#keys.set(newRow, newKey);
        group.add(newRow);
        return;
      }
      this.#remove(oldRow);
      this.#add(newRow);
    });
  }

  #add(row: Row): void {
    const key = this.#rule.keyOf(this.valueOf(row));
    this.#keys.set(row, key);
    let group = this.#groups.get(key);
    if (!group) {
      group = new Set();
      this.#groups.set(key, group);
    }
    group.add(row);
  }

  #remove(row: Row): void {
    if (!this.#keys.has(row)) return;
    const key = this.#keys.get(row);
    this.#keys.delete(row);
    const group = this.#groups.get(key);
    if (!group) return;
    group.delete(row);
    if (group.size === 0) this.#groups.delete(key);
  }

  protected valueOf(row: Row): unknown {
    return (row as Record<string, unknown>)[this.#column];
  }

  /**
   * The rows whose column the scan's `deepEqual` calls equal to `value`, or
   * none. A value with no key matches nothing, as in the scan: so
   * `identity.find(conn.identity)` before the connection has its identity.
   */
  protected rowsWith(value: unknown): ReadonlySet<Row> | readonly Row[] {
    // the hot path (kino's lookups are nearly all on number keys), inlined
    if (this.#rule === selfKeyed) {
      return value !== value ? NO_ROWS : (this.#groups.get(value) ?? NO_ROWS);
    }
    const key = this.#rule.keyOf(value);
    if (key === undefined) return NO_ROWS;
    const group = this.#groups.get(key);
    if (!group) return NO_ROWS;
    if (this.#rule.exact(value)) return group;
    const rows: Row[] = [];
    for (const row of group) {
      if (deepEqual(this.valueOf(row), value)) rows.push(row);
    }
    return rows;
  }
}

/** A unique index: each value has at most one row. C#'s `UniqueIndexBase`. */
export class UniqueIndex<Row extends object> extends IndexBase<Row> {
  find(value: unknown): Row | null {
    const rows = this.rowsWith(value);
    const count = 'size' in rows ? rows.size : rows.length;
    if (count === 0) return null;
    if (count === 1) return rows.values().next().value ?? null;
    // Two rows hold one value while a transaction moves it, or on a float
    // column holding 0 and -0: answer with the scan's first.
    const holders = new Set<Row>(rows);
    for (const row of this.table.rows()) if (holders.has(row)) return row;
    return null;
  }
}

/**
 * An index where many rows can share a value. C#'s `BTreeIndexBase`, which
 * also answers only one value at a time; a range still scans the table.
 */
export class BTreeIndex<Row extends object> extends IndexBase<Row> {
  filter(value: unknown): IteratorObject<Row, undefined> {
    return this.rowsWith(value).values() as IteratorObject<Row, undefined>;
  }
}
