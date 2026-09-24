import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, originalUrl, ip, headers, body, query, params } =
      request;

    // 过滤敏感信息
    const sensitiveFields = [
      'password',
      'newPassword',
      'oldPassword',
      'refreshToken',
    ];
    const sanitize = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      const result = { ...obj };
      for (const key of Object.keys(result)) {
        if (sensitiveFields.includes(key)) {
          result[key] = '******';
        }
      }
      return result;
    };

    const logRequest = () => {
      this.logger.log(
        `\n📥 【请求】 ${method} ${originalUrl}\n` +
          `   IP: ${ip}\n` +
          `   Headers: ${JSON.stringify(headers)}\n` +
          `   Query: ${JSON.stringify(query)}\n` +
          `   Params: ${JSON.stringify(params)}\n` +
          `   Body: ${JSON.stringify(sanitize(body))}`,
      );
    };

    const startTime = Date.now();
    logRequest();

    return next.handle().pipe(
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error(
          `\n📤 【错误响应】 ${method} ${originalUrl}\n` +
            `   耗时: ${duration}ms\n` +
            `   状态码: ${error.status || 500}\n` +
            `   错误信息: ${JSON.stringify({
              code: error.code,
              message: error.message,
              response: error.response,
            })}`,
        );
        return throwError(() => error);
      }),
      finalize(() => {
        const duration = Date.now() - startTime;
        if (response.headersSent) {
          this.logger.log(
            `\n📤 【响应】 ${method} ${originalUrl}\n` +
              `   耗时: ${duration}ms\n` +
              `   状态码: ${response.statusCode}`,
          );
        }
      }),
    );
  }
}
