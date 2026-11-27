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
import { ReadinessState } from '../health/readiness-state';

@Module({
  imports: [
    // forRootAsync factory compile-time çalışır → ASTROPRESS_RATE_LIMIT env override per-test boot'ta etkili.
    // ttl MILLISECONDS (v6). Default 60 mutation/dk/agent/route. E: REDIS_URL set → Redis storage (guard/config değişmez).
    ThrottlerModule.forRootAsync({
      useFactory: (readiness: ReadinessState) => {
        // Pozitif tam sayı doğrulama: negatif/NaN sessizce kilitlenme yerine fail-fast (issue #10).
        const rawLimit = process.env.ASTROPRESS_RATE_LIMIT;
        if (rawLimit !== undefined && (!Number.isInteger(Number(rawLimit)) || Number(rawLimit) <= 0)) {
          throw new Error(`ASTROPRESS_RATE_LIMIT pozitif tam sayı olmalı: "${rawLimit}"`);
        }
        const limit = rawLimit === undefined ? 60 : Number(rawLimit);
        const throttlers = [{ ttl: 60000, limit }];
        const url = process.env.REDIS_URL;
        if (!url) {
          readiness.set('redis', true); // in-memory storage: her zaman hazır (issue #16)
          return { throttlers };
        }
        const connection = createRedisConnection(url);
        // Redis readiness sinyali (issue #16): bağlantı durumu readyz'e yansır.
        connection.on('ready', () => readiness.set('redis', true));
        connection.on('error', () => readiness.set('redis', false));
        return { throttlers, storage: new RedisThrottlerStorage(connection) };
      },
      inject: [ReadinessState],
    }),
  ],
  providers: [
    { provide: AGENTS_FILE, useFactory: () => defaultAgentsFile() },
    { provide: TOKEN_STORE_FILE, useFactory: () => defaultTokenStoreFile() },
    { provide: DATABASE_URL, useFactory: () => process.env.DATABASE_URL || '' },
    {
      provide: AGENT_REGISTRY,
      useFactory: async (agentsFile: string, dbUrl: string, readiness: ReadinessState): Promise<AgentRegistry> => {
        if (process.env.ASTROPRESS_STORAGE === 'postgres') {
          const registry = new PostgresAgentRegistry(dbUrl, agentsFile);
          await registry.init();
          readiness.set('agents', true); // registry readiness sinyali (issue #16)
          return registry;
        }
        readiness.set('agents', true); // file registry: her zaman hazır
        return new FileAgentRegistry(agentsFile);
      },
      inject: [AGENTS_FILE, DATABASE_URL, ReadinessState],
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
      useFactory: (registry: AgentRegistry, store: TokenStore) => {
        // Fail-fast: bilinmeyen ASTROPRESS_AUTH değeri boot'u öldürür; sessiz header fallback'i yok (issue #10).
        const raw = process.env.ASTROPRESS_AUTH;
        const mode = raw === undefined || raw === '' ? 'header' : raw;
        if (mode !== 'header' && mode !== 'token') {
          throw new Error(`Bilinmeyen ASTROPRESS_AUTH: "${raw}" (geçerli: header|token)`);
        }
        if (mode === 'header') {
          // Varsayılan güvensiz mod üretimde reddedilir: header spoofable (OWASP API2).
          if (process.env.NODE_ENV === 'production') {
            throw new Error('NODE_ENV=production ile ASTROPRESS_AUTH=header reddedildi — ASTROPRESS_AUTH=token kullanın (fail-fast)');
          }
          // eslint-disable-next-line no-console
          console.warn('[security] ASTROPRESS_AUTH=header — YALNIZ GELİŞTİRME: x-astropress-agent header\u2019ı spoofable; üretimde token modu kullanın');
          return new HeaderIdentityResolver(registry);
        }
        return new TokenIdentityResolver(store, registry);
      },
      inject: [AGENT_REGISTRY, TOKEN_STORE],
    },
    { provide: APP_GUARD, useClass: AgentThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Health probe'ları token taşımaz → identity muaf (spec karar 7); Host guard health dahil kalır.
    consumer.apply(HostMiddleware).forRoutes('*');
    consumer.apply(IdentityMiddleware).exclude('healthz', 'readyz').forRoutes('*');
  }
}