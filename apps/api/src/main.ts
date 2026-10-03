import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// .env lives at the repo root so one file serves every workspace, but the
// API's working directory varies with how it is started. Walk up until we
// find it rather than guessing a fixed number of levels.
function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return config({ path: candidate });
    dir = resolve(dir, '..');
  }
  return config();
}
loadEnv();
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

const REQUIRED = [
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  'DATABASE_URL', 'REDIS_URL',
];

async function bootstrap() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}. Copy .env.example to .env.`);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // WEB_ORIGIN may list several origins, comma-separated. A bare hostname
  // (how Render hands one service's address to another) is taken as https.
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',').map((o) => o.trim()).filter(Boolean)
    .map((o) => (o.includes('://') ? o : `https://${o}`));
  app.enableCors({ origin: origins });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // In production the API also serves the built console, so one service is
  // the whole app: same origin, no CORS, one URL to share.
  const web = resolve(__dirname, '../../web/dist');
  if (existsSync(web)) {
    app.useStaticAssets(web);
    new Logger('bootstrap').log(`Serving console from ${web}`);
  }

  await app.listen(Number(process.env.PORT ?? 3000));
  new Logger('bootstrap').log(`Cutroom API on :${process.env.PORT ?? 3000}`);
}

bootstrap();
