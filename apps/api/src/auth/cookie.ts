import type { CookieOptions } from "express";
import { expiresInMs } from "./jwt.js";

export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: expiresInMs(),
  };
}
