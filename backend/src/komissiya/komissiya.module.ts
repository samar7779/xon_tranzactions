import { Module } from '@nestjs/common';
import { KomissiyaController } from './komissiya.controller';
import { KomissiyaService } from './komissiya.service';

/**
 * Bank komissiyasiga obyekt qo'yish (Ravshan aka topshirig'i, 10.10.2026).
 * PrismaService global — qo'shimcha import kerak emas.
 */
@Module({
  controllers: [KomissiyaController],
  providers: [KomissiyaService],
  exports: [KomissiyaService],
})
export class KomissiyaModule {}
