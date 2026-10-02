import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

export class RetryPaymentDto {
  @ApiPropertyOptional({
    description: 'Número del intento de reintento (calculado automáticamente si no se envía)',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  attemptNumber?: number;

  @ApiPropertyOptional({
    description: 'Versión esperada de la transacción para control de concurrencia optimista',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
