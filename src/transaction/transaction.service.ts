import { MailerService } from '@nestjs-modules/mailer';
import { HttpService } from '@nestjs/axios';
import * as Bitcoin from 'bitcore-lib';
import mempoolJS from '@mempool/mempool.js';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TypeOrmCrudService } from '@nestjsx/crud-typeorm';
import { CurrencyType } from '../currency/currency.enum';
import { Payment } from '../payment/entities/payment.entity';
import { PaymentService } from '../payment/payment.service';
import { StoresService } from '../stores/stores.service';
import { GenerateTransactionWithWalletRequestDto } from './dto/generate-transaction-with-wallet.request.dto';
import { Transaction } from './entities/transaction.entity';

@Injectable()
export class TransactionService extends TypeOrmCrudService<Transaction> {
  constructor(
    @InjectRepository(Transaction) repo,
    private readonly paymentService: PaymentService,
    private readonly storesService: StoresService,
    private httpService: HttpService,
    private mailerService: MailerService,
  ) {
    super(repo);
  }

  async sendMail(transaction) {
    try {
      await this.mailerService.sendMail({
        to: transaction.email,
        from: process.env.MAILER_EMAIL,
        subject: `Payment to store ${transaction.payment.store.name}`,
        template: 'create-transaction',
        context: {
          email: transaction.email,
          store: transaction.payment.store.name,
          status: transaction.status,
        },
      });
    } catch (e) {
      console.log(e);
    }
  }

  async create(transaction) {
    const findTransaction = await this.repo.findOne({
      where: {
        txHash: transaction.txHash,
      },
    });

    if (findTransaction) {
      throw new HttpException(
        'transaction already exist',
        HttpStatus.BAD_REQUEST,
      );
    }

    const findPayment = await Payment.findOne({
      where: {
        id: transaction.payment.id,
      },
    });

    if (!findPayment) {
      throw new HttpException('payment ID incorrect', HttpStatus.BAD_REQUEST);
    }

    if (findPayment.type === null && findPayment.status === 'Paid') {
      throw new HttpException(
        'payment already completed',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (findPayment.cancelled) {
      throw new HttpException(
        'payment already cancelled',
        HttpStatus.BAD_REQUEST,
      );
    }

    const res = await this.repo.save({
      ...transaction,
      amount: findPayment.amount.toString(),
      status: 'processing',
      updated: new Date(),
      payment: findPayment,
    });
    const sendTransaction = {
      id: res.id,
      email: res.email,
      txHash: res.txHash,
      sender: res.sender,
      amount: res.amount,
      status: res.status,
      payment: {
        id: res.payment.id,
        datetime: res.payment.datetime,
        status: res.payment.status,
        store: {
          id: res.payment.store.id,
        },
      },
    };
    try {
      await this.sendMail(res);
    } catch (e) {
      console.log(e);
    }
    return sendTransaction;
  }

  async findTransactionByPaymentId(paymentId: number) {
    const findTransaction = await this.repo.findOne({
      where: {
        paymentId: paymentId,
      },
    });
    return findTransaction;
  }

  async getBtcCommissionFromMempool() {
    const {
      bitcoin: { fees },
    } = mempoolJS({
      hostname: 'mempool.space',
    });

    const feesRecommended = (await fees.getFeesRecommended()) as any;
    return {
      economyFee: feesRecommended.economyFee * 204,
      avarageFee: feesRecommended.hourFee * 204,
      fastestFee: feesRecommended.fastestFee * 204,
    };
  }

  async createNewWithWallet(dto: GenerateTransactionWithWalletRequestDto) {
    const paymentInDB = await this.paymentService.findPayment(dto.paymentId);

    if (!paymentInDB) {
      throw new HttpException('Payment not found', HttpStatus.BAD_REQUEST);
    }

    if (
      !(
        paymentInDB.currency === CurrencyType.Doge ||
        paymentInDB.currency === CurrencyType.Bitcoin
      )
    ) {
      throw new HttpException('Currency not found', HttpStatus.BAD_REQUEST);
    }

    let bitcore;

    if (paymentInDB.currency === CurrencyType.Bitcoin) {
      bitcore = Bitcoin;

      const {
        bitcoin: { addresses, fees },
      } = mempoolJS({
        hostname: 'mempool.space',
      });

      const transaction = bitcore.Transaction();

      const newWallet = bitcore.PrivateKey();

      const publicKey = newWallet.toAddress().toString();

      const addressTxs = await addresses.getAddressTxs({
        address: publicKey,
      } as any);

      const feesRecommended = (await fees.getFeesRecommended()) as any;

      const addressObj = bitcore.Address(publicKey);

      const scriptPubKey =
        bitcore.Script.buildPublicKeyHashOut(addressObj).toHex();

      transaction.from([
        {
          txid: '0000000000000000000000000000000000000000000000000000000000000000',
          address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
          satoshis: +paymentInDB?.amount,
          outputIndex: 0,
          scriptPubKey: scriptPubKey,
        },
      ]);

      const walletForPay = paymentInDB.store.wallets.find(
        (el) => el.currency === CurrencyType.Bitcoin,
      );

      // transaction.to(walletForPay.value, +paymentInDB?.amount * 10000000);

      transaction.to(walletForPay.value, +paymentInDB?.amount);

      const transactionSize = transaction._estimateSize();

      const address = {
        economyFee: feesRecommended.economyFee * transactionSize,
        avarageFee: feesRecommended.hourFee * transactionSize,
        fastestFee: feesRecommended.fastestFee * transactionSize,
        publicKey: newWallet.toAddress().toString(),
        privateKey: newWallet.toString(),
      };

      const newTransaction = this.repo.create({
        payment: paymentInDB,
        walletForTransaction: address,
        sender: dto.email ? dto.email : '',
        amount: paymentInDB.amount,
        status: 'processing',
        updated: new Date(),
      });

      const newTransactionInDB = await this.repo.save(newTransaction);

      const returnTransaction = {
        ...newTransactionInDB,
        walletForTransaction: newTransactionInDB.walletForTransaction.publicKey,
      };

      return returnTransaction;
    }
  }
}
