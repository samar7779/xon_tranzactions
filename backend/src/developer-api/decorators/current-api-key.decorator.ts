import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Validatsiya o'tgan API kalit ob'ektini controller'da olish.
 * Misol: @CurrentApiKey() apiKey: { id: string; name: string; scopes: string[] }
 */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return req.apiKey || null;
  },
);
