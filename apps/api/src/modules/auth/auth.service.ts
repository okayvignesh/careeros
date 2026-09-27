import { Injectable, UnauthorizedException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '@careeros/auth';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(email: string, password: string, displayName?: string) {
    const passwordHash = await hashPassword(password);
    return this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        displayName: displayName ?? null,
        passwordHash,
        setupState: { create: { state: 'account_created' } },
      },
      select: { id: true, email: true, displayName: true },
    });
  }

  async verifyCredentials(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('Invalid email or password');
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    return { id: user.id, email: user.email };
  }

  async userCount(): Promise<number> {
    return this.prisma.user.count();
  }
}
