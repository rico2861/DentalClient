// Points d'attention et recommandations calculés à partir du dossier (affichés à l'écran et dans la fiche PDF).
// Ce sont des rappels d'usage courant pour le praticien, pas des prescriptions.
const months = d => (Date.now() - new Date(d)) / (30.44 * 864e5)
export function advice({ h = {}, teeth = [], consults = [], upcoming = 0, exam = null }) {
  const alerts = [], todo = [], st = new Map(teeth.map(t => [t.tooth_fdi, t.state]))
  const A = (level, title, text) => alerts.push({ level, title, text }), T = (icon, text, tab) => todo.push({ icon, text, tab })
  const al = (h.allergies || '').trim()
  if (al && !/^(aucune?|non|néant|-)$/i.test(al)) {
    const tips = []
    if (/p[ée]nicill|amoxi/i.test(al)) tips.push('éviter les pénicillines (amoxicilline…) et prévoir une alternative')
    if (/anesth|lido|artica/i.test(al)) tips.push('vérifier la molécule anesthésique, avis allergologique avant tout acte')
    if (/latex/i.test(al)) tips.push('gants et matériel sans latex')
    if (/aspirin|ains|anti-?inflam|ibupro/i.test(al)) tips.push('éviter aspirine et AINS, préférer le paracétamol')
    if (/iode|b[ée]tadine/i.test(al)) tips.push('éviter les antiseptiques iodés, utiliser la chlorhexidine')
    A('danger', 'Allergies : ' + al, tips.length ? tips.join(' ; ') + '.' : 'Vérifier chaque produit avant prescription ou utilisation.')
  }
  if (h.hemophilia) A('danger', 'Risque hémorragique (hémophilie)', "Avis de l'hématologue avant tout acte sanglant ; hémostase locale renforcée.")
  const bp = String(h.blood_pressure || '').match(/(\d{2,3})\s*[/-]\s*(\d{1,3})/)
  if (bp) { let s = +bp[1], d = +bp[2]; if (s < 30) { s *= 10; d *= 10 }
    if (s >= 160 || d >= 100) A('danger', `Tension élevée (${h.blood_pressure})`, 'Reporter les actes non urgents et orienter vers un contrôle médical.')
    else if (s >= 140 || d >= 90) A('warn', `Tension limite (${h.blood_pressure})`, 'Recontrôler la tension avant les actes longs ou chirurgicaux.') }
  if (h.cardiovascular) A('warn', 'Maladie cardiovasculaire', 'Limiter les vasoconstricteurs, contrôler la tension, vérifier un éventuel traitement anticoagulant.')
  if (h.diabetes) A('warn', 'Diabète', 'Contrôler la glycémie avant les actes chirurgicaux ; cicatrisation plus lente et risque infectieux accru.')
  if (h.pregnancy) A('warn', 'Grossesse', 'Éviter les radiographies non urgentes ; le 2e trimestre est le plus favorable aux soins.')
  if (h.cancer) A('warn', 'Antécédent de cancer', "Vérifier radiothérapie cervico-faciale ou bisphosphonates avant toute extraction (risque d'ostéonécrose).")
  if (h.epilepsy) A('warn', 'Épilepsie', "Séances courtes, limiter le stress ; l'équipe doit connaître la conduite à tenir en cas de crise.")
  if (h.hiv) A('info', 'VIH / Sida', 'Précautions standard ; tenir compte du traitement en cours (interactions médicamenteuses).')
  if (h.pulmonary) A('info', 'Maladie pulmonaire', 'Position semi-assise si gêne respiratoire ; prudence avec les sédatifs.')
  if (h.stomach) A('info', "Problème d'estomac", 'Éviter les AINS, préférer le paracétamol.')
  if (h.smoking) A('info', 'Tabagisme', "Risque parodontal et d'échec implantaire accru : conseiller l'arrêt.")
  if (h.alcohol) A('info', "Consommation d'alcool", 'Risque hémorragique et interactions médicamenteuses.')

  const list = s => [...st].filter(([, v]) => v === s).map(([n]) => n).sort((a, b) => a - b)
  const car = list('carie'), ext = list('a_extraire'), ano = list('anomalie')
  if (car.length) T('tooth', `${car.length} dent(s) cariée(s) à soigner : ${car.join(', ')}.`, 'dents')
  if (ext.length) T('alert', `${ext.length} dent(s) à extraire : ${ext.join(', ')}.`, 'dents')
  if (ano.length) T('eye', `Anomalie à surveiller sur : ${ano.join(', ')}.`, 'dents')
  if (/^(II|III)$/.test(h.scaling_grade || '')) T('zap', `Tartre de grade ${h.scaling_grade} : détartrage à prévoir.`, 'interventions')
  if (/rarement|1 fois/i.test(h.brushing || '')) T('heart', 'Hygiène insuffisante : conseiller 2 brossages par jour et le fil dentaire.', 'fiche')
  const last = consults[0]?.consulted_at
  if (!last) T('activity', 'Aucune intervention enregistrée : réaliser un examen complet.', 'interventions')
  else if (months(last) >= 6) T('calendar', `Dernière visite il y a ${Math.floor(months(last))} mois : contrôle et détartrage recommandés.`, 'rendez-vous')
  if (!upcoming) T('calendar', 'Aucun rendez-vous prévu : planifier le prochain contrôle.', 'rendez-vous')
  const filled = Object.values(h).some(v => v === true || (typeof v === 'string' && v.trim()))
  if (!filled) T('clipboard', 'Histoire médicale non renseignée : compléter la fiche diagnostique.', 'fiche')
  else { if (!h.blood_group) T('clipboard', 'Groupe sanguin non renseigné.', 'fiche'); if (!al) T('clipboard', 'Allergies non renseignées (indiquer « Aucune » si absentes).', 'fiche') }
  if (!exam) T('search', 'Examen stomatologique jamais réalisé.', 'fiche')
  if (!st.size) T('tooth', 'Schéma dentaire non rempli.', 'dents')
  return { alerts, todo }
}
