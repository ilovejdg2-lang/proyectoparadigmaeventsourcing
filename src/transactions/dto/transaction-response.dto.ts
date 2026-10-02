import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { EventType, TransactionStatus } from '@eventsourcing/domain';

export class EventEnvelopeDto {
  @ApiProperty({ example: 'a63b2cf2-4a0f-4dc9-9833-8a329fa03db5' })
  eventId!: string;

  @ApiProperty({ example: 'd8bf0e6f-6ce2-475f-b52e-9cf441e3d301' })
  transactionId!: string;

  @ApiProperty({
    example: 'TransactionCreated',
    enum: [
      'TransactionCreated',
      'PaymentRequested',
      'PaymentRejected',
      'PaymentRetried',
      'PaymentApproved',
      'TransactionCompleted',
    ],
  })
  type!: EventType;

  @ApiProperty({ example: 1, description: 'Versión del evento en la secuencia append-only' })
  version!: number;

  @ApiProperty({ example: '2026-10-02T02:30:00.000Z' })
  occurredAt!: string;

  @ApiProperty({ example: { amount: 15000, currency: 'CRC', customerId: 'cliente-456' } })
  data!: Record<string, unknown>;
}

export class TransactionStateDto {
  @ApiProperty({ example: 'd8bf0e6f-6ce2-475f-b52e-9cf441e3d301' })
  transactionId!: string;

  @ApiProperty({
    example: 'PAYMENT_APPROVED',
    enum: [
      'CREATED',
      'PAYMENT_PENDING',
      'PAYMENT_REJECTED',
      'PAYMENT_APPROVED',
      'COMPLETED',
    ],
  })
  status!: TransactionStatus;

  @ApiProperty({ example: 15000 })
  amount!: number;

  @ApiProperty({ example: 'CRC' })
  currency!: string;

  @ApiProperty({ example: 'cliente-456' })
  customerId!: string;

  @ApiProperty({ example: 4, description: 'Versión actual del stream de eventos' })
  version!: number;

  @ApiProperty({ example: 1, description: 'Cantidad de intentos de pago realizados' })
  attemptCount!: number;

  @ApiPropertyOptional({ example: 'pay-7890' })
  paymentId?: string;

  @ApiPropertyOptional({ example: 'Fondos insuficientes' })
  lastRejectionReason?: string;

  @ApiPropertyOptional({ example: 'AUTH-982143' })
  approvalCode?: string;

  @ApiPropertyOptional({ example: '2026-10-02T02:35:00.000Z' })
  completedAt?: string;
}

export class TransactionCommandResponseDto {
  @ApiProperty({ description: 'Mensaje descriptivo del resultado del comando', example: 'Comando ejecutado exitosamente' })
  message!: string;

  @ApiProperty({ description: 'Evento inmutable generado y almacenado de forma append-only', type: EventEnvelopeDto })
  event!: EventEnvelopeDto;

  @ApiProperty({ description: 'Estado actual reconstruido mediante replay de eventos', type: TransactionStateDto })
  state!: TransactionStateDto;
}
