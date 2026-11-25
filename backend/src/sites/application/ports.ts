import { Site } from '../domain/site';

export const SITE_REPOSITORY = Symbol('SITE_REPOSITORY');

export interface SiteRepository {
  save(site: Site): Promise<void>;
  findById(id: string): Promise<Site | null>;
  findAll(): Promise<Site[]>;
  exists(id: string): Promise<boolean>;
}