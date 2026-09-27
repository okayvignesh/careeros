import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Recovery key = random 32-byte value, base32-encoded, shown once.
 * We store only the last 4 chars for display and an acknowledged flag.
 * The full key is the operator's responsibility to save; losing it means
 * lost access to encrypted secrets on master-key rotation flows in P6.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function formatGroups(key: string): string {
  return key.match(/.{1,5}/g)!.join('-');
}

@Injectable()
export class RecoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(userId: string): Promise<{ key: string; last4: string }> {
    const buf = randomBytes(32);
    const encoded = base32Encode(buf).slice(0, 40);
    const formatted = formatGroups(encoded);
    const last4 = encoded.slice(-4);

    await this.prisma.recoveryKey.create({
      data: { userId, hashPreview: last4 },
    });
    return { key: formatted, last4 };
  }

  async acknowledge(userId: string): Promise<void> {
    const latest = await this.prisma.recoveryKey.findFirst({
      where: { userId, acknowledgedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) return;
    await this.prisma.recoveryKey.update({
      where: { id: latest.id },
      data: { acknowledgedAt: new Date() },
    });
  }
}
