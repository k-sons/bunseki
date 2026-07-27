
with open('src/data/examples.js', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace('!@#$', 'backticks')
c = c.replace('\\\\\\', '\\')
c = c.replace('\\\\\\$', '\\$')
c = c.replace('}\\', '}')
with open('src/data/examples.js', 'w', encoding='utf-8') as f:
    f.write(c)

