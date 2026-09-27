export const eventTypes = [
  'TransactionCreated',
  'PaymentRequested',
  'PaymentRejected',
  'PaymentRetried',
  'PaymentApproved',
  'TransactionCompleted',
] as const;

export type EventType = (typeof eventTypes)[number];

export interface EventEnvelope<TType extends EventType, TData extends object> {
  eventId: string;
  transactionId: string;
  type: TType;
  version: number;
  occurredAt: string;
  data: TData;
}

export interface TransactionCreatedData {
  amount: number;
  currency: string;
  customerId: string;
}

export interface PaymentRequestedData {
  paymentId: string;
  amount: number;
}

export interface PaymentRejectedData {
  reason: string;
}

export interface PaymentRetriedData {
  attemptNumber: number;
}

export interface PaymentApprovedData {
  approvalCode: string;
}

export interface TransactionCompletedData {
  completedAt: string;
}

export type TransactionCreated = EventEnvelope<
  'TransactionCreated',
  TransactionCreatedData
>;

export type PaymentRequested = EventEnvelope<
  'PaymentRequested',
  PaymentRequestedData
>;

export type PaymentRejected = EventEnvelope<
  'PaymentRejected',
  PaymentRejectedData
>;

export type PaymentRetried = EventEnvelope<
  'PaymentRetried',
  PaymentRetriedData
>;

export type PaymentApproved = EventEnvelope<
  'PaymentApproved',
  PaymentApprovedData
>;

export type TransactionCompleted = EventEnvelope<
  'TransactionCompleted',
  TransactionCompletedData
>;

export type TransactionEvent =
  | TransactionCreated
  | PaymentRequested
  | PaymentRejected
  | PaymentRetried
  | PaymentApproved
  | TransactionCompleted;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isEventType(value: unknown): value is EventType {
  return eventTypes.some((eventType) => eventType === value);
}

function isDataValid(type: EventType, data: Record<string, unknown>): boolean {
  switch (type) {
    case 'TransactionCreated':
      return (
        isPositiveAmount(data.amount) &&
        isNonEmptyString(data.currency) &&
        isNonEmptyString(data.customerId)
      );
    case 'PaymentRequested':
      return isNonEmptyString(data.paymentId) && isPositiveAmount(data.amount);
    case 'PaymentRejected':
      return isNonEmptyString(data.reason);
    case 'PaymentRetried':
      return isVersion(data.attemptNumber);
    case 'PaymentApproved':
      return isNonEmptyString(data.approvalCode);
    case 'TransactionCompleted':
      return isIsoDate(data.completedAt);
  }
}

export function isTransactionEvent(value: unknown): value is TransactionEvent {
  if (!isRecord(value) || !isRecord(value.data) || !isEventType(value.type)) {
    return false;
  }

  return (
    isNonEmptyString(value.eventId) &&
    isNonEmptyString(value.transactionId) &&
    isVersion(value.version) &&
    isIsoDate(value.occurredAt) &&
    isDataValid(value.type, value.data)
  );
}
