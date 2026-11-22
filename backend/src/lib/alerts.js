// Notifications automatiques : calculées périodiquement, une seule fois par sujet (clé de déduplication),
// adressées au rôle concerné (permission) : accueil, finances, soins, direction.
import { q } from '../db/pool.js'

const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }), month = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7)
const add = (cid, key, perm, kind, title, text) => q('insert into notifications(clinic_id,perm,kind,title,text,dedupe_key) values($1,$2,$3,$4,$5,$6) on conflict (clinic_id, dedupe_key) where dedupe_key is not null do nothing', [cid, perm, kind, title, text, key])
const list = (rows, f, n = 4) => rows.slice(0, n).map(f).join(', ') + (rows.length > n ? '…' : '')

export async function runAlerts() {
  const clinics = (await q('select id from clinics')).rows
  for (const { id: c } of clinics) {
    // rendez-vous de demain pas encore confirmés
    const tom = (await q("select a.id,p.last_name||' '||p.first_name patient,to_char(a.starts_at at time zone 'America/Port-au-Prince','HH24:MI') h from appointments a join patients p on p.id=a.patient_id where a.clinic_id=$1 and a.status='planned' and (a.starts_at at time zone 'America/Port-au-Prince')::date = (now() at time zone 'America/Port-au-Prince')::date + 1 order by a.starts_at", [c])).rows
    if (tom.length) await add(c, 'rdv_demain:' + day(), 'manage_appointments', 'appointments', `${tom.length} rendez-vous de demain à confirmer`, list(tom, r => `${r.h} ${r.patient}`))
    // rendez-vous manqués (absents) des dernières 24 h
    for (const r of (await q("select a.id,p.last_name||' '||p.first_name patient from appointments a join patients p on p.id=a.patient_id where a.clinic_id=$1 and a.status='no_show' and a.starts_at > now() - interval '1 day'", [c])).rows)
      await add(c, 'rdv_manque:' + r.id, 'manage_appointments', 'no_show', 'Rendez-vous manqué', `${r.patient} ne s'est pas présenté : un rappel de suivi a été créé.`)
    // factures impayées depuis plus de 30 jours / dettes anciennes (90 jours)
    const debts = (await q(`select i.id,i.number,p.last_name||' '||p.first_name patient,(current_date - i.created_at::date) age, i.total - coalesce((select sum(y.applied_amount) from payments y where y.invoice_id=i.id and y.voided_at is null),0) bal, i.currency,
        exists(select 1 from payments y where y.invoice_id=i.id and y.voided_at is null) partial from invoices i join patients p on p.id=i.patient_id where i.clinic_id=$1 and i.kind='invoice' and i.status='issued'`, [c])).rows.filter(r => Number(r.bal) > 0.004)
    const old90 = debts.filter(r => r.age > 90), old30 = debts.filter(r => r.age > 30 && r.age <= 90), part = debts.filter(r => r.partial)
    if (old90.length) await add(c, 'dettes90:' + month(), 'view_finances', 'old_debts', `${old90.length} dette(s) de plus de 90 jours`, list(old90, r => `${r.patient} (${r.number})`))
    if (old30.length) await add(c, 'impayes30:' + day().slice(0, 8) + Math.ceil(new Date().getDate() / 7), 'view_finances', 'unpaid', `${old30.length} facture(s) impayée(s) depuis plus de 30 jours`, list(old30, r => `${r.patient} (${r.number})`))
    if (part.length) await add(c, 'partiels:' + day().slice(0, 8) + Math.ceil(new Date().getDate() / 7), 'view_finances', 'partial', `${part.length} facture(s) partiellement payée(s)`, list(part, r => `${r.patient} : reste ${Number(r.bal).toLocaleString('fr-FR')} ${r.currency}`))
    // traitements incomplets : plans approuvés sans aucune intervention réalisée depuis 30 jours
    const idle = (await q("select t.id,p.last_name||' '||p.first_name patient from treatment_plans t join patients p on p.id=t.patient_id where t.clinic_id=$1 and t.status in ('approved','in_progress') and t.created_at < now() - interval '30 days' and not exists(select 1 from treatment_plan_items i where i.plan_id=t.id and (i.done_at > now() - interval '30 days' or i.sessions_done > 0 and i.status='in_progress'))", [c])).rows
    if (idle.length) await add(c, 'plans_inactifs:' + month(), 'manage_treatment_plans', 'idle_plans', `${idle.length} traitement(s) sans avancement depuis 30 jours`, list(idle, r => r.patient))
    // interventions à programmer : interventions prévues dont le patient n'a aucun rendez-vous à venir
    const toPlan = (await q("select distinct p.id,p.last_name||' '||p.first_name patient from treatment_plan_items i join treatment_plans t on t.id=i.plan_id join patients p on p.id=t.patient_id where t.clinic_id=$1 and t.status in ('approved','in_progress') and i.status in ('todo','in_progress','postponed') and not exists(select 1 from appointments a where a.patient_id=p.id and a.starts_at>now() and a.status in ('planned','confirmed'))", [c])).rows
    if (toPlan.length) await add(c, 'a_programmer:' + day(), 'manage_appointments', 'to_schedule', `${toPlan.length} patient(s) ont des soins à programmer`, list(toPlan, r => r.patient) + ' : aucun rendez-vous prévu.')
    // personnel sans rémunération définie (ni salaire fixe ni pourcentage)
    const nopay = (await q("select u.first_name||' '||u.last_name n from users u where u.clinic_id=$1 and u.status='active' and u.role<>'OWNER' and not exists(select 1 from employees e where e.user_id=u.id and e.status='active' and (e.base_salary>0 or coalesce(e.commission_pct,0)>0)) union all select first_name||' '||last_name from employees where clinic_id=$1 and status='active' and user_id is null and base_salary<=0 and coalesce(commission_pct,0)<=0", [c])).rows
    if (nopay.length) await add(c, 'sans_remuneration:' + day(), 'view_salaries', 'no_pay', `${nopay.length} membre(s) du personnel sans rémunération`, list(nopay, r => r.n) + ' : définissez un salaire fixe ou un pourcentage (Personnel & paie).')
    // commissions en attente (mois précédent non soldé)
    const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1); const pm = prev.toISOString().slice(0, 7)
    const com = (await q(`select u.first_name||' '||u.last_name doctor from users u join employees e on e.user_id=u.id where u.clinic_id=$1 and coalesce(e.commission_pct,0) > 0
        and exists(select 1 from payments y join invoices i on i.id=y.invoice_id where i.doctor_id=u.id and y.voided_at is null and to_char(y.created_at,'YYYY-MM')=$2)
        and not exists(select 1 from commission_payments cp where cp.doctor_id=u.id and cp.period=$2) and not exists(select 1 from payroll_records r where r.employee_id=e.id and r.period=$2 and r.commissions > 0)`, [c, pm])).rows
    if (com.length) await add(c, 'commissions:' + pm, 'view_salaries', 'commissions', `Commissions de ${pm} en attente`, list(com, r => r.doctor) + ' : commission ni versée ni reportée en paie.')
  }
}
export function startAlerts() { const tick = () => runAlerts().catch(e => console.error('Notifications automatiques :', e.message)); setTimeout(tick, 20e3); return setInterval(tick, 30 * 60e3) }
