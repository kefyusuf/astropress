import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { AgentRequest } from './agent-request';

const HOST_ALLOWLIST = new Set(['localhost', '127.0.0.1', '::1']);

// IPv6 Host: '[::1]:3000' biçimi — kapanış parantezi + yalnızca opsiyonel port zorunlu.
// '[::1]evil.com' kalıba uymaz → 403 (issue #10: eski slice(1, indexOf(']')) bypass'ı kapandı).
const IPV6_HOST = /^\[([^\]]+)\](?::\d+)?$/;

function extraAllowedHosts(): Set<string> {
  // ASTROPRESS_ALLOWED_HOSTS: virgülle ayrılmış ek Host değerleri (örn. kahve.example.com,api.internal:8080).
  return new Set(
    String(process.env.ASTROPRESS_ALLOWED_HOSTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

@Injectable()
export class HostMiddleware implements NestMiddleware<AgentRequest> {
  use(req: AgentRequest, res: unknown, next: (error?: any) => void): void {
    if (process.env.ASTROPRESS_ALLOW_ANY_HOST === '1') return next();
    const raw = String(req.headers.host || '');
    let host: string;
    if (raw.startsWith('[')) {
      const m = raw.match(IPV6_HOST);
      if (!m) throw new ForbiddenException('forbidden host');
      host = m[1];
    } else {
      host = raw.split(':')[0];
    }
    const allowed = extraAllowedHosts();
    const ok = HOST_ALLOWLIST.has(host.toLowerCase()) || allowed.has(host.toLowerCase()) || allowed.has(raw.toLowerCase());
    if (!ok) {
      throw new ForbiddenException('forbidden host');
    }
    next();
  }
}