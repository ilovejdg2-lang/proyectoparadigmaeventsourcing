import './otel';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { forwardOtlp } from './otlp-forwarder';
import { OtelLogger } from './otel-logger';
import { logRequests } from './http-logging';
import { RejectedCommandInterceptor } from './rejected-command.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: new OtelLogger(),
  });

  app.enableCors();
  app.use(logRequests);
  app.use('/otlp/v1', forwardOtlp);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new RejectedCommandInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Transaction API (Command Service)')
    .setDescription(
      'API de Comandos con Event Sourcing y Escritura Append-Only para el Historial Auditable de Transacciones.\n\n' +
        'Características:\n' +
        '- Inmutabilidad y almacenamiento append-only de eventos.\n' +
        '- Control estricto de versiones y concurrencia optimista.\n' +
        '- Validación de transiciones de dominio según ciclo de vida de la transacción.\n' +
        '- Soporte para reintentos y auditoría de eventos.',
    )
    .setVersion('1.0.0')
    .addTag('Transactions (Command API)')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`Transaction API escuchando en el puerto ${port}`);
  logger.log(`Documentación Swagger disponible en: http://localhost:${port}/api/docs`);
}
bootstrap();
