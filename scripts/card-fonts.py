#!/usr/bin/env python3
# Make the generated card's fonts (assets/fonts/, D55): static TTF instances of the dashboard's own variable fonts
# (the @fontsource-variable devDependencies, Latin subset, SIL OFL 1.1), because resvg wants plain TrueType and
# draws a variable font at its default instance. One weight each keeps the package small.
#
#   python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli
#   /tmp/ft/bin/python scripts/card-fonts.py
#
# The output is committed; run this again only to change a face or a weight.
import os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SRC = 'node_modules/@fontsource-variable'
OUT = 'assets/fonts'

FACES = [
    # (source, axes, family name, output file)
    ('fraunces/files/fraunces-latin-opsz-normal.woff2', {'opsz': 48, 'wght': 600}, 'Fraunces', 'Fraunces-SemiBold.ttf'),
    ('inter/files/inter-latin-opsz-normal.woff2', {'opsz': 14, 'wght': 500}, 'Inter', 'Inter-Medium.ttf'),
    ('jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', {'wght': 400}, 'JetBrains Mono', 'JetBrainsMono-Regular.ttf'),
]

os.makedirs(OUT, exist_ok=True)
for src, axes, family, out in FACES:
    font = TTFont(os.path.join(SRC, src))
    font = instantiateVariableFont(font, axes)
    font.flavor = None  # woff2 → plain TrueType
    for rec in font['name'].names:
        # one face per family, so resvg finds it by family name alone (weight and style are left to synthesis)
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID in (2, 17):
            rec.string = 'Regular'
        elif rec.nameID == 4:
            rec.string = family
        elif rec.nameID == 6:
            rec.string = family.replace(' ', '') + '-Regular'
    font['OS/2'].usWeightClass = 400
    font.save(os.path.join(OUT, out))
    print(out, os.path.getsize(os.path.join(OUT, out)))
