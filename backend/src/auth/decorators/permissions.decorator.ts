import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
/**
 * Endpoint'ga kerakli permission'larni o'rnatadi.
 * Hozircha OR mantig'i — bittasi mos kelsa o'tadi.
 */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);
