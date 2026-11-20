export class UnknownAgentError extends Error {
  constructor(id: string) {
    super(`Bilinmeyen agent: ${id}`);
    this.name = 'UnknownAgentError';
  }
}