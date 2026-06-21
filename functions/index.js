const functions   = require('firebase-functions');
const admin       = require('firebase-admin');
const https       = require('https');
const querystring = require('querystring');
const nodemailer  = require('nodemailer');
admin.initializeApp();
const db = admin.firestore();

// ── Helpers de notificação ────────────────────────────────────

async function notifyNtfy(title, body, tags = 'bell') {
    const topic = process.env.NTFY_TOPIC;
    if (!topic) return;
    await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        headers: { Title: title, Priority: 'default', Tags: tags },
        body,
    }).catch(() => {});
}

async function sendEmail(to, subject, html) {
    const user = process.env.EMAIL_FROM;
    const pass = process.env.EMAIL_PASS;
    if (!user || !pass || !to) return;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `FrotaControl <${user}>`, to, subject, html }).catch(() => {});
}

// Deleta usuário do Firebase Auth (só Admin SDK pode fazer isso)
exports.deleteAuthUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');
    }
    const callerSnap = await db.collection('usuarios').doc(context.auth.uid).get();
    if (!callerSnap.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Perfil não encontrado.');
    }
    const perfil = callerSnap.data().perfil;
    if (!['admin', 'superadmin'].includes(perfil)) {
        throw new functions.https.HttpsError('permission-denied', 'Sem permissão.');
    }
    const { uid } = data;
    if (!uid) throw new functions.https.HttpsError('invalid-argument', 'UID obrigatório.');
    try {
        await admin.auth().deleteUser(uid);
    } catch(e) {
        if (e.code !== 'auth/user-not-found') {
            throw new functions.https.HttpsError('internal', e.message);
        }
    }
    return { ok: true };
});

// Endpoint HTTP que rastreadores GPS externos chamam para enviar localização.
// GET  /gps?id=DEVICE_ID&token=TOKEN&lat=LAT&lng=LNG[&speed=KMH&acc=M&ts=UNIX_S]
// POST /gps  com body JSON ou form-urlencoded com os mesmos campos.
// Compatível com Coban, Sinotrack, Suntech e qualquer tracker com suporte a HTTP.
exports.gps = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(204).send('');

    const q = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };

    const id    = String(q.id    || q.imei    || q.device   || '').trim();
    const token = String(q.token || q.tk      || q.key      || '').trim();
    const latRaw = q.lat   || q.latitude  || '';
    const lngRaw = q.lng   || q.lon || q.longitude || '';
    const lat = parseFloat(latRaw);
    const lng = parseFloat(lngRaw);

    if (!id || !token || isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: 'Obrigatório: id, token, lat, lng' });
    }

    const devSnap = await db.collection('dispositivos').doc(id).get().catch(() => null);
    if (!devSnap?.exists) return res.status(404).json({ error: 'Dispositivo não encontrado' });

    const dev = devSnap.data();
    if (dev.token !== token)     return res.status(403).json({ error: 'Token inválido' });
    if (dev.ativo === false)     return res.status(403).json({ error: 'Dispositivo desativado' });

    // timestamp: aceita segundos (Unix) ou ms
    let ts = Date.now();
    if (q.ts || q.timestamp || q.time) {
        const n = parseInt(q.ts || q.timestamp || q.time);
        if (!isNaN(n)) ts = n < 1e10 ? n * 1000 : n;
    }

    const locData = { lat, lng, ts };
    const spd = q.speed ?? q.vel ?? q.spd;
    const acc = q.acc   ?? q.accuracy ?? q.hdop;
    if (spd != null && !isNaN(parseFloat(spd))) locData.velocidade = Math.round(parseFloat(spd));
    if (acc != null && !isNaN(parseFloat(acc))) locData.precisao   = Math.round(parseFloat(acc));

    // busca veículo e utilização ativa em paralelo
    const [veicSnap, usageSnap] = await Promise.all([
        dev.veiculoId
            ? db.collection('veiculos').doc(dev.veiculoId).get()
            : Promise.resolve(null),
        dev.veiculoId
            ? db.collection('utilizacoes')
                .where('veiculoId', '==', dev.veiculoId)
                .where('status', '==', 'em_uso')
                .limit(1).get()
            : Promise.resolve(null),
    ]);

    const veic  = veicSnap?.exists  ? veicSnap.data()          : null;
    const usage = usageSnap?.docs?.[0] ?? null;

    let motNome = '';
    if (usage?.data().motoristaId) {
        const ms = await db.collection('motoristas').doc(usage.data().motoristaId).get();
        if (ms.exists) motNome = ms.data().nome || '';
    }

    const rastreioId = usage ? usage.id : id;
    const batch = db.batch();

    batch.set(db.collection('rastreios').doc(rastreioId), {
        ...locData,
        placa:         veic?.placa   || '',
        modelo:        `${veic?.marca || ''} ${veic?.modelo || ''}`.trim(),
        motoristaNome: motNome,
        empresaId:     dev.empresaId || '',
        fonte:         'dispositivo',
    });

    if (usage) {
        batch.update(db.collection('utilizacoes').doc(usage.id), { localizacao: locData });
    }

    await batch.commit();
    return res.status(200).json({ ok: true, ts, rastreioId });
});

