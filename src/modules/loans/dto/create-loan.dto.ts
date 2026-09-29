import { IsIn, IsInt, IsNumber, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateLoanDto {
  @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999999.99)
  principal: number;

  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100)
  annualRate: number;

  @IsInt() @Min(1) @Max(50)
  years: number;

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @IsInt() @Min(1) @Max(31)
  repaymentDay: number;

  @IsString() @MinLength(1)
  accountId: string;

  @IsIn(['equal_payment', 'equal_principal'])
  repaymentMethod: 'equal_payment' | 'equal_principal';
}
