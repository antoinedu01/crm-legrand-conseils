// Transforme les tests en échec d'un fichier TAP (node --test) en
// annotations GitHub Actions lisibles directement dans l'onglet « Checks »
// d'une pull request, sans avoir à ouvrir le journal complet.
import fs from 'fs';

const file = process.argv[2] || 'test-results.tap';
if (!fs.existsSync(file)) {
  console.log(`Aucun fichier ${file} : rien à annoter.`);
  process.exit(0);
}

const lines = fs.readFileSync(file, 'utf8').split('\n');
const failures = [];
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].match(/^(\s*)not ok \d+ - (.*)$/);
  if (!m) continue;
  const indent = m[1].length;
  const details = [];
  let j = i + 1;
  if (lines[j] && lines[j].trim() === '---') {
    j += 1;
    while (j < lines.length && lines[j].trim() !== '...') {
      details.push(lines[j].slice(indent + 2));
      j += 1;
    }
  }
  // Les fichiers de test eux-mêmes apparaissent aussi en « not ok » quand un
  // de leurs sous-tests échoue : on ne garde que les détails utiles.
  const text = details.join('\n');
  if (/failureType: 'subtestsFailed'/.test(text)) continue;
  failures.push({ name: m[2].trim(), text });
}

const escape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

// Totaux du rapport TAP (« # tests 412 », « # pass 412 »…) : toujours
// publiés en note, pour voir d'un coup d'œil combien de tests ont tourné.
const totals = {};
for (const line of lines) {
  const t = line.match(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/);
  if (t) totals[t[1]] = Number(t[2]);
}
if (totals.tests != null) {
  console.log(`::notice title=Tests::${totals.tests} tests — ${totals.pass ?? 0} réussis, ${totals.fail ?? 0} en échec, ${totals.skipped ?? 0} ignorés`);
}
for (const f of failures.slice(0, 10)) {
  console.log(`::error title=${escape(f.name).slice(0, 200)}::${escape(f.text.slice(0, 4000))}`);
}

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const body = failures
    .map((f) => `### ❌ ${f.name}\n\n\`\`\`\n${f.text.slice(0, 4000)}\n\`\`\`\n`)
    .join('\n');
  fs.appendFileSync(summary, `## Tests en échec (${failures.length})\n\n${body}\n`);
}
console.log(`${failures.length} test(s) en échec annoté(s).`);
