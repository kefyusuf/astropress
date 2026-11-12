import { Module } from '@nestjs/common';
import { SITE_REPOSITORY, SiteRepository } from './application/ports';
import { InMemorySiteRepository } from './infrastructure/in-memory-site.repository';
import { FileSiteRepository, SITES_FILE, defaultSitesFile } from './infrastructure/file-site.repository';
import { RegisterSite } from './application/register-site';
import { ConfigureSiteLocales } from './application/configure-site-locales';
import { GetSite } from './application/get-site';
import { ListSites } from './application/list-sites';

@Module({
  providers: [
    { provide: SITES_FILE, useFactory: () => defaultSitesFile() },
    {
      provide: SITE_REPOSITORY,
      useFactory: (file: string): SiteRepository =>
        process.env.ASTROPRESS_STORAGE === 'memory'
          ? new InMemorySiteRepository()
          : new FileSiteRepository(file),
      inject: [SITES_FILE],
    },
    RegisterSite,
    ConfigureSiteLocales,
    GetSite,
    ListSites,
  ],
  exports: [SITE_REPOSITORY, RegisterSite, ConfigureSiteLocales, GetSite, ListSites],
})
export class SitesModule {}