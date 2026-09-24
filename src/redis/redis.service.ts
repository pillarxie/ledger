import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private hasLoggedConnectionError = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    // 优先使用 REDIS_URL（如 redis://[:password]@host:port/db），否则回退 HOST/PORT
    const url = this.configService.get<string>('REDIS_URL');
    const host = this.configService.get('REDIS_HOST', 'localhost');
    const port = Number(this.configService.get('REDIS_PORT', 6379));

    this.client = url
      ? new Redis(url, { maxRetriesPerRequest: 3 })
      : new Redis({
          host,
          port,
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });

    this.client.on('ready', () => {
      this.hasLoggedConnectionError = false;
      this.logger.log(
        url ? `Redis connected via ${url.split('@').pop()}` : `Redis connected at ${host}:${port}`,
      );
    });

    this.client.on('error', (error) => {
      if (this.hasLoggedConnectionError) {
        return;
      }

      this.hasLoggedConnectionError = true;
      this.logger.error(
        url
          ? `Redis unavailable via ${url.split('@').pop()}: ${error.message}`
          : `Redis unavailable at ${host}:${port}: ${error.message}`,
      );
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      // disconnect 立即断开（quit 会等待挂起命令，可能阻塞关闭流程）
      this.client.disconnect();
    }
  }

  /** 确保客户端已初始化（防御 onModuleInit 之前的调用） */
  private ensureClient(): Redis {
    if (!this.client) {
      throw new Error('Redis 客户端尚未初始化');
    }
    return this.client;
  }

  // 获取值
  async get(key: string): Promise<string | null> {
    return this.ensureClient().get(key);
  }

  // 设置值
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl !== undefined && ttl !== null) {
      await this.ensureClient().setex(key, ttl, value);
    } else {
      await this.ensureClient().set(key, value);
    }
  }

  // 删除值
  async del(key: string): Promise<void> {
    await this.ensureClient().del(key);
  }

  // 检查键是否存在
  async exists(key: string): Promise<boolean> {
    const result = await this.ensureClient().exists(key);
    return result === 1;
  }

  // 设置过期时间
  async expire(key: string, seconds: number): Promise<void> {
    await this.ensureClient().expire(key, seconds);
  }

  // 获取剩余过期时间
  async ttl(key: string): Promise<number> {
    return this.ensureClient().ttl(key);
  }

  // 自增
  async incr(key: string): Promise<number> {
    return this.ensureClient().incr(key);
  }

  // 哈希操作
  async hset(key: string, field: string, value: string): Promise<void> {
    await this.ensureClient().hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.ensureClient().hget(key, field);
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.ensureClient().hdel(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return (await this.ensureClient().hgetall(key)) ?? {};
  }
}
