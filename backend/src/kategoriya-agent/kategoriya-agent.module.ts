import { Module } from '@nestjs/common';
import { KategoriyaAgentController } from './kategoriya-agent.controller';
import { KategoriyaAgentService } from './kategoriya-agent.service';
import { KategoriyaAiService } from './kategoriya-ai.service';
import { CategorizationModule } from '../categorization/categorization.module';
import { TaminotModule } from '../taminot/taminot.module';

/**
 * KATEGORIYA AGENTI — ilgari qo'lda bosiladigan 4 ta asbobni bitta oqimga
 * yig'adi va qolgan "hech bir qoidaga tushmagan" to'lovlarni AI ga beradi.
 *
 * Ta'minot bazasiga FAQAT o'qish so'rovi boradi (TaminotModule shartiga rioya).
 */
@Module({
  imports: [CategorizationModule, TaminotModule],
  controllers: [KategoriyaAgentController],
  providers: [KategoriyaAgentService, KategoriyaAiService],
  exports: [KategoriyaAgentService],
})
export class KategoriyaAgentModule {}