// Cria preferência de pagamento MercadoPago (Checkout Pro) — funciona sem conta MP
exports.criarAssinatura = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');

    const { planKey, payerEmail } = data;
    if (!planKey || !payerEmail) {
        throw new functions.https.HttpsError('invalid-argument', 'Dados incompletos.');
    }

    const PLAN_NAMES  = { basico: 'Básico', profissional: 'Profissional', empresarial: 'Empresarial' };
    const PLAN_PRICES = { basico: 79, profissional: 149, empresarial: 299 };
    if (!PLAN_NAMES[planKey]) throw new functions.https.HttpsError('invalid-argument', 'Plano inválido.');

    const userSnap = await db.collection('usuarios').doc(context.auth.uid).get();
    if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
    const empresaId = userSnap.data().empresaId;

    let preco = PLAN_PRICES[planKey];
    try {
        const cfgSnap = await db.collection('configuracoes').doc('planos').get();
        if (cfgSnap.exists && cfgSnap.data()[planKey]) preco = Number(cfgSnap.data()[planKey]);
    } catch(_) {}

    const mpToken = process.env.MP_ACCESS_TOKEN;
    const body = {
        items: [{
            title:      `FrotaControl - Plano ${PLAN_NAMES[planKey]}`,
            quantity:   1,
            unit_price: preco,
            currency_id: 'BRL',
        }],
        payer:              { email: payerEmail },
        external_reference: `${empresaId}|${planKey}`,
        back_urls: {
            success: 'https://frotacontrol.api.br/sucesso.html',
            failure: 'https://frotacontrol.api.br/planos.html',
            pending: 'https://frotacontrol.api.br/sucesso.html',
        },
        auto_return:          'approved',
        notification_url:     'https://us-central1-frota-empresa-a8202.cloudfunctions.net/mpWebhook',
        statement_descriptor: 'FROTACONTROL',
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const result = await mpRes.json();

    if (!mpRes.ok) {
        console.error('MP preference error:', JSON.stringify(result));
        const msg = result?.message || 'Erro ao criar preferência de pagamento.';
        throw new functions.https.HttpsError('internal', msg);
    }

    console.log(`📋 Preferência criada — empresa: ${empresaId} | plano: ${planKey} | init_point: ${result.init_point}`);
    return { success: true, initPoint: result.init_point, preferenceId: result.id };
});

