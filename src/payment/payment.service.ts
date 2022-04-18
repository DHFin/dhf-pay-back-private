import {HttpException, HttpStatus, Injectable} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {Payment} from "./entities/payment.entity";
import {TypeOrmCrudService} from "@nestjsx/crud-typeorm";
import {TransactionService} from "../transaction/transaction.service";
import {MailerService} from "@nestjs-modules/mailer";
import {Stores} from "../stores/entities/stores.entity";

@Injectable()
export class PaymentService extends TypeOrmCrudService<Payment> {
  constructor(@InjectRepository(Payment) repo,
              private readonly transactionService: TransactionService,
              private mailerService: MailerService
  ) {
    super(repo);
  }

  async sendMailBill(billMailDto) {
    const payment = await this.repo.findOne({
      where: {
        id: billMailDto.id
      }, relations: ['store']
    })
    
    await this.mailerService.sendMail({
      to: billMailDto.email,
      from: process.env.MAILER_EMAIL,
      subject: `Payment to store ${payment.store.name}`,
      template: 'send-mail-bill',
      context: {
        email: billMailDto.email,
        billUrl: billMailDto.billUrl,
        store: payment.store.name,
        comment: payment.comment,
        amount: payment.amount,
      },
    });
  }

  // @Interval(1000)
  // async getStore(){
  //   const parentParent = await this.repo.findOne({
  //     where: {
  //       store: {
  //         user: 1
  //       }
  //     },
  //     relations: ['store', 'store.user']
  //   })
  //   console.log(parentParent)
  // }

  async create(dto, apiKey) {
    try {
      const store = await Stores.findOne({
        where: {
          apiKey: apiKey
        }
      })
      if (!store) {
        throw new HttpException('store not found', HttpStatus.BAD_REQUEST);
      }
      const payment = await this.repo.save({...dto, status: 'Not_paid', datetime: new Date(), store});
      return payment
    } catch (err) {
      throw new HttpException(err, HttpStatus.BAD_REQUEST);
    }
  }

  async findById(id, user) {
    const payment = await this.repo.findOne({
      where: {
        id: id
      }, relations: ['store']
    });
    if (!payment) {
      throw new HttpException('payment nof found', HttpStatus.NOT_FOUND);
    }
    if (user.role === 'admin') {
      return payment
    }
      const returnInfo = {
      id: payment.id,
      datetime: payment.datetime,
      amount: payment.amount,
      status: payment.status,
      comment: payment.comment,
      type: payment.type,
      text: payment.text,
      store: {
        id: payment.store.id,
        wallet: payment.store.wallet
      }
    }
    return returnInfo
  }
}
