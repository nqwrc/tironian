import { deviceConfig, type SecretKey } from './device-config.svelte';

/**
 * `SecretKey` is the secret set the facade reads; re-exported for its callers
 * so they import the key type and the reader from one place.
 */
export type { SecretKey };

/**
 * The outcome of reading a secret (ADR-0074 invariant 5). `available` carries a
 * non-empty value; `missing` means no usable value is stored. An unset key reads
 * as `missing`, because an empty string is not a usable credential, so a caller
 * branches on status and never hands a provider SDK a blank key.
 *
 * There is no `locked` state: this product has no account and no server-derived
 * keyring, so a present key is always readable in plaintext.
 */
export type SecretRead =
	| { status: 'available'; value: string }
	| { status: 'missing' };

/**
 * The credential facade: the one place the app reads and writes provider secrets,
 * the values a user *brings* (ADR-0074). Every consumer reads through the
 * `available | missing` contract instead of pulling a raw string off
 * `deviceConfig`, so a blank key can never reach a provider SDK.
 *
 * Secrets live device-local in plaintext `localStorage` through `deviceConfig`.
 * This is a local-first, single-owner product with no account and no sync, so
 * there is no server-derived keyring to encrypt against and no vault to migrate
 * into; device-local plaintext is the whole story, not a staging point.
 */
export function createSecrets() {
	return {
		/**
		 * Read a secret reactively: it reads through `deviceConfig`, whose runes
		 * track the dependency, so a `$derived` re-runs when the value changes. An
		 * unset or empty key reads as `missing`.
		 */
		get(key: SecretKey): SecretRead {
			const value = deviceConfig.get(key);
			return value ? { status: 'available', value } : { status: 'missing' };
		},

		/** Write a secret to its device-local home. */
		set(key: SecretKey, value: string): void {
			deviceConfig.set(key, value);
		},
	};
}

/** The Whispering secrets singleton: device-local, plaintext. */
export const secrets = createSecrets();
