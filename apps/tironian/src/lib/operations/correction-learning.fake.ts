/**
 * The one test fake of `$lib/operations/correction-learning`, shared by every
 * test file that registers it. Under plain `bun test` one module registry
 * serves the whole run, so files that each built their own fake could assert
 * on a handle the subject never calls. Imported by relative path, this module
 * is the same object in every file; each file resets it in `beforeEach`.
 */
import { mock } from 'bun:test';

export const correctionLearningFake = {
	wantsToObserve: mock((_app: unknown, _deliveredText: string) => false),
	afterDelivery: mock(),
	dictationStarting: mock(),
	cancel: mock(),
};

/** What `mock.module('$lib/operations/correction-learning', ...)` hands out. */
export const correctionLearningModule = {
	correctionLearning: correctionLearningFake,
};

export function resetCorrectionLearningFake(): void {
	for (const fn of Object.values(correctionLearningFake)) fn.mockClear();
}
