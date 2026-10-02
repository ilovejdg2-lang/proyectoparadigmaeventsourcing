import { ConflictException } from '@nestjs/common';

export class TransactionConflictException extends ConflictException {
  constructor(message: string) {
    super(message);
  }
}
