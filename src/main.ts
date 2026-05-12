import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);
  const swaggerPath = config.get<string>('SWAGGER_PATH', 'docs');
  const corsOrigin = config.get<string>('CORS_ORIGIN', '*');

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS
  app.enableCors({ origin: corsOrigin === '*' ? true : corsOrigin.split(','), credentials: true });

  // API prefix
  app.setGlobalPrefix('api', { exclude: ['/'] });

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Xon Tranzaksiyalar API')
    .setDescription("Umumiy to'lovlar va tranzaksiyalar monitoring")
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(swaggerPath, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(port);
  Logger.log(`🚀 Server: http://localhost:${port}`, 'Bootstrap');
  Logger.log(`📚 Swagger: http://localhost:${port}/${swaggerPath}`, 'Bootstrap');
}
bootstrap();
