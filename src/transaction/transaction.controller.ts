import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { CrudController, Override } from '@nestjsx/crud';
import { GenerateTransactionWithWalletRequestDto } from './dto/generate-transaction-with-wallet.request.dto';
import { Transaction } from './entities/transaction.entity';
import { TransactionService } from './transaction.service';
import { UserService } from '../user/user.service';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StoresService } from '../stores/stores.service';
import { Response } from 'express';
import { CreateTransactionDto } from './dto/createTransaction.dto';
import {
  GetChildTransactionDto,
  GetTransactionDto,
  ReturnChildDto,
  ReturnTransactionDto,
} from './dto/returnTransaction.dto';
import { ReturnNewTransactionDto } from './dto/returnNewTransaction.dto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import mempoolJS from '@mempool/mempool.js';

@ApiTags('transaction')
@Controller('transaction')
@ApiBearerAuth('Bearer')
export class TransactionController implements CrudController<Transaction> {
  constructor(
    @InjectRepository(Transaction)
    public readonly repo: Repository<Transaction>,
    public readonly service: TransactionService,
    public readonly userService: UserService,
    public readonly storeService: StoresService,
    public readonly TransactionService: TransactionService,
  ) {}

  /**
   * @description if Authorization is not specified or there is no store with such apiKey, then an array with all entries is returned. If a store with such apiKey exists, returns an array of payments that depend on payment that depend on this store
   */
  @Get()
  @ApiProperty()
  @ApiOperation({ summary: 'Get all transactions for current store' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Bearer token not found',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'transaction not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'This store does not have such a payments',
  })
  @ApiOkResponse({
    status: HttpStatus.OK,
    type: [ReturnTransactionDto],
  })
  @ApiHeader({
    name: 'apiKey store',
    description: 'Bearer sgRcXvaZrsd0NNxartp09RFFApSRq8E8g1lc',
  })
  async getAllByStore(@Param() param, @Headers() headers) {
    if (!headers.authorization) {
      throw new HttpException(
        'Bearer token not found',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const user = await this.userService.findByToken(
      headers['authorization'].slice(7),
    );

    if (user?.role === 'admin') {
      return await this.repo.find();
    }
    try {
      const transactions = await this.repo.find({});
      return transactions.filter((transaction) => {
        if (
          transaction.payment?.store?.apiKey ===
          headers.authorization.split(' ')[1]
        ) {
          delete transaction.payment;
          return transaction;
        }
      });
    } catch (err) {
      throw new HttpException(
        'This store does not have such a payments',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * @description return last completed transaction for payment with :id
   */
  @Get('/last/:id')
  @ApiOperation({
    summary: 'Get last completed transaction for payment with :id',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'This payment does not have such a transaction',
  })
  @ApiOkResponse({
    status: HttpStatus.OK,
    type: ReturnChildDto,
  })
  async getLastTransaction(@Param() param: GetChildTransactionDto) {
    try {
      const transaction = await this.TransactionService.findOne({
        where: {
          payment: param.id,
        },
      });
      const returnInfo = {
        txHash: transaction.txHash,
        status: transaction.status,
      };
      return returnInfo;
    } catch (err) {
      throw new HttpException(
        'This payment does not have such a transaction',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Override()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update transaction',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Error',
  })
  async patchTransaction() {
    throw new HttpException('Error', HttpStatus.BAD_REQUEST);
  }

  @Override()
  @Put(':id')
  @ApiOperation({
    summary: 'Update transaction',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Error',
  })
  async putTransaction() {
    throw new HttpException('Error', HttpStatus.BAD_REQUEST);
  }

  /**
   * @description search by txHash for transaction
   */
  @Override()
  @Get(':txHash')
  @ApiOperation({
    summary: 'Get transaction by txHash',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Transaction not exist',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'No access to this transaction',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'This store does not have such a transaction',
  })
  @ApiOkResponse({
    status: HttpStatus.OK,
    type: ReturnTransactionDto,
  })
  @ApiHeader({
    name: 'auth token',
    description: 'Bearer sgRcXvaZrsd0NNxartp09RFFApSRq8E8g1lc',
  })
  async getOneByStore(
    @Param() param: GetTransactionDto,
    @Headers() headers,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!headers.authorization) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.userService.findByToken(
      headers['authorization'].split(' ')[1],
    );

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    try {
      const transaction = await this.repo.findOne({
        where: {
          txHash: param.txHash,
        },
      });
      if (!transaction) {
        res.status(HttpStatus.BAD_REQUEST).send('Transaction not exist');
        return;
      }

      if (user.role === 'admin') {
        return transaction;
      }

      const store = await this.storeService.findOne({
        where: {
          id: transaction.payment.store.id,
        },
        relations: ['user', 'wallets'],
      });

      const receiver = store.wallets.find((el) => el.currency === transaction.payment.currency);

      if (store.user.token !== user.token) {
        res.status(HttpStatus.CONFLICT).send('No access to this transaction');
        return;
        //throw new HttpException('No access to this transaction', HttpStatus.CONFLICT);
      }

      // delete transaction.payment;
      return { ...transaction, receiver: receiver };
    } catch (err) {
      throw new HttpException(
        'This store does not have such a transaction',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  
  @Override()
  @Get('btc/commission')
  async getBtcCommission() {
    try {
      return await this.service.getBtcCommissionFromMempool();
    } catch (e) {
      throw new HttpException(
        'Server Error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Override()
  @Get('btc/:id')
  async getBtcTransaction(
    @Param() param: { id: string },
    @Headers() headers,
    @Res({ passthrough: true }) res: Response,
  ) {
    const id = +param.id;
    try {
      const findTransactions = await this.repo
        .createQueryBuilder('transaction')
        .leftJoinAndSelect('transaction.payment', 'payments')
        .where('payments.id = :id', { id })
        .getOne();
      if (!findTransactions) {
        res.status(HttpStatus.BAD_REQUEST).send('Transaction not exist');
        return;
      }
      return {
        ...findTransactions,
        walletForTransaction: findTransactions.walletForTransaction.publicKey,
      };
    } catch (e) {
      throw new HttpException(
        'Error',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Override()
  @Post()
  @ApiOperation({
    summary: 'Create new transaction for payment',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'transaction already exists',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'cant create transaction with incorrect status',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'cant create transaction without payment ID',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'transaction already exist',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'payment ID incorrect',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'payment already completed',
  })
  @ApiOkResponse({
    status: HttpStatus.OK,
    type: ReturnNewTransactionDto,
  })
  async createByStore(
    @Param() param: { apiKey: string },
    @Body() dto: CreateTransactionDto,
  ) {
    if (!dto?.payment?.id) {
      throw new HttpException(
        'cant create transaction without payment ID',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const res = await this.service.create(dto);
      return res;
    } catch (err) {
      throw new HttpException(err.response, HttpStatus.BAD_REQUEST);
    }
  }

  @Override()
  @Post('generateWallet')
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Currency not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Payment not found',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
  })
  async generateTransactionWithWallet(
    @Body() dto: GenerateTransactionWithWalletRequestDto,
  ) {
    return this.service.createNewWithWallet(dto);
  }
}
