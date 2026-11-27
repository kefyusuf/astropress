import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  // useProcessExit: NestJS default cleanup sonrası signal'i re-raise eder (exit 143/null);
  // graceful teardown'un clean exit 0 vermesi için process.exit(0) kullan (spec §6 F1).
  app.enableShutdownHooks([], { useProcessExit: true });
  await app.listen(port, host);
  console.log(`AstroPress backend HTTP: http://${host}:${port}`);
}

void bootstrap();
