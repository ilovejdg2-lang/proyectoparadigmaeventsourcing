import { Controller, Get, Header, Param } from '@nestjs/common';
import { HistoryService } from './history.service';

@Controller()
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return this.historyService.readPage();
  }

  @Get('history/transactions')
  listTransactions() {
    return this.historyService.listTransactions();
  }

  @Get('history/transactions/:id/events')
  getEvents(@Param('id') id: string) {
    return this.historyService.getEvents(id);
  }

  @Get('history/transactions/:id')
  getState(@Param('id') id: string) {
    return this.historyService.getState(id);
  }
}
