import { expect, it } from 'vitest';
import { parseDemoAccounts, passwordFor } from './demo';

const env = { VITE_DEMO_PASSWORD: 'shared-pass', VITE_ADMIN_DEMO_PASSWORD: ' admin-pass ' };

it('reads role:email pairs and labels them', () => {
  expect(parseDemoAccounts(' admin:a@x.com , trustee:t@x.com ', env)).toEqual([
    { role: 'admin', label: 'Admin', email: 'a@x.com', password: 'admin-pass' },
    { role: 'trustee', label: 'Trustee', email: 't@x.com', password: 'shared-pass' },
  ]);
});

it('uses a role-specific password when one is set, otherwise the shared one', () => {
  expect(passwordFor('admin', env)).toBe('admin-pass');
  expect(passwordFor('field_agent', env)).toBe('shared-pass');
  expect(passwordFor('field_agent', { VITE_FIELD_AGENT_DEMO_PASSWORD: 'own' })).toBe('own');
});

it('skips accounts without a password', () => {
  expect(
    parseDemoAccounts('admin:a@x.com,trustee:t@x.com', { VITE_ADMIN_DEMO_PASSWORD: 'x' }),
  ).toHaveLength(1);
});

it('skips unknown roles, missing emails and blanks', () => {
  expect(
    parseDemoAccounts('wizard:w@x.com,field_agent:,cycle_manager:not-an-email,,', env),
  ).toEqual([]);
});

it('tells apart several accounts with the same role by email', () => {
  expect(
    parseDemoAccounts(
      'investor:investor@x.com,investor:investor.retail@x.com,admin:a@x.com',
      env,
    ).map((a) => a.label),
  ).toEqual(['Investor (investor)', 'Investor (investor.retail)', 'Admin']);
});
