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