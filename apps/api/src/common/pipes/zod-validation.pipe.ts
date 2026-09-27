import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodError, ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Invalid input',
        issues: (result.error as ZodError).flatten(),
      });
    }
    return result.data;
  }
}
