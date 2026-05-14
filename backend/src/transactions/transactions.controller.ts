import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { TransactionsService } from './transactions.service';
import { StatementService } from './statement.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly svc: TransactionsService,
    private readonly statementSvc: StatementService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Tranzaksiyalar ro'yxati (filter + pagination)" })
  list(@Query() q: ListTransactionsDto) {
    return this.svc.list(q);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistika: jami, IN/OUT, banklar bo\'yicha' })
  stats(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.stats(from, to);
  }

  @Get('daily')
  @ApiOperation({ summary: 'Kunma-kun kirim/chiqim (diagramma uchun, bank/hisob filtri bilan)' })
  daily(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('bankId') bankId?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.svc.daily(from, to, bankId, accountId);
  }

  @Get('statement')
  @ApiOperation({ summary: "Bank vipiskasi — Excel (hisob + sana oralig'i)" })
  async statement(
    @Query('accountId') accountId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.statementSvc.build(accountId, dateFrom, dateTo);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Bitta tranzaksiya tafsilot' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }
}