// Atualiza o cartão de uma assinatura já ativa no MercadoPago
exports.atualizarCartao = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');

    const { cardToken } = data;
    if (!cardToken) throw new functions.https.HttpsError('invalid-argument', 'Token do cartão obrigatório.');

    const userSnap = await db.collection('usuarios').doc(context.auth.uid).get();
    if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
    const empresaId = userSnap.data().empresaId;

    const empSnap = await db.collection('empresas').doc(empresaId).get();
    if (!empSnap.exists) throw new functions.https.HttpsError('not-found', 'Empresa não encontrada.');

    const subscriptionId = empSnap.data().mpSubscriptionId;
    if (!subscriptionId) throw new functions.https.HttpsError('failed-precondition', 'Nenhuma assinatura ativa encontrada.');

    const mpToken = process.env.MP_ACCESS_TOKEN;
    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${subscriptionId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_token_id: cardToken }),
    });

    const result = await mpRes.json();
    if (!mpRes.ok) {
        console.error('MP update card error:', JSON.stringify(result));
        throw new functions.https.HttpsError('internal', result?.message || 'Erro ao atualizar cartão.');
    }

    console.log(`💳 Cartão atualizado — empresa: ${empresaId}`);
    return { success: true };
});

// Webhook do MercadoPago — ativa plano quando pagamento é aprovado
exports.mpWebhook = functions.https.onRequest(async (req, res) => {
    const topic = req.query.topic || req.body?.type || '';
    const id    = req.query.id    || req.body?.data?.id || '';

    if (!id) return res.status(200).send('ignored');

    const mpToken = process.env.MP_ACCESS_TOKEN;
    if (!mpToken) return res.status(500).send('MP_ACCESS_TOKEN não configurado');

    // Pagamento via Checkout Pro
    if (!topic || topic.includes('payment')) {
        let payment;
        try {
            const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
                headers: { Authorization: `Bearer ${mpToken}` },
            });
            if (!mpRes.ok) throw new Error(`MP API ${mpRes.status}`);
            payment = await mpRes.json();
        } catch (err) {
            console.error('Erro ao consultar pagamento MP:', err.message);
            return res.status(200).send('mp-error');
        }

        const extRef = payment.external_reference || '';
        if (!extRef || !extRef.includes('|')) return res.status(200).send('no-ref');

        const [empresaId, planKey] = extRef.split('|');
        const VALID_PLANS = ['basico', 'profissional', 'empresarial'];
        if (!empresaId || !VALID_PLANS.includes(planKey)) return res.status(200).send('invalid-ref');

        try {
            if (payment.status === 'approved') {
                const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                await db.collection('empresas').doc(empresaId).update({
                    plano:           planKey,
                    planoAtivo:      true,
                    planoAtivoEm:    admin.firestore.FieldValue.serverTimestamp(),
                    planoExpiraEm:   admin.firestore.Timestamp.fromDate(expiry),
                    pagamentoStatus: 'ativo',
                    pagamentoId:     String(id),
                });
                console.log(`✅ Plano ${planKey} ativado — empresa: ${empresaId} | pagamento: ${id}`);

                // Busca dados da empresa e do admin para notificações
                const [empSnap, userSnap] = await Promise.all([
                    db.collection('empresas').doc(empresaId).get(),
                    db.collection('usuarios').where('empresaId', '==', empresaId).where('perfil', 'in', ['admin', 'superadmin']).limit(1).get(),
                ]);
                const empNome    = empSnap.exists ? (empSnap.data().nome || empresaId) : empresaId;
                const adminEmail = !userSnap.empty ? userSnap.docs[0].data().email : payment.payer?.email || '';
                const PLANO_LABEL = { basico: 'Básico', profissional: 'Profissional', empresarial: 'Empresarial' };

                // Notifica dono da plataforma via ntfy
                await notifyNtfy(
                    `💳 Nova assinatura — ${empNome}`,
                    `Empresa: ${empNome}\nPlano: ${PLANO_LABEL[planKey] || planKey}\nEmail: ${adminEmail}\nVence em: ${expiry.toLocaleDateString('pt-BR')}`,
                    'moneybag'
                );

                // E-mail de boas-vindas para o cliente
                await sendEmail(adminEmail, `Bem-vindo ao FrotaControl — Plano ${PLANO_LABEL[planKey] || planKey} ativado!`,
                    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
                        <h2 style="color:#1e3a5f">Pagamento confirmado!</h2>
                        <p>Olá! Seu plano <strong>${PLANO_LABEL[planKey] || planKey}</strong> foi ativado com sucesso.</p>
                        <p style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:0 8px 8px 0">
                            ✅ Plano ativo por <strong>30 dias</strong> a partir de hoje.
                        </p>
                        <p>Acesse o sistema agora:</p>
                        <a href="https://frotacontrol.api.br" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Acessar FrotaControl →</a>
                        <p style="margin-top:24px;font-size:12px;color:#64748b">Renove antes do vencimento para não perder o acesso.</p>
                    </div>`
                );

            } else if (payment.status === 'rejected') {
                console.log(`❌ Pagamento rejeitado — empresa: ${empresaId} | motivo: ${payment.status_detail}`);
            }
        } catch (err) {
            console.error('Erro Firestore:', err.message);
            return res.status(500).send('db-error');
        }

        return res.status(200).send('ok');
    }

    // Legado: assinaturas preapproval já existentes
    if (topic.includes('preapproval')) {
        let subscription;
        try {
            const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${id}`, {
                headers: { Authorization: `Bearer ${mpToken}` },
            });
            if (!mpRes.ok) throw new Error(`MP API ${mpRes.status}`);
            subscription = await mpRes.json();
        } catch (err) {
            return res.status(200).send('mp-error');
        }

        const { external_reference: extRef, status } = subscription;
        if (!extRef) return res.status(200).send('no-empresa');

        let empresaId, plano;
        if (extRef.includes('|')) {
            [empresaId, plano] = extRef.split('|');
        } else {
            empresaId = extRef;
            plano = 'basico';
        }

        try {
            if (status === 'authorized') {
                const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                await db.collection('empresas').doc(empresaId).update({
                    plano,
                    planoAtivo:      true,
                    planoAtivoEm:    admin.firestore.FieldValue.serverTimestamp(),
                    planoExpiraEm:   admin.firestore.Timestamp.fromDate(expiry),
                    pagamentoStatus: 'ativo',
                });
                console.log(`✅ Plano ${plano} ativado (legado) — empresa: ${empresaId}`);
            }
        } catch (err) {
            console.error('Erro Firestore:', err.message);
            return res.status(500).send('db-error');
        }
    }

    res.status(200).send('ok');
});

