import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AGENTS_FILE, FileAgentRegistry, defaultAgentsFile } from './infrastructure/file-agent-registry';
import { AGENT_REGISTRY, AgentRegistry } from './application/agent-registry';
import { PostgresAgentRegistry } from './infrastructure/postgres-agent-registry';
import { PostgresTokenStore } from './infrastructure/postgres-token-store';
import { DATABASE_URL } from '../sites/infrastructure/postgres-site.repository';
import { IDENTITY_RESOLVER } from './application/identity-resolver';
import { TOKEN_STORE, TokenStore } from './application/token-store';
import { TOKEN_STORE_FILE, FileTokenStore, defaultTokenStoreFile } from './infrastructure/file-token-store';
import { HeaderIdentityResolver } from './infrastructure/header-identity.resolver';
import { TokenIdentityResolver } from './infrastructure/token-identity.resolver';
import { HostMiddleware } from './interface/host.middleware';
import { IdentityMiddleware } from './interface/identity.middleware';
import { PermissionGuard } from './interface/permission.guard';
import { AgentThrottlerGuard } from './interface/agent-throttler.guard';
import { RedisThrottlerStorage } from './infrastructure/redis-throttler.storage';
import { createRedisConnection } from '../infrastructure/redis-connection';

@Module({
  imports: [
    // forRootAsync factory compile-time çalışır → ASTROPRESS_RATE_LIMIT env override per-test boot'ta etkili.
    // ttl MILLISECONDS (v6). Default 60 mutation/dk/agent/route. E: REDIS_URL set → Redis storage (guard/config değişmez).
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const throttlers = [{ ttl: 60000, limit: Number(process.env.ASTROPRESS_RATE_LIMIT) || 60 }];
        const url = process.env.REDIS_URL;
        return url
          ? { throttlers, storage: new RedisThrottlerStorage(createRedisConnection(url)) }
          : { throttlers };
      },
    }),
  ],
  providers: [
    { provide: AGENTS_FILE, useFactory: () => defaultAgentsFile() },
    { provide: TOKEN_STORE_FILE, useFactory: () => defaultTokenStoreFile() },
    { provide: DATABASE_URL, useFactory: () => process.env.DATABASE_URL || '' },
    {
      provide: AGENT_REGISTRY,
      useFactory: async (agentsFile: string, dbUrl: string): Promise<AgentRegistry> => {
        if (process.env.ASTROPRESS_STORAGE === 'postgres') {
          const registry = new PostgresAgentRegistry(dbUrl, agentsFile);
          await registry.init();
          return registry;
        }
        return new FileAgentRegistry(agentsFile);
      },
      inject: [AGENTS_FILE, DATABASE_URL],
    },
    {
      provide: TOKEN_STORE,
      useFactory: async (file: string, dbUrl: string): Promise<TokenStore> => {
        if (process.env.ASTROPRESS_STORAGE === 'postgres') {
          const store = new PostgresTokenStore(dbUrl);
          await store.init();
          return store;
        }
        return new FileTokenStore(file);
      },
      inject: [TOKEN_STORE_FILE, DATABASE_URL],
    },
    {
      provide: IDENTITY_RESOLVER,
      useFactory: (registry: AgentRegistry, store: TokenStore) =>
        (process.env.ASTROPRESS_AUTH || 'header') === 'token'
          ? new TokenIdentityResolver(store, registry)
          : new HeaderIdentityResolver(registry),
      inject: [AGENT_REGISTRY, TOKEN_STORE],
    },
    { provide: APP_GUARD, useClass: AgentThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HostMiddleware, IdentityMiddleware).forRoutes('*');
  }
}