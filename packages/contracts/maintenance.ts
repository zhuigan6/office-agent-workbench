export function certificateMaintenance(validTo:number,now=Date.now()) {
  if(!Number.isFinite(validTo)||!Number.isFinite(now))return {state:'unknown',daysRemaining:null,expiresAt:null};
  const remaining=validTo-now;
  return {state:remaining<=0?'expired':remaining<=21*86400000?'renew-soon':'valid',daysRemaining:Math.max(0,Math.ceil(remaining/86400000)),expiresAt:new Date(validTo).toISOString()};
}
