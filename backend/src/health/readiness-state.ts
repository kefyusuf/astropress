import { Injectable } from '@nestjs/common';

export type ComponentStatus = 'ready' | 'degraded';
export interface ReadinessSnapshot {
  status: 'ready' | 'degraded';
  components: Record<string, ComponentStatus>;
}

// Boot-time component state (instance-local). Provider'lar onModuleInit/factory'de (listen ÖNCESİ)
// set eder → HTTP serve başladığında map doludur; boş map vacuous-ready (spec §2).
@Injectable()
export class ReadinessState {
  private readonly components = new Map<string, ComponentStatus>();

  set(name: string, ok: boolean): void {
    this.components.set(name, ok ? 'ready' : 'degraded');
  }

  snapshot(): ReadinessSnapshot {
    const components = Object.fromEntries(this.components);
    const ready = [...this.components.values()].every((s) => s === 'ready');
    return { status: ready ? 'ready' : 'degraded', components };
  }
}