/**
 * The route once built Codex labels as `window_minutes / 60` + "h", so the
 * weekly 10,080-minute window read "168h limit".
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { rateWindowLabel } from '../src/http/usage-routes';

test('rate window labels use the largest whole unit', () => {
  assert.equal(rateWindowLabel(300), '5h');
  assert.equal(rateWindowLabel(10_080), '7d');
  assert.equal(rateWindowLabel(1440), '1d');
  assert.equal(rateWindowLabel(90), '90m');
  assert.equal(rateWindowLabel(2160), '36h');
});
