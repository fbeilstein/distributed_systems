/**
 * Seeded PRNG — Mulberry32
 * Deterministic pseudorandom number generator.
 */
export class PRNG {
  constructor(seed) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1) */
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive */
  nextInt(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Clone the current state for forking */
  clone() {
    const p = new PRNG(0);
    p.state = this.state;
    return p;
  }
}
