import { STORLEKSKLASS_PACKAD } from "./storleksklass-snapshot";
import { skapaStorleksuppslag } from "./kluster/anstallda";

/** Arbetsställets storleksklass (SCB anstkl), eller null om registret saknar uppgift. */
export const storleksklassFor = skapaStorleksuppslag(STORLEKSKLASS_PACKAD);

export { anstallda, anstalldaMening, anstalldaSchema, type Anstallda } from "./kluster/anstallda";
