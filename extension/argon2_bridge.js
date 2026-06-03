import "./vendor/argon2-bundled.min.js";

const argon2 = globalThis.argon2;

if (!argon2) {
  throw new Error("argon2_unavailable");
}

export default argon2;
