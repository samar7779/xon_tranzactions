import {
  Body, Controller, Get, Headers, HttpCode, Logger, Post,
  Req, UseGuards, RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeployService } from './deploy.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('deploy')
@Controller('_deploy')
export class DeployController {
  private readonly logger = new Logger(DeployController.name);

  constructor(private readonly svc: DeployService) {}

  @Get('health')
  @ApiOperation({ summary: "Deploy webhook sog'lik tekshiruvi" })
  health() {
    return this.svc.health();
  }

  @Get('status')
  @ApiOperation({ summary: 'Joriy deploy holati (Telegram\'siz, UI uchun)' })
  status() {
    return this.svc.status();
  }

  @Get('log')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.SYSTEM_DEPLOY)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deploy log oxirgi 200 satr' })
  async log() {
    return { ok: true, log: await this.svc.tail(200) };
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'GitHub webhook — push paytida ishga tushadi' })
  async deploy(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-hub-signature-256') sig: string,
    @Headers('x-github-event') event: string,
  ) {
    const raw: Buffer | undefined = req.rawBody;
    this.logger.log(`event=${event || '?'} rawBytes=${raw?.length ?? 0} hasSig=${!!sig}`);

    // 1. Signature
    if (!raw || !this.svc.verifySignature(raw, sig)) {
      this.logger.warn(`Yaroqsiz signature (raw=${raw?.length ?? 0}, sig=${sig?.slice(0, 16)}...)`);
      return { ok: false, error: 'invalid signature' };
    }

    // 2. Event
    if (event === 'ping') return { ok: true, msg: 'pong' };
    if (event !== 'push') return { ok: true, msg: `ignored: ${event}` };

    // 3. Branch
    const payload: any = body || {};
    const ref: string = payload.ref || '';
    const pushedBranch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;

    // 4. O'zgargan fayllar
    const files = this.svc.changedFilesFromPayload(payload);
    const services = this.svc.servicesToRestart(files);
    const pusher: string = payload?.pusher?.name || '?';
    const commit: string = payload?.head_commit?.id || '';

    this.logger.log(
      `━━ DEPLOY queued · branch=${pushedBranch} pusher=${pusher} files=${files.length} restart=${services.join(',') || '(none)'} ━━`,
    );

    // 5. Fonda
    try {
      this.svc.triggerAsync({ pushedBranch, pusher, services, commit, files });
    } catch (e: any) {
      this.logger.error(`triggerAsync xato: ${e?.message}`);
    }

    return {
      ok: true,
      queued: true,
      branch: pushedBranch,
      files: files.length,
      services,
    };
  }
}
