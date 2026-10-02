import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class CompleteTransactionDto {
  @ApiPropertyOptional({
    description: 'Fecha y hora ISO de finalización (opcional, asigna fecha actual por defecto)',
    example: '2026-10-02T02:30:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @ApiPropertyOptional({
    description: 'Versión esperada de la transacción para control de concurrencia optimista',
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
