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
import { FamiliesService } from './families.service';
import { CreateFamilyDto } from './dto/create-family.dto';
import { UpdateFamilyDto } from './dto/update-family.dto';
import { JoinFamilyDto } from './dto/join-family.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { CurrentUser } from '../../common/decorators';

@ApiTags('家庭')
@Controller('families')
@ApiBearerAuth()
export class FamiliesController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Post()
  @ApiOperation({ summary: '创建家庭' })
  async create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateFamilyDto,
  ) {
    return this.familiesService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取家庭列表' })
  async findAll(@CurrentUser('sub') userId: string) {
    return this.familiesService.findAll(userId);
  }

  @Post('join')
  @ApiOperation({ summary: '加入家庭' })
  async join(
    @CurrentUser('sub') userId: string,
    @Body() dto: JoinFamilyDto,
  ) {
    return this.familiesService.join(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取家庭详情' })
  async findOne(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.familiesService.findOne(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新家庭信息' })
  async update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFamilyDto,
  ) {
    return this.familiesService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '解散家庭' })
  async remove(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.familiesService.remove(userId, id);
  }

  @Post(':id/leave')
  @ApiOperation({ summary: '退出家庭' })
  async leave(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.familiesService.leave(userId, id);
  }

  @Post(':id/invite')
  @ApiOperation({ summary: '生成邀请码' })
  async refreshInviteCode(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.familiesService.refreshInviteCode(userId, id);
  }

  @Delete(':id/members/:memberId')
  @ApiOperation({ summary: '移除成员' })
  async removeMember(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.familiesService.removeMember(userId, id, memberId);
  }

  @Put(':id/members/:memberId/role')
  @ApiOperation({ summary: '修改成员角色' })
  async updateMemberRole(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.familiesService.updateMemberRole(userId, id, memberId, dto);
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: '获取家庭账单（分页）' })
  async getTransactions(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('memberId') memberId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize?: number,
  ) {
    return this.familiesService.getTransactions(
      userId,
      id,
      startDate,
      endDate,
      memberId,
      page,
      pageSize,
    );
  }

  @Get(':id/summary')
  @ApiOperation({ summary: '获取家庭收支汇总' })
  async getSummary(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.familiesService.getSummary(userId, id, startDate, endDate);
  }

  @Get(':id/statistics')
  @ApiOperation({ summary: '获取家庭统计分析' })
  async getStatistics(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.familiesService.getStatistics(userId, id, startDate, endDate);
  }
}
