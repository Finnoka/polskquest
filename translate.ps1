# A2 — 2000 words
node translate.cjs pl_50k.txt a2 2000
node seed_vocabulary.cjs --file=a2_translated.csv --level=a2

# B1 — 3000 words
node translate.cjs pl_50k.txt b1 3000
node seed_vocabulary.cjs --file=b1_translated.csv --level=b1

# B2 — 5000 words
node translate.cjs pl_50k.txt b2 5000
node seed_vocabulary.cjs --file=b2_translated.csv --level=b2

# C1 — 10000 words
node translate.cjs pl_50k.txt c1 10000
node seed_vocabulary.cjs --file=c1_translated.csv --level=c1