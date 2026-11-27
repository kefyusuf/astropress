import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HealthModule } from './health/health.module';
import { SitesModule } from './sites/sites.module';
import { BuildsModule } from './builds/builds.module';
import { SecurityModule } from './security/security.module';
import { DomainExceptionFilter } from './sites/infrastructure/domain-exception.filter';
import { BuildExceptionFilter } from './builds/infrastructure/build-exception.filter';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

@Module({
  imports: [HealthModule, SitesModule, BuildsModule, SecurityModule],
  providers: [
    // Global filtreler ters sırada denenir: catch-all ÖNCE kaydedilir ki spesifik domain
    // filtreleri (SiteNotFound → 404 vb.) öncelik kazansın (issue #10).
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_FILTER, useClass: BuildExceptionFilter },
  ],
})
export class AppModule {}