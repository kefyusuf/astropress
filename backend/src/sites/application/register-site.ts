import { Inject, Injectable } from '@nestjs/common';
import { Site, SiteProps } from '../domain/site';
import { SiteAlreadyExistsError } from '../domain/errors';
import { SITE_REPOSITORY, SiteRepository } from './ports';

@Injectable()
export class RegisterSite {
  constructor(@Inject(SITE_REPOSITORY) private readonly repo: SiteRepository) {}

  async execute(input: SiteProps): Promise<Site> {
    const site = Site.create(input);
    if (await this.repo.exists(site.id)) {
      throw new SiteAlreadyExistsError(site.id);
    }
    await this.repo.save(site);
    return site;
  }
}