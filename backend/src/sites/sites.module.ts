import { Module } from '@nestjs/common';
import { SITE_REPOSITORY, SiteRepository } from './application/ports';
import { InMemorySiteRepository } from './infrastructure/in-memory-site.repository';
import { FileSiteRepository, SITES_FILE, defaultSitesFile } from './infrastructure/file-site.repository';
import { SqliteSiteRepository, DB_FILE, defaultDbFile } from './infrastructure/sqlite-site.repository';
import { RegisterSite } from './application/register-site';
import { ConfigureSiteLocales } from './application/configure-site-locales';
import { GetSite } from './application/get-site';
import { ListSites } from './application/list-sites';
import { SitesController } from './sites.controller';

@Module({
  controllers: [SitesController],
  providers: [
    { provide: SITES_FILE, useFactory: () => defaultSitesFile() },
    { provide: DB_FILE, useFactory: () => defaultDbFile() },
    {
      provide: SITE_REPOSITORY,
      useFactory: (file: string, dbFile: string): SiteRepository => {
        const mode = process.env.ASTROPRESS_STORAGE;
        if (mode === 'memory') return new InMemorySiteRepository();
        if (mode === 'sqlite') return new SqliteSiteRepository(dbFile);
        return new FileSiteRepository(file);
      },
      inject: [SITES_FILE, DB_FILE],
    },
    RegisterSite,
    ConfigureSiteLocales,
    GetSite,
    ListSites,
  ],
  exports: [SITE_REPOSITORY, RegisterSite, ConfigureSiteLocales, GetSite, ListSites],
})
export class SitesModule {}