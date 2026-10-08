/**
 * Function words and the commonest verbs and adverbs, Italian and English,
 * written for this file. Folded: lowercase, no accents, because the learner
 * compares folds. A term made only of these is never learned.
 */
const ITALIAN = `a abbiamo ad adesso agli ai al alla alle allo allora altro anche ancora avere aveva avevo bene c che chi ci ciao come con cosa cosi cui da dal dall dalla dalle dai degli dei del dell della delle dello di dire dopo dove e ecco ed era essere fa fare fatto fino fra gia gli ha hai hanno ho i il in io la le lei li lo loro lui ma me mi mia mie miei mio molto ne nei nel nella nelle no noi non nostro o ogni ok okay per perche pero piu poi prima proprio qua qual quale quando quanto quella quelle quelli quello questa queste questi questo qui se sei sempre senza si sia siamo solo sono sta stai stato su sua sue sul sulla suo suoi te ti tra tu tutta tutte tutti tutto un una uno va vi voi volta`;

const ENGLISH = `a about after again all also am an and any are as at be because been before being both but by can could did do does doing done down each even few for from get got had has have having he her here him his how i if in into is it its just know let like made make me more most much my no not now of off ok okay on once one only or other our out over please really right said same say see she should so some such than thanks that the their them then there these they thing think this those through to too two under until up us very want was we well were what when where which while who why will with would yeah yes yet you your`;

export const COMMON_WORDS: ReadonlySet<string> = new Set(
	`${ITALIAN} ${ENGLISH}`.split(/\s+/u).filter(Boolean),
);
