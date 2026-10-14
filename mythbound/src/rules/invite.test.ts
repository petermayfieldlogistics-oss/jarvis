import { describe, expect, it } from 'vitest';
import { inviteCode, inviteLink } from './invite';

describe('co-op invite links', () => {
  it('reads the room code from the link', () => {
    expect(inviteCode('?join=ABCDE')).toBe('ABCDE');
    expect(inviteCode('?join=abc12')).toBe('ABC12');
    expect(inviteCode('?x=1&join=%20ab-cd%20')).toBe('ABCD');
  });

  it('ignores a missing or unusable code', () => {
    expect(inviteCode('')).toBeNull();
    expect(inviteCode('?join=')).toBeNull();
    expect(inviteCode('?join=AB')).toBeNull();
    expect(inviteCode('?join=ABCDEFGHIJ')).toBeNull();
    expect(inviteCode('?room=ABCDE')).toBeNull();
  });

  it('builds a link on the game address, dropping its own query and hash', () => {
    expect(inviteLink('https://example.github.io/jarvis/mythbound/', 'ABCDE')).toBe('https://example.github.io/jarvis/mythbound/?join=ABCDE');
    expect(inviteLink('https://example.github.io/jarvis/mythbound/?join=OLD1#x', 'NEW22')).toBe('https://example.github.io/jarvis/mythbound/?join=NEW22');
  });

  it('round-trips: a built link reads back the same code', () => {
    expect(inviteCode(new URL(inviteLink('http://localhost:5173/', 'QX7RT')).search)).toBe('QX7RT');
  });
});
