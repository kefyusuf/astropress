import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLICY, routeKey } from '../../src/security/interface/policy';

test('routeKey strips default "/" handler path → controller only', () => {
  assert.equal(routeKey('GET', 'sites', '/'), 'GET sites');
  assert.equal(routeKey('POST', 'sites', '/'), 'POST sites');
  assert.equal(routeKey('POST', 'builds', '/'), 'POST builds');
  assert.equal(routeKey('GET', 'builds', '/'), 'GET builds');
});

test('routeKey joins param handler paths', () => {
  assert.equal(routeKey('GET', 'sites', ':id'), 'GET sites/:id');
  assert.equal(routeKey('PUT', 'sites', ':id/locales'), 'PUT sites/:id/locales');
  assert.equal(routeKey('GET', 'builds', ':id'), 'GET builds/:id');
});

test('routeKey strips leading/trailing slashes on both segments', () => {
  assert.equal(routeKey('GET', '/sites/', '/:id/'), 'GET sites/:id');
});

test('POLICY maps GET reads to public', () => {
  assert.equal(POLICY['GET sites'], 'public');
  assert.equal(POLICY['GET sites/:id'], 'public');
  assert.equal(POLICY['GET builds'], 'public');
  assert.equal(POLICY['GET builds/:id'], 'public');
});

test('POLICY maps mutations to perms (builds POST → edit)', () => {
  assert.equal(POLICY['POST sites'], 'create');
  assert.equal(POLICY['PUT sites/:id/locales'], 'edit');
  assert.equal(POLICY['POST builds'], 'edit');
});

test('POLICY unmapped route → undefined (fail-closed)', () => {
  assert.equal(POLICY['DELETE sites/:id'], undefined);
  assert.equal(POLICY['POST unknown'], undefined);
});