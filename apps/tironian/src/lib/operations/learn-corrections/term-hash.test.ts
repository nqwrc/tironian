import { expect, test } from 'bun:test';
import { hashFold } from './term-hash';

test('the hash is lowercase hex SHA-256 of the fold', async () => {
	expect(await hashFold('kubernetes')).toBe(
		'94abcb2d2773df65cda0708afd551ea23131ec18400d7694cd971b016d86e7ae',
	);
	expect(await hashFold('nicola')).toBe(
		'c9ae5a10ae8824d79d22c3e571ef302f5368e51afa1f551b374f06cbbd682410',
	);
});
