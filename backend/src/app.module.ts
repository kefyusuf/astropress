import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SitesModule } from './sites/sites.module';
import { DomainExceptionFilter } from './sites/infrastructure/domain-exception.filter';

@Module({
  imports: [SitesModule],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}