# A1 (optional — only if you want to redo it)
node translate.cjs pl_50k.txt a1 700 --offset=0
node merge_synonyms.cjs --file=a1_translated.csv
node seed_vocabulary.cjs --file=a1_translated_merged.csv --level=a1

# A2
node translate.cjs pl_50k.txt a2 2000 --offset=700
node merge_synonyms.cjs --file=a2_translated.csv
node seed_vocabulary.cjs --file=a2_translated_merged.csv --level=a2

# B1
node translate.cjs pl_50k.txt b1 3000 --offset=2700
node merge_synonyms.cjs --file=b1_translated.csv
node seed_vocabulary.cjs --file=b1_translated_merged.csv --level=b1

# B2
node translate.cjs pl_50k.txt b2 5000 --offset=5700
node merge_synonyms.cjs --file=b2_translated.csv
node seed_vocabulary.cjs --file=b2_translated_merged.csv --level=b2

# C1
node translate.cjs pl_50k.txt c1 10000 --offset=10700
node merge_synonyms.cjs --file=c1_translated.csv
node seed_vocabulary.cjs --file=c1_translated_merged.csv --level=c1
