// P1.1: yalnız dil kodu (language-only); bölge kodu (en-US) sonraki increment'ta.
export const LOCALE_PATTERN = /^[a-z]{2}$/;

export function isValidLocale(code: string): boolean {
  return LOCALE_PATTERN.test(code);
}