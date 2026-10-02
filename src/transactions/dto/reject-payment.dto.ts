import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class RejectPaymentDto {
  @ApiProperty({
    description: 'Motivo o razón del rechazo del pago',
    example: 'Fondos insuficientes en la cuenta del cliente',
  })
  @IsString()
  @IsNotEmpty({ message: 'El motivo del rechazo no puede estar vacío' })
  reason!: string;

  @ApiPropertyOptional({
    description: 'Versión esperada de la transacción para control de concurrencia optimista',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
