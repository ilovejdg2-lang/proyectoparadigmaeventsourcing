import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

export class RetryPaymentDto {
  @ApiPropertyOptional({
    description:
      'El backend calcula el número de intento desde el historial. Si se envía y no coincide, el comando se rechaza.',
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
