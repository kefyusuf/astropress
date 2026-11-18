import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SitesModule } from './sites/sites.module';
import { BuildsModule } from './builds/builds.module';
import { DomainExceptionFilter } from './sites/infrastructure/domain-exception.filter';
import { BuildExceptionFilter } from './builds/infrastructure/build-exception.filter';

@Module({
  imports: [SitesModule, BuildsModule],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_FILTER, useClass: BuildExceptionFilter },
  ],
})
export class AppModule {}