import { UseGuards, applyDecorators } from '@nestjs/common';
import { RequireAdminGuard } from '../guards/require-admin.guard';

/**
 * C-P3.8a: shorthand for `@UseGuards(RequireAdminGuard)`. Attach to any
 * admin-flavored handler or controller (`/admin/*`, or `/me/*` config
 * mutations with global effect).
 */
export function RequireAdmin(): ClassDecorator & MethodDecorator {
  return applyDecorators(UseGuards(RequireAdminGuard));
}
