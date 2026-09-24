import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { QueryTransactionDto } from './dto/query-transaction.dto';
import { BatchTransactionDto } from './dto/batch-transaction.dto';
import { CurrentUser } from '../../common/decorators';

@ApiTags('账单')
@Controller('transactions')
@ApiBearerAuth()
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @ApiOperation({ summary: '创建账单' })
  async create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.transactionsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取账单列表' })
  async findAll(
    @CurrentUser('sub') userId: string,
    @Query() query: QueryTransactionDto,
  ) {
    return this.transactionsService.findAll(userId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: '获取收支汇总' })
  async getSummary(
    @CurrentUser('sub') userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('familyId') familyId?: string,
  ) {
    return this.transactionsService.getSummary(userId, startDate, endDate, familyId);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取账单详情' })
  async findOne(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.transactionsService.findOne(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新账单' })
  async update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    return this.transactionsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除账单' })
  async remove(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.transactionsService.remove(userId, id);
  }

  @Post('batch')
  @ApiOperation({ summary: '批量操作' })
  async batch(
    @CurrentUser('sub') userId: string,
    @Body() dto: BatchTransactionDto,
  ) {
    return this.transactionsService.batch(userId, dto);
  }
}
