// Reusable buckets keep local searches independent of the total population.
class SpatialGrid {
  constructor(cellSize = 256) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  key(x, y) { return (x + 32768) * 65536 + y + 32768; }

  insert(item) {
    const key = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.y / this.cellSize));
    let bucket = this.cells.get(key);
    if (!bucket) this.cells.set(key, bucket = []);
    bucket.push(item);
  }

  rebuild(items) {
    for (const bucket of this.cells.values()) bucket.length = 0;
    for (const item of items) this.insert(item);
  }

  move(item, oldX, oldY) {
    const oldKey = this.key(Math.floor(oldX / this.cellSize), Math.floor(oldY / this.cellSize));
    const newKey = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.y / this.cellSize));
    if (oldKey === newKey) return;
    const bucket = this.cells.get(oldKey);
    if (bucket) {
      const index = bucket.indexOf(item);
      if (index >= 0) {
        bucket[index] = bucket[bucket.length - 1];
        bucket.pop();
      }
    }
    this.insert(item);
  }

  *query(x, y, radius) {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    const radiusSquared = radius * radius;
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const item of bucket) {
          const dx = item.x - x;
          const dy = item.y - y;
          if (dx * dx + dy * dy <= radiusSquared) yield item;
        }
      }
    }
  }
}
