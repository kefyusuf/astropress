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

export class BuildQueueFullError extends Error {
  constructor(limit: number) {
    super(`Build kuyruğu dolu (limit: ${limit}), daha sonra deneyin`);
    this.name = 'BuildQueueFullError';
  }
}

export class ConcurrencyError extends Error {
  constructor(streamId: string, expected: number, actual?: number) {
    super(`Event stream version conflict: ${streamId} expected ${expected}` + (actual !== undefined ? `, actual ${actual}` : ''));
    this.name = 'ConcurrencyError';
  }
}