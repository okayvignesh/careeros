import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { LockoutError } from '../../modules/auth/auth.service';

/**
 * A-C1: LockoutError already carries `retryAfterS` in its JSON body; the RFC
 * says a 429 should also emit a `Retry-After` header. This filter sets the
 * header, then reproduces the standard Nest 429 JSON body so clients that
 * ignore the header still see the message.
 */
@Catch(LockoutError)
export class LockoutExceptionFilter implements ExceptionFilter {
  catch(err: LockoutError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.setHeader('Retry-After', String(err.retryAfterS));
    const status = err.getStatus();
    const body = err.getResponse();
    res.status(status).json(body);
  }
}
