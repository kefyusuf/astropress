import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './factory.mjs';
import { getAgent } from './auth.mjs';

// Kimlik: ASTROPRESS_AGENT env (varsayılan content-studio). Yetki matrisi sunucu tarafında zorunlu.
const server = createMcpServer(getAgent());
await server.connect(new StdioServerTransport());
