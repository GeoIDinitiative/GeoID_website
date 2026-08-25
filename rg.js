(async()=>{const w=m=>new Promise(r=>setTimeout(r,m));
window.__flightSim.engage();await w(9000);
const g=i=>document.getElementById(i)?.textContent;
return JSON.stringify({body:window.__flightSimHooks.bodyId,pos:g("fs-coord"),region:g("fs-region-top")})})()
