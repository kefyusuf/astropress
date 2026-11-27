import { randomBytes } from 'node:crypto';
import { AgentRegistry } from './agent-registry';
import { MintOptions, TokenStore, hashToken } from './token-store';

// Mint use-case: agent için high-entropy token üret, hash store'a yaz (rotate), plaintext döndür.
// agentId registry'de yoksa UnknownAgentError fırlatır (caller reject). Plaintext asla saklanmaz.
export class MintToken {
  constructor(private readonly registry: AgentRegistry, private readonly store: TokenStore) {}

  async execute(agentId: string, opts?: MintOptions): Promise<string> {
    await this.registry.getAgent(agentId); // validate (unknown → UnknownAgentError)
    const token = `astro_${randomBytes(32).toString('base64url')}`;
    await this.store.setHash(agentId, hashToken(token), opts);
    return token;
  }
}
