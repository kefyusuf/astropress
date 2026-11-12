import { Inject, Injectable } from '@nestjs/common';
import { Site } from '../domain/site';
import { SiteNotFoundError } from '../domain/errors';
import { SITE_REPOSITORY, SiteRepository } from './ports';

@Injectable()
export class GetSite {
  constructor(@Inject(SITE_REPOSITORY) private readonly repo: SiteRepository) {}

  async execute(id: string): Promise<Site> {
    const site = await this.repo.findById(id);
    if (!site) {
      throw new SiteNotFoundError(id);
    }
    return site;
  }
}