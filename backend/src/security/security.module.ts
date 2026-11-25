import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AGENTS_FILE, FileAgentRegistry, defaultAgentsFile } from './infrastructure/file-agent-registry';
import { AGENT_REGISTRY, AgentRegistry } from './application/agent-registry';
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
    { provide: AGENT_REGISTRY, useClass: FileAgentRegistry },
    { provide: TOKEN_STORE_FILE, useFactory: () => defaultTokenStoreFile() },
    { provide: TOKEN_STORE, useClass: FileTokenStore },
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