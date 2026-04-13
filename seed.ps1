node -e "
const fs = require('fs');
const csv = fs.readFileSync('c1_translated.csv', 'utf-8').trim().split('\n').slice(1);
const stages = new Set(csv.map(l => l.split(',')[0]).map((_, i) => 'c1-s' + (Math.floor(i/50)+1)));
console.log([...stages]);
"