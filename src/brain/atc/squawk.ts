// Transponder code allocation. Codes are octal (digits 0-7).
// Avoids special/reserved codes.

const RESERVED = new Set([
  '0000', // not assigned
  '1200', // VFR (US)
  '7500', // hijack
  '7600', // radio failure
  '7700', // emergency
]);

const issued = new Set<string>();

/** Allocate a unique-ish discrete squawk code as a 4-char octal string. */
export function allocateSquawk(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += Math.floor(Math.random() * 8).toString();
    if (!RESERVED.has(code) && !issued.has(code)) {
      issued.add(code);
      return code;
    }
  }
  // extremely unlikely fallback
  return '4601';
}
