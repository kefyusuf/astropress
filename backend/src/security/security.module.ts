import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AGENTS_FILE, AgentRegistry, defaultAgentsFile } from './infrastructure/agent-registry';
import { HostMiddleware } from './interface/host.middleware';
import { IdentityMiddleware } from './interface/identity.middleware';
import { PermissionGuard } from './interface/permission.guard';
import { AgentThrottlerGuard } from './interface/agent-throttler.guard';
import { RedisThrottlerStorage } from './infrastructure/redis-throttler.storage';
import { createRedisConnection } from '../builds/infrastructure/bullmq/redis-connection';

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
    AgentRegistry,
    { provide: APP_GUARD, useClass: AgentThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HostMiddleware, IdentityMiddleware).forRoutes('*');
  }
}