import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { LoggerService } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { AppModule } from './app.module';

// Structured JSON logging (issue #16): Nest logger'ı Pino'ya bağlanır — 401/redis/bootstrap
// hataları yapılandırılmış loglarda görünür (kabul kriteri).
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

class PinoLoggerService implements LoggerService {
  log(message: unknown, ctx?: string): void { logger.info({ ctx }, String(message)); }
  error(message: unknown, trace?: unknown, ctx?: string): void {
    logger.error({ ctx, trace: typeof trace === 'string' ? trace : undefined }, String(message));
  }
  warn(message: unknown, ctx?: string): void { logger.warn({ ctx }, String(message)); }
  debug(message: unknown, ctx?: string): void { logger.debug({ ctx }, String(message)); }
  verbose(message: unknown, ctx?: string): void { logger.trace({ ctx }, String(message)); }
  fatal(message: unknown, ctx?: string): void { logger.fatal({ ctx }, String(message)); }
}

// PORT fail-fast (issue #16): PORT=0/NaN sessizce 3000'e düşmez — geçersiz değer exit 1.
function resolvePort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return 3000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    logger.error(`PORT geçersiz: "${raw}" — 1-65535 pozitif tam sayı olmalı`);
    process.exit(1);
  }
  return n;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useLogger(new PinoLoggerService());
  // X-Request-Id middleware (issue #16): istek-yanıt korelasyonu — gelen id korunur,
  // yoksa üretilir; yanıt başlığıyla geri verilir.
  app.use((req: { headers: Record<string, unknown>; requestId?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    const requestId = String(req.headers['x-request-id'] ?? '') || randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });
  app.useBodyParser('json', { limit: '1mb' });
  const port = resolvePort();
  const host = process.env.HOST || '127.0.0.1';
  // useProcessExit: NestJS default cleanup sonrası signal'i re-raise eder (exit 143/null);
  // graceful teardown'un clean exit 0 vermesi için process.exit(0) kullan (spec §6 F1).
  app.enableShutdownHooks([], { useProcessExit: true });
  await app.listen(port, host);
  logger.info(`AstroPress backend HTTP: http://${host}:${port}`);
}

// Bootstrap hatası: unhandled rejection yerine structured log + exit 1 (issue #16).
bootstrap().catch((err: unknown) => {
  logger.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) }, 'bootstrap başarısız');
  process.exit(1);
});

// Shutdown watchdog (issue #16): graceful teardown 10sn'yi aşarsa zorla çık.
// unref: normal sürede timer loop'u açık tutmaz; hang olursa 10sn'de tetiklenir.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    const watchdog = setTimeout(() => {
      logger.error('shutdown watchdog: 10sn içinde temiz kapanmadı — zorla çıkılıyor');
      process.exit(1);
    }, 10000);
    watchdog.unref();
  });
}