// Consulta multas e débitos DETRAN SP via Infosimples
exports.consultarMultas = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');
    const callerSnap = await db.collection('usuarios').doc(context.auth.uid).get();
    const perfil = callerSnap.exists ? callerSnap.data().perfil : null;
    if (!['admin', 'superadmin'].includes(perfil)) throw new functions.https.HttpsError('permission-denied', 'Apenas administradores podem consultar multas.');

    const placa   = String(data.placa   || '').trim().toUpperCase();
    const renavam = String(data.renavam || '').trim().replace(/\D/g, '');
    if (!placa)   throw new functions.https.HttpsError('invalid-argument', 'Placa obrigatória.');
    if (!renavam) throw new functions.https.HttpsError('invalid-argument', 'RENAVAM obrigatório. Cadastre o RENAVAM no veículo primeiro.');

    const token = process.env.INFOSIMPLES_TOKEN;
    if (!token) throw new functions.https.HttpsError('internal', 'Token não configurado.');

    const body = querystring.stringify({ placa, renavam, token, timeout: '300' });

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.infosimples.com',
            path: '/api/v2/consultas/detran/sp/debitos',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch (e) { reject(new functions.https.HttpsError('internal', 'Resposta inválida da API.')); }
            });
        });
        req.on('error', e => reject(new functions.https.HttpsError('internal', e.message)));
        req.write(body);
        req.end();
    });
});

