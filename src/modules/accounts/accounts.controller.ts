import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { TransferDto } from './dto/transfer.dto';
import { CurrentUser } from '../../common/decorators';

@ApiTags('账户')
@Controller('accounts')
@ApiBearerAuth()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @ApiOperation({ summary: '创建账户' })
  async create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accountsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取账户列表' })
  async findAll(@CurrentUser('sub') userId: string) {
    return this.accountsService.findAll(userId);
  }

  @Get('stats')
  @ApiOperation({ summary: '获取账户统计' })
  async getStats(@CurrentUser('sub') userId: string) {
    return this.accountsService.getStats(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取账户详情' })
  async findOne(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.accountsService.findOne(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新账户' })
  async update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accountsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除账户' })
  async remove(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.accountsService.remove(userId, id);
  }

  @Post('transfer')
  @ApiOperation({ summary: '账户转账' })
  async transfer(
    @CurrentUser('sub') userId: string,
    @Body() dto: TransferDto,
  ) {
    return this.accountsService.transfer(userId, dto);
  }
}
