import type { Food } from "./rx";

/**
 * Medicines the doctor prescribes most, with the usual course. Any other name can still be typed in.
 * `penicillin` marks drugs that clash with a recorded penicillin allergy; `swap` is the usual alternative.
 */
export type Drug = { name: string; generic: string; dose: string; days: number; food: Food; penicillin?: boolean; swap?: string };

export const DRUGS: Drug[] = [
  { name: "Zerodol P", generic: "Aceclofenac 100 mg + paracetamol 325 mg · tablet", dose: "1-0-1", days: 5, food: "after" },
  { name: "Pan 40", generic: "Pantoprazole 40 mg · tablet", dose: "1-0-0", days: 5, food: "before" },
  { name: "Moxclav 625", generic: "Amoxicillin 500 mg + clavulanic acid 125 mg · tablet", dose: "1-0-1", days: 5, food: "after", penicillin: true, swap: "Azithral 500" },
  { name: "Mox 500", generic: "Amoxicillin 500 mg · capsule", dose: "1-1-1", days: 5, food: "after", penicillin: true, swap: "Azithral 500" },
  { name: "Azithral 500", generic: "Azithromycin 500 mg · tablet", dose: "1-0-0", days: 3, food: "after" },
  { name: "Metrogyl 400", generic: "Metronidazole 400 mg · tablet", dose: "1-1-1", days: 5, food: "after" },
  { name: "Ketorol DT", generic: "Ketorolac 10 mg · dispersible tablet", dose: "SOS", days: 3, food: "after" },
  { name: "Dolo 650", generic: "Paracetamol 650 mg · tablet", dose: "SOS", days: 3, food: "after" },
  { name: "Hexidine mouthwash", generic: "Chlorhexidine 0.2% · rinse 10 ml", dose: "1-0-1", days: 7, food: "after" },
];

export const DRUG_SETS: Record<string, string[]> = {
  "RCT pain set": ["Zerodol P", "Pan 40"],
  "Antibiotic + pain": ["Moxclav 625", "Zerodol P", "Pan 40"],
  "Post-extraction": ["Ketorol DT", "Hexidine mouthwash"],
};

export const findDrug = (name: string) => DRUGS.find((d) => d.name.toLowerCase() === name.trim().toLowerCase());

/** True when the patient's alerts record a penicillin allergy. */
export const penicillinAllergy = (alerts: string[]) => alerts.some((a) => /penicillin|amoxi/i.test(a));
