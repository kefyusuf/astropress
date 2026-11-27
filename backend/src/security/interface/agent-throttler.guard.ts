import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AgentRequest } from './agent-request';

// ASTROPRESS_READ_RATE_LIMIT: GET istekleri için ayrı okuma limiti (vars. 240/dk/agent).
// Mutasyonlar @nestjs/throttler ile (Redis storage destekli); okuma penceresi süreç-içi
// sliding window — çok replikada hafif gevşek kabul (read limit; issue #10).
function readRateLimit(): number {
  const raw = process.env.ASTROPRESS_READ_RATE_LIMIT;
  if (raw !== undefined && (!Number.isInteger(Number(raw)) || Number(raw) <= 0)) {
    throw new Error(`ASTROPRESS_READ_RATE_LIMIT pozitif tam sayı olmalı: "${raw}"`);
  }
  return raw === undefined ? 240 : Number(raw);
}

@Injectable()
export class AgentThrottlerGuard extends ThrottlerGuard {
  private readonly readLimit: number = readRateLimit();
  private readonly readWindow = new Map<string, number[]>();

  // Loopback'te tüm istekler 127.0.0.1 → per-IP çöker; per-agent tracker şart.
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.agent?.id ?? req.ip;
  }

  // GET artık muaf değil: ayrı okuma penceresi; mutasyonlar super üzerinden throttle (issue #10).
  protected async shouldSkip(_context: ExecutionContext): Promise<boolean> {
    return false;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AgentRequest>();
    if (req.method === 'GET') return this.readThrottle(req);
    return super.canActivate(context);
  }

  private readThrottle(req: AgentRequest): boolean {
    const key = String(req.agent?.id ?? req.ip ?? 'anon');
    const now = Date.now();
    const arr = (this.readWindow.get(key) ?? []).filter((t) => now - t < 60000);
    if (arr.length >= this.readLimit) {
      throw new HttpException('Okuma limiti aşıldı', HttpStatus.TOO_MANY_REQUESTS);
    }
    arr.push(now);
    this.readWindow.set(key, arr);
    if (this.readWindow.size > 5000) this.readWindow.clear(); // basit bellek savunması
    return true;
  }
}
