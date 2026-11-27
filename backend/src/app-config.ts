import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * main.ts üretim konfigürasyonu — tek kaynak (spec §8): HTTP spec boot()'ları da burayı
 * kullanır, böylece ValidationPipe/helmet/trust-proxy davranışları test altındadır (issue #10).
 */
export function configureApp(app: NestExpressApplication): void {
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  // Reverse-proxy arkasında X-Forwarded-For güveni: TRUST_PROXY=1 → 1 hop; yoksa kapalı.
  const trustProxy = process.env.TRUST_PROXY;
  express.set('trust proxy', trustProxy === undefined ? false : trustProxy === '1' ? 1 : trustProxy);
  app.use(helmet());
  app.useBodyParser('json', { limit: '1mb' });
  // Runtime DTO validasyonu: whitelist bilinmeyen alanları keser, forbidNonWhitelisted 400 döndürür,
  // transform tip dönüşümü yapar (interface-typed gövdeler pipe tarafından atlanır — Object metatype).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}
