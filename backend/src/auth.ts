// Passwords (PBKDF2-SHA256), session tokens (random, stored hashed) and per-user secret encryption (AES-GCM).
import type { Env } from './types';

const enc = new TextEncoder();
const dec = new TextDecoder();
const PBKDF2_ITERATIONS = 100000;

function toBase64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
function toHex(bytes: Uint8Array): string { return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''); }

export function randomToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64(arr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

export async function hashPassword(password: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? fromBase64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: toBase64(new Uint8Array(bits)), salt: toBase64(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const h = await hashPassword(password, salt);
  if (h.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= h.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

// ---- secret encryption (Gemini keys) ----
const DEV_KEY = 'dev-only-encryption-key-change-me-in-prod!!';
let cachedKey: CryptoKey | null = null;
let cachedSource = '';

export function encryptionSource(env: Env): 'env' | 'dev-fallback' {
  return env.ENCRYPTION_KEY ? 'env' : 'dev-fallback';
}

async function aesKey(env: Env): Promise<CryptoKey> {
  const source = env.ENCRYPTION_KEY || DEV_KEY;
  if (cachedKey && cachedSource === source) return cachedKey;
  const raw = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(source)));
  cachedKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  cachedSource = source;
  return cachedKey;
}

export async function encryptSecret(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(plain)));
  return `${toBase64(iv)}.${toBase64(data)}`;
}

export async function decryptSecret(env: Env, blob: string): Promise<string> {
  const [ivB64, dataB64] = blob.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivB64) }, await aesKey(env), fromBase64(dataB64));
  return dec.decode(plain);
}

export function maskKey(key: string): string {
  return key.length <= 8 ? '****' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}
