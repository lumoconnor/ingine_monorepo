/** Binary min-heap of (index, priority): the queue behind flood fills and pathfinding over grids. */
export class MinHeap {
  private idx: Int32Array;
  private pri: Float32Array;
  size = 0;
  constructor(cap: number) {
    this.idx = new Int32Array(cap);
    this.pri = new Float32Array(cap);
  }
  push(i: number, p: number): void {
    if (this.size === this.idx.length) {
      const ni = new Int32Array(this.size * 2);
      const np = new Float32Array(this.size * 2);
      ni.set(this.idx);
      np.set(this.pri);
      this.idx = ni;
      this.pri = np;
    }
    let k = this.size++;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (this.pri[up] <= p) break;
      this.idx[k] = this.idx[up];
      this.pri[k] = this.pri[up];
      k = up;
    }
    this.idx[k] = i;
    this.pri[k] = p;
  }
  pop(): [number, number] {
    const top: [number, number] = [this.idx[0], this.pri[0]];
    const li = this.idx[--this.size];
    const lp = this.pri[this.size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.pri[c + 1] < this.pri[c]) c++;
      if (this.pri[c] >= lp) break;
      this.idx[k] = this.idx[c];
      this.pri[k] = this.pri[c];
      k = c;
    }
    this.idx[k] = li;
    this.pri[k] = lp;
    return top;
  }
}
