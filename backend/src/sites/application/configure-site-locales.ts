import { Inject, Injectable } from '@nestjs/common';
import { Site } from '../domain/site';
import { SiteNotFoundError } from '../domain/errors';
import { SITE_REPOSITORY, SiteRepository } from './ports';

export interface ConfigureSiteLocalesInput {
  siteId: string;
  locales: string[];
  defaultLocale: string;
}

@Injectable()
export class ConfigureSiteLocales {
  constructor(@Inject(SITE_REPOSITORY) private readonly repo: SiteRepository) {}

  async execute(input: ConfigureSiteLocalesInput): Promise<Site> {
    const current = await this.repo.findById(input.siteId);
    if (!current) {
      throw new SiteNotFoundError(input.siteId);
    }
    const updated = Site.create({
      id: current.id,
      name: current.name,
      locales: input.locales,
      defaultLocale: input.defaultLocale,
    });
    await this.repo.save(updated);
    return updated;
  }
}