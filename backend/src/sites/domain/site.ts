import { isValidLocale } from './locale';
import { SiteValidationError } from './errors';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface SiteProps {
  id: string;
  name: string;
  locales: string[];
  defaultLocale: string;
}

export class Site {
  readonly id: string;
  readonly name: string;
  readonly locales: readonly string[];
  readonly defaultLocale: string;

  private constructor(props: SiteProps) {
    this.id = props.id;
    this.name = props.name;
    this.locales = [...props.locales];
    this.defaultLocale = props.defaultLocale;
  }

  static create(props: SiteProps): Site {
    if (!ID_PATTERN.test(props.id)) {
      throw new SiteValidationError(`Geçersiz site id (slug): ${props.id}`);
    }
    if (!props.name || !props.name.trim()) {
      throw new SiteValidationError('Site name boş olamaz');
    }
    if (!Array.isArray(props.locales) || props.locales.length === 0) {
      throw new SiteValidationError('locales en az bir dil içermeli');
    }
    for (const loc of props.locales) {
      if (!isValidLocale(loc)) {
        throw new SiteValidationError(`Geçersiz locale kodu: ${loc}`);
      }
    }
    if (new Set(props.locales).size !== props.locales.length) {
      throw new SiteValidationError('locales tekrarlı olamaz');
    }
    if (!props.locales.includes(props.defaultLocale)) {
      throw new SiteValidationError(`defaultLocale locales içinde olmalı: ${props.defaultLocale}`);
    }
    return new Site(props);
  }

  hasLocale(locale: string): boolean {
    return this.locales.includes(locale);
  }

  // Ana dil öneksiz (kök), diğerleri /<locale>; site-başı ana dil bağımsızdır.
  localePrefix(locale: string): string {
    if (!this.hasLocale(locale)) {
      throw new SiteValidationError(`Site bu dili desteklemiyor: ${locale}`);
    }
    return locale === this.defaultLocale ? '' : `/${locale}`;
  }
}