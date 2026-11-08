import { timingSafeEqual } from 'node:crypto';
import type { AnalysisJob, AnalysisResult } from '../shared/types';

type Entry = { key: string; job: AnalysisJob; settledAt?: number };

/** Task capabilities are private to a browser conversation, even with a shared API token. */
export class AnalysisJobs {
  private entries = new Map<string, Entry>();

  constructor(
    private ttlMs = 60 * 60_000,
    private capacity = 50,
  ) {}

  private prune() {
    for (const [id, entry] of this.entries) {
      if (entry.settledAt !== undefined && Date.now() - entry.settledAt > this.ttlMs)
        this.entries.delete(id);
    }
  }

  get(id: string, key: string): AnalysisJob | undefined {
    this.prune();
    const entry = this.entries.get(id);
    if (!entry) return;
    const expected = Buffer.from(entry.key),
      provided = Buffer.from(key);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return;
    return entry.job;
  }

  has(id: string) {
    this.prune();
    return this.entries.has(id);
  }

  start(
    id: string,
    key: string,
    work: () => Promise<AnalysisResult>,
    failure: (error: unknown) => string,
  ) {
    this.prune();
    if (this.entries.size >= this.capacity) {
      const oldest = [...this.entries].find(([, entry]) => entry.settledAt !== undefined);
      if (oldest) this.entries.delete(oldest[0]);
    }
    const entry: Entry = { key, job: { id, status: 'running' } };
    this.entries.set(id, entry);
    void Promise.resolve()
      .then(work)
      .then(
        (result) => {
          entry.job = { id, status: 'succeeded', result };
          entry.settledAt = Date.now();
        },
        (error) => {
          entry.job = { id, status: 'failed', error: failure(error) };
          entry.settledAt = Date.now();
        },
      );
    return entry.job;
  }
}
