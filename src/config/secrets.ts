import { chmod, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

const SAFE_SECRET_NAME = /^[A-Za-z0-9._-]+$/;

export class FileSecretProvider {
  readonly #secretDirectory: string;

  constructor(secretDirectory = process.env.MAILBRIDGE_SECRET_DIR ?? "./secrets") {
    this.#secretDirectory = resolve(secretDirectory);
  }

  async read(reference: string): Promise<string> {
    if (!SAFE_SECRET_NAME.test(reference)) {
      throw new Error("Invalid secret reference");
    }
    const target = resolve(this.#secretDirectory, reference);
    const rel = relative(this.#secretDirectory, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Secret path escaped the configured directory");
    }
    const value = (await readFile(target, "utf8")).trimEnd();
    if (!value) {
      throw new Error(`Secret ${reference} is empty`);
    }
    return value;
  }

  async exists(reference: string): Promise<boolean> {
    if (!SAFE_SECRET_NAME.test(reference)) return false;
    try {
      const target = resolve(this.#secretDirectory, reference);
      const rel = relative(this.#secretDirectory, target);
      if (rel.startsWith("..") || isAbsolute(rel)) return false;
      return (await stat(target)).isFile();
    } catch {
      return false;
    }
  }

  async replace(reference: string, value: string): Promise<void> {
    const target = this.#target(reference);
    if (!value || value.length > 16 * 1024) throw new Error("Secret value must contain between 1 and 16384 characters");
    await mkdir(this.#secretDirectory, { recursive: true, mode: 0o700 });
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error("Refusing to replace a symbolic-link secret");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const temporary = `${target}.tmp-${randomBytes(8).toString("hex")}`;
    try {
      await writeFile(temporary, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  #target(reference: string): string {
    if (!SAFE_SECRET_NAME.test(reference)) throw new Error("Invalid secret reference");
    const target = resolve(this.#secretDirectory, reference);
    const rel = relative(this.#secretDirectory, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Secret path escaped the configured directory");
    return target;
  }
}
