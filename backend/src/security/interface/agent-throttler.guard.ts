import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AgentRequest } from './agent-request';

@Injectable()
export class AgentThrottlerGuard extends ThrottlerGuard {
  // Loopback'te tüm istekler 127.0.0.1 → per-IP çöker; per-agent tracker şart.
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.agent?.id ?? req.ip;
  }

  // GET exempt (read/poll cheap) → mutations-only throttle. Controller'a dokunmadan (sites-freeze).
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AgentRequest>();
    return req.method === 'GET';
  }
}