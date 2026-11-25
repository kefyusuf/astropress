import 'reflect-metadata';
import { FileAgentRegistry, defaultAgentsFile } from '../security/infrastructure/file-agent-registry';
import { FileTokenStore, defaultTokenStoreFile } from '../security/infrastructure/file-token-store';
import { PostgresAgentRegistry } from '../security/infrastructure/postgres-agent-registry';
import { PostgresTokenStore } from '../security/infrastructure/postgres-token-store';
import { AgentRegistry } from '../security/application/agent-registry';
import { TokenStore } from '../security/application/token-store';
import { MintToken } from '../security/application/mint-token';
import { UnknownAgentError } from '../security/domain/errors';

// Token mint CLI: npm --prefix backend run token:mint -- <agentId>
// Plaintext token BİR KEZ basılır; store'da yalnız sha256 hash. Re-mint = rotate.
// ASTROPRESS_STORAGE=postgres → shared DB (multi-instance); değilse file (parity). Bridge CLI emsali.
async function main(): Promise<void> {
  const agentId = process.argv[2];
  if (!agentId) {
    console.error('Kullanım: token:mint -- <agentId>');
    process.exitCode = 1;
    return;
  }
  const postgres = process.env.ASTROPRESS_STORAGE === 'postgres';
  const url = process.env.DATABASE_URL || '';
  const pgRegistry = postgres ? new PostgresAgentRegistry(url, defaultAgentsFile()) : null;
  const pgStore = postgres ? new PostgresTokenStore(url) : null;
  const registry: AgentRegistry = pgRegistry ?? new FileAgentRegistry(defaultAgentsFile());
  const store: TokenStore = pgStore ?? new FileTokenStore(defaultTokenStoreFile());
  try {
    if (pgRegistry) await pgRegistry.init();
    if (pgStore) await pgStore.init();
    const token = await new MintToken(registry, store).execute(agentId);
    console.log(token);
  } catch (err) {
    if (err instanceof UnknownAgentError) {
      console.error(`Bilinmeyen agent: ${agentId}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    if (pgRegistry) await pgRegistry.close().catch(() => {});
    if (pgStore) await pgStore.close().catch(() => {});
  }
}

void main();