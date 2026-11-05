#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 bria-bria
"""Checks the Italian table IT in extension/sch-i18n.js against the code.

- every sentence passed to _('...') in the code must be in IT;
- every sentence in IT must be used in the code (no useless entries);
- the {placeholders} of each Italian translation must match the English ones.
Exit code 0 = everything fine, 1 = problems found.
"""
import json
import pathlib
import re
import sys

EXT = pathlib.Path(__file__).resolve().parent.parent / 'extension'
I18N = EXT / 'sch-i18n.js'
SOURCES = [p for p in EXT.glob('*.js') if p.name != I18N.name]

# A JavaScript string literal in single or double quotes (no template strings)
STRING = r"""('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")"""


def js_string(literal):
    """Turns a JS string literal into its Python value."""
    body = literal[1:-1]
    out = []
    i = 0
    while i < len(body):
        c = body[i]
        if c == '\\' and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt in '\'"':
                out.append(nxt)          # \' or \" -> the quote itself
            else:
                out.append(json.loads(f'"\\{nxt}"') if nxt in 'nrtbf\\/' else nxt)
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def used_sentences():
    used = {}
    for path in SOURCES:
        text = path.read_text(encoding='utf-8')
        # _( followed by a string literal; flag _( followed by anything else
        for m in re.finditer(r'(?<![\w.])_\(\s*', text):
            rest = text[m.end():]
            lit = re.match(STRING, rest)
            line = text.count('\n', 0, m.start()) + 1
            if not lit:
                print(f'{path.name}:{line}: _() without a plain string literal')
                used.setdefault(None, []).append(f'{path.name}:{line}')
                continue
            used.setdefault(js_string(lit.group(1)), []).append(f'{path.name}:{line}')
    return used


def italian_table():
    text = I18N.read_text(encoding='utf-8')
    body = re.search(r'(?:export )?const IT = \{(.*?)\n\};', text, re.S).group(1)
    # drop comment lines, so quoted examples in comments are not read as entries
    body = '\n'.join(l for l in body.splitlines() if not l.lstrip().startswith('//'))
    pairs = re.findall(STRING + r'\s*:\s*' + STRING, body)
    return {js_string(k): js_string(v) for k, v in pairs}


def main():
    used = used_sentences()
    table = italian_table()
    problems = 0

    if None in used:
        problems += len(used.pop(None))
    for sentence, where in sorted(used.items()):
        if sentence not in table:
            print(f'MISSING in IT: {sentence!r}  (used in {", ".join(where)})')
            problems += 1
    for sentence, italian in table.items():
        if sentence not in used:
            print(f'UNUSED in IT: {sentence!r}')
            problems += 1
        if italian == '':
            print(f'EMPTY Italian translation: {sentence!r}')
            problems += 1
        if set(re.findall(r'\{\w+\}', sentence)) != set(re.findall(r'\{\w+\}', italian)):
            print(f'PLACEHOLDERS differ: {sentence!r} -> {italian!r}')
            problems += 1

    print(f'{len(used)} sentences used, {len(table)} in the Italian table, {problems} problems')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
