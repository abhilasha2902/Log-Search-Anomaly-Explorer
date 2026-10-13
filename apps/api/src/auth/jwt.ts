import jwt from "jsonwebtoken";

export interface JwtPayload {
  sub: string;
}

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error("JWT_SECRET is not set");
  }
  return value;
}

function expiresIn(): string {
  return process.env.JWT_EXPIRES_IN ?? "60m";
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, secret(), { expiresIn: expiresIn() } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, secret()) as JwtPayload;
}

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function expiresInMs(): number {
  const raw = expiresIn();
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) {
    throw new Error(`Unsupported JWT_EXPIRES_IN format: ${raw}`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}
