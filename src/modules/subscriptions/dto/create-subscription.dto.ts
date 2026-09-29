import { IsIn, IsNumber, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @IsIn(['monthly', 'quarterly', 'yearly'])
  cycle: 'monthly' | 'quarterly' | 'yearly';

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999999.99)
  amount: number;

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  firstChargeDate: string;

  @IsString() @MinLength(1)
  accountId: string;
}
