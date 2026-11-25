import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { IDENTITY_RESOLVER, IdentityResolver } from '../application/identity-resolver';
import { AgentRequest } from './agent-request';

@Injectable()
export class IdentityMiddleware implements NestMiddleware<AgentRequest> {
  constructor(@Inject(IDENTITY_RESOLVER) private readonly resolver: IdentityResolver) {}

  async use(req: AgentRequest, res: unknown, next: (error?: any) => void): Promise<void> {
    try {
      req.agent = await this.resolver.resolve(req);
      next();
    } catch (err) {
      next(err);
    }
  }
}