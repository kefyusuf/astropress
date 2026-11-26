import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ReadinessState, ReadinessSnapshot } from './readiness-state';

// Probe yüzeyi: healthz liveness (her zaman 200), readyz readiness (200|503).
// Gating orchestrator'ın işi (k8s probe normu) — app state raporlar, istek reddetmez (spec karar 4).
@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessState) {}

  @Get('healthz')
  healthz(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readyz')
  readyz(): ReadinessSnapshot {
    const snap = this.readiness.snapshot();
    if (snap.status !== 'ready') throw new ServiceUnavailableException(snap); // 503 + snapshot body
    return snap;
  }
}