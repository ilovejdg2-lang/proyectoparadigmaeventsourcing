import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { RequestPaymentDto } from './dto/request-payment.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';
import { RetryPaymentDto } from './dto/retry-payment.dto';
import { ApprovePaymentDto } from './dto/approve-payment.dto';
import { CompleteTransactionDto } from './dto/complete-transaction.dto';
import {
  EventEnvelopeDto,
  TransactionCommandResponseDto,
  TransactionStateDto,
} from './dto/transaction-response.dto';

@ApiTags('Transactions (Command API)')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Comando: Iniciar transacción',
    description:
      'Registra el evento append-only TransactionCreated (versión 1). Inicia una nueva transacción en el sistema.',
  })
  @ApiCreatedResponse({
    description: 'Transacción creada exitosamente',
    type: TransactionCommandResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Datos de la transacción inválidos' })
  @ApiConflictResponse({ description: 'La transacción con ese ID ya existe' })
  async createTransaction(
    @Body() dto: CreateTransactionDto,
  ): Promise<TransactionCommandResponseDto> {
    return this.transactionsService.createTransaction(dto) as any;
  }

  @Post(':id/request-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Comando: Solicitar pago',
    description:
      'Registra el evento append-only PaymentRequested. Requiere que la transacción esté en estado CREATED.',
  })
  @ApiParam({ name: 'id', description: 'ID de la transacción' })
  @ApiOkResponse({
    description: 'Pago solicitado y registrado',
    type: TransactionCommandResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Transacción no encontrada' })
  @ApiBadRequestResponse({ description: 'Transición inválida según el estado actual' })
  @ApiConflictResponse({ description: 'Conflicto de versión (concurrencia optimista)' })
  async requestPayment(
    @Param('id') id: string,
    @Body() dto: RequestPaymentDto,
  ): Promise<TransactionCommandResponseDto> {
    return this.transactionsService.requestPayment(id, dto) as any;
  }

  @Post(':id/reject-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Comando: Rechazar pago',
    description:
      'Registra el evento append-only PaymentRejected con el motivo de rechazo. Requiere estado PAYMENT_PENDING.',
  })
  @ApiParam({ name: 'id', description: 'ID de la transacción' })
  @ApiOkResponse({
    description: 'Rechazo registrado exitosamente',
    type: TransactionCommandResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Transacción no encontrada' })
  @ApiBadRequestResponse({ description: 'Transición inválida según el estado actual' })
  @ApiConflictResponse({ description: 'Conflicto de versión (concurrencia optimista)' })
  async rejectPayment(
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
  ): Promise<TransactionCommandResponseDto> {
    return this.transactionsService.rejectPayment(id, dto) as any;
  }

  @Post(':id/retry-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Comando: Reintentar pago',
    description:
      'Registra el evento append-only PaymentRetried con el número de intento. Requiere estado PAYMENT_REJECTED.',
  })
  @ApiParam({ name: 'id', description: 'ID de la transacción' })
  @ApiOkResponse({
    description: 'Reintento registrado exitosamente',
    type: TransactionCommandResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Transacción no encontrada' })
  @ApiBadRequestResponse({ description: 'Transición inválida según el estado actual' })
  @ApiConflictResponse({ description: 'Conflicto de versión (concurrencia optimista)' })
  async retryPayment(
    @Param('id') id: string,
    @Body() dto: RetryPaymentDto,
  ): Promise<TransactionCommandResponseDto> {
    return this.transactionsService.retryPayment(id, dto) as any;
  }

  @Post(':id/approve-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Comando: Aprobar pago',
    description:
      'Registra el evento append-only PaymentApproved con el código de aprobación. Requiere estado PAYMENT_PENDING.',
  })
  @ApiParam({ name: 'id', description: 'ID de la transacción' })
  @ApiOkResponse({
    description: 'Pago aprobado y registrado exitosamente',
    type: TransactionCommandResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Transacción no encontrada' })
  @ApiBadRequestResponse({ description: 'Transición inválida según el estado actual' })
  @ApiConflictResponse({ description: 'Conflicto de versión (concurrencia optimista)' })
  async approvePayment(
    @Param('id') id: string,
    @Body() dto: ApprovePaymentDto,
  ): Promise<TransactionCommandResponseDto> {
    return this.transactionsService.approvePayment(id, dto) as any;
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Comando: Completar transacción',
    description:
      'Registra el evento append-only TransactionCompleted. Requiere estado PAYMENT_APPROVED.',
  })
  @ApiParam({ name: 'id', description: 'ID de la transacción' })
  @ApiOkResponse({
    description: 'Transacción completada exitosamente',
    type: TransactionCommandResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Transacción no encontrada' })
  @ApiBadRequestResponse({ description: 'Transición inválida según el estado actual' })
  @ApiConflictResponse({ description: 'Conflicto de versión (concurrencia optimista)' })
  async completeTransaction(
    @Param('id') id: string,
    @Body() dto: CompleteTransactionDto,
  ): Promise<TransactionCommandResponseDto> {
    return this.transactionsService.completeTransaction(id, dto) as any;
  }

  @Get()
  @ApiOperation({
    summary: 'Listar transacciones',
    description:
      'Devuelve el estado actual reconstruido de todas las transacciones registradas.',
  })
  @ApiOkResponse({
    description: 'Lista de estados de transacciones',
    type: [TransactionStateDto],
  })
  async listAll(): Promise<TransactionStateDto[]> {
    return this.transactionsService.listAll() as any;
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consultar estado reconstruido',
    description:
      'Reconstruye el estado actual de la transacción aplicando la función replay sobre su flujo de eventos auditables.',
  })
  @ApiParam({ name: 'id', description: 'ID de la transacción' })
  @ApiOkResponse({
    description: 'Estado actual reconstruido',
    type: TransactionStateDto,
  })
  @ApiNotFoundResponse({ description: 'Transacción no encontrada' })
  async getState(@Param('id') id: string): Promise<TransactionStateDto> {
    return this.transactionsService.getState(id) as any;
  }

  @Get(':id/events')
  @ApiOperation({
    summary: 'Consultar historial de eventos append-only',
    description:
      'Obtiene la lista inmutable y cronológica de todos los eventos registrados para la transacción.',
  })
  @ApiParam({ name: 'id', description: 'ID de la transacción' })
  @ApiOkResponse({
    description: 'Secuencia auditada de eventos de la transacción',
    type: [EventEnvelopeDto],
  })
  @ApiNotFoundResponse({ description: 'Transacción no encontrada' })
  async getEvents(@Param('id') id: string): Promise<EventEnvelopeDto[]> {
    return this.transactionsService.getEvents(id) as any;
  }
}
