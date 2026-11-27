import { Injectable, OnApplicationShutdown } from '@nestjs/common';

export type ComponentStatus = 'ready' | 'degraded';
export interface ReadinessSnapshot {
  status: 'ready' | 'degraded';
  components: Record<string, ComponentStatus>;
}

// Boot-time component state (instance-local). Provider'lar onModuleInit/factory'de (listen ÖNCESİ)
// set eder → HTTP serve başladığında map doludur; boş map vacuous-ready (spec §2).
// Shutdown'da degrade (issue #16): graceful teardown başlarken readyz 503 döner →
// LB trafiği drain edilirken yeni istek alınmaz.
@Injectable()
export class ReadinessState implements OnApplicationShutdown {
  private readonly components = new Map<string, ComponentStatus>();
  private shuttingDown = false;

  set(name: string, ok: boolean): void {
    this.components.set(name, ok ? 'ready' : 'degraded');
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
  }

  snapshot(): ReadinessSnapshot {
    const components = Object.fromEntries(this.components);
    if (this.shuttingDown) components['shutdown'] = 'degraded';
    const ready = !this.shuttingDown && [...this.components.values()].every((s) => s === 'ready');
    return { status: ready ? 'ready' : 'degraded', components };
  }
}
