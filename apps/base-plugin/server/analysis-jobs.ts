import { timingSafeEqual } from 'node:crypto';
import type { AnalysisJob, AnalysisResult, AnalysisUpdate, JobStreamEvent } from '../shared/types';

import { applyAnalysisUpdate } from '../shared/progress';
type Entry = {
  key: string;
  job: AnalysisJob;
  settledAt?: number;
  listeners: Set<(event: JobStreamEvent) => void>;
};

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

  subscribe(id: string, key: string, listener: (event: JobStreamEvent) => void) {
    const job = this.get(id, key);
    if (!job) return null;
    const entry = this.entries.get(id)!;
    entry.listeners.add(listener);
    listener({ type: 'snapshot', job });
    return () => {
      entry.listeners.delete(listener);
    };
  }

  has(id: string) {
    this.prune();
    return this.entries.has(id);
  }

  start(
    id: string,
    key: string,
    work: (publish: (update: AnalysisUpdate) => void) => Promise<AnalysisResult>,
    failure: (error: unknown) => string,
  ) {
    this.prune();
    if (this.entries.size >= this.capacity) {
      const oldest = [...this.entries].find(([, entry]) => entry.settledAt !== undefined);
      if (oldest) this.entries.delete(oldest[0]);
    }
    const entry: Entry = { key, job: { id, status: 'running' }, listeners: new Set() };
    const broadcast = (event: JobStreamEvent) => {
      for (const listener of entry.listeners) listener(event);
    };
    const publish = (update: AnalysisUpdate) => {
      if (entry.job.status !== 'running') return;
      entry.job = {
        id,
        status: 'running',
        progress: applyAnalysisUpdate(entry.job.progress, update),
      };
      broadcast({ type: 'update', update });
    };
    this.entries.set(id, entry);
    void Promise.resolve()
      .then(() => work(publish))
      .then(
        (result) => {
          entry.job = { id, status: 'succeeded', result };
          entry.settledAt = Date.now();
          broadcast({ type: 'snapshot', job: entry.job });
          entry.listeners.clear();
        },
        (error) => {
          const progress = entry.job.status === 'running' ? entry.job.progress : undefined;
          entry.job = {
            id,
            status: 'failed',
            error: failure(error),
            ...(progress ? { progress } : {}),
          };
          entry.settledAt = Date.now();
          broadcast({ type: 'snapshot', job: entry.job });
          entry.listeners.clear();
        },
      );
    return entry.job;
  }
}
