import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { AgentRequest } from './agent-request';

const HOST_ALLOWLIST = new Set(['localhost', '127.0.0.1', '::1']);

@Injectable()
export class HostMiddleware implements NestMiddleware<AgentRequest> {
  use(req: AgentRequest, res: unknown, next: (error?: any) => void): void {
    if (process.env.ASTROPRESS_ALLOW_ANY_HOST === '1') return next();
    const raw = req.headers.host || '';
    const host = typeof raw === 'string' && raw.startsWith('[')
      ? raw.slice(1, raw.indexOf(']'))
      : String(raw).split(':')[0];
    if (!HOST_ALLOWLIST.has(host.toLowerCase())) {
      throw new ForbiddenException('forbidden host');
    }
    next();
  }
}