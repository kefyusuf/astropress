import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { RegisterSite } from './application/register-site';
import { ListSites } from './application/list-sites';
import { GetSite } from './application/get-site';
import { ConfigureSiteLocales } from './application/configure-site-locales';
import { SiteProps } from './domain/site';

@Controller('sites')
export class SitesController {
  constructor(
    private readonly registerSite: RegisterSite,
    private readonly listSites: ListSites,
    private readonly getSite: GetSite,
    private readonly configureSiteLocales: ConfigureSiteLocales,
  ) {}

  @Get()
  list() {
    return this.listSites.execute();
  }

  @Post()
  register(@Body() body: SiteProps) {
    return this.registerSite.execute(body);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.getSite.execute(id);
  }

  @Put(':id/locales')
  configureLocales(@Param('id') id: string, @Body() body: { locales: string[]; defaultLocale: string }) {
    return this.configureSiteLocales.execute({ siteId: id, locales: body.locales, defaultLocale: body.defaultLocale });
  }
}