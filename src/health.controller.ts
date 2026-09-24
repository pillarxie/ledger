import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

/**
 * 健康检查
 *
 * 供容器 healthcheck、宝塔/云监控、负载均衡探活使用。
 * 不鉴权，且不依赖 Swagger 是否开启 —— 生产环境用 SWAGGER_ENABLED=false
 * 关掉接口文档后，探活仍然可用。
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: '健康检查' })
  check() {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
