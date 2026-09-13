/**
 * The compiled applications the host serves (ADR-0245).
 */

import { describe, expect, test } from 'bun:test';
import { COMPILED_APPLICATIONS } from './applications.ts';
import { BUILT_IN_ROUTES } from './routes.ts';

describe('COMPILED_APPLICATIONS', () => {
	test('lists exactly the one compiled application this release ships', () => {
		expect(COMPILED_APPLICATIONS).toEqual([
			{ id: 'dictation', title: 'Tironian' },
		]);
	});

	test('a compiled application carries only an id and a title', () => {
		const [application] = COMPILED_APPLICATIONS;
		expect(Object.keys(application ?? {}).sort()).toEqual(['id', 'title']);
	});
});

/**
 * Every built-in route the host serves has something behind it, and every
 * compiled application has its own route. The two lists used to be one object
 * literal the type checker cross-checked; now that compiled builds arrive at
 * runtime, this is where a built-in route with no document, or an application
 * with no route, shows up.
 */
describe('built-in route coverage', () => {
	test('each built-in route is a compiled application', () => {
		const served = new Set(COMPILED_APPLICATIONS.map(({ id }) => id));
		expect(
			Object.keys(BUILT_IN_ROUTES).filter((id) => !served.has(id)),
		).toEqual([]);
	});

	test('each compiled application has its own built-in route', () => {
		expect(
			COMPILED_APPLICATIONS.filter(
				({ id, title }) =>
					BUILT_IN_ROUTES[id as keyof typeof BUILT_IN_ROUTES]?.title !== title,
			),
		).toEqual([]);
	});
});
