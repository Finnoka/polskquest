node translate.cjs pl_50k.txt a1  700  --offset=0
node translate.cjs pl_50k.txt a2  1300 --offset=700
node translate.cjs pl_50k.txt b1  1000 --offset=2000
node translate.cjs pl_50k.txt b2  2000 --offset=3000
node translate.cjs pl_50k.txt c1  5000 --offset=5000

node seed_vocabulary.cjs --file=a1_translated.csv --level=a1
node seed_vocabulary.cjs --file=a2_translated.csv --level=a2
node seed_vocabulary.cjs --file=b1_translated.csv --level=b1
node seed_vocabulary.cjs --file=b2_translated.csv --level=b2
node seed_vocabulary.cjs --file=c1_translated.csv --level=c1
