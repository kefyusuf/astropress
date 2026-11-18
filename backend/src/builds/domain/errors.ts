export class BuildValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildValidationError';
  }
}

export class BuildJobNotFoundError extends Error {
  constructor(id: string) {
    super(`Build job bulunamadı: ${id}`);
    this.name = 'BuildJobNotFoundError';
  }
}