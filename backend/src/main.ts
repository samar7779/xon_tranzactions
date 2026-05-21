import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    rawBody: true, // GitHub webhook HMAC tekshiruvi uchun
    bodyParser: true,
  });

  // Body parser limit oshiriladi (katta Excel import uchun)
  // verify: GitHub webhook HMAC uchun xom body'ni req.rawBody'da saqlash
  app.use(json({
    limit: '100mb',
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(urlencoded({ limit: '100mb', extended: true }));
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);
  const swaggerPath = config.get<string>('SWAGGER_PATH', 'docs');
  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:3000');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  });

  app.setGlobalPrefix('api', { exclude: ['/'] });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Xon Tranzaksiyalar API')
    .setDescription('Xon Saroy — banklar tranzaksiyalari monitoring tizimi')
    .setVersion('0.1.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(swaggerPath, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(port);
  Logger.log(`🚀 Backend: http://localhost:${port}`, 'Bootstrap');
  Logger.log(`📚 Swagger: http://localhost:${port}/${swaggerPath}`, 'Bootstrap');
}
bootstrap();
