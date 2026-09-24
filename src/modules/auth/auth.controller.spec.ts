import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<AuthService>> = {
      register: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
      refreshToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: serviceMock }],
    }).compile();

    controller = module.get(AuthController);
    service = module.get(AuthService) as jest.Mocked<AuthService>;
  });

  it('register 透传 DTO 给 service', async () => {
    const dto = {
      username: 'alice',
      email: 'alice@x.com',
      password: 'Passw0rd!',
    };
    const ret = { user: { id: '1' }, accessToken: 'a', refreshToken: 'r' };
    service.register.mockResolvedValue(ret as never);

    await expect(controller.register(dto)).resolves.toEqual(ret);
    expect(service.register).toHaveBeenCalledWith(dto);
  });

  it('login 透传 DTO 给 service', async () => {
    const dto = { email: 'a@x.com', password: 'Passw0rd!' };
    service.login.mockResolvedValue({ accessToken: 'a' } as never);

    await controller.login(dto);
    expect(service.login).toHaveBeenCalledWith(dto);
  });

  it('logout 从 DTO 中拆出 refreshToken 调用 service', async () => {
    service.logout.mockResolvedValue({ message: '登出成功' } as never);
    const user = { sub: 'u-1', username: 'a', email: 'a', sessionId: 's-1' };
    await controller.logout({ refreshToken: 'rt' }, user);
    expect(service.logout).toHaveBeenCalledWith('rt', user);
  });

  it('refreshToken 透传 DTO 给 service', async () => {
    const dto = { refreshToken: 'rt' };
    service.refreshToken.mockResolvedValue({ accessToken: 'new' } as never);
    await controller.refreshToken(dto);
    expect(service.refreshToken).toHaveBeenCalledWith(dto);
  });
});
