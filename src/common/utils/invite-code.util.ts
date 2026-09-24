import { randomInt } from 'crypto';

/**
 * 生成邀请码
 * @param length 邀请码长度，默认6位
 * @returns 邀请码字符串
 */
export function generateInviteCode(length: number = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除容易混淆的字符 I, O, 0, 1
  let code = '';
  for (let i = 0; i < length; i++) {
    // 使用加密安全的随机数，避免 Math.random 可预测性
    code += chars[randomInt(chars.length)];
  }
  return code;
}
