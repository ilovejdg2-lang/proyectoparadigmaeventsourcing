import { Inject, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  replay,
  TransactionCreated,
  PaymentRequested,
  PaymentRejected,
  PaymentRetried,
  PaymentApproved,
  TransactionCompleted,
  TransactionEvent,
  TransactionState,
} from '@eventsourcing/domain';
import {
  EVENT_STORE_TOKEN,
  type IEventStore,
} from './event-store/event-store.interface';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { RequestPaymentDto } from './dto/request-payment.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';
import { RetryPaymentDto } from './dto/retry-payment.dto';
import { ApprovePaymentDto } from './dto/approve-payment.dto';
import { CompleteTransactionDto } from './dto/complete-transaction.dto';
import { TransactionNotFoundException } from './exceptions/transaction-not-found.exception';
import { InvalidTransactionTransitionException } from './exceptions/invalid-transition.exception';

export interface CommandResult {
  message: string;
  event: TransactionEvent;
  state: TransactionState;
}

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(EVENT_STORE_TOKEN)
    private readonly eventStore: IEventStore,
  ) {}

  async createTransaction(dto: CreateTransactionDto): Promise<CommandResult> {
    const transactionId = dto.transactionId?.trim() || crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();

    const event: TransactionCreated = {
      eventId,
      transactionId,
      type: 'TransactionCreated',
      version: 1,
      occurredAt,
      data: {
        amount: dto.amount,
        currency: dto.currency.toUpperCase(),
        customerId: dto.customerId,
      },
    };

    const appendedEvent = await this.eventStore.append(event, 0);
    const events = await this.eventStore.getEventsByTransactionId(transactionId);
    const state = replay(events);

    return {
      message: 'Transacción iniciada correctamente',
      event: appendedEvent,
      state: state!,
    };
  }

  async requestPayment(
    transactionId: string,
    dto: RequestPaymentDto,
  ): Promise<CommandResult> {
    const events = await this.getEventsOrThrow(transactionId);
    const currentState = replay(events)!;

    if (dto.amount !== undefined && dto.amount !== currentState.amount) {
      throw new InvalidTransactionTransitionException(
        'El monto del pago no coincide con el monto de la transacción',
      );
    }

    const event: PaymentRequested = {
      eventId: crypto.randomUUID(),
      transactionId,
      type: 'PaymentRequested',
      version: currentState.version + 1,
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: dto.paymentId?.trim() || `pay-${crypto.randomUUID().slice(0, 8)}`,
        amount: currentState.amount,
      },
    };

    const appendedEvent = await this.eventStore.append(event, dto.expectedVersion);
    const updatedEvents = await this.eventStore.getEventsByTransactionId(transactionId);
    const state = replay(updatedEvents)!;

    return {
      message: 'Pago solicitado correctamente',
      event: appendedEvent,
      state,
    };
  }

  async rejectPayment(
    transactionId: string,
    dto: RejectPaymentDto,
  ): Promise<CommandResult> {
    const events = await this.getEventsOrThrow(transactionId);
    const currentState = replay(events)!;

    const event: PaymentRejected = {
      eventId: crypto.randomUUID(),
      transactionId,
      type: 'PaymentRejected',
      version: currentState.version + 1,
      occurredAt: new Date().toISOString(),
      data: {
        reason: dto.reason.trim(),
      },
    };

    const appendedEvent = await this.eventStore.append(event, dto.expectedVersion);
    const updatedEvents = await this.eventStore.getEventsByTransactionId(transactionId);
    const state = replay(updatedEvents)!;

    return {
      message: 'Pago registrado como rechazado',
      event: appendedEvent,
      state,
    };
  }

  async retryPayment(
    transactionId: string,
    dto: RetryPaymentDto,
  ): Promise<CommandResult> {
    const events = await this.getEventsOrThrow(transactionId);
    const currentState = replay(events)!;
    const attemptNumber = currentState.attemptCount + 1;

    if (
      dto.attemptNumber !== undefined &&
      dto.attemptNumber !== attemptNumber
    ) {
      throw new InvalidTransactionTransitionException(
        `El número de reintento debe ser ${attemptNumber}`,
      );
    }

    const event: PaymentRetried = {
      eventId: crypto.randomUUID(),
      transactionId,
      type: 'PaymentRetried',
      version: currentState.version + 1,
      occurredAt: new Date().toISOString(),
      data: {
        attemptNumber,
      },
    };

    const appendedEvent = await this.eventStore.append(event, dto.expectedVersion);
    const updatedEvents = await this.eventStore.getEventsByTransactionId(transactionId);
    const state = replay(updatedEvents)!;

    return {
      message: 'Reintento de pago solicitado correctamente',
      event: appendedEvent,
      state,
    };
  }

  async approvePayment(
    transactionId: string,
    dto: ApprovePaymentDto,
  ): Promise<CommandResult> {
    const events = await this.getEventsOrThrow(transactionId);
    const currentState = replay(events)!;

    const event: PaymentApproved = {
      eventId: crypto.randomUUID(),
      transactionId,
      type: 'PaymentApproved',
      version: currentState.version + 1,
      occurredAt: new Date().toISOString(),
      data: {
        approvalCode: dto.approvalCode.trim(),
      },
    };

    const appendedEvent = await this.eventStore.append(event, dto.expectedVersion);
    const updatedEvents = await this.eventStore.getEventsByTransactionId(transactionId);
    const state = replay(updatedEvents)!;

    return {
      message: 'Pago aprobado correctamente',
      event: appendedEvent,
      state,
    };
  }

  async completeTransaction(
    transactionId: string,
    dto: CompleteTransactionDto,
  ): Promise<CommandResult> {
    const events = await this.getEventsOrThrow(transactionId);
    const currentState = replay(events)!;

    const event: TransactionCompleted = {
      eventId: crypto.randomUUID(),
      transactionId,
      type: 'TransactionCompleted',
      version: currentState.version + 1,
      occurredAt: new Date().toISOString(),
      data: {
        completedAt: dto.completedAt || new Date().toISOString(),
      },
    };

    const appendedEvent = await this.eventStore.append(event, dto.expectedVersion);
    const updatedEvents = await this.eventStore.getEventsByTransactionId(transactionId);
    const state = replay(updatedEvents)!;

    return {
      message: 'Transacción completada exitosamente',
      event: appendedEvent,
      state,
    };
  }

  async getEvents(transactionId: string): Promise<TransactionEvent[]> {
    return this.getEventsOrThrow(transactionId);
  }

  async getState(transactionId: string): Promise<TransactionState> {
    const events = await this.getEventsOrThrow(transactionId);
    return replay(events)!;
  }

  async listAll(): Promise<TransactionState[]> {
    const ids = await this.eventStore.getTransactionIds();
    const states: TransactionState[] = [];
    for (const id of ids) {
      const events = await this.eventStore.getEventsByTransactionId(id);
      const state = replay(events);
      if (state) {
        states.push(state);
      }
    }
    return states;
  }

  private async getEventsOrThrow(
    transactionId: string,
  ): Promise<TransactionEvent[]> {
    const events = await this.eventStore.getEventsByTransactionId(transactionId);
    if (!events || events.length === 0) {
      throw new TransactionNotFoundException(transactionId);
    }
    return events;
  }
}