// Lembrete diário de renovação — avisa plataforma + cliente 3 dias e 1 dia antes de vencer
exports.lembreteRenovacao = functions.pubsub.schedule('every 24 hours').onRun(async () => {
    const now     = admin.firestore.Timestamp.now();
    const in4days = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 4 * 86400000));
    const PLANO_LABEL = { basico: 'Básico', profissional: 'Profissional', empresarial: 'Empresarial' };

    const snap = await db.collection('empresas')
        .where('planoAtivo', '==', true)
        .where('planoExpiraEm', '>=', now)
        .where('planoExpiraEm', '<=', in4days)
        .get();

    for (const docSnap of snap.docs) {
        const emp  = docSnap.data();
        const exp  = emp.planoExpiraEm.toDate();
        const dias = Math.ceil((exp - Date.now()) / 86400000);

        if (dias !== 3 && dias !== 1) continue;

        // Busca e-mail do admin da empresa
        const userSnap = await db.collection('usuarios')
            .where('empresaId', '==', docSnap.id)
            .where('perfil', 'in', ['admin', 'superadmin'])
            .limit(1).get();
        const adminEmail = !userSnap.empty ? userSnap.docs[0].data().email : '';
        const planoLabel = PLANO_LABEL[emp.plano] || emp.plano;

        // Notifica dono da plataforma
        await notifyNtfy(
            `⏰ Renovação em ${dias} dia(s) — ${emp.nome || docSnap.id}`,
            `Empresa: ${emp.nome || docSnap.id}\nPlano: ${planoLabel}\nEmail: ${adminEmail}\nVence: ${exp.toLocaleDateString('pt-BR')}`,
            'calendar'
        );

        // E-mail de lembrete para o cliente
        await sendEmail(adminEmail,
            `Seu plano FrotaControl vence em ${dias} dia${dias > 1 ? 's' : ''} — Renove agora`,
            `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
                <h2 style="color:#92400e">⏰ Seu plano vence em ${dias} dia${dias > 1 ? 's' : ''}</h2>
                <p>Plano <strong>${planoLabel}</strong> da empresa <strong>${emp.nome || ''}</strong> expira em <strong>${exp.toLocaleDateString('pt-BR')}</strong>.</p>
                <p>Renove agora para não perder o acesso ao sistema:</p>
                <a href="https://frotacontrol.api.br/planos.html" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Renovar plano →</a>
                <p style="margin-top:24px;font-size:12px;color:#64748b">Se já renovou, ignore este e-mail.</p>
            </div>`
        );

        console.log(`⏰ Lembrete enviado — empresa: ${docSnap.id} | dias: ${dias}`);
    }
});

// Consulta dados do veículo pela placa usando WDAPI2 (cadastre-se grátis em wdapi2.com.br)
exports.consultarPlaca = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');
    const { placa } = data;
    if (!placa) throw new functions.https.HttpsError('invalid-argument', 'Placa obrigatória.');

    const token = process.env.WDAPI2_TOKEN;
    if (!token) throw new functions.https.HttpsError('failed-precondition', 'API de placa não configurada.');

    const placaLimpa = placa.replace(/[^A-Z0-9]/g, '').toUpperCase();
    try {
        const res = await fetch(`https://wdapi2.com.br/consulta/${placaLimpa}/${token}`);
        const d   = await res.json();
        if (!d.MARCA) throw new Error('not-found');
        console.log(`🔍 Placa consultada: ${placaLimpa} — ${d.MARCA} ${d.MODELO}`);
        return { marca: d.MARCA || '', modelo: d.MODELO || '', ano: String(d.ano || d.AnoFabricacao || ''), cor: d.cor || d.COR || '' };
    } catch(e) {
        throw new functions.https.HttpsError('not-found', 'Placa não encontrada ou serviço indisponível.');
    }
});

