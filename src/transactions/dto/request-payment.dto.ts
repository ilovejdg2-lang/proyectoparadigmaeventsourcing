import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class RequestPaymentDto {
  @ApiPropertyOptional({
    description: 'Identificador del pago (autogenerado si no se provee)',
    example: 'pay-7890',
  })
  @IsOptional()
  @IsString()
  paymentId?: string;

  @ApiPropertyOptional({
    description: 'Monto solicitado para el pago (por defecto el monto original de la transacción)',
    example: 15000,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive({ message: 'El monto debe ser positivo' })
  amount?: number;

  @ApiPropertyOptional({
    description: 'Versión esperada de la transacción para control de concurrencia optimista',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
