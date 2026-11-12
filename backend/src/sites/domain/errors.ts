export class SiteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteValidationError';
  }
}

export class SiteAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`Site zaten kayıtlı: ${id}`);
    this.name = 'SiteAlreadyExistsError';
  }
}

export class SiteNotFoundError extends Error {
  constructor(id: string) {
    super(`Site bulunamadı: ${id}`);
    this.name = 'SiteNotFoundError';
  }
}