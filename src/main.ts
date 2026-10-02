import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

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

