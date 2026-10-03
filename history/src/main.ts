import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { HistoryAppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('HistoryBootstrap');
  const app = await NestFactory.create(HistoryAppModule);
  app.enableCors();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  const eventStore =
    process.env.EVENT_STORE_FILE || 'data/event-store.jsonl';
  logger.log(`History API escuchando en el puerto ${port}`);
  logger.log(`Leyendo el event store (solo lectura): ${eventStore}`);
  logger.log(`Pantalla disponible en: http://localhost:${port}/`);
}

bootstrap();
