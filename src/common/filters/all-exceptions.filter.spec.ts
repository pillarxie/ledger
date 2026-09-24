import {
  BadRequestException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function buildContext() {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', url: '/api/test' }),
    }),
  };
  return { host, response };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('校验错误：数组 message 移入 errors，code=1001', () => {
    const { host, response } = buildContext();

    filter.catch(new BadRequestException(['字段a错误', '字段b错误']), host as any);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe(1001);
    expect(body.message).toBe('Validation failed');
    expect(body.errors).toEqual(['字段a错误', '字段b错误']);
  });

  it('401 → code 1002；404 → code 1004', () => {
    const ctx1 = buildContext();
    filter.catch(new UnauthorizedException('未登录'), ctx1.host as any);
    expect(ctx1.response.json.mock.calls[0][0].code).toBe(1002);

    const ctx2 = buildContext();
    filter.catch(
      new BadRequestException('普通 400'),
      ctx2.host as any,
    );
    // BadRequest 走 1001
    expect(ctx2.response.json.mock.calls[0][0].code).toBe(1001);
  });

  it('Prisma P2025 → 404/1004，不泄露内部信息', () => {
    const { host, response } = buildContext();

    filter.catch(
      new Prisma.PrismaClientKnownRequestError('记录不存在', {
        code: 'P2025',
        clientVersion: '7.7.0',
        meta: {},
      }),
      host as any,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe(1004);
    expect(body.message).toBe('资源不存在');
  });

  it('Prisma P2002 → 409/1005，message 为通用文案', () => {
    const { host, response } = buildContext();

    filter.catch(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: '7.7.0',
        meta: {},
      }),
      host as any,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe(1005);
    expect(body.message).toBe('数据冲突，请重试');
  });

  it('未捕获异常：500 + 通用文案，不泄露原始错误信息', () => {
    const { host, response } = buildContext();

    filter.catch(new Error('内部机密: db password=xxx'), host as any);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe(1000);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('db password');
  });
});
