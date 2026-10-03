import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { TokenCapExceededError } from '@careeros/ai';

/**
 * ai-safety.md item 9: a prompt rejected by the pre-flight token cap never
 * reaches the provider, so the user should see an actionable 413 (with the
 * numbers) rather than an opaque 500. The provider still throws the typed error;
 * this filter is the single HTTP mapping.
 */
@Catch(TokenCapExceededError)
export class TokenCapExceptionFilter implements ExceptionFilter {
  catch(err: TokenCapExceededError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      error: 'Payload Too Large',
      code: err.code,
      message:
        `Prompt is too large for one call (estimated ${err.estimatedInputTokens} input + ` +
        `${err.maxOutputTokens} output tokens exceeds the ${err.cap}-token cap). ` +
        'Shorten the input or raise the per-call cap.',
    });
  }
}
