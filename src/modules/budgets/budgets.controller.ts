import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { CurrentUser } from '../../common/decorators';

@ApiTags('预算')
@Controller('budgets')
@ApiBearerAuth()
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Post()
  @ApiOperation({ summary: '创建预算' })
  async create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.budgetsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取预算列表（分页）' })
  async findAll(
    @CurrentUser('sub') userId: string,
    @Query('familyId') familyId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize?: number,
  ) {
    return this.budgetsService.findAll(userId, familyId, page, pageSize);
  }

  @Get('progress')
  @ApiOperation({ summary: '获取所有预算进度' })
  async getAllProgress(
    @CurrentUser('sub') userId: string,
    @Query('familyId') familyId?: string,
  ) {
    return this.budgetsService.getAllProgress(userId, familyId);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取预算详情' })
  async findOne(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.budgetsService.findOne(userId, id);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: '获取预算进度' })
  async getProgress(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.budgetsService.getProgress(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新预算' })
  async update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgetsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除预算' })
  async remove(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.budgetsService.remove(userId, id);
  }
}
