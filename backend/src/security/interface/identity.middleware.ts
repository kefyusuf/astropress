import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { AgentRegistry } from '../infrastructure/agent-registry';
import { UnknownAgentError } from '../domain/errors';
import { AgentRequest } from './agent-request';

@Injectable()
export class IdentityMiddleware implements NestMiddleware<AgentRequest> {
  constructor(private readonly registry: AgentRegistry) {}

  use(req: AgentRequest, res: unknown, next: (error?: any) => void): void {
    const header = req.headers['x-astropress-agent'];
    const id = (typeof header === 'string' && header) || 'content-studio';
    try {
      req.agent = this.registry.getAgent(id);
    } catch (err) {
      if (err instanceof UnknownAgentError) throw new UnauthorizedException(err.message);
      throw err;
    }
    next();
  }
}