import { describe, expect, it } from 'vitest';
import { CLASSES, ROLES, SUBCLASSES, type ClassId, type RoleId, type SubclassId } from '../data/defs';
import { baseLook } from './outfit';

const hex = (n: number | undefined) => (n === undefined ? undefined : `#${n.toString(16).padStart(6, '0')}`);

describe('class looks', () => {
  it('dresses every class, subclass and role as before', () => {
    const looks: Record<string, unknown> = {};
    for (const classId of Object.keys(CLASSES) as ClassId[]) {
      const subs: (SubclassId | null)[] = [null, ...(Object.values(SUBCLASSES).filter((s) => s.classId === classId).map((s) => s.id))];
      for (const sub of subs)
        for (const roleId of Object.keys(ROLES) as RoleId[]) {
          const l = baseLook(classId, sub, roleId);
          looks[`${classId}/${sub ?? '-'}/${roleId}`] = { ...l, armor: hex(l.armor), cloth: hex(l.cloth), accent: hex(l.accent), cape: hex(l.cape), headband: hex(l.headband), circlet: hex(l.circlet) };
        }
    }
    expect(looks).toMatchSnapshot();
  });
});
