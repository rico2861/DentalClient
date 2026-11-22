// Grille des tarifs des soins : consultable par tout le personnel, modifiable par la direction et les finances.
const UUID = /^[0-9a-f-]{36}$/, AMT = /^\d{1,10}(\.\d{1,2})?$/
export default function (app, { q, need, audit, fail, wrap, clean }) {
  const canEdit = req => req.perms.has('manage_finances') || req.user.role === 'OWNER' || String(req.user.role).startsWith('ADMIN')
  const rateNow = async cid => (await q('select rate::float8 r from exchange_rates where clinic_id=$1 and effective_at<=now() order by effective_at desc, created_at desc limit 1', [cid])).rows[0]?.r ?? null
  // tarifs de départ de la clinique (créés une seule fois, si la grille n'a jamais été remplie)
  const DEFAULTS = [['Prophylaxie', 'Prévention', 3000, 'HTG'], ['Restauration', 'Soins conservateurs', 2000, 'HTG'], ['Extraction simple', 'Chirurgie', 2000, 'HTG'], ['Extraction chirurgicale', 'Chirurgie', null, 'HTG'],
    ['Traitement orthodontique (braces)', 'Orthodontie', 150, 'USD'], ['Endodontie', 'Soins conservateurs', null, 'HTG'], ['Prothèse', 'Prothèses', null, 'HTG'], ['Radiographie', 'Imagerie', null, 'HTG', false]]
  const seed = async cid => { if ((await q('select 1 from tariffs where clinic_id=$1 limit 1', [cid])).rowCount) return
    for (const [i, [n, c, p, cur, on = true]] of DEFAULTS.entries()) await q('insert into tariffs(clinic_id,name,category,price,currency,sort,active,note) values($1,$2,$3,$4,$5,$6,$7,$8)', [cid, n, c, p, cur, (i + 1) * 10, on, on ? null : 'Non opérationnelle : tarif et fonctionnement à confirmer par la clinique']) }
  app.get('/api/tariffs', need(), wrap(async (req, res) => {
    await seed(req.user.clinic_id)
    const all = req.query.all === '1' && canEdit(req)
    const rows = (await q(`select id,code,name,category,price::float8 price,currency,note,sort,active from tariffs where clinic_id=$1 ${all ? '' : 'and active'} order by sort,name`, [req.user.clinic_id])).rows
    const last = (await q("select r.effective_at,u.first_name||' '||u.last_name by from exchange_rates r left join users u on u.id=r.created_by where r.clinic_id=$1 and r.effective_at<=now() order by r.effective_at desc, r.created_at desc limit 1", [req.user.clinic_id])).rows[0]
    res.json({ rows, rate: await rateNow(req.user.clinic_id), rate_at: last?.effective_at || null, rate_by: last?.by || null, can_edit: canEdit(req), can_rate: req.perms.has('manage_exchange_rates') || ['OWNER', 'ADMIN', 'ADMIN_FINANCIER'].includes(req.user.role) }) }))
  const read = b => { const name = clean(b.name, 120), cur = b.currency === 'USD' ? 'USD' : 'HTG', p = b.price === '' || b.price == null ? null : String(b.price).replace(',', '.')
    if (!name) return { err: 'Nom du soin requis' }; if (p !== null && !AMT.test(p)) return { err: 'Prix invalide (laissez vide si « à déterminer »)' }
    return { code: clean(b.code, 20), name, category: clean(b.category, 60), price: p, currency: cur, note: clean(b.note, 200), sort: Number.isInteger(+b.sort) ? +b.sort : 100 } }
  app.post('/api/tariffs', need(), wrap(async (req, res) => {
    if (!canEdit(req)) return fail(res, 403, 'Permission refusée'); const t = read(req.body); if (t.err) return fail(res, 400, t.err)
    const { rows: [r] } = await q('insert into tariffs(clinic_id,name,category,price,currency,note,sort,code) values($1,$2,$3,$4,$5,$6,$7,$8) returning id', [req.user.clinic_id, t.name, t.category, t.price, t.currency, t.note, t.sort, t.code])
    await audit(req, 'TARIFF_CREATED', 'tariffs', r.id, t); res.json(r) }))
  app.post('/api/tariffs/:id', need(), wrap(async (req, res) => {
    if (!canEdit(req)) return fail(res, 403, 'Permission refusée'); if (!UUID.test(req.params.id)) return fail(res, 404, 'Introuvable')
    if ('active' in req.body && Object.keys(req.body).length === 1) { const r = await q('update tariffs set active=$3, updated_at=now() where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id, !!req.body.active]); if (!r.rowCount) return fail(res, 404, 'Introuvable'); await audit(req, 'TARIFF_STATUS', 'tariffs', req.params.id, { active: !!req.body.active }); return res.json({ ok: true }) }
    const t = read(req.body); if (t.err) return fail(res, 400, t.err)
    const r = await q('update tariffs set name=$3,category=$4,price=$5,currency=$6,note=$7,sort=$8,code=$9,updated_at=now() where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id, t.name, t.category, t.price, t.currency, t.note, t.sort, t.code]); if (!r.rowCount) return fail(res, 404, 'Introuvable')
    await audit(req, 'TARIFF_UPDATED', 'tariffs', req.params.id, t); res.json({ ok: true }) }))
}
