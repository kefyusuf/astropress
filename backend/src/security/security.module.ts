import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AGENTS_FILE, AgentRegistry, defaultAgentsFile } from './infrastructure/agent-registry';
import { HostMiddleware } from './interface/host.middleware';
import { IdentityMiddleware } from './interface/identity.middleware';

@Module({
  providers: [
    { provide: AGENTS_FILE, useFactory: () => defaultAgentsFile() },
    AgentRegistry,
  ],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HostMiddleware, IdentityMiddleware).forRoutes('*');
  }
}