import { Module } from '@nestjs/common';
import { SITE_REPOSITORY } from './application/ports';
import { InMemorySiteRepository } from './infrastructure/in-memory-site.repository';
import { RegisterSite } from './application/register-site';
import { ConfigureSiteLocales } from './application/configure-site-locales';
import { GetSite } from './application/get-site';
import { ListSites } from './application/list-sites';

@Module({
  providers: [
    { provide: SITE_REPOSITORY, useClass: InMemorySiteRepository },
    RegisterSite,
    ConfigureSiteLocales,
    GetSite,
    ListSites,
  ],
  exports: [SITE_REPOSITORY, RegisterSite, ConfigureSiteLocales, GetSite, ListSites],
})
export class SitesModule {}