import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export interface JwtPayload {
  sub: string;
  tokenType?: 'access' | 'refresh';
  sessionId?: string;
  jti?: string;
  username: string;
  email: string;
  iat?: number;
  exp?: number;
}

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as JwtPayload;

    if (!user) {
      // 仅在守卫被绕过的异常路径出现；显式抛错优于把 null 传进业务层
      throw new UnauthorizedException('未授权访问');
    }

    return data ? user[data] : user;
  },
);
