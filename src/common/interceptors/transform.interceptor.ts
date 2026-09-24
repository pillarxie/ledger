import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Decimal } from '@prisma/client/runtime/client';

export interface Response<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 递归把 Prisma Decimal 转成 number，
 * 避免金额/余额以字符串形式出现在 JSON 响应中
 */
function convertDecimals(value: any): any {
  if (value instanceof Decimal) {
    return Number(value);
  }

  if (Array.isArray(value)) {
    return value.map(convertDecimals);
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = convertDecimals(item);
    }
    return result;
  }

  return value;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, Response<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => ({
        code: 0,
        message: 'success',
        data: convertDecimals(data),
      })),
    );
  }
}
