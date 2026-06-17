import { SetMetadata } from '@nestjs/common';
import { ApiScope } from '../api-scopes';

export const API_SCOPES_KEY = 'apiScopes';

/**
 * Public API endpoint'ga kerakli scope'lar belgilash uchun. Foydalanuvchining
 * API kalitida shu scope'lardan kamida bittasi bo'lishi kerak.
 *
 * Misol: @RequireApiScopes(API_SCOPES.TRANSACTIONS_READ)
 */
export const RequireApiScopes = (...scopes: ApiScope[]) =>
  SetMetadata(API_SCOPES_KEY, scopes);
