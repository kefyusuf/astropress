import { BuildRunner } from '../../src/builds/application/ports';
import { BuildResult } from '../../src/builds/domain/build-job';

// Test helper: instant/deterministic runner. Eşzamanlılık sayacı serial kanıtı için.
export class FakeBuildRunner implements BuildRunner {
  active = 0;
  maxActive = 0;
  calls = 0;
  private readonly results: BuildResult[];

  constructor(results?: BuildResult[]) {
    this.results = results ?? [{ ok: true, exitCode: 0, logTail: 'fake build ok' }];
  }

  async run(): Promise<BuildResult> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.calls++;
    await new Promise((r) => setImmediate(r)); // yield → serial değilse maxActive > 1 olur
    this.active--;
    return this.results[Math.min(this.calls - 1, this.results.length - 1)];
  }
}

// Queue-bound e2e: run() release edilene kadar block eder → queued job'lar birikir (instant runner kuyruğu hemen boşaltır).
export class BlockingBuildRunner implements BuildRunner {
  calls = 0;
  private release!: () => void;
  private readonly gate = new Promise<void>((r) => { this.release = r; });

  async run(): Promise<BuildResult> {
    this.calls++;
    await this.gate;
    return { ok: true, exitCode: 0, logTail: 'blocking build ok' };
  }

  unblock(): void { this.release(); }
}