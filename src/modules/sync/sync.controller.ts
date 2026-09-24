import {
  Controller,
  Post,
  Get,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RestoreDataDto } from './dto/restore-data.dto';
import { SyncService } from './sync.service';
import { PushDataDto } from './dto/push-data.dto';
import { PullDataDto } from './dto/pull-data.dto';
import { ConflictCheckDto } from './dto/conflict-check.dto';
import { ResolveConflictsDto } from './dto/resolve-conflict.dto';
import { CurrentUser } from '../../common/decorators';

@ApiTags('同步')
@Controller('sync')
@ApiBearerAuth()
export class SyncController {
  constructor(private readonly syncService: SyncService) { }

  @Post('pull')
  @ApiOperation({ summary: '拉取服务器数据' })
  async pull(
    @CurrentUser('sub') userId: string,
    @Body() dto: PullDataDto,
  ) {
    return this.syncService.pull(userId, dto);
  }

  @Post('push')
  @ApiOperation({ summary: '推送本地数据' })
  async push(
    @CurrentUser('sub') userId: string,
    @Body() dto: PushDataDto,
  ) {
    return this.syncService.push(userId, dto);
  }

  @Post('restore')
  @ApiOperation({ summary: '恢复当前账号备份中的缺失记录' })
  async restore(@CurrentUser('sub') userId: string, @Body() dto: RestoreDataDto) {
    return this.syncService.restore(userId, dto);
  }

  @Post('conflicts')
  @ApiOperation({ summary: '获取冲突数据' })
  async getConflicts(
    @CurrentUser('sub') userId: string,
    @Body() dto: ConflictCheckDto,
  ) {
    return this.syncService.getConflicts(userId, dto);
  }

  @Post('resolve')
  @ApiOperation({ summary: '解决冲突' })
  async resolveConflicts(
    @CurrentUser('sub') userId: string,
    @Body() dto: ResolveConflictsDto,
  ) {
    return this.syncService.resolveConflicts(userId, dto);
  }

  @Get('status')
  @ApiOperation({ summary: '获取同步状态' })
  async getSyncStatus(
    @CurrentUser('sub') userId: string,
    @Query('deviceId') deviceId: string,
  ) {
    return this.syncService.getSyncStatus(userId, deviceId);
  }
}
