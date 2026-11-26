import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReadinessState } from './readiness-state';

// @Global: diğer modüller ReadinessState'i import etmeden inject eder; BuildsModule standalone
// boot edilebildiği için (builds.module.spec) explicit import taşır (Nest modül bağımlılık normu).
@Global()
@Module({ controllers: [HealthController], providers: [ReadinessState], exports: [ReadinessState] })
export class HealthModule {}