import { Inject, Injectable } from '@nestjs/common';
import { Site } from '../domain/site';
import { SITE_REPOSITORY, SiteRepository } from './ports';

@Injectable()
export class ListSites {
  constructor(@Inject(SITE_REPOSITORY) private readonly repo: SiteRepository) {}

  async execute(): Promise<Site[]> {
    return this.repo.findAll();
  }
}