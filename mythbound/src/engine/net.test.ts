import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVER, healthUrl, httpBase, serverUrl } from './net';

describe('server addresses', () => {
  it('accepts the address however it was typed', () => {
    expect(serverUrl('')).toBe(DEFAULT_SERVER);
    expect(serverUrl('wss://mythbound-server.onrender.com/ws')).toBe('wss://mythbound-server.onrender.com/ws');
    expect(serverUrl('https://mythbound-server.onrender.com')).toBe('wss://mythbound-server.onrender.com/ws');
    expect(serverUrl('https://mythbound-server.onrender.com/')).toBe('wss://mythbound-server.onrender.com/ws');
    expect(serverUrl('mythbound-server.onrender.com')).toBe('wss://mythbound-server.onrender.com/ws');
    expect(serverUrl(' https://mythbound-server.onrender.com/health?x=1 ')).toBe('wss://mythbound-server.onrender.com/ws');
    expect(serverUrl('ws://localhost:8787/ws')).toBe('ws://localhost:8787/ws');
    expect(serverUrl('ftp://nope')).toBe(DEFAULT_SERVER);
  });
  it('finds the web and health addresses', () => {
    expect(httpBase('https://mythbound-server.onrender.com')).toBe('https://mythbound-server.onrender.com');
    expect(healthUrl('wss://mythbound-server.onrender.com/ws')).toBe('https://mythbound-server.onrender.com/health');
    expect(httpBase('ws://localhost:8787/ws')).toBe('http://localhost:8787');
  });
});
