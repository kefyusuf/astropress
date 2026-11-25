import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityResolver } from '../application/identity-resolver';
import { TokenStore, hashToken } from '../application/token-store';
import { AgentRegistry } from '../application/agent-registry';
import { UnknownAgentError } from '../domain/errors';
import { Agent } from '../domain/agent';
import { AgentRequest } from '../interface/agent-request';

// Token mode (Faz-2+): Authorization: Bearer → sha256 → TokenStore → registry. Fail-closed, fallback YOK.
@Injectable()
export class TokenIdentityResolver implements IdentityResolver {
  constructor(private readonly store: TokenStore, private readonly registry: AgentRegistry) {}

  async resolve(req: AgentRequest): Promise<Agent> {
    const header = req.headers['authorization'];
    const value = typeof header === 'string' ? header : '';
    const match = /^Bearer (.+)$/i.exec(value);
    if (!match) throw new UnauthorizedException('Geçersiz veya eksik bearer token');
    const agentId = await this.store.findAgentByHash(hashToken(match[1].trim()));
    if (!agentId) throw new UnauthorizedException('Bilinmeyen token');
    try {
      return await this.registry.getAgent(agentId);
    } catch (err) {
      if (err instanceof UnknownAgentError) throw new UnauthorizedException(err.message);
      throw err;
    }
  }
}