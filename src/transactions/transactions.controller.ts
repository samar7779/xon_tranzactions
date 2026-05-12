import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly svc: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: "Tranzaksiyalar ro'yxati (filter + pagination)" })
  list(@Query() q: ListTransactionsDto) {
    return this.svc.list(q);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistika: jami, IN/OUT, status bo\'yicha' })
  stats(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.stats(from, to);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Bitta tranzaksiya tafsilot' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }
}
