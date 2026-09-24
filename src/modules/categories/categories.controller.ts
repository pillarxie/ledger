import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseEnumPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoryDto } from './dto/reorder-category.dto';
import { CurrentUser } from '../../common/decorators';
import { TransactionType } from '@prisma/client';

@ApiTags('分类')
@Controller('categories')
@ApiBearerAuth()
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @ApiOperation({ summary: '创建分类' })
  async create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取分类列表' })
  async findAll(
    @CurrentUser('sub') userId: string,
    @Query('type', new ParseEnumPipe(TransactionType, { optional: true }))
    type?: TransactionType,
    @Query('familyId') familyId?: string,
  ) {
    return this.categoriesService.findAll(userId, type, familyId);
  }

  @Post('init-default')
  @ApiOperation({ summary: '初始化默认分类' })
  async initDefaults(@CurrentUser('sub') userId: string) {
    return this.categoriesService.initDefaultCategories(userId);
  }

  @Put('reorder')
  @ApiOperation({ summary: '排序分类' })
  async reorder(
    @CurrentUser('sub') userId: string,
    @Body() dto: ReorderCategoryDto,
  ) {
    return this.categoriesService.reorder(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取分类详情' })
  async findOne(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.categoriesService.findOne(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新分类' })
  async update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除分类' })
  async remove(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.categoriesService.remove(userId, id);
  }
}
