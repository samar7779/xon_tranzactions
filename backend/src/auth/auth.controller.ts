import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Admin login — email + parol, JWT qaytaradi' })
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const res: any = await this.auth.login(dto);
    // Kirishni audit'ga yozamiz (global interceptor login'da req.user'ni hali bilmaydi).
    try {
      const u = res?.user || {};
      const ipRaw = req?.headers?.['x-forwarded-for'];
      const ip = (Array.isArray(ipRaw) ? ipRaw[0] : String(ipRaw || '').split(',')[0]).trim()
        || req?.ip || req?.socket?.remoteAddress || null;
      this.audit.record({
        userId: u.id ?? null, userEmail: u.email ?? dto.email ?? null, userName: u.fullName ?? null,
        action: 'Tizimga kirish', module: 'auth', method: 'POST', path: '/api/auth/login',
        ip, statusCode: 200, success: true,
      });
    } catch { /* audit hech qachon login'ni buzmasin */ }
    return res;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Joriy admin haqida ma\'lumot' })
  me(@CurrentUser('id') id: string) {
    return this.auth.me(id);
  }
}
