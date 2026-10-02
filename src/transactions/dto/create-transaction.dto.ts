import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateTransactionDto {
  @ApiPropertyOptional({
    description: 'Identificador único de la transacción (UUID opcional, autogenerado si no se provee)',
    example: 'd8bf0e6f-6ce2-475f-b52e-9cf441e3d301',
  })
  @IsOptional()
  @IsString()
  transactionId?: string;

  @ApiProperty({
    description: 'Monto de la transacción (debe ser mayor a 0)',
    example: 15000,
  })
  @IsNumber()
  @IsPositive({ message: 'El monto debe ser un número positivo mayor a 0' })
  amount!: number;

  @ApiProperty({
    description: 'Código de moneda (ISO 4217)',
    example: 'CRC',
  })
  @IsString()
  @IsNotEmpty({ message: 'La moneda no puede estar vacía' })
  currency!: string;

  @ApiProperty({
    description: 'Identificador del cliente asociado a la transacción',
    example: 'cliente-456',
  })
  @IsString()
  @IsNotEmpty({ message: 'El customerId no puede estar vacío' })
  customerId!: string;
}
