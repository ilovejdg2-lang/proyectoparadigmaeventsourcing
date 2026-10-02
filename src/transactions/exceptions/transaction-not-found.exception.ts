import { NotFoundException } from '@nestjs/common';

export class TransactionNotFoundException extends NotFoundException {
  constructor(transactionId: string) {
    super(`No se encontró la transacción con ID '${transactionId}'`);
  }
}
