import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReadinessState } from './readiness-state';

// @Global: builds ReadinessState'i import etmeden inject eder (nötr cross-module, redis-connection emsali).
@Global()
@Module({ controllers: [HealthController], providers: [ReadinessState], exports: [ReadinessState] })
export class HealthModule {}