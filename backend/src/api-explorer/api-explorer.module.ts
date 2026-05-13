import { Module } from '@nestjs/common';
import { ApiExplorerController } from './api-explorer.controller';

@Module({
  controllers: [ApiExplorerController],
})
export class ApiExplorerModule {}
