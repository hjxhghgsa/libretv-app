console.log('typeof require(electron):', typeof require('electron'));
const e = require('electron');
console.log('keys:', Object.keys(e).slice(0, 8));
console.log('app type:', typeof e.app);
