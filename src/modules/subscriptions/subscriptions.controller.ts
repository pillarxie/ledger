import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('续费管理')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list(@CurrentUser('sub') userId: string) { return this.subscriptions.list(userId); }

  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptions.create(userId, dto);
  }

  @Post(':id/stop')
  stop(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subscriptions.stop(userId, id);
  }
}
