import { IsInt } from 'class-validator';

class GenerateTransactionWithWalletRequestDto {
  @IsInt()
  paymentId: number;

  email?: string;
}

export { GenerateTransactionWithWalletRequestDto };
