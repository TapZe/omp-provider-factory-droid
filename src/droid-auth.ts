import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface DroidCliCredentials {
  accessToken: string;
  refreshToken: string;
  activeOrganizationId?: string;
}

const FACTORY_DIR = path.join(os.homedir(), ".factory");
const LOGIN_KEYCHAIN_PATH = path.join(FACTORY_DIR, "auth.v2.loginkeychain");
const FILE_STORAGE_PATH = path.join(FACTORY_DIR, "auth.v2.file");
const KEYFILE_PATH = path.join(FACTORY_DIR, "auth.v2.key");

const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function decryptPayload(ciphertext: string, key: Buffer): Record<string, unknown> | null {
  const parts = ciphertext.trim().split(":");
  if (parts.length !== 3) {
    return null;
  }

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const encryptedData = Buffer.from(parts[2], "base64");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    const parsed: unknown = JSON.parse(decrypted.toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readKeychainKey(): Buffer | null {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    // Factory CLI stores the encryption key in macOS Keychain under service "Factory CLI"
    const stdout = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Factory CLI", "-w"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    if (stdout.length > 0) {
      return Buffer.from(stdout, "base64");
    }
  } catch {
    // Keychain item may not exist or access denied
  }

  return null;
}

function readKeyfileKey(): Buffer | null {
  try {
    if (fs.existsSync(KEYFILE_PATH)) {
      const raw = fs.readFileSync(KEYFILE_PATH, "utf8").trim();
      if (raw.length > 0) {
        return Buffer.from(raw, "base64");
      }
    }
  } catch {
    // Keyfile unreadable
  }

  return null;
}

/**
 * Loads and decrypts the credentials stored locally by the Factory Droid CLI (`droid`).
 *
 * Supports macOS Keychain-backed storage (`auth.v2.loginkeychain`) and Linux/file-backed
 * storage (`auth.v2.file`). Returns null if no valid credentials can be loaded.
 */
export function loadDroidCliCredentials(): DroidCliCredentials | null {
  // 1. Try macOS Keychain
  const keychainKey = readKeychainKey();
  if (keychainKey && fs.existsSync(LOGIN_KEYCHAIN_PATH)) {
    try {
      const encrypted = fs.readFileSync(LOGIN_KEYCHAIN_PATH, "utf8");
      const decrypted = decryptPayload(encrypted, keychainKey);
      if (decrypted && typeof decrypted.access_token === "string" && typeof decrypted.refresh_token === "string") {
        return {
          accessToken: decrypted.access_token,
          refreshToken: decrypted.refresh_token,
          activeOrganizationId:
            typeof decrypted.active_organization_id === "string" ? decrypted.active_organization_id : undefined,
        };
      }
    } catch {
      // Continue to next backend
    }
  }

  // 2. Try file-backed key (`auth.v2.key` + `auth.v2.file` or `auth.v2.loginkeychain`)
  const fileKey = readKeyfileKey();
  if (fileKey) {
    const candidatePaths = [FILE_STORAGE_PATH, LOGIN_KEYCHAIN_PATH];
    for (const candidatePath of candidatePaths) {
      if (fs.existsSync(candidatePath)) {
        try {
          const encrypted = fs.readFileSync(candidatePath, "utf8");
          const decrypted = decryptPayload(encrypted, fileKey);
          if (decrypted && typeof decrypted.access_token === "string" && typeof decrypted.refresh_token === "string") {
            return {
              accessToken: decrypted.access_token,
              refreshToken: decrypted.refresh_token,
              activeOrganizationId:
                typeof decrypted.active_organization_id === "string" ? decrypted.active_organization_id : undefined,
            };
          }
        } catch {
          // Continue
        }
      }
    }
  }

  return null;
}
