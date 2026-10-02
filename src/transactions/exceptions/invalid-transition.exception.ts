import { BadRequestException } from '@nestjs/common';

export class InvalidTransactionTransitionException extends BadRequestException {
  constructor(reason: string) {
    super(`Transición inválida: ${reason}`);
  }
}
