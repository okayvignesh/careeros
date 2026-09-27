import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from './session.service';

/**
 * C-P0.7: WebAuthn / passkey server. All CBOR/COSE parsing is delegated to
 * @simplewebauthn/server (ponytail: do not hand-roll). This class only
 * marshals shapes to/from Prisma and enforces the challenge-park invariant.
 *
 * RP config: `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGIN` env, falling back to
 * WEB_URL / localhost so dev-host works with no config. Prod must set both.
 *
 * Challenge storage: rows in `passkey_challenges` keyed by the challenge
 * string, TTL 5 min. On verify we consume + delete. Usernameless auth is
 * supported (no userId on the challenge row until verify resolves it).
 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function resolveRp(): { rpID: string; origin: string; rpName: string } {
  const explicit = process.env.WEBAUTHN_ORIGIN ?? process.env.WEB_URL ?? 'http://localhost:3000';
  let originUrl: URL;
  try {
    originUrl = new URL(explicit);
  } catch {
    originUrl = new URL('http://localhost:3000');
  }
  const rpID = process.env.WEBAUTHN_RP_ID ?? originUrl.hostname;
  const rpName = process.env.WEBAUTHN_RP_NAME ?? 'Career OS';
  return { rpID, origin: originUrl.origin, rpName };
}

@Injectable()
export class PasskeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
  ) {}

  async generateRegistrationOptions(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { rpID, rpName } = resolveRp();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const existing = await this.prisma.passkeyCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email,
      userDisplayName: user.displayName ?? user.email,
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: existing.map((c) => ({
        id: bytesToBase64url(c.credentialId),
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
    });
    await this.parkChallenge(options.challenge, userId, 'register');
    return options;
  }

  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    name?: string,
  ): Promise<{ credentialId: string; name: string | null }> {
    const { rpID, origin } = resolveRp();
    const challenge = await this.consumeChallenge(response.response.clientDataJSON, userId, 'register');
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Passkey registration verification failed');
    }
    const info = verification.registrationInfo;
    const created = await this.prisma.passkeyCredential.create({
      data: {
        userId,
        credentialId: Buffer.from(base64urlToBytes(info.credential.id)),
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        transports: (info.credential.transports ?? []) as string[],
        name: name?.slice(0, 64) ?? null,
      },
      select: { id: true, name: true },
    });
    return { credentialId: created.id, name: created.name };
  }

  async generateAuthenticationOptions(userId?: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const { rpID } = resolveRp();
    // Usernameless supported: when userId is absent we do not narrow the
    // allow-list; the browser picks a discoverable credential.
    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;
    if (userId) {
      const rows = await this.prisma.passkeyCredential.findMany({
        where: { userId },
        select: { credentialId: true, transports: true },
      });
      allowCredentials = rows.map((r) => ({
        id: bytesToBase64url(r.credentialId),
        transports: r.transports as AuthenticatorTransportFuture[],
      }));
    }
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials,
    });
    await this.parkChallenge(options.challenge, userId ?? null, 'authenticate');
    return options;
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    res: Response,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<{ userId: string }> {
    const { rpID, origin } = resolveRp();
    const challenge = await this.consumeChallenge(response.response.clientDataJSON, null, 'authenticate');
    const credRow = await this.prisma.passkeyCredential.findUnique({
      where: { credentialId: Buffer.from(base64urlToBytes(response.id)) },
    });
    if (!credRow) throw new UnauthorizedException('Unknown passkey');
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: bytesToBase64url(credRow.credentialId),
        publicKey: new Uint8Array(credRow.publicKey),
        counter: Number(credRow.counter),
        transports: credRow.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: false,
    });
    if (!verification.verified) {
      throw new UnauthorizedException('Passkey verification failed');
    }
    // Counter monotonic check: 0/0 is the "authenticator doesn't track" case
    // (some platform authenticators). Only reject if a non-zero counter went
    // backwards.
    const newCounter = verification.authenticationInfo.newCounter;
    const oldCounter = Number(credRow.counter);
    if (oldCounter > 0 && newCounter !== 0 && newCounter <= oldCounter) {
      throw new UnauthorizedException('Passkey counter regression (cloned credential?)');
    }
    await this.prisma.passkeyCredential.update({
      where: { id: credRow.id },
      data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
    });
    await this.session.write(res, credRow.userId, meta);
    return { userId: credRow.userId };
  }

  async listCredentials(userId: string): Promise<
    Array<{ id: string; name: string | null; transports: string[]; createdAt: Date; lastUsedAt: Date | null }>
  > {
    const rows = await this.prisma.passkeyCredential.findMany({
      where: { userId },
      select: { id: true, name: true, transports: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows;
  }

  async revokeCredential(userId: string, credentialRowId: string): Promise<void> {
    const res = await this.prisma.passkeyCredential.deleteMany({
      where: { id: credentialRowId, userId },
    });
    if (res.count === 0) throw new NotFoundException('Passkey not found');
  }

  // --- challenge park helpers ---

  private async parkChallenge(challenge: string, userId: string | null, kind: 'register' | 'authenticate'): Promise<void> {
    await this.prisma.passkeyChallenge.create({
      data: {
        challenge,
        userId,
        kind,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });
  }

  /**
   * Extract the challenge from the browser's clientDataJSON, verify it exists
   * in our park, matches the expected `kind`, has not expired, and (if the
   * park row is user-bound) matches the caller. Deletes the row so a challenge
   * cannot be replayed. Returns the challenge string so simplewebauthn can
   * re-verify it against the signed response.
   */
  private async consumeChallenge(
    clientDataJSONB64: string,
    userId: string | null,
    kind: 'register' | 'authenticate',
  ): Promise<string> {
    const clientData = JSON.parse(Buffer.from(base64urlToBytes(clientDataJSONB64)).toString('utf8')) as {
      challenge?: string;
    };
    const challenge = clientData.challenge;
    if (!challenge) throw new BadRequestException('Missing challenge in client data');
    const row = await this.prisma.passkeyChallenge.findUnique({ where: { challenge } });
    if (!row) throw new BadRequestException('Unknown or expired challenge');
    if (row.kind !== kind) throw new BadRequestException('Challenge kind mismatch');
    if (row.expiresAt.getTime() < Date.now()) {
      await this.prisma.passkeyChallenge.delete({ where: { challenge } }).catch(() => undefined);
      throw new BadRequestException('Challenge expired');
    }
    if (row.userId && userId && row.userId !== userId) {
      throw new BadRequestException('Challenge owner mismatch');
    }
    // Registration challenges MUST be tied to the caller.
    if (kind === 'register' && (!userId || row.userId !== userId)) {
      throw new BadRequestException('Challenge owner mismatch');
    }
    await this.prisma.passkeyChallenge.delete({ where: { challenge } }).catch(() => undefined);
    return challenge;
  }
}

// ---- base64url helpers (avoid a dep just for encode/decode) ----

function bytesToBase64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

function base64urlToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}
