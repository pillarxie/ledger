import { BadRequestException } from '@nestjs/common';

/**
 * 把日期（字符串或 Date）归一化为当天最后一毫秒
 *
 * 数据库日期范围上界应包含结束日全天：
 * `new Date('2025-01-31')` 是当天 00:00:00，会漏掉 1月31日 的账单
 */
export function endOfDay(value: string | Date): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * 校验日期范围合法性：开始日期不能晚于结束日期
 */
export function assertValidDateRange(
  startDate?: string,
  endDate?: string,
): void {
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    throw new BadRequestException('开始日期不能晚于结束日期');
  }
}
