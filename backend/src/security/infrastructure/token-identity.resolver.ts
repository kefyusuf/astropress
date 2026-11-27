import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityResolver } from '../application/identity-resolver';
import { TokenStore, hashToken } from '../application/token-store';
import { AgentRegistry } from '../application/agent-registry';
import { UnknownAgentError } from '../domain/errors';
import { Agent } from '../domain/agent';
import { AgentRequest } from '../interface/agent-request';

const UNAUTHORIZED_MESSAGE = 'Yetkisiz: geçerli bir bearer token gerekli';

// Sıkı bearer biçimi: 'Bearer <token>' — sondaki/öndeki boşluklara izin yok (issue #10).
const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i;

// Token mode (Faz-2+): Authorization: Bearer → sha256 → TokenStore → registry. Fail-closed, fallback YOK.
@Injectable()
export class TokenIdentityResolver implements IdentityResolver {
  constructor(private readonly store: TokenStore, private readonly registry: AgentRegistry) {}

  async resolve(req: AgentRequest): Promise<Agent> {
    const header = req.headers['authorization'];
    const value = typeof header === 'string' ? header : '';
    const match = value.match(BEARER_PATTERN);
    if (!match) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    const agentId = await this.store.findAgentByHash(hashToken(match[1].trim()));
    if (!agentId) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    try {
      return await this.registry.getAgent(agentId);
    } catch (err) {
      if (err instanceof UnknownAgentError) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
      throw err;
    }
  }
}
