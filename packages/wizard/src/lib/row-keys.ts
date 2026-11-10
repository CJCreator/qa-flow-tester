/**
 * Stable React keys for a list whose items have no id of their own. Items are added at the end and
 * removed by position; a key stays with its row, so a row's own state never moves to its neighbour.
 */
export class RowKeys {
  private keys: number[] = [];
  private next = 1;

  /** The keys for a list of this length, growing at the end when rows were added. */
  for(length: number): readonly number[] {
    while (this.keys.length < length) this.keys.push(this.next++);
    if (this.keys.length > length) this.keys.length = length;
    return this.keys;
  }

  /** Forgets the key of the row at this position: call it when that row is removed. */
  remove(index: number): void {
    this.keys.splice(index, 1);
  }
}
