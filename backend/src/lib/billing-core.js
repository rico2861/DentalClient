// Facturation automatique d'un acte : facture attribuée au médecin, remise éventuelle, paiement immédiat éventuel (reçu + caisse).
// À appeler dans une transaction (client c). Montants en HTG.
import crypto from 'crypto'
const NUM = /^\d{1,10}(\.\d{1,2})?$/, c100 = v => Math.round(Number(v || 0) * 100)
// Modes de paiement acceptés ; ceux qui laissent une trace exigent une référence (n° de transaction, de virement, de chèque)
export const METHODS = ['espèces', 'MonCash', 'NatCash', 'virement', 'carte', 'chèque', 'Autre'], NEED_REF = ['MonCash', 'NatCash', 'virement', 'chèque']
export const payProblem = ({ paid, method, reference }) => { if (!(Number(paid) > 0)) return null; const m = String(method || 'espèces'); if (!METHODS.includes(m)) return 'Mode de paiement inconnu'
  if (NEED_REF.includes(m) && !String(reference || '').trim()) return `Référence obligatoire pour un paiement par ${m} (n° de transaction, de virement ou de chèque)`; return null }
// Schéma dentaire synchronisé : après un soin sur des dents précises, l'état de ces dents est mis à jour automatiquement
const STATE_OF = [[/extraction|extraite|avulsion/i, 'extraite'], [/implant/i, 'implant'], [/bridge|pont/i, 'bridge'], [/couronne|prothèse fixe/i, 'couronne'], [/restaur|obtur|composite|amalgame|carie|inlay|onlay/i, 'restauree']]
export const stateFor = label => (STATE_OF.find(([re]) => re.test(label || '')) || [])[1] || null
export async function syncTeeth(c, { clinicId, patientId, teeth, label, doctorId }) {
  const st = stateFor(label); if (!st || !teeth?.length) return []
  const cur = new Map((await c.query('select distinct on (tooth_fdi) tooth_fdi,state from tooth_states where patient_id=$1 order by tooth_fdi, recorded_at desc', [patientId])).rows.map(r => [r.tooth_fdi, r.state])), out = []
  for (const n of teeth) if (cur.get(n) !== st && cur.get(n) !== 'absente') { await c.query('insert into tooth_states(clinic_id,patient_id,tooth_fdi,state,note,doctor_id) values($1,$2,$3,$4,$5,$6)', [clinicId, patientId, n, st, 'Mis à jour après : ' + String(label).slice(0, 200), doctorId]); out.push(n) }
  return out }
// Rémunération : tout employé (et tout compte autre que le propriétaire) a un salaire fixe, un pourcentage, ou les deux
export const payPlan = b => { const base = Number(String(b.base_salary ?? '').replace(/\s/g, '').replace(',', '.') || 0), pct = Number(String(b.commission_pct ?? '').replace(',', '.') || 0), t = b.pay_type
  if (!(base >= 0) || !(pct >= 0) || pct > 100 || !/^\d{0,10}(\.\d{0,2})?$/.test(String(base))) return { err: 'Montant ou pourcentage invalide (0 à 100 %)' }
  if (t === 'fixe' && !(base > 0)) return { err: 'Indiquez le salaire fixe mensuel' }
  if (t === 'pourcentage' && !(pct > 0)) return { err: 'Indiquez le pourcentage (commission sur les actes)' }
  if (t === 'mixte' && !(base > 0 && pct > 0)) return { err: 'Rémunération mixte : indiquez le salaire fixe et le pourcentage' }
  if (!(base > 0 || pct > 0)) return { err: 'Rémunération obligatoire : un salaire fixe, un pourcentage, ou les deux' }
  return { base: t === 'pourcentage' ? 0 : base, pct: t === 'fixe' ? 0 : pct } }
export const validAmounts = ({ amount, discount, paid }) => {
  for (const v of [amount, discount, paid]) if (v !== undefined && v !== null && v !== '' && !NUM.test(String(v))) return 'Montant invalide'
  const a = c100(amount), d = c100(discount), p = c100(paid)
  if (d > a) return 'La réduction dépasse le montant'
  if (p > a - d) return 'Le montant payé dépasse le total à payer'
  return null }
