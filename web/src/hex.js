// Pointy-top hex grid, odd-r offset layout — mirrors pipeline/common.py HexGrid exactly.
export const SQRT3 = Math.sqrt(3);

export class HexGrid {
  constructor({ radius, cols, rows }) {
    this.radius = radius; this.cols = cols; this.rows = rows; this.size = cols * rows;
  }
  colRow(i) { return [i % this.cols, Math.floor(i / this.cols)]; }
  index(c, r) { return r * this.cols + c; }
  center(i) {
    const c = i % this.cols, r = (i / this.cols) | 0;
    return [SQRT3 * this.radius * (c + 0.5 * (r & 1)), 1.5 * this.radius * r];
  }
  cellAt(x, y) {
    const q = (SQRT3 / 3 * x - y / 3) / this.radius, rr = (2 / 3 * y) / this.radius;
    let cx = q, cz = rr, cy = -cx - cz;
    let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
    const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
    const row = rz, col = rx + (row - (row & 1)) / 2;
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows ? this.index(col, row) : -1;
  }
  neighbours(i) {
    const [c, r] = this.colRow(i);
    const off = (r & 1) ? [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]]
      : [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
    const out = [];
    for (const [dc, dr] of off) {
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && cc < this.cols && rr >= 0 && rr < this.rows) out.push(this.index(cc, rr));
    }
    return out;
  }
}
