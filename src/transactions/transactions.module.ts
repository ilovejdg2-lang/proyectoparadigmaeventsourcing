import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { EVENT_STORE_TOKEN } from './event-store/event-store.interface';
import { InMemoryEventStore } from './event-store/in-memory-event-store';

@Module({
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    {
      provide: EVENT_STORE_TOKEN,
      useClass: InMemoryEventStore,
    },
  ],
  exports: [TransactionsService, EVENT_STORE_TOKEN],
})
export class TransactionsModule {}
