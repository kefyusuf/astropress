import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityResolver } from '../application/identity-resolver';
import { AgentRegistry } from '../application/agent-registry';
import { UnknownAgentError } from '../domain/errors';
import { Agent } from '../domain/agent';
import { AgentRequest } from '../interface/agent-request';

// Mevcut D1 header-claim davranışı (parity): X-Astropress-Agent → registry, default content-studio.
@Injectable()
export class HeaderIdentityResolver implements IdentityResolver {
  constructor(private readonly registry: AgentRegistry) {}

  async resolve(req: AgentRequest): Promise<Agent> {
    const header = req.headers['x-astropress-agent'];
    const id = (typeof header === 'string' && header) || 'content-studio';
    try {
      return await this.registry.getAgent(id);
    } catch (err) {
      if (err instanceof UnknownAgentError) throw new UnauthorizedException(err.message);
      throw err;
    }
  }
}