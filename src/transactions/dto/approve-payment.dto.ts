import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class ApprovePaymentDto {
  @ApiProperty({
    description: 'Código de autorización o aprobación emitido por la pasarela de pagos',
    example: 'AUTH-982143',
  })
  @IsString()
  @IsNotEmpty({ message: 'El código de aprobación no puede estar vacío' })
  approvalCode!: string;

  @ApiPropertyOptional({
    description: 'Versión esperada de la transacción para control de concurrencia optimista',
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
