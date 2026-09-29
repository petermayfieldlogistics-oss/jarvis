import { describe, expect, it } from 'vitest';
import {
  parseLorcanaPrints,
  parseMagicPrints,
  parseNames,
  parseOnePieceIds,
  parseScan,
  parseSlashNumbers,
  parseYugiohPasscodes,
  parseYugiohSetCodes,
} from './parse';

describe('parseOnePieceIds', () => {
  it('reads standard set, starter deck, extra booster and promo ids', () => {
    expect(parseOnePieceIds('SR OP01-120 CHARACTER')).toEqual(['OP01-120']);
    expect(parseOnePieceIds('ST10-002')).toEqual(['ST10-002']);
    expect(parseOnePieceIds('eb01-012')).toEqual(['EB01-012']);
    expect(parseOnePieceIds('PRB01-001')).toEqual(['PRB01-001']);
    expect(parseOnePieceIds('P-041 PROMO')).toEqual(['P-041']);
  });

  it('repairs common OCR confusions', () => {
    expect(parseOnePieceIds('0P0l-O25')).toEqual(['OP01-025']);
    expect(parseOnePieceIds('OP05 — 119')).toEqual(['OP05-119']);
    expect(parseOnePieceIds('5T01-012')).toEqual(['ST01-012']);
  });

  it('does not mistake ordinary words for ids', () => {
    expect(parseOnePieceIds('STOLISZ the pirate')).toEqual([]);
    expect(parseOnePieceIds('POP - SOB')).toEqual([]);
  });
});

describe('parseSlashNumbers', () => {
  it('reads Pokémon collector numbers', () => {
    expect(parseSlashNumbers('G SVI EN 025/198')).toEqual([{ number: '025', total: '198' }]);
    expect(parseSlashNumbers('4/102 ★')).toEqual([{ number: '4', total: '102' }]);
    expect(parseSlashNumbers('2l0/l98')).toEqual([{ number: '210', total: '198' }]);
  });

  it('reads subset and promo numbering', () => {
    expect(parseSlashNumbers('TG05/TG30')).toEqual([{ number: 'TG05', total: 'TG30' }]);
    expect(parseSlashNumbers('SWSH050')).toEqual([{ number: 'SWSH050' }]);
  });

  it('ignores implausible numbers', () => {
    expect(parseSlashNumbers('1/2 cup')).toEqual([]);
    expect(parseSlashNumbers('900/12')).toEqual([]);
  });
});

describe('parseMagicPrints', () => {
  it('reads the modern two-line collector block', () => {
    expect(parseMagicPrints('0123 R\nMOM • EN ✎ Artist Name')).toEqual([{ set: 'mom', number: '123' }]);
    expect(parseMagicPrints('0079 U\nWOE * EN')).toEqual([{ set: 'woe', number: '79' }]);
  });

  it('reads the 2014–2022 style with a set total', () => {
    expect(parseMagicPrints('146/280 M\nDOM - EN')).toEqual([{ set: 'dom', number: '146' }]);
  });

  it('copes with a missing bullet', () => {
    expect(parseMagicPrints('0254 C\nSPM EN')).toEqual([{ set: 'spm', number: '254' }]);
  });

  it('falls back to just a number when no set code is readable', () => {
    expect(parseMagicPrints('0254 C')).toEqual([{ number: '254' }]);
  });
});

describe('parseNames', () => {
  it('strips Pokémon stage and HP noise', () => {
    expect(parseNames('BASIC Pikachu HP 60 @')[0]).toBe('Pikachu');
    expect(parseNames('STAGE 1 Raichu Evolves from Pikachu\nHP 120')[0]).toBe('Raichu');
    expect(parseNames('BASIC Charizard ex HP330')[0]).toBe('Charizard ex');
  });

  it('keeps punctuation-bearing Magic names and drops mana symbol junk', () => {
    expect(parseNames('Jace, the Mind Sculptor @ @ ®')[0]).toBe('Jace the Mind Sculptor');
    expect(parseNames('~ = @ %\nLightning Bolt ®')[0]).toBe('Lightning Bolt');
  });

  it('returns nothing for pure noise', () => {
    expect(parseNames('~ = @ % |\n1 2 3')).toEqual([]);
  });
});

describe('parseScan game detection', () => {
  it('spots One Piece cards', () => {
    const h = parseScan('', 'OP01-120 ©EIICHIRO ODA/SHUEISHA');
    expect(h.gameGuesses[0]).toBe('onepiece');
    expect(h.onePieceIds).toEqual(['OP01-120']);
  });

  it('spots Pokémon cards', () => {
    const h = parseScan('BASIC Pikachu HP 60', 'SVI EN 025/198 ©2023 Pokémon/Nintendo/Creatures/GAME FREAK');
    expect(h.gameGuesses[0]).toBe('pokemon');
    expect(h.pokemonNumbers).toEqual([{ number: '025', total: '198' }]);
    expect(h.names[0]).toBe('Pikachu');
  });

  it('spots Magic cards', () => {
    const h = parseScan('Lightning Bolt', '0123 R\nMOM • EN\n™ & © 2023 Wizards of the Coast');
    expect(h.gameGuesses[0]).toBe('magic');
    expect(h.magicPrints[0]).toEqual({ set: 'mom', number: '123' });
  });
});

