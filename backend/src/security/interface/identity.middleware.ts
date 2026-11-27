import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { IDENTITY_RESOLVER, IdentityResolver } from '../application/identity-resolver';
import { AgentRequest } from './agent-request';

@Injectable()
export class IdentityMiddleware implements NestMiddleware<AgentRequest> {
  private readonly logger = new Logger(IdentityMiddleware.name);

  constructor(@Inject(IDENTITY_RESOLVER) private readonly resolver: IdentityResolver) {}

  async use(req: AgentRequest, res: unknown, next: (error?: any) => void): Promise<void> {
    try {
      req.agent = await this.resolver.resolve(req);
      next();
    } catch (err) {
      // Auth hataları sessizce yutulmasın (issue #16): structured warn — credential/header
      // değeri loglanmaz, yalnız başarısızlık ve yol.
      const path = String((req as unknown as { url?: string }).url ?? '');
      this.logger.warn(`auth failed: ${err instanceof Error ? err.message : String(err)} path=${path}`);
      next(err);
    }
  }
}
