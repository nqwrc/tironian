import { expect, test } from 'bun:test';
import { decideSecureFieldGuard } from './secure-field-guard';

test('an affirmative secure verdict withholds while the guard is on', () => {
	expect(
		decideSecureFieldGuard({ focusedField: 'secure', enabled: true }),
	).toBe('withhold');
});

test('a not-secure verdict always passes', () => {
	expect(
		decideSecureFieldGuard({ focusedField: 'notSecure', enabled: true }),
	).toBe('allow');
});

test('an unknown verdict fails open', () => {
	expect(
		decideSecureFieldGuard({ focusedField: 'unknown', enabled: true }),
	).toBe('allow');
});

test('a disabled guard passes even a secure verdict', () => {
	expect(
		decideSecureFieldGuard({ focusedField: 'secure', enabled: false }),
	).toBe('allow');
});
