// Ed25519 public keys trusted to sign content packages (base64, raw 32 bytes).
// Same key as App/Resources/TrustedKeys.txt and content/trusted_keys/phq-dev-2026.pub.
// The matching private key is never in this repository.
export const TRUSTED_KEYS = [
  { id: 'phq-dev-2026', key: 'Y1w4NSAaUNDpw61acPvVol2cCKla5c0ojLh0t66WuVQ=', note: 'Development key' },
];

export const APP_VERSION = '1.0.0';
export const SUPPORTED_SCHEMA = 1;
export const SUPPORTED_FORMAT = 1;
