const NOISE_FLOOR = -60;
const RELEASE = 3;
const MIN_SPAN = 16;
const RANGE = 24;
const ROOM_MARGIN = 5;
const ATTACK = 0.04;
const ROOM_FALL = 0.3;
const ROOM_RISE = 6;

const follow = (value: number, target: number, time: number, h: number) =>
  value + (target - value) * (1 - Math.exp(-h / time));

/**
 * Maps a microphone's loudness to a 0–1 level against the speaker's recent peak and the room, so
 * a quiet microphone moves a meter as far as a loud one. The peak stays 16 dB above the room, so
 * silence and steady background noise are never boosted to full.
 */
export class AutoLevel {
  private peak = -30;
  private room = -55;

  /** Steps `h` seconds at `loudness` dBFS and returns the level. */
  step(loudness: number, h: number): number {
    const db = Math.max(loudness, -120);
    this.room = follow(this.room, db, db < this.room ? ROOM_FALL : ROOM_RISE, h);
    const lowest = Math.max(this.room, NOISE_FLOOR) + MIN_SPAN;
    this.peak =
      db > this.peak ? follow(this.peak, db, ATTACK, h) : follow(this.peak, lowest, RELEASE, h);
    this.peak = Math.max(this.peak, lowest);
    const low = Math.max(Math.max(this.room, NOISE_FLOOR) + ROOM_MARGIN, this.peak - RANGE);
    return Math.min(1, Math.max(0, (db - low) / Math.max(1, this.peak - low)));
  }
}
