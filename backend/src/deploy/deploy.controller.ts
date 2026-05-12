import { Controller, Get, Headers, HttpCode, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeployService } from './deploy.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('deploy')
@Controller('_deploy')
export class DeployController {
  private readonly logger = new Logger(DeployController.name);

  constructor(private readonly svc: DeployService) {}

  @Get('health')
  @ApiOperation({ summary: 'Deploy webhook sog\'lik tekshiruvi' })
  health() {
    return this.svc.health();
  }

  @Get('log')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deploy log oxirgi 200 satr (admin only)' })
  async log() {
    return { ok: true, log: await this.svc.tail(200) };
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'GitHub webhook — push paytida ishga tushadi' })
  async deploy(@Req() req: Request, @Res() res: Response, @Headers() headers: any) {
    const raw: Buffer = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const sig = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
    const event = headers['x-github-event'] || headers['X-GitHub-Event'] || '';

    // 1. Signature
    if (!this.svc.verifySignature(raw, sig)) {
      this.logger.warn(`Yaroqsiz signature, ip=${req.ip}`);
      return res.status(401).json({ ok: false, error: 'invalid signature' });
    }

    // 2. Event
    if (event === 'ping') {
      return res.json({ ok: true, msg: 'pong' });
    }
    if (event !== 'push') {
      return res.json({ ok: true, msg: `ignored: ${event}` });
    }

    // 3. Branch
    const payload: any = req.body || {};
    const ref: string = payload.ref || '';
    const pushedBranch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;

    // 4. Fayl o'zgarishlari → qaysi service'larni restart qilish
    const files = this.svc.changedFilesFromPayload(payload);
    const services = this.svc.servicesToRestart(files);
    const pusher: string = payload?.pusher?.name || '?';
    const commit: string = payload?.head_commit?.id || '';

    this.logger.log(
      `━━ DEPLOY queued · branch=${pushedBranch} pusher=${pusher} files=${files.length} restart=${services.join(',') || '(none)'} ━━`,
    );

    // 5. Fonda boshlab yuboramiz, webhook'ga darrov javob qaytaramiz
    this.svc.triggerAsync({ pushedBranch, pusher, services, commit });

    return res.json({
      ok: true,
      queued: true,
      branch: pushedBranch,
      files: files.length,
      services,
    });
  }
}