// Notifica gestores via FCM quando uma saída é finalizada pelo motorista
exports.notificarGestor = functions.firestore.document('utilizacoes/{usageId}').onUpdate(async (change, context) => {
    const before = change.before.data();
    const after  = change.after.data();
    if (before.status === after.status || after.status !== 'finalizado') return;

    const empresaId = after.empresaId;
    if (!empresaId) return;
    try {
        const [adminSnap, veicSnap, motSnap] = await Promise.all([
            db.collection('usuarios').where('empresaId', '==', empresaId).where('perfil', 'in', ['admin', 'superadmin']).get(),
            after.veiculoId  ? db.collection('veiculos').doc(after.veiculoId).get()    : Promise.resolve(null),
            after.motoristaId ? db.collection('motoristas').doc(after.motoristaId).get() : Promise.resolve(null),
        ]);

        const tokens = adminSnap.docs.map(d => d.data().fcmToken).filter(Boolean);
        if (!tokens.length) return;

        const placa    = veicSnap?.exists ? (veicSnap.data().placa || '') : '';
        const motorista = motSnap?.exists  ? (motSnap.data().nome  || '') : '';
        const percurso  = (after.kmFinal && after.kmInicial) ? ` · ${after.kmFinal - after.kmInicial} km` : '';

        await admin.messaging().sendEachForMulticast({
            tokens,
            notification: {
                title: `✅ Saída finalizada — ${placa}`,
                body:  `${motorista}${after.destino ? ' → ' + after.destino : ''}${percurso}`,
            },
            webpush: { notification: { icon: 'https://frotacontrol.api.br/logo.jpg' } },
        });
        console.log(`📱 FCM enviado — empresa: ${empresaId} | tokens: ${tokens.length}`);
    } catch(e) {
        console.error('Erro FCM notificarGestor:', e.message);
    }
});

// E-mail de boas-vindas quando uma nova empresa é criada
exports.bemVindo = functions.firestore.document('empresas/{empresaId}').onCreate(async (snap, context) => {
    const emp = snap.data();
    if (!emp.adminUid) return;
    try {
        const userRecord = await admin.auth().getUser(emp.adminUid);
        const email = userRecord.email;
        if (!email) return;
        const nome = emp.nome || 'sua empresa';
        await sendEmail(email,
            '🎉 Bem-vindo ao FrotaControl! Seu trial de 14 dias começa agora',
            `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
                <h2 style="color:#1e3a5f;margin-bottom:8px">🎉 Bem-vindo ao FrotaControl!</h2>
                <p>Olá! A conta da empresa <strong>${nome}</strong> foi criada com sucesso.</p>
                <p style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:0 8px 8px 0;margin:20px 0">
                    ✅ Você tem <strong>14 dias grátis</strong> para explorar tudo sem cartão de crédito.
                </p>
                <p style="font-weight:600;margin-bottom:8px">Por onde começar:</p>
                <ol style="color:#374151;line-height:2.2;padding-left:20px">
                    <li>Cadastre seus <strong>veículos</strong> com placa e dados do carro</li>
                    <li>Adicione seus <strong>motoristas</strong> com CNH e contato</li>
                    <li>Registre a primeira <strong>utilização</strong> e veja o controle em ação</li>
                    <li>Ative o <strong>rastreamento GPS</strong> pelo celular do motorista</li>
                </ol>
                <a href="https://frotacontrol.api.br" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:20px">Acessar o sistema →</a>
                <p style="margin-top:28px;font-size:13px;color:#64748b">Ficou com dúvida? Fale com o suporte pelo WhatsApp — respondemos rápido.</p>
            </div>`
        );
        await notifyNtfy(
            `🆕 Novo cadastro — ${nome}`,
            `Empresa: ${nome}\nEmail: ${email}`,
            'office_building'
        );
        console.log(`📧 E-mail de boas-vindas enviado — empresa: ${context.params.empresaId}`);
    } catch(e) {
        console.error('Erro ao enviar e-mail de boas-vindas:', e.message);
    }
});
