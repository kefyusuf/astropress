import { IsArray, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

// Runtime DTO validasyonu (issue #10): ValidationPipe whitelist + forbidNonWhitelisted ile
// bilinmeyen alanlar 400 döner; tip zorlaması class-validator ile yapılır (interface runtime'da silinir).

const LOCALE_RE = /^[a-z]{2}$/;

export class CreateSiteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  locales!: string[];

  @IsString()
  defaultLocale!: string;
}

export class ConfigureLocalesDto {
  @IsArray()
  @IsString({ each: true })
  locales!: string[];

  @IsString()
  @MinLength(2, { message: 'defaultLocale en az 2 karakter olmalı' })
  defaultLocale!: string;
}

// locale kod biçimi burada da korunur (domain Locale ile aynı kural — tek kaynak: LOCALE_RE).
export function isValidLocaleDto(code: string): boolean {
  return LOCALE_RE.test(code);
}
