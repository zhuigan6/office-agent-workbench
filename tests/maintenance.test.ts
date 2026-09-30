import {test} from 'node:test';
import assert from 'node:assert/strict';
import {certificateMaintenance} from '../packages/contracts/maintenance.ts';
test('certificate maintenance warns before expiration without claiming automatic renewal',()=>{
  const now=Date.UTC(2026,8,28),day=86400000;
  assert.equal(certificateMaintenance(now+22*day,now).state,'valid');
  assert.equal(certificateMaintenance(now+21*day,now).state,'renew-soon');
  assert.equal(certificateMaintenance(now+1000,now).daysRemaining,1);
  assert.equal(certificateMaintenance(now,now).state,'expired');
  assert.equal(certificateMaintenance(now-day,now).daysRemaining,0);
  assert.equal(certificateMaintenance(NaN,now).state,'unknown');
});
