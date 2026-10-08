import { expect, test } from 'bun:test';
import { hashFold } from './term-hash';

test('the hash is lowercase hex SHA-256 of the fold', async () => {
	expect(await hashFold('kubernetes')).toBe(
		'94abcb2d2773df65cda0708afd551ea23131ec18400d7694cd971b016d86e7ae',
	);
	expect(await hashFold('daniel')).toBe(
		'bd3dae5fb91f88a4f0978222dfd58f59a124257cb081486387cbae9df11fb879',
	);
});
