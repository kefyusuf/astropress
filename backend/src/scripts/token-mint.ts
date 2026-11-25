import 'reflect-metadata';
import { FileAgentRegistry, defaultAgentsFile } from '../security/infrastructure/file-agent-registry';
import { FileTokenStore, defaultTokenStoreFile } from '../security/infrastructure/file-token-store';
import { MintToken } from '../security/application/mint-token';
import { UnknownAgentError } from '../security/domain/errors';

// Token mint CLI: npm --prefix backend run token:mint -- <agentId>
// Plaintext token BİR KEZ basılır; store'da yalnız sha256 hash. Re-mint = rotate.
async function main(): Promise<void> {
  const agentId = process.argv[2];
  if (!agentId) {
    console.error('Kullanım: token:mint -- <agentId>');
    process.exitCode = 1;
    return;
  }
  const registry = new FileAgentRegistry(defaultAgentsFile());
  const store = new FileTokenStore(defaultTokenStoreFile());
  try {
    const token = await new MintToken(registry, store).execute(agentId);
    console.log(token);
  } catch (err) {
    if (err instanceof UnknownAgentError) {
      console.error(`Bilinmeyen agent: ${agentId}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

void main();