describe('mergeHints', () => {
  it('combines two reads without duplicates', async () => {
    const { mergeHints } = await import('./parse');
    const a = parseScan('BASIC Pikachu HP 60', '025/198');
    const b = parseScan('', '025/198 ©Pokémon/Nintendo');
    const m = mergeHints(a, b);
    expect(m.pokemonNumbers).toEqual([{ number: '025', total: '198' }]);
    expect(m.names[0]).toBe('Pikachu');
    expect(m.gameGuesses[0]).toBe('pokemon');
  });
});

describe('parseNames ranking', () => {
  it('prefers a short Title Case line over rules text', () => {
    const text = 'Flip a coin. If tails, this Pokémon also does 10 damage to itself.\nPikachu\nweakness resistance retreat';
    expect(parseNames(text)[0]).toBe('Pikachu');
  });

  it('skips type lines', () => {
    expect(parseNames('Instant\nLightning Bolt')[0]).toBe('Lightning Bolt');
    expect(parseNames('Legendary Creature — Elf Druid\nSelvala, Heart of the Wilds')[0]).toBe('Selvala Heart of the Wilds');
    expect(parseNames('CHARACTER\nSanji')[0]).toBe('Sanji');
  });

  it('offers the name without a misread leading label', () => {
    expect(parseNames('Pree Pikachu')).toEqual(['Pree Pikachu', 'Pikachu']);
  });
});

describe('Yu-Gi-Oh! codes', () => {
  it('reads set codes with and without a region', () => {
    expect(parseYugiohSetCodes('LOB-EN001')).toEqual(['LOB-EN001']);
    expect(parseYugiohSetCodes('RA01 - EN054 1st Edition')).toEqual(['RA01-EN054']);
    expect(parseYugiohSetCodes('SDK-00l')).toEqual(['SDK-001']);
    expect(parseYugiohSetCodes('LOB-E001')).toEqual(['LOB-E001']);
  });

  it('does not treat One Piece ids as set codes', () => {
    expect(parseYugiohSetCodes('OP01-001 ST10-002')).toEqual([]);
  });

  it('reads passcodes and repairs OCR slips', () => {
    expect(parseYugiohPasscodes('89631139 1st Edition')).toEqual(['89631139']);
    expect(parseYugiohPasscodes('8963ll39')).toEqual(['89631139']);
    expect(parseYugiohPasscodes('©2020 Studio Dice/SHUEISHA, TV TOKYO, KONAMI')).toEqual([]);
  });
});

describe('Lorcana codes', () => {
  it('reads the collector line', () => {
    expect(parseLorcanaPrints('12/204 • EN • 3')).toEqual([{ number: '12', total: '204', set: '3' }]);
    expect(parseLorcanaPrints('207/204 · EN · 1 Enchanted')).toEqual([{ number: '207', total: '204', set: '1' }]);
    expect(parseLorcanaPrints('5/P1 • EN • P1')).toEqual([{ number: '5', total: 'P1', set: 'P1' }]);
    expect(parseLorcanaPrints('l2/204 EN 3')).toEqual([{ number: '12', total: '204', set: '3' }]);
  });

  it('ignores Pokémon numbers', () => {
    expect(parseLorcanaPrints('SVI EN 025/198')).toEqual([]);
  });
});

describe('game detection for the new games', () => {
  it('spots Yu-Gi-Oh! cards', () => {
    const h = parseScan('Blue-Eyes White Dragon', 'LOB-EN001\n89631139 ©1996 KAZUKI TAKAHASHI ©2020 Studio Dice/SHUEISHA, TV TOKYO, KONAMI');
    expect(h.gameGuesses[0]).toBe('yugioh');
    expect(h.yugiohSetCodes).toEqual(['LOB-EN001']);
    expect(h.yugiohPasscodes).toEqual(['89631139']);
  });

  it('spots Lorcana cards even though the number looks like a Pokémon one', () => {
    const h = parseScan('', '12/204 • EN • 3 ©Disney');
    expect(h.gameGuesses[0]).toBe('lorcana');
    expect(h.lorcanaPrints).toEqual([{ number: '12', total: '204', set: '3' }]);
  });
});

describe('fixes from the Yu-Gi-Oh!/Lorcana browser runs', () => {
  it('accepts letter-for-digit slips in set codes that have a region', () => {
    expect(parseYugiohSetCodes('LOB-ENOO1')).toEqual(['LOB-EN001']);
  });

  it('rejects star rows read as a passcode', () => {
    expect(parseYugiohPasscodes('00000000 89631139')).toEqual(['89631139']);
  });

  it('does not read a Yu-Gi-Oh! set code as a Magic set', () => {
    expect(parseMagicPrints('LOB-EN001')).toEqual([]);
  });

  it('joins a Lorcana character name with its version', () => {
    expect(parseNames('ELSA\nSpirit of Winter')).toContain('ELSA Spirit of Winter');
  });
});
