// What a hero wears: their class's own clothes and their role's colours.
// Pure: the engine (player.ts) builds the model from the look.

import type { ClassId, RoleId, SubclassId } from '../data/defs';

export type Build = 'heavy' | 'light' | 'robe' | 'gi';
export type HeadLook = 'helmet' | 'hood' | 'hat' | 'bare' | 'mask' | 'plume' | 'crown';
export type Look = { armor: number; cloth: number; accent: number; build: Build; head: HeadLook; cape?: number; headband?: number; circlet?: number };

/** Each class's clothes; the newer classes dress for their subclass. */
export function classLook(classId: ClassId, subclassId: SubclassId | null | undefined): Look {
  switch (classId) {
    case 'warrior':
      return { armor: 0x7a7468, cloth: 0x4a3a2a, accent: 0xb0904a, build: 'heavy', head: 'helmet', cape: 0x5a1a14 };
    case 'ranger':
      return { armor: 0x4a5a3a, cloth: 0x2e3a26, accent: 0x8a7a4a, build: 'light', head: 'hood', cape: 0x2a3a22 };
    case 'mage':
      return { armor: 0x3a2e5a, cloth: 0x2a2244, accent: 0xc0a050, build: 'robe', head: 'hat' };
    case 'monk':
      // A gi (its trousers take `armor`), a sash and a headband in the sash's colour.
      return subclassId === 'windwalker'
        ? { armor: 0x4a5a64, cloth: 0xd6d2c2, accent: 0x2f8a86, build: 'gi', head: 'bare', headband: 0x2f8a86 }
        : subclassId === 'ironfist'
          ? { armor: 0x3a2a20, cloth: 0x8a4420, accent: 0x161412, build: 'gi', head: 'bare', headband: 0x161412 }
          : { armor: 0x4a3424, cloth: 0xc0702a, accent: 0x8a1c18, build: 'gi', head: 'bare', headband: 0x8a1c18 };
    case 'sorcerer':
      return subclassId === 'lightmage'
        ? { armor: 0xd8cfa8, cloth: 0xe6dec8, accent: 0xe0b84a, build: 'robe', head: 'bare', circlet: 0xe0b84a }
        : { armor: 0x2a1c3a, cloth: 0x1c1426, accent: 0x8a4ad8, build: 'robe', head: 'hood' };
    case 'rogue':
      // Dark leathers, a hood and a mask; a duelist shows a little more colour.
      return subclassId === 'duelist'
        ? { armor: 0x3a2622, cloth: 0x241a1a, accent: 0xb08a4a, build: 'light', head: 'mask', cape: 0x5a1418 }
        : { armor: 0x262224, cloth: 0x161418, accent: 0x6a5e50, build: 'light', head: 'mask' };
  }
}

/** A role's colours over the class's clothes: a knight's pale steel, an assassin's black. */
export function roleTint(look: Look, classId: ClassId, roleId: RoleId): Look {
  if (roleId === 'knight') {
    look.armor = 0xc8c0a8;
    look.accent = 0xffe080;
    if (look.build !== 'gi') look.cape = 0xb8ae94;
  }
  if ((roleId === 'assassin' || roleId === 'darkslayer') && classId !== 'rogue') {
    look.cloth = 0x18161a;
    if (look.build !== 'gi') look.cape = 0x101012;
    if (classId !== 'warrior' && look.build !== 'gi') look.armor = 0x24222a;
  }
  return look;
}

/** A hero's own clothes before the wardrobe: class, subclass and role. */
export const baseLook = (classId: ClassId, subclassId: SubclassId | null | undefined, roleId: RoleId): Look =>
  roleTint(classLook(classId, subclassId), classId, roleId);
