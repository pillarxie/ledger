import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

export interface ErrorResponse {
  code: number;
  message: string;
  errors?: any[];
  timestamp: string;
  path: string;
}

/** Prisma 错误码常量（避免魔法字符串） */
const PrismaErrorCode = {
  P2002: 'P2002', // 唯一约束冲突
  P2003: 'P2003', // 外键约束冲突
  P2025: 'P2025', // 记录不存在
} as const;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * HTTP 状态码 → 业务错误码映射（见 docs/plan.md 错误码定义）
   * - 1001-1004 按计划；1005 为通用段扩展（CONFLICT，计划未单列）
   * - 未列出的状态码沿用 UNKNOWN_ERROR=1000，或使用响应对象中显式指定的 code
   */
  private static readonly STATUS_CODE_MAP: Record<number, number> = {
    [HttpStatus.BAD_REQUEST]: 1001, // VALIDATION_ERROR
    [HttpStatus.UNAUTHORIZED]: 1002, // UNAUTHORIZED
    [HttpStatus.FORBIDDEN]: 1003, // FORBIDDEN
    [HttpStatus.NOT_FOUND]: 1004, // NOT_FOUND
    [HttpStatus.CONFLICT]: 1005, // CONFLICT（扩展）
  };

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 1000; // UNKNOWN_ERROR
    let errors: any[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as any;
        const rawMessage = responseObj.message ?? responseObj.error;

        // 校验错误：message 是数组时移入 errors 字段
        if (Array.isArray(rawMessage)) {
          errors = rawMessage;
          message = 'Validation failed';
        } else {
          message = rawMessage ?? message;
        }

        code =
          responseObj.code ??
          AllExceptionsFilter.STATUS_CODE_MAP[status] ??
          code;
      } else {
        message = exceptionResponse as string;
        code = AllExceptionsFilter.STATUS_CODE_MAP[status] ?? code;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma 已知错误 → 映射为对应的 4xx，不泄露内部细节
      const { P2002, P2003, P2025 } = PrismaErrorCode;
      if (exception.code === P2025) {
        status = HttpStatus.NOT_FOUND;
        message = '资源不存在';
      } else if (exception.code === P2002 || exception.code === P2003) {
        status = HttpStatus.CONFLICT;
        message = '数据冲突，请重试';
      }
      code = AllExceptionsFilter.STATUS_CODE_MAP[status] ?? code;
      this.logger.warn(
        `Prisma error ${exception.code} on ${request.method} ${request.url}`,
      );
    } else {
      // 未捕获异常：服务端记录完整堆栈，响应不泄露内部细节
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const errorResponse: ErrorResponse = {
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (errors.length > 0) {
      errorResponse.errors = errors;
    }

    response.status(status).json(errorResponse);
  }
}
