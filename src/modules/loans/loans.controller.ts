import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { CreateLoanDto } from './dto/create-loan.dto';
import { LoansService } from './loans.service';

@ApiTags('贷款')
@ApiBearerAuth()
@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get()
  list(@CurrentUser('sub') userId: string) { return this.loans.list(userId); }

  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateLoanDto) {
    return this.loans.create(userId, dto);
  }

  @Post(':id/stop')
  stop(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.loans.stop(userId, id);
  }
}
