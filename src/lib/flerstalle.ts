import dataKluster from "@/data/flerstalle.json";
import dataPilot from "@/data/flerstalle.pilot.json";
import { AR_PILOT } from "./datakalla";

const data = AR_PILOT ? dataPilot : dataKluster;

/**
 * Arbetsställen vars bolag har fler arbetsställen i katalogen.
 *
 * För dem är `aeant` bolagets antal anställda, inte arbetsställets — varje
 * Praktikertjänst-mottagning står som 1 198. Listorna visar därför inget antal
 * för dessa rader. Byggs av scripts/build-index-set.mjs; filen bär bara cfarnr.
 */
const FLERSTALLE: ReadonlySet<number> = new Set(data.cfarnr);

export function delarOrgnr(cfarnr: number | null | undefined): boolean {
  return cfarnr != null && FLERSTALLE.has(cfarnr);
}