export async function billService(c, { clinicId, patientId, doctorId, userId, description, amount, discount, paid, method, reference = null, consultationId = null, planId = null, planItemId = null }) {
  const a = c100(amount)
  let d = c100(discount)
  // Remise par patient : si aucune remise explicite n'est saisie, appliquer la remise
  // par défaut du patient (pourcentage) à TOUS ses actes.
  if ((discount === undefined || discount === null || discount === '') && patientId) {
    const pct = Number((await c.query('select discount_percent from patients where id=$1', [patientId])).rows[0]?.discount_percent || 0)
    if (pct > 0) d = Math.min(a, Math.round(a * pct / 100))
  }
  const p = c100(paid), total = a - d
  if (a <= 0) return null
  const seq = (await c.query("select nextval('invoice_seq') n")).rows[0].n, number = `FAC-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`
  const { rows: [inv] } = await c.query(`insert into invoices(clinic_id,kind,number,patient_id,currency,subtotal,discount,total,created_by,doctor_id,consultation_id,plan_id,plan_item_id)
    values($1,'invoice',$2,$3,'HTG',$4,$5,$6,$7,$8,$9,$10,$11) returning id,number`, [clinicId, number, patientId, a / 100, d / 100, total / 100, userId, doctorId, consultationId, planId, planItemId])
  await c.query('insert into invoice_items(invoice_id,description,qty,unit_price,line_total) values($1,$2,1,$3,$3)', [inv.id, description || 'Acte dentaire', a / 100])
  let receipt = null
  if (p > 0) {
    const rn = `REC-${new Date().getFullYear()}-${String((await c.query("select nextval('receipt_seq') n")).rows[0].n).padStart(5, '0')}`
    receipt = (await c.query(`insert into payments(clinic_id,invoice_id,receipt_number,amount,currency,applied_amount,amount_htg,method,idempotency_key,created_by,reference)
      values($1,$2,$3,$4,'HTG',$4,$4,$5,$6,$7,$8) returning id,receipt_number`, [clinicId, inv.id, rn, p / 100, String(method || 'espèces').slice(0, 30), crypto.randomUUID(), userId, reference ? String(reference).slice(0, 80) : null])).rows[0]
    await c.query("select cash_post_m($1,'HTG','in',$2,$3,$4,'payment',$5,$6,$7)", [clinicId, p / 100, rn, 'Paiement ' + number, receipt.id, userId, String(method || 'espèces').slice(0, 30)])   // compte selon le mode de paiement
  }
  return { invoice_id: inv.id, number: inv.number, amount: a / 100, discount: d / 100, total: total / 100, paid: p / 100, balance: (total - p) / 100, receipt_id: receipt?.id ?? null, receipt_number: receipt?.receipt_number ?? null }
}
// Commissions : taux de l'employé relié au médecin × montants encaissés sur ses actes (paiements de la période, hors annulés)
export const COMMISSION_SQL = `select u.id,u.first_name||' '||u.last_name doctor,u.role,coalesce(e.commission_pct,0)::float8 pct,e.id employee_id,(select commission_basis from clinics where id=$1) basis,
  (select count(*) from invoices i where i.doctor_id=u.id and i.status<>'cancelled' and i.kind='invoice' and i.created_at>=$2::date and i.created_at<($2::date+interval '1 month'))::int services,
  (select count(distinct i.patient_id) from invoices i where i.doctor_id=u.id and i.status<>'cancelled' and i.kind='invoice' and i.created_at>=$2::date and i.created_at<($2::date+interval '1 month'))::int patients,
  (select coalesce(sum(i.total * case when i.currency='USD' then coalesce(i.rate_htg_per_usd,0) else 1 end),0) from invoices i where i.doctor_id=u.id and i.status<>'cancelled' and i.kind='invoice' and i.created_at>=$2::date and i.created_at<($2::date+interval '1 month'))::float8 billed,
  (select coalesce(sum(y.amount_htg),0) from payments y join invoices i on i.id=y.invoice_id where i.doctor_id=u.id and y.voided_at is null and y.created_at>=$2::date and y.created_at<($2::date+interval '1 month'))::float8 collected
  from users u left join employees e on e.user_id=u.id where u.clinic_id=$1 and u.status='active' and u.role in ('DENTIST','OWNER','ADMIN_MEDICAL','ADMIN') `
// Un médecin simple (rôle DENTIST) ne peut jamais attribuer un acte à un autre médecin : c'est toujours lui.
// La direction (propriétaire, administrateurs) et l'accueil peuvent choisir ; par défaut, c'est l'utilisateur connecté.
export const lockedDoctor = req => req.user.role === 'DENTIST'
export const actingDoctor = (req, wanted) => lockedDoctor(req) ? req.user.id : (/^[0-9a-f-]{36}$/i.test(wanted || '') ? wanted : req.user.id)
export const withCommission = r => ({ ...r, commission: Math.round((r.basis === 'billed' ? r.billed : r.collected) * r.pct) / 100 })
