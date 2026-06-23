// ============================================================
// FrotaControl — App Principal (Firebase + Vanilla JS)
// ============================================================
import { initializeApp }      from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signOut, onAuthStateChanged, sendEmailVerification, updatePassword, setPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc,
    getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, serverTimestamp, Timestamp, onSnapshot, increment
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { getMessaging, getToken }      from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { firebaseConfig, brandConfig } from './config.js';

const TENANT_COLS  = new Set(['veiculos','motoristas','utilizacoes','multas','abastecimentos','escalas','manutencoes','usuarios','dispositivos']);
const LOG_MODULES  = new Set(['veiculos','motoristas','utilizacoes','multas','abastecimentos','manutencoes','escalas','dispositivos']);
const PLAN_LIMITS  = {
    gratuito:     { veiculos: 3,    motoristas: 5    },
    trial:        { veiculos: 3,    motoristas: 5    },
    basico:       { veiculos: 10,   motoristas: 20   },
    profissional: { veiculos: 30,   motoristas: 100  },
    empresarial:  { veiculos: null, motoristas: null },
};
const LIMIT_COLS   = new Set(['veiculos', 'motoristas']);

// ── Firebase init ────────────────────────────────────────────
const fbApp    = initializeApp(firebaseConfig);
const auth     = getAuth(fbApp);
const fbFuncs  = getFunctions(fbApp, 'us-central1');
let fbMsg = null;
try { fbMsg = getMessaging(fbApp); } catch(_) {}

async function initFCM() {
    if (!fbMsg || !brandConfig.fcmVapidKey || !state.user) return;
    try {
        if (!('Notification' in window)) return;
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
        const token = await getToken(fbMsg, { vapidKey: brandConfig.fcmVapidKey });
        if (token) await updateDoc(doc(db, 'usuarios', state.user.uid), { fcmToken: token });
    } catch(_) {}
}
setPersistence(auth, browserSessionPersistence).catch(() => {});
let db;
try {
    db = initializeFirestore(fbApp, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
} catch(_) {
    try { db = initializeFirestore(fbApp, { localCache: persistentLocalCache() }); }
    catch(_) { db = getFirestore(fbApp); }
}

// ── App state ─────────────────────────────────────────────────
const state = {
    user: null,
    profile: null,
    empresa: null,
    currentPage: 'dashboard',
    cache: { vehicles: null, drivers: null },
};

// ── Paletas de cor ────────────────────────────────────────────
const PALETTES = {
    blue:   { primary:'#1e3a5f', primaryLt:'#2c4f7c', accent:'#2563eb', accentDk:'#1d4ed8' },
    green:  { primary:'#14532d', primaryLt:'#166534', accent:'#16a34a', accentDk:'#15803d' },
    purple: { primary:'#3b0764', primaryLt:'#581c87', accent:'#9333ea', accentDk:'#7e22ce' },
    red:    { primary:'#7f1d1d', primaryLt:'#991b1b', accent:'#dc2626', accentDk:'#b91c1c' },
    teal:   { primary:'#134e4a', primaryLt:'#115e59', accent:'#0d9488', accentDk:'#0f766e' },
};
const PAL_LABELS = { blue:'Azul', green:'Verde', purple:'Roxo', red:'Vermelho', teal:'Teal' };

function applyPalette(id) {
    const p = PALETTES[id] || PALETTES.blue;
    const r = document.documentElement;
    r.style.setProperty('--primary',    p.primary);
    r.style.setProperty('--primary-lt', p.primaryLt);
    r.style.setProperty('--accent',     p.accent);
    r.style.setProperty('--accent-dk',  p.accentDk);
    localStorage.setItem('frotaPalette', id);
}

// ── Rodízio helpers ───────────────────────────────────────────
const CITY_MODELS = {
    sp:       { nome:'São Paulo — SP',        horario:'7h–10h e 17h–20h', regras:{ 1:[1,2], 2:[3,4], 3:[5,6], 4:[7,8], 5:[9,0] } },
    campinas: { nome:'Campinas — SP',         horario:'7h–9h e 17h–20h',  regras:{ 1:[1,2], 2:[3,4], 3:[5,6], 4:[7,8], 5:[9,0] } },
    santos:   { nome:'Santos — SP',           horario:'7h–9h e 17h–19h',  regras:{ 1:[1,2], 2:[3,4], 3:[5,6], 4:[7,8], 5:[9,0] } },
    sorocaba: { nome:'Sorocaba — SP',         horario:'7h–9h e 17h–20h',  regras:{ 1:[1,2], 2:[3,4], 3:[5,6], 4:[7,8], 5:[9,0] } },
    bh:       { nome:'Belo Horizonte — MG',   horario:'7h–9h e 17h–19h',  regras:{ 1:[1,2], 2:[3,4], 3:[5,6], 4:[7,8], 5:[9,0] } },
    curitiba: { nome:'Curitiba — PR',         horario:'7h–9h30 e 17h–20h',regras:{ 1:[1,2], 2:[3,4], 3:[5,6], 4:[7,8], 5:[9,0] } },
    goiania:  { nome:'Goiânia — GO',          horario:'7h–9h e 17h–19h',  regras:{ 1:[1,2], 2:[3,4], 3:[5,6], 4:[7,8], 5:[9,0] } },
    brasilia: { nome:'Brasília — DF',         horario:'7h–9h e 17h30–19h30', regras:{ 1:[1,2], 2:[3,4], 3:[5,6], 4:[7,8], 5:[9,0] } },
};

const DAY_NAMES    = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DAY_FULL     = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const TURNO_LABELS = { manha:'Manhã', tarde:'Tarde', integral:'Integral' };

function getRodizioCity()  { return localStorage.getItem('frotaRodizioCity') || 'sp'; }
function getRodizioRules() { return (CITY_MODELS[getRodizioCity()] || CITY_MODELS.sp).regras; }

function plateRestrictionDay(plate) {
    const last  = parseInt(String(plate || '').replace(/\D/g,'').slice(-1));
    const rules = getRodizioRules();
    for (const [day, finals] of Object.entries(rules)) {
        if (finals.includes(isNaN(last) ? -1 : last)) return parseInt(day);
    }
    return null;
}

function isRodizioEnabled() { return localStorage.getItem('frotaRodizio') !== 'false'; }

// ── DOM refs ──────────────────────────────────────────────────
const pageContent  = document.getElementById('pageContent');
const loadingScr   = document.getElementById('loadingScreen');
const bcCurrent    = document.getElementById('bcCurrent');

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
    if (!user) { window.location.href = 'login.html'; return; }

    try {
        const profileSnap = await getDoc(doc(db, 'usuarios', user.uid));
        const perfil = profileSnap.exists() ? profileSnap.data().perfil : null;

        // Bloqueia acesso se e-mail não verificado (exceto superadmin)
        if (!user.emailVerified && perfil !== 'superadmin') {
            let resending = false;
            loadingScr.innerHTML = `
                <div style="text-align:center;padding:40px;max-width:440px;margin:0 auto">
                    <i class="fa-solid fa-envelope-open-text" style="font-size:52px;color:#2563eb;margin-bottom:20px;display:block"></i>
                    <h2 style="font-size:18px;font-weight:700;color:#1e293b;margin-bottom:8px">Verifique seu e-mail</h2>
                    <p style="color:#64748b;font-size:14px;margin-bottom:4px">Enviamos um link de confirmação para:</p>
                    <p style="color:#1e293b;font-weight:600;font-size:14px;margin-bottom:20px">${user.email}</p>
                    <p style="color:#64748b;font-size:13px;margin-bottom:24px">Clique no link do e-mail para ativar sua conta. Pode estar na pasta de spam.</p>
                    <div style="display:flex;flex-direction:column;gap:10px;align-items:center">
                        <button id="resendBtn" style="padding:10px 24px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600">
                            <i class="fa-solid fa-paper-plane"></i> Reenviar e-mail
                        </button>
                        <button onclick="window.location.reload()" style="padding:8px 24px;background:transparent;color:#2563eb;border:1px solid #2563eb;border-radius:8px;cursor:pointer;font-size:13px">
                            <i class="fa-solid fa-rotate-right"></i> Já verifiquei, entrar
                        </button>
                        <button onclick="import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js').then(m=>m.signOut(m.getAuth())); window.location.href='login.html'" style="padding:8px 24px;background:transparent;color:#94a3b8;border:none;cursor:pointer;font-size:12px">
                            Sair
                        </button>
                    </div>
                    <p id="resendMsg" style="margin-top:16px;font-size:13px;color:#16a34a;display:none"><i class="fa-solid fa-circle-check"></i> E-mail reenviado!</p>
                </div>`;
            document.getElementById('resendBtn').addEventListener('click', async () => {
                if (resending) return;
                resending = true;
                try {
                    await sendEmailVerification(user);
                    document.getElementById('resendMsg').style.display = 'block';
                    setTimeout(() => { resending = false; document.getElementById('resendMsg').style.display = 'none'; }, 4000);
                } catch(e) { resending = false; }
            });
            return;
        }
        if (!profileSnap.exists()) {
            loadingScr.innerHTML = `<div style="text-align:center;padding:40px">
                <p style="color:#dc2626;font-size:16px;margin-bottom:12px">
                  <b>Perfil não encontrado no banco de dados.</b>
                </p>
                <p style="color:#64748b;font-size:13px">UID: ${user.uid}</p>
                <p style="color:#64748b;font-size:13px">E-mail: ${user.email}</p>
                <p style="color:#64748b;font-size:13px;margin-top:8px">
                  Acesse <a href="setup.html">setup.html</a> para criar o perfil de administrador.
                </p>
                <button onclick="import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js').then(m=>m.signOut(m.getAuth())).finally(()=>window.location.href='login.html')"
                  style="margin-top:16px;padding:10px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer">
                  Voltar ao login
                </button>
            </div>`;
            return;
        }
        if (!profileSnap.data().ativo) {
            loadingScr.innerHTML = `<div style="text-align:center;padding:40px">
                <p style="color:#dc2626;font-size:16px"><b>Usuário inativo.</b> Contate o administrador.</p>
            </div>`;
            return;
        }
        state.user    = user;
        state.profile = { id: user.uid, ...profileSnap.data() };
        if (!state.profile.empresaId && state.profile.perfil !== 'superadmin') {
            loadingScr.innerHTML = `<div style="text-align:center;padding:40px;max-width:440px;margin:0 auto">
                <i class="fa-solid fa-building" style="font-size:48px;color:#2563eb;margin-bottom:20px;display:block"></i>
                <p style="color:#1e293b;font-size:16px;font-weight:600;margin-bottom:8px">Empresa não configurada</p>
                <p style="color:#64748b;font-size:13px;margin-bottom:20px">Seu usuário não está vinculado a nenhuma empresa.<br>Execute o setup para configurar.</p>
                <a href="setup.html" style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
                    <i class="fa-solid fa-gear"></i> Ir para Setup
                </a>
            </div>`;
            return;
        }
        // Registra último acesso e contagem diária (fire-and-forget)
        const hoje = new Date().toISOString().slice(0, 10); // '2026-06-14'
        updateDoc(doc(db, 'usuarios', user.uid), {
            lastLogin:            serverTimestamp(),
            [`acessosDia.${hoje}`]: increment(1),
        }).catch(() => {});

        await initApp();
        warmCache().catch(() => {}); // pré-carrega dados para uso offline
    } catch (e) {
        loadingScr.innerHTML = `<div style="text-align:center;padding:40px">
            <p style="color:#dc2626;font-size:16px"><b>Erro ao carregar perfil:</b></p>
            <p style="color:#64748b;font-size:13px;margin-top:8px">${e.message}</p>
            <p style="color:#64748b;font-size:13px">Código: ${e.code || 'desconhecido'}</p>
        </div>`;
    }
});

async function doLogout() {
    await signOut(auth);
    window.location.href = 'login.html';
}

document.getElementById('logoutBtn').addEventListener('click', e => { e.preventDefault(); doLogout(); });
document.getElementById('headerLogout').addEventListener('click', e => { e.preventDefault(); doLogout(); });

// ── Dark mode ─────────────────────────────────────────────────
function updateDarkIcon() {
    const btn = document.getElementById('darkToggle');
    if (!btn) return;
    const isDark = document.documentElement.classList.contains('dark');
    btn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    btn.title = isDark ? 'Modo claro' : 'Modo escuro';
}
document.getElementById('darkToggle').addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('frotaDark', isDark ? '1' : '0');
    updateDarkIcon();
});
updateDarkIcon();

// ── Mobile sidebar ────────────────────────────────────────────
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebarOverlay');
document.getElementById('menuToggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
});
overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
});
function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
}

function closeBnSheet() {
    document.getElementById('bnSheet')?.classList.remove('open');
    document.getElementById('bnSheetOverlay')?.classList.remove('open');
}

// ══════════════════════════════════════════════════════════════
// INIT & ROUTER
// ══════════════════════════════════════════════════════════════
async function initApp() {
    const p = state.profile;
    const initials = (p.nome || 'A').charAt(0).toUpperCase();

    // Carrega dados da empresa
    if (p.empresaId) {
        try {
            const snap = await getDoc(doc(db, 'empresas', p.empresaId));
            if (snap.exists()) state.empresa = { id: snap.id, ...snap.data() };
        } catch(_) {}
    }

    // Widget de plano na sidebar + aviso de vencimento com contagem regressiva
    const expiraEm = state.empresa?.planoExpiraEm;
    if (expiraEm) {
        const expDate  = expiraEm.toDate ? expiraEm.toDate() : new Date(expiraEm.seconds * 1000);
        const pad      = n => String(n).padStart(2, '0');
        const PLANO_LABEL = { basico:'Básico', profissional:'Profissional', empresarial:'Empresarial', gratuito:'Trial' };
        const planoNome   = PLANO_LABEL[state.empresa?.plano] || state.empresa?.plano || 'Plano';

        // Widget sempre visível na sidebar
        const widget      = document.getElementById('planWidget');
        const widgetNome  = document.getElementById('planWidgetNome');
        const widgetStatus= document.getElementById('planWidgetStatus');
        const widgetDias  = document.getElementById('planWidgetDias');

        if (widget) {
            widget.style.display = 'block';
            if (widgetNome) widgetNome.textContent = planoNome;
        }

        const banner = document.getElementById('safetyBanner');

        const tickAll = () => {
            const diff = expDate - Date.now();
            const d = Math.max(0, Math.floor(diff / 86400000));
            const h = Math.floor((Math.max(0, diff) % 86400000) / 3600000);
            const m = Math.floor((Math.max(0, diff) % 3600000)  / 60000);
            const s = Math.floor((Math.max(0, diff) % 60000)    / 1000);

            // Atualiza widget da sidebar
            if (widgetDias) {
                if (diff <= 0) {
                    widgetDias.textContent = 'Vencido';
                    widgetDias.style.color = '#fca5a5';
                } else if (d <= 7) {
                    widgetDias.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
                    widgetDias.style.color = d <= 2 ? '#fca5a5' : '#fcd34d';
                } else {
                    widgetDias.textContent = `${d} dias restantes`;
                    widgetDias.style.color = 'rgba(255,255,255,.55)';
                }
            }
            if (widgetStatus) {
                if (diff <= 0) {
                    widgetStatus.textContent = 'Vencido';
                    widgetStatus.style.cssText = 'font-size:10px;padding:1px 7px;border-radius:10px;font-weight:700;background:#fca5a5;color:#7f1d1d';
                } else {
                    widgetStatus.textContent = 'Ativo';
                    widgetStatus.style.cssText = 'font-size:10px;padding:1px 7px;border-radius:10px;font-weight:700;background:#bbf7d0;color:#14532d';
                }
            }

            // Banner de aviso (só nos últimos 7 dias)
            if (banner) {
                if (diff <= 0) {
                    banner.style.cssText = 'display:block;background:#fef2f2;border-bottom:2px solid #fca5a5;padding:10px 20px;text-align:center;font-size:13px;color:#b91c1c;font-family:inherit';
                    banner.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <strong>Seu plano venceu.</strong> Renove agora para continuar usando o sistema. <a href="planos.html" style="color:#b91c1c;font-weight:700;text-decoration:underline">Renovar →</a>`;
                    clearInterval(timer);
                } else if (d <= 7) {
                    banner.style.cssText = 'display:block;background:#fffbeb;border-bottom:2px solid #fcd34d;padding:10px 20px;text-align:center;font-size:13px;color:#92400e;font-family:inherit';
                    banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Plano vence em <strong style="font-variant-numeric:tabular-nums">${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s</strong> — <a href="planos.html" style="color:#92400e;font-weight:700;text-decoration:underline">Renovar agora →</a>`;
                }
            }
        };
        tickAll();
        const timer = setInterval(tickAll, 1000);
    }

    // Log de acesso
    if (p.empresaId) {
        addDoc(collection(db, 'logs'), {
            empresaId:   p.empresaId,
            empresaNome: state.empresa?.nome || '',
            userId:      state.user.uid,
            userNome:    p.nome || '',
            userEmail:   state.user.email || '',
            acao:        'acessou',
            modulo:      'sistema',
            itemId:      null,
            ts:          serverTimestamp(),
        }).catch(() => {});
    }

    const empNome = state.empresa?.nome || brandConfig.name;
    document.title = empNome;
    document.getElementById('brandName').textContent    = empNome;
    document.getElementById('brandTagline').textContent = brandConfig.tagline;

    // Aplica logo no sidebar
    if (state.empresa?.logo) {
        document.getElementById('sidebarLogoIcon').innerHTML =
            `<img src="${state.empresa.logo}" style="width:52px;height:52px;object-fit:contain;border-radius:10px">`;
    }

    document.getElementById('sidebarAvatar').textContent  = initials;
    document.getElementById('sidebarUserName').textContent = p.nome || '';
    document.getElementById('sidebarUserRole').textContent = roleLabel(p.perfil);
    document.getElementById('headerAvatar').textContent   = initials;
    document.getElementById('headerUserName').textContent  = p.nome || '';
    document.getElementById('headerUserRole').textContent  = roleLabel(p.perfil);

    if (p.perfil === 'admin' || p.perfil === 'superadmin') {
        document.querySelectorAll('.admin-nav').forEach(el => el.style.display = '');
    }
    if (p.perfil === 'superadmin' || state.user?.email === brandConfig.superadminEmail) {
        document.querySelectorAll('.superadmin-nav').forEach(el => el.style.display = '');
    }

    // Nav clicks
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
        el.addEventListener('click', () => {
            navigate(el.dataset.page);
            closeSidebar();
        });
    });

    // Bottom nav + sheet
    document.querySelectorAll('.bn-item[data-page]').forEach(el => {
        el.addEventListener('click', () => { navigate(el.dataset.page); closeSidebar(); });
    });
    document.querySelectorAll('.bn-sheet-item[data-page]').forEach(el => {
        el.addEventListener('click', () => { closeBnSheet(); navigate(el.dataset.page); closeSidebar(); });
    });
    const bnMore = document.getElementById('bn-more');
    const bnSheet = document.getElementById('bnSheet');
    const bnSheetOverlay = document.getElementById('bnSheetOverlay');
    if (bnMore) bnMore.addEventListener('click', () => { bnSheet?.classList.add('open'); bnSheetOverlay?.classList.add('open'); });
    if (bnSheetOverlay) bnSheetOverlay.addEventListener('click', closeBnSheet);

    applyPalette(localStorage.getItem('frotaPalette') || brandConfig.palette || 'blue');

    // Força troca de senha no primeiro acesso
    if (p.trocaSenha) { showTrocaSenhaModal(); return; }

    checkTrial();
    showSafetyBanner();
    navigate('dashboard');
    checkGPSBar();
    initPWAPrompt();
    checkOnboarding();
    initFCM();
}

function checkOnboarding() {
    const empresaId = state.empresa?.id;
    if (!empresaId) return;
    const key = `onboardingVisto_${empresaId}`;
    if (localStorage.getItem(key)) return;

    const criadoEm = state.empresa?.criadoEm;
    if (criadoEm) {
        const criadoMs = criadoEm.toDate ? criadoEm.toDate().getTime() : criadoEm.seconds * 1000;
        if (Date.now() - criadoMs > 7 * 24 * 60 * 60 * 1000) return;
    }

    localStorage.setItem(key, '1');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:28px 24px;width:100%;max-width:460px;box-shadow:0 24px 64px rgba(0,0,0,.3)">
            <div style="text-align:center;margin-bottom:20px">
                <div style="font-size:36px;margin-bottom:8px">🎉</div>
                <h2 style="font-size:20px;font-weight:800;color:#0f172a;margin:0 0 6px">Bem-vindo ao FrotaControl!</h2>
                <p style="font-size:13px;color:#64748b;margin:0">Você tem <strong>14 dias grátis</strong>. Veja por onde começar:</p>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">
                <div style="display:flex;align-items:center;gap:14px;background:#f8fafc;border-radius:12px;padding:14px">
                    <div style="width:36px;height:36px;background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;flex-shrink:0">🚗</div>
                    <div><div style="font-size:13px;font-weight:700;color:#1e293b">1. Cadastre seus veículos</div><div style="font-size:12px;color:#64748b">Placa, marca, modelo e KM atual</div></div>
                </div>
                <div style="display:flex;align-items:center;gap:14px;background:#f8fafc;border-radius:12px;padding:14px">
                    <div style="width:36px;height:36px;background:linear-gradient(135deg,#16a34a,#15803d);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;flex-shrink:0">👤</div>
                    <div><div style="font-size:13px;font-weight:700;color:#1e293b">2. Adicione os motoristas</div><div style="font-size:12px;color:#64748b">Nome, CNH e tipo de vínculo</div></div>
                </div>
                <div style="display:flex;align-items:center;gap:14px;background:#f8fafc;border-radius:12px;padding:14px">
                    <div style="width:36px;height:36px;background:linear-gradient(135deg,#9333ea,#7e22ce);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;flex-shrink:0">📋</div>
                    <div><div style="font-size:13px;font-weight:700;color:#1e293b">3. Registre uma utilização</div><div style="font-size:12px;color:#64748b">Quem saiu, com qual carro e para onde</div></div>
                </div>
                <div style="display:flex;align-items:center;gap:14px;background:#f8fafc;border-radius:12px;padding:14px">
                    <div style="width:36px;height:36px;background:linear-gradient(135deg,#0891b2,#0e7490);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;flex-shrink:0">📡</div>
                    <div><div style="font-size:13px;font-weight:700;color:#1e293b">4. Ative o rastreamento GPS</div><div style="font-size:12px;color:#64748b">Só precisa do celular do motorista</div></div>
                </div>
            </div>
            <button id="onboardingBtn" style="width:100%;padding:13px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer">
                <i class="fa-solid fa-rocket"></i> Começar — cadastrar primeiro veículo
            </button>
            <button id="onboardingSkip" style="width:100%;padding:10px;background:none;border:none;color:#94a3b8;font-size:13px;cursor:pointer;margin-top:8px">Pular por agora</button>
        </div>`;
    document.body.appendChild(overlay);
    document.getElementById('onboardingBtn').addEventListener('click', () => {
        overlay.remove();
        navigate('veiculos');
    });
    document.getElementById('onboardingSkip').addEventListener('click', () => overlay.remove());
}


// ── PWA install prompt ────────────────────────────────────────
let _pwaPrompt = null;
function initPWAPrompt() {
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        _pwaPrompt = e;
        if (!localStorage.getItem('pwaDismissed')) {
            setTimeout(() => {
                document.getElementById('pwaInstallBanner')?.classList.add('pwa-show');
            }, 4000);
        }
    });
    document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
        if (!_pwaPrompt) return;
        document.getElementById('pwaInstallBanner').classList.remove('pwa-show');
        _pwaPrompt.prompt();
        const { outcome } = await _pwaPrompt.userChoice;
        if (outcome === 'accepted') showToast('App instalado com sucesso!');
        _pwaPrompt = null;
    });
    document.getElementById('pwaDismissBtn')?.addEventListener('click', () => {
        document.getElementById('pwaInstallBanner').classList.remove('pwa-show');
        localStorage.setItem('pwaDismissed', '1');
    });
}

function showTrocaSenhaModal() {
    document.getElementById('loadingScreen').style.display = 'none';
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:28px 24px;width:100%;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,.3)">
            <h2 style="font-size:18px;font-weight:700;color:#1e293b;margin-bottom:6px"><i class="fa-solid fa-lock" style="color:#2563eb"></i> Criar nova senha</h2>
            <p style="font-size:13px;color:#64748b;margin-bottom:20px">Por segurança, defina uma senha pessoal antes de continuar.</p>
            <div id="trocaErr" style="display:none;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:14px"></div>
            <div style="margin-bottom:12px">
                <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;display:block;margin-bottom:5px">Nova senha</label>
                <input type="password" id="novaSenha" placeholder="Mín. 6 caracteres" minlength="6"
                    style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box">
            </div>
            <div style="margin-bottom:20px">
                <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;display:block;margin-bottom:5px">Confirmar senha</label>
                <input type="password" id="novaSenha2" placeholder="Repita a senha"
                    style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box">
            </div>
            <button id="trocaSenhaBtn" style="width:100%;padding:11px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">
                <i class="fa-solid fa-check"></i> Salvar senha e entrar
            </button>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('trocaSenhaBtn').addEventListener('click', async () => {
        const s1  = document.getElementById('novaSenha').value;
        const s2  = document.getElementById('novaSenha2').value;
        const err = document.getElementById('trocaErr');
        const btn = document.getElementById('trocaSenhaBtn');
        err.style.display = 'none';
        if (s1.length < 6) { err.textContent = 'Senha deve ter ao menos 6 caracteres.'; err.style.display = 'block'; return; }
        if (s1 !== s2)     { err.textContent = 'As senhas não coincidem.';               err.style.display = 'block'; return; }
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
        try {
            await updatePassword(state.user, s1);
            await updateDoc(doc(db, 'usuarios', state.user.uid), { trocaSenha: false });
            modal.remove();
            checkTrial();
            navigate('dashboard');
            checkGPSBar();
        } catch(e) {
            err.textContent = 'Erro ao salvar: ' + e.message;
            err.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Salvar senha e entrar';
        }
    });
}

function navigate(page, sub = null) {
    if (state.currentPage === 'map' && page !== 'map') {
        if (mapUnsub) { mapUnsub(); mapUnsub = null; }
        const pc = document.getElementById('pageContent');
        pc.style.padding = '';
        pc.style.display = '';
        pc.style.flexDirection = '';
        pc.style.height = '';
        pc.style.overflow = '';
    }
    state.currentPage = page;
    state.sub = sub;

    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.page === page);
    });
    // Bottom nav sync
    const bnPages = ['dashboard','vehicles','usage','map'];
    document.querySelectorAll('.bn-item[data-page]').forEach(el => {
        el.classList.toggle('active', el.dataset.page === page);
    });
    const bnMore = document.getElementById('bn-more');
    if (bnMore) bnMore.classList.toggle('active', !bnPages.includes(page));

    const labels = { dashboard:'Dashboard', vehicles:'Veículos', drivers:'Motoristas',
                     usage:'Utilização Diária', fines:'Multas', infracoes:'Infrações CTB',
                     map:'Rastreamento', rodizio:'Rodízio', licenciamento:'Licenciamento',
                     fuel:'Combustível', manutencao:'Manutenção', reports:'Relatórios',
                     users:'Usuários', empresa:'Minha Empresa', ajuda:'Ajuda' };
    bcCurrent.textContent = labels[page] || page;

    // FAB logic
    const FAB_ACTIONS = {
        vehicles:  () => navigate('vehicles','create'),
        drivers:   () => navigate('drivers','create'),
        usage:     () => navigate('usage','create'),
        fines:     () => navigate('fines','create'),
        fuel:      () => navigate('fuel','create'),
        manutencao:() => navigate('manutencao','create'),
    };
    const fab = document.getElementById('fabBtn');
    if (fab) {
        fab.className = FAB_ACTIONS[page] ? 'fab-visible' : '';
        fab.onclick = FAB_ACTIONS[page] || null;
    }

    loadingScr.style.display = 'none';
    pageContent.style.display = 'block';

    const pages = { dashboard:renderDashboard, vehicles:renderVehicles, drivers:renderDrivers,
                    usage:renderUsage, fines:renderFines, infracoes:renderInfracoes,
                    map:renderMap, rodizio:renderRodizio, licenciamento:renderLicenciamento,
                    fuel:renderFuel, manutencao:renderMaintenance, reports:renderReports,
                    users:renderUsers, empresa:renderEmpresa, ajuda:renderAjuda };
    if (pages[page]) {
        pages[page](sub).catch(e => {
            setContent(`<div style="padding:48px 24px;text-align:center;max-width:480px;margin:0 auto">
                <i class="fa-solid fa-circle-exclamation" style="font-size:52px;color:#dc2626;margin-bottom:16px;display:block"></i>
                <p style="color:#dc2626;font-weight:700;font-size:17px;margin-bottom:8px">Erro ao carregar dados</p>
                <p style="color:#64748b;font-size:13px;margin-bottom:6px">${esc(e.message)}</p>
                ${e.code ? `<p style="color:#94a3b8;font-size:12px;margin-bottom:16px">Código: ${esc(e.code)}</p>` : ''}
                <button class="btn btn-primary" onclick="navigate('${page}')">
                    <i class="fa-solid fa-rotate-right"></i> Tentar novamente
                </button>
            </div>`);
        });
    }
}

window.navigate = navigate;

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════
function setContent(html) {
    pageContent.innerHTML = html;
    const kids = pageContent.firstElementChild?.children;
    if (!kids?.length) return;
}

// ── Toast notifications ───────────────────────────────────────
const TOAST_ICONS = { success:'fa-circle-check', danger:'fa-circle-xmark', warning:'fa-triangle-exclamation', info:'fa-circle-info' };
function showToast(msg, type = 'success', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fa-solid ${TOAST_ICONS[type]||TOAST_ICONS.info} toast-icon"></i><span>${esc(msg)}</span><button class="toast-close" aria-label="Fechar">×</button>`;
    document.getElementById('toastContainer').appendChild(el);
    el.querySelector('.toast-close').addEventListener('click', () => _removeToast(el));
    setTimeout(() => _removeToast(el), duration);
}
function _removeToast(el) {
    if (!el.parentNode) return;
    el.remove();
}
function showFlash(msg, type = 'success') { showToast(msg, type); }

function resizeImageToBase64(file, maxW = 320, maxH = 220, quality = 0.72) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
                if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ── Confirm modal ─────────────────────────────────────────────
function showConfirm(msg, onOk, title = 'Confirmar exclusão') {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
    <div class="confirm-sheet">
        <div class="confirm-icon"><i class="fa-solid fa-trash"></i></div>
        <div class="confirm-title">${esc(title)}</div>
        <div class="confirm-msg">${esc(msg)}</div>
        <div class="confirm-btns">
            <button class="confirm-cancel">Cancelar</button>
            <button class="confirm-ok">Excluir</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.confirm-cancel').addEventListener('click', close);
    overlay.querySelector('.confirm-ok').addEventListener('click', () => { close(); onOk(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function trocasTimeline(u, driverMap) {
    if (!u.trocas?.length) return '';
    const t = u.trocas;
    const rows = [];
    rows.push({ nome: t[0].motoristaNome || driverMap[t[0].motoristaId]?.nome || '—', de: u.horaSaida?.substring(0,5)||'—', ate: t[0].hora });
    for (let i = 0; i < t.length - 1; i++) {
        rows.push({ nome: t[i].novoMotoristaNome || driverMap[t[i].novoMotoristaId]?.nome || '—', de: t[i].hora, ate: t[i+1].hora });
    }
    const last = t[t.length-1];
    rows.push({ nome: last.novoMotoristaNome || driverMap[last.novoMotoristaId]?.nome || '—', de: last.hora, ate: u.horaRetorno?.substring(0,5)||null, isCurrent: !u.horaRetorno });
    return `<div style="margin-top:8px;padding:8px 10px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd">
        <div style="font-size:10px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px"><i class="fa-solid fa-clock-rotate-left" style="margin-right:4px"></i>Motoristas no dia</div>
        ${rows.map((r, i) => `<div style="display:flex;align-items:center;gap:8px;font-size:11px;padding:3px 0${i<rows.length-1?';border-bottom:1px solid #e0f2fe':''}">
            <i class="fa-solid fa-user" style="color:${i===rows.length-1&&r.isCurrent?'var(--accent)':'#94a3b8'};font-size:10px;flex-shrink:0;width:12px"></i>
            <span style="font-weight:600;color:#334155;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.nome)}</span>
            <span style="font-weight:700;color:${r.isCurrent?'#15803d':'#0369a1'};background:${r.isCurrent?'#dcfce7':'#e0f2fe'};padding:1px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;font-size:12px">${esc(r.de)} → ${r.ate ? esc(r.ate) : 'agora'}</span>
            ${r.isCurrent ? '<span style="font-size:9px;background:#bbf7d0;color:#166534;padding:1px 5px;border-radius:4px;font-weight:700;flex-shrink:0">atual</span>' : ''}
        </div>`).join('')}
    </div>`;
}

function showDriverSwapModal(drivers, u, onConfirm) {
    const activeDrivers = drivers.filter(d => d.ativo !== false && d.id !== u.motoristaId);
    const now = new Date().toTimeString().substring(0,5);
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
    <div class="confirm-sheet" style="max-width:420px;text-align:left">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
            <div style="width:40px;height:40px;border-radius:50%;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                <i class="fa-solid fa-arrows-rotate" style="color:#2563eb;font-size:17px"></i>
            </div>
            <div>
                <div style="font-weight:700;font-size:15px;color:var(--text)">Trocar Motorista</div>
                <div style="font-size:12px;color:var(--muted)">O horário fica registrado para fins de multa</div>
            </div>
        </div>
        <div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:10px 12px;margin-bottom:16px;display:flex;align-items:flex-start;gap:8px">
            <i class="fa-solid fa-triangle-exclamation" style="color:#ca8a04;font-size:14px;flex-shrink:0;margin-top:1px"></i>
            <span style="font-size:12px;color:#92400e;font-weight:600;line-height:1.4">Confirme o horário exato — identifica quem conduzia em caso de infração de trânsito.</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
            <div>
                <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Horário da troca *</label>
                <input type="time" id="swapHora" class="form-control" value="${now}" style="font-size:22px;font-weight:800;color:var(--accent);text-align:center;border:2px solid var(--accent);border-radius:8px;padding:10px">
            </div>
            <div>
                <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">KM na troca</label>
                <input type="number" id="swapKm" class="form-control" min="${u.kmInicial||0}" placeholder="${u.kmFinal||u.kmInicial||''}">
            </div>
            <div>
                <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Novo motorista *</label>
                <select id="swapDriver" class="form-control">
                    <option value="">— Selecione —</option>
                    ${activeDrivers.map(d => `<option value="${d.id}">${esc(d.nome)}</option>`).join('')}
                </select>
            </div>
        </div>
        <div class="confirm-btns" style="margin-top:20px">
            <button class="confirm-cancel">Cancelar</button>
            <button class="confirm-ok" style="background:var(--accent);color:#fff"><i class="fa-solid fa-arrows-rotate"></i> Confirmar Troca</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.confirm-cancel').addEventListener('click', close);
    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
        const hora   = document.getElementById('swapHora').value;
        const kmRaw  = document.getElementById('swapKm').value;
        const km     = kmRaw ? parseInt(kmRaw) : null;
        const novoId = document.getElementById('swapDriver').value;
        if (!hora)   { showFlash('Informe o horário da troca.', 'danger'); return; }
        if (!novoId) { showFlash('Selecione o novo motorista.', 'danger'); return; }
        const novoDriver = activeDrivers.find(d => d.id === novoId);
        close();
        onConfirm({ hora, km, novoId, novoNome: novoDriver?.nome || '' });
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(val) {
    if (!val) return '—';
    const d = val.toDate ? val.toDate() : new Date(val + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
}

function fmtMoney(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2}); }
function fmtKm(v)    { return Number(v || 0).toLocaleString('pt-BR') + ' km'; }
function waLink(tel) { let t=(tel||'').replace(/\D/g,''); if(t&&!t.startsWith('55'))t='55'+t; return t; }
function motoristUrl(u, v, m) {
    if (!u?.id || !u?.linkToken) return '';
    const p = new URLSearchParams({
        u:   u.id,
        t:   u.linkToken,
        n:   m?.nome    || u.motoristaNome || '',
        p:   v?.placa   || u.veiculoPlaca  || '',
        dc:  v ? vDesc(v) : (u.veiculoDesc || ''),
        s:   (u.horaSaida||'').substring(0,5),
        dst: u.destino  || '',
        ki:  String(u.kmInicial || 0),
        kf:  String(u.kmFinal   || u.kmInicial || 0),
        vid: u.veiculoId || '',
    });
    return `https://frotacontrol.api.br/motorista.html?${p.toString()}`;
}
function waMsg(u, v, m) {
    const link = motoristUrl(u, v, m);
    return `Olá ${m?.nome||u.motoristaNome||''}, você está com o veículo ${v?.placa||u.veiculoPlaca||''} desde ${(u.horaSaida||'').substring(0,5)}.`
        + (link ? `\n\n📍 Reporte o KM:\n${link}` : '');
}
function trackerUrl(u, v, m) {
    const p = new URLSearchParams({
        uso:   u.id,
        placa: v?.placa  || u.veiculoPlaca || '',
        mod:   v ? vDesc(v) : (u.veiculoDesc || ''),
        mot:   m?.nome   || u.motoristaNome || '',
        eid:   state.profile?.empresaId || '',
    });
    return `https://frotacontrol.api.br/tracker.html?${p.toString()}`;
}
function waMsgTracker(u, v, m) {
    return `Olá ${m?.nome||u.motoristaNome||''}! Por favor abra este link no seu celular para ativar o rastreamento do veículo *${v?.placa||u.veiculoPlaca||''}*:\n\n📡 ${trackerUrl(u,v,m)}\n\nMantenha a tela aberta durante o trajeto.`;
}
function today()     { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function roleLabel(r) {
    return { admin:'Administrador', superadmin:'Administrador', gerente:'Gerente', visualizador:'Visualizador' }[r] || r;
}

function canEdit() { return ['admin','gerente','superadmin'].includes(state.profile?.perfil); }
function isAdmin() { return ['admin','superadmin'].includes(state.profile?.perfil); }

function vehicleStatusBadge(s) {
    const map = {
        disponivel: '<span class="badge badge-success"><span class="status-dot dot-green"></span>Disponível</span>',
        em_uso:     '<span class="badge badge-info"><span class="status-dot dot-blue"></span>Em Uso</span>',
        manutencao: '<span class="badge badge-warning"><span class="status-dot dot-orange"></span>Manutenção</span>',
    };
    return map[s] || `<span class="badge badge-muted">${esc(s)}</span>`;
}

function fineStatusBadge(s) {
    const map = {
        pendente:   '<span class="badge badge-danger">Pendente</span>',
        pago:       '<span class="badge badge-success">Pago</span>',
        transferido:'<span class="badge badge-muted">Transferido</span>',
    };
    return map[s] || `<span class="badge badge-muted">${esc(s)}</span>`;
}

function plate(p) { return `<span class="plate">${esc(p)}</span>`; }
function vDesc(v) { return [v?.marca, v?.modelo].filter(Boolean).join(' ') || ''; }

function emptyState(icon, title, subtitle = '') {
    return `<div class="empty-state"><div class="empty-icon"><i class="fa-solid ${icon}"></i></div><h3>${title}</h3>${subtitle ? `<p>${subtitle}</p>` : ''}</div>`;
}

function pagination(currentPage, totalPages, onPage) {
    if (totalPages <= 1) return '';
    let html = '<div class="pagination">';
    if (currentPage > 1) html += `<a class="page-link" data-pg="${currentPage-1}"><i class="fa-solid fa-chevron-left"></i></a>`;
    for (let i = Math.max(1, currentPage-2); i <= Math.min(totalPages, currentPage+2); i++) {
        html += `<a class="page-link${i===currentPage?' active':''}" data-pg="${i}">${i}</a>`;
    }
    if (currentPage < totalPages) html += `<a class="page-link" data-pg="${currentPage+1}"><i class="fa-solid fa-chevron-right"></i></a>`;
    html += '</div>';
    return html;
}

function attachPagination(onPage) {
    document.querySelectorAll('.page-link[data-pg]').forEach(el => {
        el.addEventListener('click', () => onPage(parseInt(el.dataset.pg)));
    });
}

// ── Firestore helpers ─────────────────────────────────────────
async function getAll(col, ...constraints) {
    const empId = state.profile?.empresaId;
    const allC  = (empId && TENANT_COLS.has(col))
        ? [where('empresaId', '==', empId), ...constraints]
        : constraints;
    const q = allC.length ? query(collection(db, col), ...allC) : collection(db, col);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getOne(col, id) {
    const snap = await getDoc(doc(db, col, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function _origSaveDoc(col, data, id = null) {
    const empId = state.profile?.empresaId;
    const payload = (!id && empId && TENANT_COLS.has(col))
        ? { ...data, empresaId: empId }
        : data;
    if (id) {
        await updateDoc(doc(db, col, id), { ...payload, atualizadoEm: serverTimestamp() });
        return id;
    } else {
        const ref = await addDoc(collection(db, col), { ...payload, criadoEm: serverTimestamp() });
        return ref.id;
    }
}

async function _origDeleteFireDoc(col, id) {
    await deleteDoc(doc(db, col, id));
}

// ── Cache helpers ─────────────────────────────────────────────
async function getVehicles(fresh = false) {
    if (!state.cache.vehicles || fresh)
        state.cache.vehicles = await getAll('veiculos', orderBy('placa'));
    return state.cache.vehicles;
}

function isAdminUser() {
    return ['admin','superadmin'].includes(state.profile?.perfil);
}

async function getVisibleVehicles(fresh = false) {
    const all = await getVehicles(fresh);
    return isAdminUser() ? all : all.filter(v => (v.categoria || 'empresa') !== 'pessoal');
}

async function getDrivers(fresh = false) {
    if (!state.cache.drivers || fresh)
        state.cache.drivers = await getAll('motoristas', orderBy('nome'));
    return state.cache.drivers;
}

// Pré-carrega coleções críticas no cache do Firestore (offline-first)
async function warmCache() {
    if (!state.profile?.empresaId) return;
    await Promise.allSettled([
        getAll('veiculos'),
        getAll('motoristas'),
        getAll('utilizacoes', orderBy('dataUtilizacao', 'desc')),
        getAll('abastecimentos', orderBy('data', 'desc')),
        getAll('manutencoes',    orderBy('data', 'desc')),
        getAll('multas',         orderBy('dataInfracao', 'desc')),
    ]);
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════
function getWeatherDesc(code) {
    if (code === 0)       return { icon:'☀️',  label:'Sol aberto' };
    if (code <= 2)        return { icon:'🌤️',  label:'Poucas nuvens' };
    if (code === 3)       return { icon:'☁️',  label:'Nublado' };
    if (code <= 48)       return { icon:'🌫️',  label:'Neblina' };
    if (code <= 55)       return { icon:'🌦️',  label:'Garoa' };
    if (code <= 65)       return { icon:'🌧️',  label:'Chuva' };
    if (code <= 75)       return { icon:'🌨️',  label:'Neve' };
    if (code <= 82)       return { icon:'🌧️',  label:'Chuva forte' };
    if (code <= 99)       return { icon:'⛈️',  label:'Trovoada' };
    return { icon:'🌡️', label:'Variável' };
}

async function fetchWeather() {
    const el = document.getElementById('weatherWidget');
    if (!el) return;

    async function loadWeather(lat, lng, cidade) {
        const res  = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`);
        const data = await res.json();
        const c    = data.current;
        const w    = getWeatherDesc(c.weather_code);
        el.innerHTML = `
            <div style="font-size:30px;line-height:1;flex-shrink:0">${w.icon}</div>
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
                    <span style="font-size:22px;font-weight:800;color:#1e293b">${Math.round(c.temperature_2m)}°C</span>
                    <span style="font-size:12px;color:#64748b;font-weight:600">${w.label}</span>
                </div>
                <div style="font-size:11px;color:#94a3b8;margin-top:2px">
                    Sensação ${Math.round(c.apparent_temperature)}°C &nbsp;·&nbsp;
                    <i class="fa-solid fa-droplet" style="color:#3b82f6;font-size:9px"></i> ${c.relative_humidity_2m}% &nbsp;·&nbsp;
                    <i class="fa-solid fa-wind" style="font-size:9px"></i> ${Math.round(c.wind_speed_10m)} km/h
                </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
                <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;text-transform:uppercase">${cidade}</div>
                <div style="font-size:10px;color:#cbd5e1;margin-top:2px">${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
            </div>`;
    }

    try {
        if (!navigator.geolocation) throw new Error('sem geo');
        navigator.geolocation.getCurrentPosition(
            async pos => {
                try {
                    const { latitude: lat, longitude: lng } = pos.coords;
                    let cidade = '';
                    try {
                        const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pt-BR`, { headers: { 'User-Agent': 'FrotaControl/1.0' } });
                        const gd  = await geo.json();
                        cidade = gd.address?.city || gd.address?.town || gd.address?.village || gd.address?.county || '';
                    } catch(_) {}
                    await loadWeather(lat, lng, cidade);
                } catch {
                    el.innerHTML = `<i class="fa-solid fa-cloud-slash" style="color:#94a3b8"></i><span style="font-size:12px;color:#94a3b8;margin-left:8px">Clima indisponível</span>`;
                }
            },
            async () => {
                // Permissão negada — tenta IP geolocation como fallback
                try {
                    const ipRes = await fetch('https://ipapi.co/json/');
                    const ipDt  = await ipRes.json();
                    const lat   = ipDt.latitude;
                    const lng   = ipDt.longitude;
                    const cidade = ipDt.city || '';
                    await loadWeather(lat, lng, cidade);
                } catch {
                    el.innerHTML = `<i class="fa-solid fa-cloud-slash" style="color:#94a3b8"></i><span style="font-size:12px;color:#94a3b8;margin-left:8px">Clima indisponível</span>`;
                }
            },
            { timeout: 6000 }
        );
    } catch {
        el.innerHTML = `<i class="fa-solid fa-cloud-slash" style="color:#94a3b8"></i><span style="font-size:12px;color:#94a3b8;margin-left:8px">Clima indisponível</span>`;
    }
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════
async function renderDashboard() {
    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');

    const [allVehiclesRaw, drivers, usages, fines, fuelAll, manutAll] = await Promise.all([
        getAll('veiculos'), getAll('motoristas'), getAll('utilizacoes'), getAll('multas'),
        getAll('abastecimentos', orderBy('data', 'desc')),
        getAll('manutencoes', orderBy('data', 'desc'))
    ]);
    const vehicles = isAdminUser() ? allVehiclesRaw : allVehiclesRaw.filter(v => (v.categoria || 'empresa') !== 'pessoal');

    const disponiveis = vehicles.filter(v => v.status === 'disponivel').length;
    const emUso       = vehicles.filter(v => v.status === 'em_uso').length;
    const manutencao  = vehicles.filter(v => v.status === 'manutencao').length;
    const motAtivos   = drivers.filter(d => d.ativo !== false).length;
    const totalMultas = fines.length;
    const valorPend   = fines.filter(f => f.status === 'pendente').reduce((s, f) => s + (f.valor || 0), 0);

    const nowDate    = new Date();
    const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
    const fuelMes    = fuelAll.filter(f => f.data && new Date(f.data + 'T00:00:00') >= monthStart);
    const fuelGasto  = fuelMes.reduce((s, f) => s + (f.valorTotal || 0), 0);
    const fuelRecent = fuelAll.slice(0, 6);

    const manutMes   = manutAll.filter(m => m.data && new Date(m.data + 'T00:00:00') >= monthStart);
    const manutGasto = manutMes.reduce((s, m) => s + (m.custo || 0), 0);
    const manutAgend = manutAll.filter(m => m.status === 'agendada').length;

    const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const driverMap  = Object.fromEntries(drivers.map(d => [d.id, d]));

    const latestKmByV = {};
    usages.forEach(u => { if (u.kmFinal && u.kmFinal > (latestKmByV[u.veiculoId]||0)) latestKmByV[u.veiculoId] = u.kmFinal; });
    const lastManutKm = {};
    manutAll.forEach(m => { if (m.kmProxima && (!lastManutKm[m.veiculoId]||(m.data||'')>(lastManutKm[m.veiculoId]?.data||''))) lastManutKm[m.veiculoId] = m; });
    const kmAlerts = Object.entries(lastManutKm).map(([vid,m]) => {
        const v = vehicleMap[vid]; if (!v) return null;
        const curKm = latestKmByV[vid] || v.quilometragem || 0;
        const remaining = (m.kmProxima||0) - curKm;
        return remaining <= 1000 ? { v, m, remaining } : null;
    }).filter(Boolean).sort((a,b) => a.remaining - b.remaining);

    const now = new Date();
    const cnhAlerts = drivers.filter(d => {
        if (!d.cnhValidade) return false;
        const diff = (new Date(d.cnhValidade + 'T00:00:00') - now) / 86400000;
        return diff <= 30;
    }).sort((a, b) => a.cnhValidade.localeCompare(b.cnhValidade));

    const licAlerts = vehicles.filter(v => {
        if (!v.dataLicenciamento) return false;
        const vencD = new Date(v.dataLicenciamento + 'T00:00:00');
        const pagoD = v.licenciamentoPagoEm ? new Date(v.licenciamentoPagoEm + 'T00:00:00') : null;
        if (pagoD && pagoD.getFullYear() === vencD.getFullYear()) return false;
        const diff = (vencD - now) / 86400000;
        return diff <= 30;
    }).sort((a, b) => a.dataLicenciamento.localeCompare(b.dataLicenciamento));

    const seguroAlerts = vehicles.filter(v => {
        if (!v.seguroVencimento) return false;
        const diff = (new Date(v.seguroVencimento + 'T00:00:00') - now) / 86400000;
        return diff <= 30;
    }).sort((a, b) => a.seguroVencimento.localeCompare(b.seguroVencimento));

    const ipvaAlerts = vehicles.filter(v => {
        if (!v.ipvaVencimento) return false;
        const diff = (new Date(v.ipvaVencimento + 'T00:00:00') - now) / 86400000;
        return diff <= 30;
    }).sort((a, b) => a.ipvaVencimento.localeCompare(b.ipvaVencimento));

    const oilAlerts = vehicles.filter(v =>
        v.kmProximaTrocaOleo && (v.quilometragem || 0) >= v.kmProximaTrocaOleo - 500
    ).sort((a, b) => (a.kmProximaTrocaOleo - (a.quilometragem||0)) - (b.kmProximaTrocaOleo - (b.quilometragem||0)));

    const recentUsage = [...usages].sort((a,b) => (b.criadoEm?.seconds||0) - (a.criadoEm?.seconds||0)).slice(0, 8);
    const recentFines = [...fines].sort((a,b) => (b.criadoEm?.seconds||0) - (a.criadoEm?.seconds||0)).slice(0, 8);

    const seenVehTipo = new Set();
    const dateAlerts = [];
    manutAll.forEach(m => {
        if (!m.dataProxima || !m.veiculoId) return;
        const key = m.veiculoId + '_' + (m.tipo || 'outros');
        if (seenVehTipo.has(key)) return;
        seenVehTipo.add(key);
        const v = vehicleMap[m.veiculoId];
        if (!v) return;
        const diff = Math.floor((new Date(m.dataProxima + 'T00:00:00') - now) / 86400000);
        if (diff <= 15) dateAlerts.push({ v, m, diff });
    });
    dateAlerts.sort((a, b) => a.diff - b.diff);

    const activePal = localStorage.getItem('frotaPalette') || 'blue';
    const palColors = { blue:'#2563eb', green:'#16a34a', purple:'#9333ea', red:'#dc2626', teal:'#0d9488' };
    const todayDay  = now.getDay();
    const restrictedVehicles = isRodizioEnabled() && todayDay >= 1 && todayDay <= 5
        ? vehicles.filter(v => v.tipo !== 'motos' && plateRestrictionDay(v.placa) === todayDay) : [];

    // Atividades recentes misturadas (utilizações + multas + abastecimentos)
    const activities = [
        ...recentUsage.slice(0,5).map(u => ({ type:'uso', ts: u.criadoEm?.seconds||0, data: u })),
        ...recentFines.slice(0,4).map(f => ({ type:'multa', ts: f.criadoEm?.seconds||0, data: f })),
        ...fuelRecent.slice(0,4).map(f => ({ type:'fuel', ts: f.criadoEm?.seconds||0, data: f })),
    ].sort((a,b) => b.ts - a.ts).slice(0,10);

    const alertCount = cnhAlerts.length + licAlerts.length + kmAlerts.length + dateAlerts.length + seguroAlerts.length + ipvaAlerts.length + oilAlerts.length;

    const userName = state.profile?.nome?.split(' ')?.[0] || 'Gestor';
    const hora = now.getHours();
    const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

    setContent(`
    <div style="padding:0 16px 16px;max-width:900px;margin:0 auto">

    <!-- Hero card -->
    <div style="background:linear-gradient(135deg,var(--primary) 0%,var(--accent) 100%);border-radius:24px;padding:22px 24px 20px;margin-bottom:16px;color:#fff;position:relative;overflow:hidden">
        <div style="position:absolute;top:-20px;right:-20px;width:120px;height:120px;background:rgba(255,255,255,.07);border-radius:50%"></div>
        <div style="position:absolute;bottom:-30px;right:40px;width:80px;height:80px;background:rgba(255,255,255,.05);border-radius:50%"></div>
        <p style="font-size:13px;opacity:.75;margin-bottom:4px">${saudacao}, ${esc(userName)} 👋</p>
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px">
            <span id="heroCount" style="font-size:36px;font-weight:800;line-height:1">0</span>
            <span style="font-size:14px;opacity:.8">veículos na frota</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span style="background:rgba(255,255,255,.15);backdrop-filter:blur(4px);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600">
                <i class="fa-solid fa-circle-check" style="margin-right:4px;font-size:10px"></i>${disponiveis} disponíveis
            </span>
            <span style="background:rgba(255,255,255,.15);backdrop-filter:blur(4px);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600">
                <i class="fa-solid fa-road" style="margin-right:4px;font-size:10px"></i>${emUso} em uso
            </span>
            ${manutencao ? `<span style="background:rgba(255,165,0,.25);backdrop-filter:blur(4px);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600">
                <i class="fa-solid fa-wrench" style="margin-right:4px;font-size:10px"></i>${manutencao} manutenção
            </span>` : ''}
            ${alertCount ? `<span style="background:rgba(220,38,38,.3);backdrop-filter:blur(4px);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600">
                <i class="fa-solid fa-bell" style="margin-right:4px;font-size:10px"></i>${alertCount} alerta${alertCount>1?'s':''}
            </span>` : ''}
        </div>
        <!-- Tema picker discreto no canto -->
        <div style="position:absolute;top:16px;right:16px;display:flex;gap:5px;align-items:center">
            ${Object.keys(PALETTES).map(id => `
            <button data-pal="${id}" title="${PAL_LABELS[id]}"
                style="width:16px;height:16px;border-radius:50%;background:${palColors[id]};
                border:${activePal===id?'2px solid #fff':'2px solid rgba(255,255,255,.3)'};
                cursor:pointer;padding:0;transition:.15s;flex-shrink:0"></button>`).join('')}
        </div>
    </div>

    <!-- Clima Caieiras -->
    <div id="weatherWidget" style="background:#fff;border-radius:16px;padding:12px 18px;margin-bottom:16px;box-shadow:0 2px 10px rgba(0,0,0,.07);display:flex;align-items:center;gap:14px">
        <i class="fa-solid fa-cloud-sun" style="color:#94a3b8;font-size:18px;flex-shrink:0"></i>
        <span style="font-size:12px;color:#94a3b8">Carregando clima...</span>
    </div>

    <!-- Ações rápidas -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
        ${[
            {icon:'fa-plus',        label:'Nova Saída',  color:'#2563eb', bg:'#eff6ff', page:"navigate('usage','create')"},
            {icon:'fa-car',         label:'Veículos',    color:'#0d9488', bg:'#f0fdfa', page:"navigate('vehicles')"},
            {icon:'fa-map-location-dot', label:'Mapa',  color:'#7c3aed', bg:'#faf5ff', page:"navigate('map')"},
            {icon:'fa-chart-bar',   label:'Relatórios',  color:'#ea580c', bg:'#fff7ed', page:"navigate('reports')"},
        ].map(a => `
        <button onclick="${a.page}" class="quick-action" style="background:#fff;border:none;border-radius:18px;padding:14px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;box-shadow:0 2px 10px rgba(0,0,0,.07);-webkit-tap-highlight-color:transparent">
            <div style="width:46px;height:46px;border-radius:14px;background:${a.bg};display:flex;align-items:center;justify-content:center;font-size:18px;color:${a.color}">
                <i class="fa-solid ${a.icon}"></i>
            </div>
            <span style="font-size:11px;font-weight:700;color:#475569;text-align:center;line-height:1.2">${a.label}</span>
        </button>`).join('')}
    </div>

    <!-- Rodízio hoje -->
    ${restrictedVehicles.length ? (() => {
        const cityModel = CITY_MODELS[getRodizioCity()] || CITY_MODELS.sp;
        return `<div style="border-radius:20px;overflow:hidden;margin-bottom:16px;border:2px solid #fca5a5">
            <div style="background:linear-gradient(135deg,#7f1d1d,#dc2626);padding:14px 18px;display:flex;align-items:center;gap:12px">
                <div style="width:40px;height:40px;background:rgba(255,255,255,.15);border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <i class="fa-solid fa-ban" style="color:#fff;font-size:18px"></i>
                </div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:14px;font-weight:800;color:#fff">Rodízio Ativo Hoje</div>
                    <div style="font-size:11px;color:rgba(255,255,255,.75);margin-top:1px"><i class="fa-solid fa-clock" style="margin-right:4px"></i>${esc(cityModel.horario)} · ${esc(cityModel.nome)}</div>
                </div>
                <span style="background:rgba(255,255,255,.2);color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:20px;white-space:nowrap">${restrictedVehicles.length} veículo${restrictedVehicles.length>1?'s':''}</span>
            </div>
            <div style="background:#fff9f9;padding:12px 16px;display:flex;flex-direction:column;gap:8px">
                ${restrictedVehicles.map(v => `
                <div style="display:flex;align-items:center;gap:10px;background:#fff;border-radius:12px;padding:10px 14px;border:1px solid #fecaca;cursor:pointer" onclick="navigate('vehicles')">
                    ${v.foto ? `<img src="${v.foto}" style="width:44px;height:34px;object-fit:cover;border-radius:6px;flex-shrink:0">` :
                    `<div style="width:44px;height:34px;background:#fef2f2;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fa-solid fa-car" style="color:#dc2626;font-size:14px"></i></div>`}
                    <div style="flex:1;min-width:0">
                        <div style="font-family:monospace;font-size:15px;font-weight:800;color:#1e293b;letter-spacing:1.5px">${esc(v.placa)}</div>
                        <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(vDesc(v)||'—')}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-size:10px;font-weight:700;color:#dc2626;background:#fef2f2;padding:2px 8px;border-radius:10px;letter-spacing:.5px">RESTRITO</div>
                        <div style="font-size:10px;color:#94a3b8;margin-top:3px">${v.status==='em_uso'?'<span style="color:#2563eb;font-weight:600">Em uso</span>':v.status==='disponivel'?'<span style="color:#16a34a;font-weight:600">Disponível</span>':esc(v.status)}</div>
                    </div>
                </div>
                <div style="margin-top:8px;padding:8px 10px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                    <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#7f1d1d">
                        <i class="fa-solid fa-gavel" style="font-size:10px;color:#dc2626"></i>
                        <span style="font-weight:700">Art. 235 CTB</span>
                        <span style="color:#991b1b">— Transitar em horário proibido</span>
                    </div>
                    <div style="display:flex;gap:10px;margin-left:auto;flex-shrink:0">
                        <span style="font-size:11px;font-weight:700;color:#dc2626;background:#fff;padding:2px 8px;border-radius:6px;border:1px solid #fecaca"><i class="fa-solid fa-star" style="font-size:9px;margin-right:3px"></i>5 pontos</span>
                        <span style="font-size:11px;font-weight:700;color:#dc2626;background:#fff;padding:2px 8px;border-radius:6px;border:1px solid #fecaca"><i class="fa-solid fa-money-bill" style="font-size:9px;margin-right:3px"></i>R$ 195,23</span>
                    </div>
                </div>`).join('')}
            </div>
        </div>`;
    })() : ''}

    <!-- Financeiro do mês -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:#fff;border-radius:20px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.06)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                <div style="width:34px;height:34px;border-radius:10px;background:#fef2f2;display:flex;align-items:center;justify-content:center;color:#dc2626;font-size:14px"><i class="fa-solid fa-triangle-exclamation"></i></div>
                <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Multas Pend.</span>
            </div>
            <div style="font-size:22px;font-weight:800;color:#dc2626">${fmtMoney(valorPend)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">${totalMultas} total registradas</div>
        </div>
        <div style="background:#fff;border-radius:20px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.06)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                <div style="width:34px;height:34px;border-radius:10px;background:#f0fdf4;display:flex;align-items:center;justify-content:center;color:#16a34a;font-size:14px"><i class="fa-solid fa-gas-pump"></i></div>
                <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Combustível</span>
            </div>
            <div style="font-size:22px;font-weight:800;color:#16a34a">${fmtMoney(fuelGasto)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">este mês · ${fuelMes.length} abast.</div>
        </div>
        <div style="background:#fff;border-radius:20px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.06)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                <div style="width:34px;height:34px;border-radius:10px;background:#fff7ed;display:flex;align-items:center;justify-content:center;color:#ea580c;font-size:14px"><i class="fa-solid fa-wrench"></i></div>
                <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Manutenção</span>
            </div>
            <div style="font-size:22px;font-weight:800;color:#ea580c">${fmtMoney(manutGasto)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">este mês${manutAgend ? ` · ${manutAgend} agendada${manutAgend>1?'s':''}` : ''}</div>
        </div>
        <div style="background:#fff;border-radius:20px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.06)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                <div style="width:34px;height:34px;border-radius:10px;background:#faf5ff;display:flex;align-items:center;justify-content:center;color:#7c3aed;font-size:14px"><i class="fa-solid fa-users"></i></div>
                <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Motoristas</span>
            </div>
            <div style="font-size:22px;font-weight:800;color:#7c3aed">${motAtivos}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">ativos na frota</div>
        </div>
    </div>

    <!-- Alertas -->
    ${(restrictedVehicles.length || cnhAlerts.length || licAlerts.length || kmAlerts.length || dateAlerts.length) ? `
    <div style="background:#fff;border-radius:20px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-bottom:16px;overflow:hidden">
        <div style="padding:14px 18px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:14px;font-weight:700;color:#1e293b"><i class="fa-solid fa-bell" style="color:#f59e0b;margin-right:8px"></i>Alertas</span>
            <span style="background:#fef3c7;color:#b45309;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700">${alertCount}</span>
        </div>
        ${cnhAlerts.map(d => {
            const diff = Math.floor((new Date(d.cnhValidade+'T00:00:00') - now) / 86400000);
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
                <div style="width:36px;height:36px;border-radius:12px;background:#fff7ed;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#ea580c"><i class="fa-solid fa-id-card"></i></div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:13px">${esc(d.nome)}</div>
                    <div style="font-size:11px;color:#94a3b8">CNH ${diff<0?'VENCIDA':'vence'} ${diff<0?`há ${Math.abs(diff)}d`:`em ${diff}d`} · ${fmtDate(d.cnhValidade)}</div>
                </div>
                <span style="background:${diff<0?'#fef2f2':'#fff7ed'};color:${diff<0?'#dc2626':'#ea580c'};border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap">${diff<0?'VENCIDA':'A VENCER'}</span>
            </div>`;
        }).join('')}
        ${licAlerts.map(v => {
            const diff = Math.floor((new Date(v.dataLicenciamento+'T00:00:00') - now) / 86400000);
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
                <div style="width:36px;height:36px;border-radius:12px;background:#f5f3ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#7c3aed"><i class="fa-solid fa-file-certificate"></i></div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:13px">${esc(v.placa)} — CRLV</div>
                    <div style="font-size:11px;color:#94a3b8">Licenciamento ${diff<0?'VENCIDO':'vence'} ${diff<0?`há ${Math.abs(diff)}d`:`em ${diff}d`}</div>
                </div>
                <span style="background:${diff<0?'#fef2f2':'#f5f3ff'};color:${diff<0?'#dc2626':'#7c3aed'};border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap">${diff<0?'VENCIDO':'A VENCER'}</span>
            </div>`;
        }).join('')}
        ${[...kmAlerts.map(({v,m,remaining}) => ({v,label:`Faltam ${fmtKm(Math.abs(remaining))}`,tipo:MANUT_LABELS[m.tipo]||m.tipo,vencida:remaining<=0})),
           ...dateAlerts.map(({v,m,diff}) => ({v,label:diff<0?`Vencida há ${Math.abs(diff)}d`:diff===0?'Hoje':diff===1?'Amanhã':`Em ${diff}d`,tipo:MANUT_LABELS[m.tipo]||m.tipo,vencida:diff<=0}))
          ].map(a => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
            <div style="width:36px;height:36px;border-radius:12px;background:#fffbeb;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#d97706"><i class="fa-solid fa-oil-can"></i></div>
            <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:13px">${esc(a.v.placa)} — ${esc(a.tipo)}</div>
                <div style="font-size:11px;color:#94a3b8">${a.label}</div>
            </div>
            <span style="background:${a.vencida?'#fef2f2':'#fffbeb'};color:${a.vencida?'#dc2626':'#d97706'};border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap">${a.vencida?'VENCIDA':'PRÓXIMA'}</span>
        </div>`).join('')}
        ${seguroAlerts.map(v => {
            const diff = Math.floor((new Date(v.seguroVencimento+'T00:00:00') - now) / 86400000);
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
                <div style="width:36px;height:36px;border-radius:12px;background:#fef2f2;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#dc2626"><i class="fa-solid fa-shield-halved"></i></div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:13px">${esc(v.placa)} — Seguro</div>
                    <div style="font-size:11px;color:#94a3b8">Seguro ${diff<0?'VENCIDO':'vence'} ${diff<0?`há ${Math.abs(diff)}d`:`em ${diff}d`}</div>
                </div>
                <span style="background:${diff<0?'#fef2f2':'#fff7ed'};color:${diff<0?'#dc2626':'#ea580c'};border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap">${diff<0?'VENCIDO':'A VENCER'}</span>
            </div>`;
        }).join('')}
        ${ipvaAlerts.map(v => {
            const diff = Math.floor((new Date(v.ipvaVencimento+'T00:00:00') - now) / 86400000);
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
                <div style="width:36px;height:36px;border-radius:12px;background:#faf5ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#7c3aed"><i class="fa-solid fa-receipt"></i></div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:13px">${esc(v.placa)} — IPVA</div>
                    <div style="font-size:11px;color:#94a3b8">IPVA ${diff<0?'VENCIDO':'vence'} ${diff<0?`há ${Math.abs(diff)}d`:`em ${diff}d`}</div>
                </div>
                <span style="background:${diff<0?'#fef2f2':'#faf5ff'};color:${diff<0?'#dc2626':'#7c3aed'};border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap">${diff<0?'VENCIDO':'A VENCER'}</span>
            </div>`;
        }).join('')}
        ${oilAlerts.map(v => {
            const diff = v.kmProximaTrocaOleo - (v.quilometragem || 0);
            const vencida = diff <= 0;
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
                <div style="width:36px;height:36px;border-radius:12px;background:#fffbeb;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#d97706"><i class="fa-solid fa-oil-can"></i></div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:13px">${esc(v.placa)} — Troca de Óleo</div>
                    <div style="font-size:11px;color:#94a3b8">${vencida ? `Ultrapassou por ${Math.abs(diff)} km` : `Faltam ${diff} km`}</div>
                </div>
                <span style="background:${vencida?'#fef2f2':'#fffbeb'};color:${vencida?'#dc2626':'#d97706'};border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap">${vencida?'VENCIDA':'PRÓXIMA'}</span>
            </div>`;
        }).join('')}
    </div>` : ''}

    <!-- Atividade recente (estilo extrato bancário) -->
    ${activities.length ? `
    <div style="background:#fff;border-radius:20px;box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden">
        <div style="padding:14px 18px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:14px;font-weight:700;color:#1e293b"><i class="fa-solid fa-clock-rotate-left" style="color:var(--accent);margin-right:8px"></i>Atividade Recente</span>
        </div>
        ${activities.map(a => {
            if (a.type === 'uso') {
                const u = a.data, v = vehicleMap[u.veiculoId], m = driverMap[u.motoristaId];
                return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc" onclick="navigate('usage')" style="cursor:pointer">
                    <div style="width:40px;height:40px;border-radius:14px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#2563eb;font-size:16px"><i class="fa-solid fa-road"></i></div>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v?esc(v.placa)+' · '+esc(vDesc(v)):'—'}</div>
                        <div style="font-size:11px;color:#94a3b8">${esc(m?.nome||'—')} · ${fmtDate(u.dataUtilizacao)}</div>
                    </div>
                    ${u.status==='em_uso'?'<span style="background:#eff6ff;color:#2563eb;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap">EM USO</span>':'<span style="background:#f0fdf4;color:#16a34a;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap">FINALIZADO</span>'}
                </div>`;
            }
            if (a.type === 'multa') {
                const f = a.data, v = vehicleMap[f.veiculoId];
                return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
                    <div style="width:40px;height:40px;border-radius:14px;background:#fef2f2;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#dc2626;font-size:16px"><i class="fa-solid fa-triangle-exclamation"></i></div>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:13px">${v?esc(v.placa):'—'} · Multa</div>
                        <div style="font-size:11px;color:#94a3b8">${fmtDate(f.dataInfracao)}</div>
                    </div>
                    <span style="font-weight:700;font-size:13px;color:#dc2626;white-space:nowrap">${fmtMoney(f.valor)}</span>
                </div>`;
            }
            const f = a.data, v = vehicleMap[f.veiculoId];
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
                <div style="width:40px;height:40px;border-radius:14px;background:#f0fdf4;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#16a34a;font-size:16px"><i class="fa-solid fa-gas-pump"></i></div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:600;font-size:13px">${v?esc(v.placa):'—'} · Abastecimento</div>
                    <div style="font-size:11px;color:#94a3b8">${fmtDate(f.data)}${f.litros?` · ${f.litros.toLocaleString('pt-BR',{maximumFractionDigits:1})}L`:''}</div>
                </div>
                <span style="font-weight:700;font-size:13px;color:#16a34a;white-space:nowrap">${f.valorTotal?fmtMoney(f.valorTotal):'—'}</span>
            </div>`;
        }).join('')}
    </div>` : ''}

    <!-- Gráfico de combustível (últimos 6 meses) -->
    ${fuelAll.length >= 2 ? `
    <div style="background:#fff;border-radius:20px;box-shadow:0 2px 10px rgba(0,0,0,.06);padding:18px;margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <span style="font-size:14px;font-weight:700;color:#1e293b"><i class="fa-solid fa-chart-line" style="color:#16a34a;margin-right:8px"></i>Combustível — últimos 6 meses</span>
        </div>
        <canvas id="fuelChart" height="120"></canvas>
    </div>` : ''}

    </div>`);

    // Clima
    fetchWeather();

    // Contador animado no hero
    const heroNum = document.getElementById('heroCount');
    if (heroNum) {
        const target = vehicles.length;
        let cur = 0;
        const step = Math.max(1, Math.ceil(target / 20));
        const tick = setInterval(() => {
            cur = Math.min(cur + step, target);
            heroNum.textContent = cur;
            if (cur >= target) clearInterval(tick);
        }, 40);
    }

    // Palette picker
    document.querySelectorAll('[data-pal]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.pal;
            applyPalette(id);
            document.querySelectorAll('[data-pal]').forEach(b => {
                const active = b.dataset.pal === id;
                b.style.border   = active ? '2px solid #1e293b' : '2px solid transparent';
                b.style.boxShadow = active ? `0 0 0 2px ${palColors[b.dataset.pal]}` : 'none';
            });
        });
    });

    // Gráfico de combustível — últimos 6 meses
    const fuelCanvas = document.getElementById('fuelChart');
    if (fuelCanvas && window.Chart) {
        const months = [];
        const gastoMes = [];
        const litrMes  = [];
        const now2 = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
            const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            months.push(label);
            const start = new Date(d.getFullYear(), d.getMonth(), 1);
            const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0);
            const recs  = fuelAll.filter(f => { if (!f.data) return false; const fd = new Date(f.data+'T00:00:00'); return fd >= start && fd <= end; });
            gastoMes.push(recs.reduce((s, r) => s + (r.valorTotal || 0), 0));
            litrMes.push(recs.reduce((s, r) => s + (r.litros || 0), 0));
        }
        new window.Chart(fuelCanvas, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [
                    { label: 'Gasto (R$)', data: gastoMes, backgroundColor: 'rgba(22,163,74,.75)', borderRadius: 6, borderSkipped: false },
                    { label: 'Litros', data: litrMes, backgroundColor: 'rgba(37,99,235,.4)', borderRadius: 6, borderSkipped: false, yAxisID: 'y2' },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                plugins: { legend: { labels: { font: { size: 11 }, boxWidth: 12 } }, tooltip: { callbacks: {
                    label: ctx => ctx.datasetIndex === 0 ? `R$ ${ctx.parsed.y.toLocaleString('pt-BR',{minimumFractionDigits:2})}` : `${ctx.parsed.y.toLocaleString('pt-BR',{maximumFractionDigits:1})} L`
                }}},
                scales: {
                    y:  { position: 'left',  ticks: { font: { size: 10 }, callback: v => 'R$'+v.toLocaleString('pt-BR',{maximumFractionDigits:0}) }, grid: { color: '#f1f5f9' } },
                    y2: { position: 'right', ticks: { font: { size: 10 }, callback: v => v+'L' }, grid: { display: false } },
                    x:  { ticks: { font: { size: 10 } }, grid: { display: false } },
                }
            }
        });
    }

    // Expose navigate to inline onclick
    window.navigate = navigate;
}

// ── Swipe-to-delete ───────────────────────────────────────────
function addSwipeDelete(container, onDelete) {
    if (!container) return;
    container.querySelectorAll('.swipe-wrap').forEach(wrap => {
        const inner = wrap.querySelector('.swipe-inner');
        if (!inner) return;
        let startX = 0, curX = 0, swiping = false;
        inner.addEventListener('touchstart', e => {
            startX = e.touches[0].clientX;
            swiping = true;
            curX = 0;
            inner.style.transition = 'none';
        }, { passive: true });
        inner.addEventListener('touchmove', e => {
            if (!swiping) return;
            curX = e.touches[0].clientX - startX;
            if (curX < 0) inner.style.transform = `translateX(${Math.max(curX, -72)}px)`;
        }, { passive: true });
        inner.addEventListener('touchend', () => {
            inner.style.transition = 'transform .2s ease';
            if (curX < -48) {
                inner.style.transform = 'translateX(-72px)';
                wrap.classList.add('swiped');
            } else {
                inner.style.transform = '';
                wrap.classList.remove('swiped');
            }
            swiping = false;
        });
        const bg = wrap.querySelector('.swipe-bg');
        if (bg) bg.addEventListener('click', () => {
            const id = wrap.dataset.swipeId;
            const name = wrap.dataset.swipeName || 'este item';
            inner.style.transform = '';
            wrap.classList.remove('swiped');
            if (id) onDelete(id, name);
        });
    });
}

// ── Offline queue ─────────────────────────────────────────────
const OFFLINE_QUEUE_KEY = 'frotaOfflineQueue';
function getOfflineQueue() { try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch(_) { return []; } }
function saveOfflineQueue(q) { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); }
function queueOfflineAction(action) {
    const q = getOfflineQueue();
    q.push({ ...action, ts: Date.now() });
    saveOfflineQueue(q);
    showToast('Salvo localmente — será sincronizado ao reconectar.', 'warning');
}
async function flushOfflineQueue() {
    const q = getOfflineQueue();
    if (!q.length) return;
    let failed = [];
    for (const item of q) {
        try {
            if (item.type === 'save') {
                if (item.id) await updateDoc(doc(db, item.col, item.id), { ...item.data, atualizadoEm: serverTimestamp() });
                else { const ref = await addDoc(collection(db, item.col), { ...item.data, criadoEm: serverTimestamp() }); }
            } else if (item.type === 'delete') {
                await deleteDoc(doc(db, item.col, item.id));
            }
        } catch(_) { failed.push(item); }
    }
    saveOfflineQueue(failed);
    if (q.length - failed.length > 0) {
        showToast(`${q.length - failed.length} ação(ões) sincronizada(s) com sucesso!`);
        navigate(state.currentPage, state.sub);
    }
}
window.addEventListener('online', () => flushOfflineQueue());

async function saveDoc(col, data, id = null) {
    if (!navigator.onLine) {
        const empId = state.profile?.empresaId;
        const payload = (!id && empId && TENANT_COLS.has(col)) ? { ...data, empresaId: empId } : data;
        queueOfflineAction({ type: 'save', col, id, data: payload });
        return id || 'offline_' + Date.now();
    }
    // Verificação de limite do plano para novos cadastros
    if (!id && LIMIT_COLS.has(col) && state.profile?.empresaId && state.empresa) {
        const plano = state.empresa.plano || 'gratuito';
        const lim   = (PLAN_LIMITS[plano] || PLAN_LIMITS.gratuito)[col];
        if (lim !== null && lim !== undefined) {
            const countSnap = await getDocs(query(collection(db, col), where('empresaId', '==', state.profile.empresaId)));
            if (countSnap.size >= lim) {
                const PLANO_LABEL = { basico:'Básico', profissional:'Profissional', empresarial:'Empresarial', gratuito:'Trial', trial:'Trial' };
                const colLabel    = col === 'veiculos' ? 'veículos' : 'motoristas';
                showToast(`Limite do plano ${PLANO_LABEL[plano] || plano}: máximo ${lim} ${colLabel}. Acesse Planos para fazer upgrade.`);
                return null;
            }
        }
    }
    const result = await _origSaveDoc(col, data, id);
    if (LOG_MODULES.has(col) && state.user && state.profile?.empresaId) {
        addDoc(collection(db, 'logs'), {
            empresaId:   state.profile.empresaId,
            empresaNome: state.empresa?.nome || '',
            userId:      state.user.uid,
            userNome:    state.profile.nome || '',
            userEmail:   state.user.email || '',
            acao:        id ? 'editou' : 'criou',
            modulo:      col,
            itemId:      result,
            ts:          serverTimestamp(),
        }).catch(() => {});
    }
    return result;
}
async function deleteFireDoc(col, id) {
    if (!navigator.onLine) {
        queueOfflineAction({ type: 'delete', col, id });
        return;
    }
    await _origDeleteFireDoc(col, id);
    if (LOG_MODULES.has(col) && state.user && state.profile?.empresaId) {
        addDoc(collection(db, 'logs'), {
            empresaId:   state.profile.empresaId,
            empresaNome: state.empresa?.nome || '',
            userId:      state.user.uid,
            userNome:    state.profile.nome || '',
            userEmail:   state.user.email || '',
            acao:        'excluiu',
            modulo:      col,
            itemId:      id,
            ts:          serverTimestamp(),
        }).catch(() => {});
    }
}

// ── Indicador de fila offline no banner ───────────────────────
function updateOfflineQueueBanner() {
    const q = getOfflineQueue();
    const banner = document.getElementById('offlineBanner');
    if (banner && q.length > 0) {
        banner.innerHTML = `<i class="fa-solid fa-wifi-slash" style="color:#f59e0b;margin-right:6px"></i>
            Você está offline — ${q.length} ação(ões) pendente(s) de sincronização.`;
    }
}
window.addEventListener('offline', updateOfflineQueueBanner);

// ══════════════════════════════════════════════════════════════
// COMPONENTES UI (statCard, print, modal de multas)
// ══════════════════════════════════════════════════════════════
function statCard(color, icon, label, value) {
    return `<div class="stat-card ${color}">
        <div class="stat-icon"><i class="fa-solid ${icon}"></i></div>
        <div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>
    </div>`;
}

function openPrintWindow(title, headCells, bodyRows) {
    const w   = window.open('', '_blank', 'width=960,height=720');
    const emp = state.empresa;
    const logoHtml = emp?.logo
        ? `<img src="${emp.logo}" style="height:44px;object-fit:contain;border-radius:6px;margin-right:14px">`
        : `<div style="width:44px;height:44px;background:#1e3a5f;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-right:14px"><span style="color:#fff;font-size:20px">🚗</span></div>`;
    const empNome  = emp?.nome || brandConfig.name;
    const empTel   = emp?.telefone ? ` · ${emp.telefone}` : '';
    const empEmail = emp?.emailContato ? ` · ${emp.emailContato}` : '';
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
    <style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;margin:24px}
        .header{display:flex;align-items:center;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #1e3a5f}
        .emp-name{font-size:15px;font-weight:700;color:#1e3a5f;margin:0 0 2px}
        .emp-info{font-size:10px;color:#64748b;margin:0}
        h1{font-size:16px;margin:6px 0 2px;color:#1e293b}
        .sub{color:#94a3b8;font-size:10px}
        table{width:100%;border-collapse:collapse}
        th{background:#1e3a5f;color:#fff;padding:7px 10px;text-align:left;font-size:11px}
        td{padding:6px 10px;border-bottom:1px solid #e2e8f0}
        tr:nth-child(even) td{background:#f8fafc}
        .btn{margin-top:16px;padding:8px 18px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px}
        @media print{.btn{display:none}}
    </style></head><body>
    <div class="header">
        ${logoHtml}
        <div>
            <p class="emp-name">${empNome}</p>
            <p class="emp-info">${empTel}${empEmail}</p>
            <h1>${title}</h1>
            <p class="sub">Emitido em ${new Date().toLocaleString('pt-BR')}</p>
        </div>
    </div>
    <table><thead><tr>${headCells.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${bodyRows}</tbody></table>
    <button class="btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    </body></html>`);
    w.document.close();
}

// ══════════════════════════════════════════════════════════════
// VEHICLES
// ══════════════════════════════════════════════════════════════
function showMultasModal(placa, data) {
    const existing = document.getElementById('multasModal');
    if (existing) existing.remove();

    const header = data?.header?.[0] || {};
    const multas = data?.data?.[0]?.debitos_multas || [];
    const ipva   = data?.data?.[0]?.debitos_ipva   || [];
    const licenc = data?.data?.[0]?.debitos_licenciamento || [];
    const erro   = data?.errors?.length ? data.errors.join(', ') : null;

    const fmtR = v => v != null ? `R$ ${Number(v).toFixed(2).replace('.',',')}` : '—';

    const listaMultas = multas.length ? multas.map(m => `
        <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px">
            <div style="font-size:12px;font-weight:700;color:#dc2626">${esc(m.descricao||m.auto_infracao||'Multa')}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px">
                ${m.data_infracao?`Data: ${esc(m.data_infracao)} `:''}
                ${m.local?`· ${esc(m.local)}`:''}
            </div>
            <div style="font-size:13px;font-weight:700;color:#dc2626;margin-top:4px">${fmtR(m.valor)}</div>
        </div>`).join('') : '<p style="color:var(--muted);font-size:13px">Nenhuma multa encontrada.</p>';

    const modal = document.createElement('div');
    modal.id = 'multasModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `
    <div style="background:var(--card);border-radius:16px;width:100%;max-width:520px;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="background:var(--primary);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-radius:16px 16px 0 0">
        <div>
          <div style="font-family:monospace;font-size:20px;font-weight:800;color:#fff;letter-spacing:3px">${esc(placa)}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.7)">Consulta DETRAN SP</div>
        </div>
        <button id="multasClose" style="background:rgba(255,255,255,.2);border:none;border-radius:8px;color:#fff;cursor:pointer;padding:6px 12px;font-size:16px">✕</button>
      </div>
      <div style="padding:16px 20px">
        ${erro ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;color:#dc2626;font-size:13px;margin-bottom:12px">${esc(erro)}</div>` : ''}
        <h3 style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Multas (${multas.length})</h3>
        ${listaMultas}
        ${ipva.length ? `<h3 style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px">IPVA</h3>
        ${ipva.map(i=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span>${esc(i.descricao||'IPVA')}</span><span style="font-weight:700">${fmtR(i.valor)}</span></div>`).join('')}` : ''}
        ${licenc.length ? `<h3 style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px">Licenciamento</h3>
        ${licenc.map(l=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span>${esc(l.descricao||'Licenciamento')}</span><span style="font-weight:700">${fmtR(l.valor)}</span></div>`).join('')}` : ''}
        <div style="margin-top:16px;font-size:10px;color:var(--muted);text-align:center">Fonte: DETRAN SP via Infosimples · ${new Date().toLocaleString('pt-BR')}</div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    document.getElementById('multasClose').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

let vehiclePage = 1, vehicleSearch = '', vehicleStatusFilter = '', vehicleCatFilter = '', vehicleViewMode = 'grid', vehicleShowHidden = false;

const CAT_LABELS = { empresa:'Empresa', pessoal:'Pessoal', locado:'Locado', terceiro:'Terceiro' };
const CAT_STYLES = {
    empresa: { bg:'rgba(37,99,235,.22)',  color:'rgba(255,255,255,.95)' },
    pessoal: { bg:'rgba(217,119,6,.28)',  color:'rgba(255,255,255,.95)' },
    locado:  { bg:'rgba(13,148,136,.28)', color:'rgba(255,255,255,.95)' },
    terceiro:{ bg:'rgba(124,58,237,.28)', color:'rgba(255,255,255,.95)' },
};

// ══════════════════════════════════════════════════════════════
// VEÍCULOS
// ══════════════════════════════════════════════════════════════
async function renderVehicles(sub) {
    if (sub === 'create') { renderVehicleForm(null); return; }
    if (sub && sub.startsWith('edit:'))    { renderVehicleForm(sub.split(':')[1]); return; }
    if (sub && sub.startsWith('history:')) { renderVehicleHistory(sub.split(':')[1]); return; }

    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');
    const [all, activeUsages, allDrivers] = await Promise.all([
        getVisibleVehicles(true),
        getAll('utilizacoes', where('status', '==', 'em_uso')),
        getDrivers()
    ]);
    const activeUsageMap = Object.fromEntries(activeUsages.map(u => [u.veiculoId, u]));
    const driverMap = Object.fromEntries(allDrivers.map(d => [d.id, d]));

    const hiddenCount = all.filter(v => v.oculto).length;
    let filtered = all.filter(v => {
        const q = vehicleSearch.toLowerCase();
        const matchQ = !q || v.placa?.toLowerCase().includes(q) || v.modelo?.toLowerCase().includes(q) || v.marca?.toLowerCase().includes(q);
        const matchS = !vehicleStatusFilter || v.status === vehicleStatusFilter;
        const matchC = !vehicleCatFilter || (v.categoria || 'empresa') === vehicleCatFilter;
        const matchH = vehicleShowHidden || !v.oculto;
        return matchQ && matchS && matchC && matchH;
    });

    const perPage = 15, total = filtered.length, totalPages = Math.ceil(total / perPage);
    if (vehiclePage > totalPages) vehiclePage = 1;
    const paged = filtered.slice((vehiclePage-1)*perPage, vehiclePage*perPage);

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-car" style="color:var(--accent)"></i> Veículos</h1>
            <p class="page-subtitle">${total} veículo(s)</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
            <div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden">
                <button id="vViewGrid" title="Grade" style="padding:7px 12px;border:none;cursor:pointer;font-size:14px;background:${vehicleViewMode==='grid'?'var(--primary)':'var(--card)'};color:${vehicleViewMode==='grid'?'#fff':'var(--muted)'}"><i class="fa-solid fa-grip"></i></button>
                <button id="vViewList" title="Lista" style="padding:7px 12px;border:none;cursor:pointer;font-size:14px;background:${vehicleViewMode==='list'?'var(--primary)':'var(--card)'};color:${vehicleViewMode==='list'?'#fff':'var(--muted)'}"><i class="fa-solid fa-list"></i></button>
            </div>
            ${hiddenCount ? `<button class="btn btn-secondary" id="vToggleHidden" title="${vehicleShowHidden?'Esconder ocultos':'Mostrar ocultos'}"><i class="fa-solid ${vehicleShowHidden?'fa-eye-slash':'fa-eye'}"></i> ${vehicleShowHidden?'Esconder ocultos':`Ocultos (${hiddenCount})`}</button>` : ''}
            ${canEdit() ? '<button class="btn btn-primary" id="addVehicleBtn"><i class="fa-solid fa-plus"></i> Novo Veículo</button>' : ''}
        </div>
    </div>

    <div class="filters-bar">
        <div class="form-group grow">
            <label class="form-label">Buscar</label>
            <input type="text" id="vSearch" class="form-control" placeholder="Placa, modelo, marca..." value="${esc(vehicleSearch)}">
        </div>
        <div class="form-group">
            <label class="form-label">Status</label>
            <select id="vStatusFilter" class="form-control">
                <option value="">Todos</option>
                <option value="disponivel" ${vehicleStatusFilter==='disponivel'?'selected':''}>Disponível</option>
                <option value="em_uso" ${vehicleStatusFilter==='em_uso'?'selected':''}>Em Uso</option>
                <option value="manutencao" ${vehicleStatusFilter==='manutencao'?'selected':''}>Manutenção</option>
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Categoria</label>
            <select id="vCatFilter" class="form-control">
                <option value="">Todas</option>
                <option value="empresa"  ${vehicleCatFilter==='empresa'?'selected':''}>Empresa</option>
                <option value="pessoal"  ${vehicleCatFilter==='pessoal'?'selected':''}>Pessoal</option>
                <option value="locado"   ${vehicleCatFilter==='locado'?'selected':''}>Locado</option>
                <option value="terceiro" ${vehicleCatFilter==='terceiro'?'selected':''}>Terceiro</option>
            </select>
        </div>
        <div class="form-group" style="justify-content:flex-end">
            <button class="btn btn-primary" id="vFilterBtn"><i class="fa-solid fa-magnifying-glass"></i> Filtrar</button>
            <button class="btn btn-secondary" id="vClearBtn">Limpar</button>
        </div>
    </div>

    ${paged.length ? `
    <div style="${vehicleViewMode==='list'?'display:flex;flex-direction:column;gap:10px':'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px'}">
    ${paged.map(v => {
      const tipoIcon = v.tipo==='motos' ? 'fa-motorcycle' : v.tipo==='caminhoes' ? 'fa-truck' : 'fa-car';
      const cat = CAT_STYLES[v.categoria||'empresa'] || CAT_STYLES.empresa;
      const catLabel = CAT_LABELS[v.categoria||'empresa'] || 'Empresa';
      const licBadge = (() => {
        if (!v.dataLicenciamento) return '';
        const vencD = new Date(v.dataLicenciamento+'T00:00:00');
        const pagoD = v.licenciamentoPagoEm ? new Date(v.licenciamentoPagoEm+'T00:00:00') : null;
        const pago  = pagoD && pagoD.getFullYear() === vencD.getFullYear();
        if (pago) return '<span style="font-size:11px;color:#16a34a"><i class="fa-solid fa-circle-check"></i> Licenc. Pago</span>';
        const diff = Math.floor((vencD - new Date()) / 86400000);
        if (diff < 0)  return '<span style="font-size:11px;color:#dc2626"><i class="fa-solid fa-triangle-exclamation"></i> Licenc. VENCIDO</span>';
        if (diff <= 30) return `<span style="font-size:11px;color:#d97706"><i class="fa-solid fa-clock"></i> Licenc. ${diff}d</span>`;
        return '';
      })();
      if (vehicleViewMode === 'list') return `
    <div class="card-list-row" style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;display:flex;align-items:center">
      <div style="background:var(--primary);padding:10px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:100px;align-self:stretch">
        <i class="fa-solid ${tipoIcon}" style="color:rgba(255,255,255,.7);font-size:13px"></i>
        <div style="font-family:monospace;font-size:15px;font-weight:800;color:#fff;letter-spacing:2px">${esc(v.placa)}</div>
        <span style="background:${cat.bg};color:${cat.color};border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700">${catLabel}</span>
      </div>
      <div style="padding:10px 14px;flex:1;display:flex;align-items:center;gap:20px;flex-wrap:wrap;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(vDesc(v))} <span style="color:var(--muted);font-weight:400">${v.ano||''}</span></div>
        <div style="font-size:12px;color:var(--muted)">KM: <span style="font-weight:600;color:var(--text)">${fmtKm(v.quilometragem)}</span></div>
        ${licBadge}
        ${vehicleStatusBadge(v.status)}
        ${v.status === 'em_uso' && activeUsageMap[v.id] ? (() => { const u=activeUsageMap[v.id]; const md=driverMap[u.motoristaId]; return `<span style="font-size:11px;color:#2563eb;font-weight:600"><i class="fa-solid fa-user" style="margin-right:3px"></i>${esc(md?.nome||'—')}${u.destino?' — '+esc(u.destino):''}${u.horaSaida?' <span style="color:var(--muted);font-weight:400">saiu '+esc((u.horaSaida||'').substring(0,5))+'</span>':''}</span>`; })() : ''}
      </div>
      <div class="card-list-actions">
        <button class="btn btn-secondary btn-sm" data-multas="${esc(v.id)}" data-placa="${esc(v.placa)}" data-renavam="${esc(v.renavam||'')}" title="Consultar Multas DETRAN SP"><i class="fa-solid fa-magnifying-glass"></i></button>
        ${canEdit() ? `
        <button class="btn btn-secondary btn-sm" data-edit="${v.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-secondary btn-sm" data-hide="${v.id}" data-hidden="${!!v.oculto}" title="${v.oculto?'Mostrar':'Ocultar'}"><i class="fa-solid ${v.oculto?'fa-eye':'fa-eye-slash'}"></i></button>
        ${isAdmin() ? `<button class="btn btn-danger btn-sm" data-delete="${v.id}" data-name="${esc(v.placa)}"><i class="fa-solid fa-trash"></i></button>` : ''}` : ''}
      </div>
    </div>`;
      return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column${v.oculto?';opacity:0.55':''}">
      <div style="background:var(--primary);padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          ${v.foto
            ? `<img src="${v.foto}" style="width:36px;height:36px;object-fit:cover;border-radius:8px;flex-shrink:0;border:2px solid rgba(255,255,255,.3)">`
            : `<div style="width:36px;height:36px;background:rgba(255,255,255,.18);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;flex-shrink:0"><i class="fa-solid ${tipoIcon}"></i></div>`
          }
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="font-family:monospace;font-size:17px;font-weight:800;color:#fff;letter-spacing:2px">${esc(v.placa)}</div>
              <button onclick="navigator.clipboard.writeText('${esc(v.placa)}').then(()=>{this.innerHTML='<i class=\\'fa-solid fa-check\\'></i>';setTimeout(()=>this.innerHTML='<i class=\\'fa-regular fa-copy\\'></i>',1500)})" style="background:rgba(255,255,255,.2);border:none;border-radius:5px;color:#fff;cursor:pointer;padding:2px 6px;font-size:11px;line-height:1.4" title="Copiar placa"><i class="fa-regular fa-copy"></i></button>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
              <div style="font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(vDesc(v))}</div>
              <span style="background:${cat.bg};color:${cat.color};border-radius:5px;padding:1px 7px;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0">${catLabel}</span>
            </div>
          </div>
        </div>
        ${vehicleStatusBadge(v.status)}
      </div>
      <div style="padding:14px 16px;flex:1;display:flex;gap:24px;flex-wrap:wrap">
        <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Ano</div><div style="font-weight:700;font-size:15px;color:var(--text)">${v.ano||'—'}</div></div>
        <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Quilometragem</div><div style="font-weight:700;font-size:15px;color:var(--text)">${fmtKm(v.quilometragem)}</div></div>
        ${v.renavam ? `<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">RENAVAM</div><div style="display:flex;align-items:center;gap:6px"><span style="font-weight:700;font-size:13px;color:var(--text);font-family:monospace">${esc(v.renavam)}</span><button onclick="navigator.clipboard.writeText('${esc(v.renavam)}').then(()=>{this.innerHTML='<i class=\\'fa-solid fa-check\\'></i>';setTimeout(()=>this.innerHTML='<i class=\\'fa-regular fa-copy\\'></i>',1500)})" style="background:var(--border);border:none;border-radius:5px;color:var(--muted);cursor:pointer;padding:2px 6px;font-size:11px;line-height:1.4" title="Copiar RENAVAM"><i class="fa-regular fa-copy"></i></button></div></div>` : ''}
        ${v.valorFipe ? `<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Valor FIPE</div><div style="font-weight:700;font-size:15px;color:#16a34a">${esc(v.valorFipe)}</div></div>` : ''}
        ${(() => {
          if (!v.dataLicenciamento) return '';
          const vencD = new Date(v.dataLicenciamento+'T00:00:00');
          const pagoD = v.licenciamentoPagoEm ? new Date(v.licenciamentoPagoEm+'T00:00:00') : null;
          const pago  = pagoD && pagoD.getFullYear() === vencD.getFullYear();
          if (pago) return `<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Licenciamento</div><div style="font-weight:700;font-size:13px;color:#16a34a"><i class="fa-solid fa-circle-check"></i> Pago</div></div>`;
          const diff = Math.floor((vencD - new Date()) / 86400000);
          if (diff < 0) return `<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Licenciamento</div><div style="font-weight:700;font-size:13px;color:#dc2626"><i class="fa-solid fa-triangle-exclamation"></i> VENCIDO</div></div>`;
          if (diff <= 30) return `<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Licenciamento</div><div style="font-weight:700;font-size:13px;color:#d97706"><i class="fa-solid fa-clock"></i> ${diff}d</div></div>`;
          return '';
        })()}
      </div>
      ${v.status === 'em_uso' && activeUsageMap[v.id] ? (() => {
        const u = activeUsageMap[v.id];
        const md = driverMap[u.motoristaId];
        return `<div style="margin:0 16px 12px;padding:8px 12px;background:#eff6ff;border-radius:8px;border-left:3px solid #2563eb;font-size:12px;display:flex;flex-direction:column;gap:4px">
            <div style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-user" style="color:#2563eb;width:12px"></i><span style="color:#1e40af;font-weight:600">${esc(md?.nome||'—')}</span></div>
            ${u.destino?`<div style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-location-dot" style="color:#64748b;width:12px"></i><span style="color:var(--text)">${esc(u.destino)}</span></div>`:''}
            <div style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-clock" style="color:#64748b;width:12px"></i><span style="color:var(--muted)">Saiu às ${(u.horaSaida||'').substring(0,5)||'—'}</span></div>
        </div>`;
      })() : ''}
      ${(() => {
        if (!v.kmProximaTrocaOleo) return '';
        const diff = v.kmProximaTrocaOleo - (v.quilometragem || 0);
        if (diff > 500) return '';
        const vencida = diff <= 0;
        return `<div style="margin:0 16px 10px;padding:8px 12px;background:${vencida?'#fef2f2':'#fffbeb'};border-radius:8px;border-left:3px solid ${vencida?'#dc2626':'#f59e0b'};font-size:12px;display:flex;align-items:center;gap:8px">
            <i class="fa-solid fa-oil-can" style="color:${vencida?'#dc2626':'#d97706'}"></i>
            <span style="color:${vencida?'#991b1b':'#92400e'};font-weight:600">${vencida?'Troca de óleo VENCIDA':`Troca de óleo em ${diff} km`}</span>
        </div>`;
      })()}
      ${v.oculto ? '<div style="margin:0 0 0;padding:3px 16px;background:#f1f5f9;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-top:1px solid var(--border)"><i class="fa-solid fa-eye-slash"></i> Oculto</div>' : ''}
      <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" data-history="${v.id}" title="Histórico do veículo"><i class="fa-solid fa-clock-rotate-left"></i> Histórico</button>
        <button class="btn btn-secondary btn-sm" data-multas="${esc(v.id)}" data-placa="${esc(v.placa)}" data-renavam="${esc(v.renavam||'')}" title="Consultar Multas DETRAN SP"><i class="fa-solid fa-magnifying-glass"></i> Multas</button>
        ${v.status === 'em_uso' && activeUsageMap[v.id] ? `<a href="/rastreio.html?id=${activeUsageMap[v.id].id}" target="_blank" class="btn btn-primary btn-sm" title="Rastrear ao vivo"><i class="fa-solid fa-map-location-dot"></i> Rastrear</a>` : ''}
        ${canEdit() ? `
        <button class="btn btn-secondary btn-sm" data-edit="${v.id}"><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="btn btn-secondary btn-sm" data-hide="${v.id}" data-hidden="${!!v.oculto}" title="${v.oculto?'Mostrar':'Ocultar'}"><i class="fa-solid ${v.oculto?'fa-eye':'fa-eye-slash'}"></i> ${v.oculto?'Mostrar':'Ocultar'}</button>
        ${isAdmin() ? `<button class="btn btn-danger btn-sm" data-delete="${v.id}" data-name="${esc(v.placa)}"><i class="fa-solid fa-trash"></i> Excluir</button>` : ''}` : ''}
      </div>
    </div>`; }).join('')}
    </div>
    ${pagination(vehiclePage, totalPages, p => { vehiclePage = p; renderVehicles(); })}`
    : emptyState('fa-car', 'Nenhum veículo encontrado', vehicleSearch||vehicleStatusFilter||vehicleCatFilter ? 'Tente outros filtros.' : 'Cadastre o primeiro veículo.')}
    `);

    document.getElementById('addVehicleBtn')?.addEventListener('click', () => navigate('vehicles','create'));
    document.getElementById('vViewGrid')?.addEventListener('click', () => { vehicleViewMode='grid'; renderVehicles(); });
    document.getElementById('vViewList')?.addEventListener('click', () => { vehicleViewMode='list'; renderVehicles(); });
    document.getElementById('vFilterBtn')?.addEventListener('click', () => {
        vehicleSearch      = document.getElementById('vSearch').value;
        vehicleStatusFilter = document.getElementById('vStatusFilter').value;
        vehicleCatFilter   = document.getElementById('vCatFilter').value;
        vehiclePage = 1;
        renderVehicles();
    });
    document.getElementById('vClearBtn')?.addEventListener('click', () => {
        vehicleSearch = ''; vehicleStatusFilter = ''; vehicleCatFilter = ''; vehiclePage = 1; renderVehicles();
    });
    document.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => navigate('vehicles', 'edit:' + btn.dataset.edit));
    });
    document.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
            showConfirm(`Excluir o veículo "${btn.dataset.name}"? Esta ação não pode ser desfeita.`, async () => {
                try { await deleteFireDoc('veiculos', btn.dataset.delete); state.cache.vehicles = null; showToast('Veículo excluído.'); renderVehicles(); }
                catch (e) { showToast('Erro ao excluir: ' + e.message, 'danger'); }
            });
        });
    });
    document.querySelectorAll('[data-hide]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const nowHidden = btn.dataset.hidden === 'true';
            try { await saveDoc('veiculos', { oculto: !nowHidden }, btn.dataset.hide); state.cache.vehicles = null; renderVehicles(); }
            catch (e) { showFlash('Erro: ' + e.message, 'danger'); }
        });
    });
    document.getElementById('vToggleHidden')?.addEventListener('click', () => { vehicleShowHidden = !vehicleShowHidden; renderVehicles(); });
    document.querySelectorAll('[data-history]').forEach(btn => {
        btn.addEventListener('click', () => navigate('vehicles', 'history:' + btn.dataset.history));
    });
    document.querySelectorAll('[data-multas]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const placa   = btn.dataset.placa;
            const renavam = btn.dataset.renavam;
            if (!renavam) { showFlash('Cadastre o RENAVAM deste veículo antes de consultar multas.', 'danger'); return; }
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const fn = httpsCallable(fbFuncs, 'consultarMultas');
                const result = await fn({ placa, renavam });
                showMultasModal(placa, result.data);
            } catch(e) {
                showFlash('Erro na consulta: ' + (e.message || 'tente novamente.'), 'danger');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
            }
        });
    });
    attachPagination(p => { vehiclePage = p; renderVehicles(); });
}

async function renderVehicleForm(id) {
    const isEdit = !!id;
    let v = { placa:'', marca:'', modelo:'', ano:new Date().getFullYear(), quilometragem:0, status:'disponivel' };
    if (isEdit) { const data = await getOne('veiculos', id); if (data) v = data; }

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-car" style="color:var(--accent)"></i> ${isEdit?'Editar Veículo':'Novo Veículo'}</h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>
    <div class="card">
        <div class="card-header"><div class="card-title"><i class="fa-solid fa-pen-to-square"></i> Dados do Veículo</div></div>
        <div class="card-body">
            <form id="vehicleForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Placa *</label>
                        <div style="display:flex;gap:8px">
                            <div style="position:relative;flex:1">
                                <input type="text" name="placa" id="placaInput" class="form-control" required maxlength="8" value="${esc(v.placa)}" placeholder="ABC1234" style="font-family:monospace;font-weight:700;text-transform:uppercase;letter-spacing:2px;padding-right:36px">
                                <span id="placaIcon" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:14px">${v.placa ? (validarPlaca(v.placa).valid ? '✅' : '❌') : ''}</span>
                            </div>
                            <button type="button" id="buscarPlacaBtn" style="padding:9px 14px;background:#2563eb;color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0"><i class="fa-solid fa-magnifying-glass"></i> Buscar</button>
                        </div>
                        <div id="placaMsg" style="font-size:11px;margin-top:4px;${v.placa && !validarPlaca(v.placa).valid ? 'color:#dc2626' : 'color:#16a34a'}">${v.placa ? (validarPlaca(v.placa).valid ? validarPlaca(v.placa).tipo : 'Placa inválida — use ABC1234 ou ABC1D23') : ''}</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Tipo</label>
                        <select name="tipo" id="fipeTipoSelect" class="form-control">
                            <option value="carros" ${(v.tipo||'carros')==='carros'?'selected':''}>Carro</option>
                            <option value="motos" ${v.tipo==='motos'?'selected':''}>Moto</option>
                            <option value="caminhoes" ${v.tipo==='caminhoes'?'selected':''}>Caminhão</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Categoria</label>
                        <select name="categoria" class="form-control">
                            <option value="empresa"  ${(v.categoria||'empresa')==='empresa'?'selected':''}>Empresa</option>
                            <option value="pessoal"  ${v.categoria==='pessoal'?'selected':''}>Pessoal</option>
                            <option value="locado"   ${v.categoria==='locado'?'selected':''}>Locado</option>
                            <option value="terceiro" ${v.categoria==='terceiro'?'selected':''}>Terceiro</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Marca *</label>
                        ${isEdit
                            ? '<input type="text" name="marca" class="form-control" required value="'+esc(v.marca)+'" placeholder="Toyota, Honda...">'
                            : '<select name="marca" id="fipeMarcaSelect" class="form-control" required><option value="">— Selecione o tipo —</option></select>'
                        }
                    </div>
                    <div class="form-group">
                        <label class="form-label">Modelo *</label>
                        ${isEdit
                            ? '<input type="text" name="modelo" class="form-control" required value="'+esc(v.modelo)+'" placeholder="Corolla, Ranger...">'
                            : '<select name="modelo" id="fipeModeloSelect" class="form-control" required disabled><option value="">— Selecione a marca primeiro —</option></select>'
                        }
                    </div>
                    <div class="form-group">
                        <label class="form-label">Ano *</label>
                        ${isEdit
                            ? '<input type="number" name="ano" class="form-control" required min="1950" max="'+(new Date().getFullYear()+1)+'" value="'+v.ano+'">'
                            : '<select name="ano" id="fipeAnoSelect" class="form-control" required disabled><option value="">— Selecione o modelo —</option></select>'
                        }
                    </div>
                    <div class="form-group">
                        <label class="form-label">RENAVAM</label>
                        <div style="position:relative">
                            <input type="text" name="renavam" id="renavamInput" class="form-control" maxlength="11" value="${esc(v.renavam||'')}" placeholder="00000000000" style="font-family:monospace;letter-spacing:1px;padding-right:36px">
                            <span id="renavamIcon" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:14px">${v.renavam ? (validarRENAVAM(v.renavam) ? '✅' : '❌') : ''}</span>
                        </div>
                        <div id="renavamMsg" style="font-size:11px;margin-top:4px;${v.renavam && !validarRENAVAM(v.renavam) ? 'color:#dc2626' : 'color:#16a34a'}">${v.renavam ? (validarRENAVAM(v.renavam) ? 'RENAVAM válido' : 'RENAVAM inválido — verifique os dígitos') : ''}</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Quilometragem (km)</label>
                        <input type="number" name="quilometragem" class="form-control" min="0" value="${v.quilometragem||0}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Licenciamento (CRLV) — Vencimento</label>
                        <input type="date" name="dataLicenciamento" id="licVencInput" class="form-control" value="${v.dataLicenciamento||''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Licenciamento — Pago em</label>
                        <input type="date" name="licenciamentoPagoEm" id="licPagoInput" class="form-control" value="${v.licenciamentoPagoEm||''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Seguro — Vencimento</label>
                        <input type="date" name="seguroVencimento" class="form-control" value="${v.seguroVencimento||''}" placeholder="Vencimento do seguro">
                    </div>
                    <div class="form-group">
                        <label class="form-label">IPVA — Vencimento</label>
                        <input type="date" name="ipvaVencimento" class="form-control" value="${v.ipvaVencimento||''}" placeholder="Vencimento do IPVA">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Troca de Óleo — KM Previsto</label>
                        <input type="number" name="kmProximaTrocaOleo" class="form-control" min="0" value="${v.kmProximaTrocaOleo||''}" placeholder="Ex: 85000">
                    </div>
                    <div class="form-group span-full">
                        <label class="form-label">Foto do Veículo</label>
                        <div id="fotoPreviewWrap" style="margin-bottom:8px">
                            ${v.foto
                                ? `<img src="${v.foto}" id="fotoPreview" style="width:160px;height:110px;object-fit:cover;border-radius:10px;border:2px solid var(--border)">`
                                : `<div id="fotoPreview" style="width:160px;height:110px;border-radius:10px;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px">Sem foto</div>`
                            }
                        </div>
                        <input type="file" id="fotoInput" accept="image/*" style="font-size:13px">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Status</label>
                        <select name="status" class="form-control">
                            <option value="disponivel" ${v.status==='disponivel'?'selected':''}>Disponível</option>
                            <option value="em_uso"     ${v.status==='em_uso'?'selected':''}>Em Uso</option>
                            <option value="manutencao" ${v.status==='manutencao'?'selected':''}>Manutenção</option>
                        </select>
                    </div>
                    ${!isEdit ? '<div class="form-group span-full" id="fipeValorBox" style="display:none"><div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px"><i class="fa-solid fa-tag" style="color:#16a34a;font-size:18px"></i><div><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Valor FIPE</div><div id="fipeValorText" style="font-size:22px;font-weight:800;color:#15803d"></div></div></div><input type="hidden" name="valorFipe" id="valorFipeHidden"></div>' : ''}
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> ${isEdit?'Salvar':'Cadastrar'}</button>
                </div>
            </form>
        </div>
    </div>`);

    document.getElementById('backBtn').addEventListener('click', () => navigate('vehicles'));
    document.getElementById('cancelBtn').addEventListener('click', () => navigate('vehicles'));

    document.getElementById('renavamInput')?.addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '').slice(0, 11);
        const icon = document.getElementById('renavamIcon');
        const msg  = document.getElementById('renavamMsg');
        if (!this.value) { icon.textContent = ''; msg.textContent = ''; return; }
        if (this.value.length < 11) { icon.textContent = ''; msg.textContent = ''; return; }
        if (validarRENAVAM(this.value)) {
            icon.textContent = '✅'; msg.textContent = 'RENAVAM válido'; msg.style.color = '#16a34a';
        } else {
            icon.textContent = '❌'; msg.textContent = 'RENAVAM inválido — verifique os dígitos'; msg.style.color = '#dc2626';
        }
    });

    document.getElementById('buscarPlacaBtn')?.addEventListener('click', async () => {
        const placa = document.getElementById('placaInput').value.replace(/[^A-Z0-9]/g, '');
        if (placa.length < 7) { showFlash('Informe a placa completa antes de buscar.', 'danger'); return; }
        const btn = document.getElementById('buscarPlacaBtn');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
        try {
            const fn = httpsCallable(fbFuncs, 'consultarPlaca');
            const { data } = await fn({ placa });
            const { marca, modelo, ano, cor } = data;
            const msg = document.getElementById('placaMsg');
            msg.textContent = `${marca} ${modelo} ${ano}${cor ? ' · ' + cor : ''}`;
            msg.style.color = '#2563eb';
            // Prefill FIPE dropdowns (somente no formulário de novo veículo)
            const marcaSel  = document.getElementById('fipeMarcaSelect');
            const modeloSel = document.getElementById('fipeModeloSelect');
            const anoSel    = document.getElementById('fipeAnoSelect');
            if (marcaSel && marcaSel.options.length > 1) {
                const marcaKey = marca.toLowerCase().split('/')[0].trim();
                for (const opt of marcaSel.options) {
                    if (opt.value && opt.text.toLowerCase().includes(marcaKey)) {
                        marcaSel.value = opt.value;
                        marcaSel.dispatchEvent(new Event('change'));
                        await new Promise(r => setTimeout(r, 1500));
                        if (modeloSel) {
                            const modeloKey = modelo.toLowerCase().split(' ')[0];
                            for (const mo of modeloSel.options) {
                                if (mo.value && mo.text.toLowerCase().includes(modeloKey)) {
                                    modeloSel.value = mo.value;
                                    modeloSel.dispatchEvent(new Event('change'));
                                    await new Promise(r => setTimeout(r, 1500));
                                    if (anoSel && ano) {
                                        for (const ao of anoSel.options) {
                                            if (ao.value === ano || ao.text.startsWith(ano)) {
                                                anoSel.value = ao.value;
                                                anoSel.dispatchEvent(new Event('change'));
                                                break;
                                            }
                                        }
                                    }
                                    break;
                                }
                            }
                        }
                        break;
                    }
                }
            }
            showFlash(`Veículo encontrado: ${marca} ${modelo} ${ano}`, 'success');
        } catch(e) {
            const msg = e.message?.includes('não configurada')
                ? 'API de placa não configurada — cadastre-se em wdapi2.com.br e adicione WDAPI2_TOKEN em functions/.env'
                : 'Placa não encontrada ou serviço indisponível.';
            showFlash(msg, 'danger');
        }
        btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar';
        btn.disabled = false;
    });

    document.getElementById('placaInput')?.addEventListener('input', function() {
        this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
        const icon = document.getElementById('placaIcon');
        const msg  = document.getElementById('placaMsg');
        if (this.value.length < 7) { icon.textContent = ''; msg.textContent = ''; return; }
        const r = validarPlaca(this.value);
        if (r.valid) {
            icon.textContent = '✅'; msg.textContent = r.tipo; msg.style.color = '#16a34a';
        } else {
            icon.textContent = '❌'; msg.textContent = 'Placa inválida — use ABC1234 ou ABC1D23'; msg.style.color = '#dc2626';
        }
    });

    // Auto-preenche data de licenciamento pelo final da placa
    // Tabela SP 2026: finais 1-2→Jul, 3-4→Ago, 5-6→Set, 7-8→Out, 9→Nov, 0→Dez
    const PLACA_MES = { '1':7,'2':7,'3':8,'4':8,'5':9,'6':9,'7':10,'8':10,'9':11,'0':12 };
    function sugerirLicenciamento(placa) {
        const digits = placa.replace(/\D/g,'');
        if (!digits) return;
        const final = digits.slice(-1);
        const mes = PLACA_MES[final];
        if (!mes) return;
        const licInput = document.querySelector('[name="dataLicenciamento"]');
        if (licInput?.value) return; // não sobrescreve se já preenchido
        const hoje = new Date();
        let ano = hoje.getFullYear();
        if (mes < hoje.getMonth() + 1) ano++; // mês já passou, usa próximo ano
        const ultimo = new Date(ano, mes, 0).getDate(); // último dia do mês
        licInput.value = `${ano}-${String(mes).padStart(2,'0')}-${ultimo}`;
    }
    document.querySelector('[name="placa"]')?.addEventListener('input', e => sugerirLicenciamento(e.target.value));
    if (isEdit && v.placa) sugerirLicenciamento(v.placa); // ao editar, sugere se campo vazio

    // Quando registrar pagamento, avança vencimento para o próximo ano
    document.getElementById('licPagoInput')?.addEventListener('change', e => {
        const pagoEm = e.target.value;
        if (!pagoEm) return;
        const vencInput = document.getElementById('licVencInput');
        if (!vencInput?.value) return;
        const venc = new Date(vencInput.value + 'T00:00:00');
        const novoAno = venc.getFullYear() + 1;
        const mes = venc.getMonth() + 1;
        const ultimo = new Date(novoAno, mes, 0).getDate();
        vencInput.value = `${novoAno}-${String(mes).padStart(2,'0')}-${ultimo}`;
        showFlash('Vencimento avançado para ' + new Date(vencInput.value+'T00:00:00').toLocaleDateString('pt-BR') + '.', 'info');
    });

    if (!isEdit) {
        const tipoSel   = document.getElementById('fipeTipoSelect');
        const marcaSel  = document.getElementById('fipeMarcaSelect');
        const modeloSel = document.getElementById('fipeModeloSelect');
        const anoSel    = document.getElementById('fipeAnoSelect');
        const valorBox  = document.getElementById('fipeValorBox');
        let fipeMarcas = [], fipeMarcaCod = '', fipeModeloCod = '';

        async function carregarMarcas() {
            const tipo = tipoSel.value;
            fipeMarcas = []; fipeMarcaCod = ''; fipeModeloCod = '';
            marcaSel.innerHTML = '<option value="">— Carregando marcas... —</option>';
            modeloSel.innerHTML = '<option value="">— Selecione a marca —</option>'; modeloSel.disabled = true;
            anoSel.innerHTML = '<option value="">— Selecione o modelo —</option>'; anoSel.disabled = true;
            valorBox.style.display = 'none';
            try {
                const res = await fetch(`https://parallelum.com.br/fipe/api/v1/${tipo}/marcas`);
                fipeMarcas = await res.json();
                marcaSel.innerHTML = '<option value="">— Selecione a marca —</option>' +
                    fipeMarcas.map(m => `<option value="${m.nome}">${m.nome}</option>`).join('');
            } catch(e) { marcaSel.innerHTML = '<option value="">— Erro ao carregar marcas —</option>'; }
        }

        tipoSel.addEventListener('change', carregarMarcas);
        carregarMarcas();

        marcaSel.addEventListener('change', async () => {
            const marca = fipeMarcas.find(m => m.nome === marcaSel.value);
            fipeMarcaCod = ''; fipeModeloCod = '';
            modeloSel.innerHTML = '<option value="">— Selecione o modelo —</option>';
            modeloSel.disabled = true;
            anoSel.innerHTML = '<option value="">— Selecione o modelo —</option>';
            anoSel.disabled = true;
            valorBox.style.display = 'none';
            if (!marca) return;
            fipeMarcaCod = marca.codigo;
            modeloSel.innerHTML = '<option value="">— Carregando modelos... —</option>';
            try {
                const res = await fetch(`https://parallelum.com.br/fipe/api/v1/${tipoSel.value}/marcas/${fipeMarcaCod}/modelos`);
                const data = await res.json();
                modeloSel.innerHTML = '<option value="">— Selecione o modelo —</option>' +
                    data.modelos.map(m => `<option value="${m.nome}" data-cod="${m.codigo}">${m.nome}</option>`).join('');
                modeloSel.disabled = false;
            } catch(e) {
                modeloSel.innerHTML = '<option value="">— Erro ao carregar modelos —</option>';
            }
        });

        modeloSel.addEventListener('change', async () => {
            const opt = modeloSel.options[modeloSel.selectedIndex];
            fipeModeloCod = opt?.dataset.cod || '';
            anoSel.innerHTML = '<option value="">— Selecione o ano —</option>';
            anoSel.disabled = true;
            valorBox.style.display = 'none';
            if (!fipeMarcaCod || !fipeModeloCod) return;
            anoSel.innerHTML = '<option value="">— Carregando anos... —</option>';
            try {
                const res = await fetch(`https://parallelum.com.br/fipe/api/v1/${tipoSel.value}/marcas/${fipeMarcaCod}/modelos/${fipeModeloCod}/anos`);
                const anos = await res.json();
                anoSel.innerHTML = '<option value="">— Selecione o ano —</option>' +
                    anos.map(a => `<option value="${a.codigo.split('-')[0]}" data-cod="${a.codigo}">${a.nome}</option>`).join('');
                anoSel.disabled = false;
            } catch(e) {
                anoSel.innerHTML = '<option value="">— Erro ao carregar anos —</option>';
            }
        });

        anoSel.addEventListener('change', async () => {
            const anoCod = anoSel.options[anoSel.selectedIndex]?.dataset.cod || '';
            valorBox.style.display = 'none';
            if (!fipeMarcaCod || !fipeModeloCod || !anoCod) return;
            try {
                const res = await fetch(`https://parallelum.com.br/fipe/api/v1/${tipoSel.value}/marcas/${fipeMarcaCod}/modelos/${fipeModeloCod}/anos/${anoCod}`);
                const d = await res.json();
                document.getElementById('fipeValorText').textContent = d.Valor;
                document.getElementById('valorFipeHidden').value = d.Valor;
                valorBox.style.display = '';
            } catch(e) { /* silencia */ }
        });
    }

    let _fotoBase64 = v.foto || null;
    document.getElementById('fotoInput')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        _fotoBase64 = await resizeImageToBase64(file);
        const preview = document.getElementById('fotoPreview');
        if (preview) { preview.outerHTML = `<img src="${_fotoBase64}" id="fotoPreview" style="width:160px;height:110px;object-fit:cover;border-radius:10px;border:2px solid var(--border)">`; }
    });

    document.getElementById('vehicleForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const placaVal = fd.get('placa').toUpperCase().replace(/[^A-Z0-9]/g,'');
        if (!validarPlaca(placaVal).valid) {
            showFlash('Placa inválida. Use o formato ABC1234 ou Mercosul ABC1D23.', 'danger');
            document.getElementById('placaInput')?.focus();
            return;
        }
        const renavamVal = fd.get('renavam').replace(/\D/g,'');
        if (renavamVal && !validarRENAVAM(renavamVal)) {
            showFlash('RENAVAM inválido. Verifique os dígitos.', 'danger');
            document.getElementById('renavamInput')?.focus();
            return;
        }
        const data = {
            placa: placaVal,
            renavam: fd.get('renavam').replace(/\D/g,''),
            marca: fd.get('marca').trim(),
            modelo: fd.get('modelo').trim(),
            ano: parseInt(fd.get('ano')) || new Date().getFullYear(),
            quilometragem: parseInt(fd.get('quilometragem')) || 0,
            tipo: fd.get('tipo') || 'carros',
            categoria: fd.get('categoria') || 'empresa',
            status: fd.get('status'),
            dataLicenciamento: fd.get('dataLicenciamento') || '',
            licenciamentoPagoEm: fd.get('licenciamentoPagoEm') || '',
            seguroVencimento: fd.get('seguroVencimento') || '',
            ipvaVencimento: fd.get('ipvaVencimento') || '',
            kmProximaTrocaOleo: parseInt(fd.get('kmProximaTrocaOleo')) || 0,
            foto: _fotoBase64 || '',
            ...(fd.get('valorFipe') ? { valorFipe: fd.get('valorFipe') } : {}),
        };
        try {
            await saveDoc('veiculos', data, id || null);
            state.cache.vehicles = null;
            showFlash(isEdit ? 'Veículo atualizado.' : 'Veículo cadastrado.');
            navigate('vehicles');
        } catch (err) {
            showFlash('Erro ao salvar: ' + err.message, 'danger');
        }
    });
}

// ══════════════════════════════════════════════════════════════
// VEHICLE HISTORY
// ══════════════════════════════════════════════════════════════
async function renderVehicleHistory(vid) {
    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');
    const [v, drivers, usages, fuelList, manutList, finesList] = await Promise.all([
        getOne('veiculos', vid),
        getDrivers(),
        getAll('utilizacoes', where('veiculoId','==',vid)),
        getAll('abastecimentos', where('veiculoId','==',vid)),
        getAll('manutencoes', where('veiculoId','==',vid)),
        getAll('multas', where('veiculoId','==',vid)),
    ]);
    const driverMap = Object.fromEntries(drivers.map(d => [d.id, d]));

    const events = [
        ...usages.map(u => ({
            date: u.dataUtilizacao || (u.criadoEm?.toDate?.()?.toISOString?.()?.slice(0,10) || ''),
            ts: u.criadoEm?.seconds || 0,
            type: 'uso',
            icon: 'fa-road', color: '#2563eb', bg: '#eff6ff',
            title: `Utilização — ${esc(driverMap[u.motoristaId]?.nome || '—')}`,
            sub: `${u.destino ? esc(u.destino) + ' · ' : ''}${u.kmInicial ? fmtKm(u.kmInicial) + ' → ' + fmtKm(u.kmFinal||u.kmInicial) : ''}`,
            badge: u.status === 'em_uso' ? '<span style="background:#eff6ff;color:#2563eb;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700">EM USO</span>' : '',
        })),
        ...fuelList.map(f => ({
            date: f.data || '',
            ts: f.criadoEm?.seconds || 0,
            type: 'fuel',
            icon: 'fa-gas-pump', color: '#16a34a', bg: '#f0fdf4',
            title: `Abastecimento — ${f.litros ? f.litros + ' L' : ''}`,
            sub: `${f.valorTotal ? 'R$ ' + parseFloat(f.valorTotal).toFixed(2) : ''}${f.quilometragem ? ' · ' + fmtKm(f.quilometragem) : ''}`,
            badge: '',
        })),
        ...manutList.map(m => ({
            date: m.data || m.dataProxima || '',
            ts: m.criadoEm?.seconds || 0,
            type: 'manut',
            icon: 'fa-wrench', color: '#7c3aed', bg: '#faf5ff',
            title: `Manutenção — ${esc(m.tipo || 'Serviço')}`,
            sub: `${m.descricao ? esc(m.descricao) : ''}${m.custo ? ' · R$ ' + parseFloat(m.custo).toFixed(2) : ''}`,
            badge: m.status === 'concluida' ? '<span style="background:#f0fdf4;color:#16a34a;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700">CONCLUÍDA</span>' : '',
        })),
        ...finesList.map(f => ({
            date: f.dataInfracao || f.dataVencimento || '',
            ts: f.criadoEm?.seconds || 0,
            type: 'multa',
            icon: 'fa-triangle-exclamation', color: '#dc2626', bg: '#fef2f2',
            title: `Multa — ${esc(f.infracao || f.artigo || 'Infração')}`,
            sub: `${f.valor ? 'R$ ' + parseFloat(f.valor).toFixed(2) : ''}${f.pontos ? ' · ' + f.pontos + ' pts' : ''}${f.local ? ' · ' + esc(f.local) : ''}`,
            badge: '',
        })),
    ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.ts - a.ts);

    const tipoIcon = (v?.tipo === 'motos') ? 'fa-motorcycle' : (v?.tipo === 'caminhoes') ? 'fa-truck' : 'fa-car';

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-clock-rotate-left" style="color:var(--accent)"></i> Histórico do Veículo</h1>
            <p class="page-subtitle">${v ? esc(v.placa) + ' — ' + esc(vDesc(v)) : '—'}</p>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>

    <div style="background:var(--primary);border-radius:16px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;gap:14px">
        ${v?.foto
            ? `<img src="${v.foto}" style="width:52px;height:52px;object-fit:cover;border-radius:10px;border:2px solid rgba(255,255,255,.3);flex-shrink:0">`
            : `<div style="width:52px;height:52px;background:rgba(255,255,255,.18);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;flex-shrink:0"><i class="fa-solid ${tipoIcon}"></i></div>`
        }
        <div>
            <div style="font-family:monospace;font-size:20px;font-weight:800;color:#fff;letter-spacing:2px">${esc(v?.placa||'—')}</div>
            <div style="font-size:13px;color:rgba(255,255,255,.75)">${esc(vDesc(v||{}))} · ${fmtKm(v?.quilometragem)} km</div>
        </div>
        <div style="margin-left:auto;text-align:right">
            <div style="font-size:22px;font-weight:800;color:#fff">${events.length}</div>
            <div style="font-size:11px;color:rgba(255,255,255,.7)">evento${events.length!==1?'s':''}</div>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:16px">
        ${[
            { label:'Utilizações', count: usages.length, icon:'fa-road', color:'#2563eb', bg:'#eff6ff' },
            { label:'Abastecimentos', count: fuelList.length, icon:'fa-gas-pump', color:'#16a34a', bg:'#f0fdf4' },
            { label:'Manutenções', count: manutList.length, icon:'fa-wrench', color:'#7c3aed', bg:'#faf5ff' },
            { label:'Multas', count: finesList.length, icon:'fa-triangle-exclamation', color:'#dc2626', bg:'#fef2f2' },
        ].map(s => `
            <div style="background:#fff;border-radius:12px;padding:12px 14px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">
                <div style="width:32px;height:32px;border-radius:8px;background:${s.bg};display:flex;align-items:center;justify-content:center;margin:0 auto 6px;color:${s.color}"><i class="fa-solid ${s.icon}" style="font-size:14px"></i></div>
                <div style="font-size:20px;font-weight:800;color:var(--text)">${s.count}</div>
                <div style="font-size:10px;color:var(--muted)">${s.label}</div>
            </div>`).join('')}
    </div>

    ${events.length ? `
    <div style="background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden">
        <div style="padding:14px 18px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700;color:#1e293b">
            <i class="fa-solid fa-timeline" style="color:var(--accent);margin-right:8px"></i>Timeline
        </div>
        ${events.map(ev => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
            <div style="width:36px;height:36px;border-radius:10px;background:${ev.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;color:${ev.color};font-size:15px;margin-top:2px">
                <i class="fa-solid ${ev.icon}"></i>
            </div>
            <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px;color:var(--text)">${ev.title} ${ev.badge}</div>
                ${ev.sub ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${ev.sub}</div>` : ''}
                ${ev.date ? `<div style="font-size:11px;color:#94a3b8;margin-top:3px">${fmtDate(ev.date)}</div>` : ''}
            </div>
        </div>`).join('')}
    </div>` : `<div style="text-align:center;padding:40px;color:var(--muted)"><i class="fa-solid fa-clock-rotate-left" style="font-size:32px;opacity:.3;display:block;margin-bottom:12px"></i>Nenhum evento registrado ainda.</div>`}
    `);

    document.getElementById('backBtn')?.addEventListener('click', () => navigate('vehicles'));
}

// ══════════════════════════════════════════════════════════════
// DRIVERS
// ══════════════════════════════════════════════════════════════
// MOTORISTAS
// ══════════════════════════════════════════════════════════════
let driverPage = 1, driverSearch = '', driverActiveFilter = '', driverViewMode = 'grid', driverShowHidden = false, driverSort = '', driverVinculoFilter = '';

async function renderDrivers(sub) {
    if (sub === 'create') { renderDriverForm(null); return; }
    if (sub?.startsWith('edit:')) { renderDriverForm(sub.split(':')[1]); return; }

    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');
    const all = await getDrivers(true);
    const now = new Date();

    const hiddenCountD = all.filter(d => d.oculto).length;
    let filtered = all.filter(d => {
        const q = driverSearch.toLowerCase();
        const matchQ = !q || d.nome?.toLowerCase().includes(q) || d.cpf?.includes(q) || d.cnhNumero?.includes(q);
        const matchA = driverActiveFilter === '' || String(d.ativo !== false) === driverActiveFilter;
        const matchV = !driverVinculoFilter || d.vinculo === driverVinculoFilter;
        const matchH = driverShowHidden || !d.oculto;
        return matchQ && matchA && matchV && matchH;
    });

    if (driverSort === 'cnh_asc') {
        filtered.sort((a, b) => (a.cnhValidade || '9999') < (b.cnhValidade || '9999') ? -1 : 1);
    } else if (driverSort === 'cnh_desc') {
        filtered.sort((a, b) => (a.cnhValidade || '') > (b.cnhValidade || '') ? -1 : 1);
    } else {
        filtered.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    }

    const perPage = 15, total = filtered.length, totalPages = Math.ceil(total / perPage);
    if (driverPage > totalPages) driverPage = 1;
    const paged = filtered.slice((driverPage-1)*perPage, driverPage*perPage);

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-id-card" style="color:var(--accent)"></i> Motoristas</h1>
            <p class="page-subtitle">${total} motorista(s)</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
            <div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden">
                <button id="dViewGrid" title="Grade" style="padding:7px 12px;border:none;cursor:pointer;font-size:14px;background:${driverViewMode==='grid'?'var(--primary)':'var(--card)'};color:${driverViewMode==='grid'?'#fff':'var(--muted)'}"><i class="fa-solid fa-grip"></i></button>
                <button id="dViewList" title="Lista" style="padding:7px 12px;border:none;cursor:pointer;font-size:14px;background:${driverViewMode==='list'?'var(--primary)':'var(--card)'};color:${driverViewMode==='list'?'#fff':'var(--muted)'}"><i class="fa-solid fa-list"></i></button>
            </div>
            ${hiddenCountD ? `<button class="btn btn-secondary" id="dToggleHidden" title="${driverShowHidden?'Esconder ocultos':'Mostrar ocultos'}"><i class="fa-solid ${driverShowHidden?'fa-eye-slash':'fa-eye'}"></i> ${driverShowHidden?'Esconder ocultos':`Ocultos (${hiddenCountD})`}</button>` : ''}
            ${canEdit() ? '<button class="btn btn-primary" id="addDriverBtn"><i class="fa-solid fa-plus"></i> Novo Motorista</button>' : ''}
        </div>
    </div>

    <div class="filters-bar">
        <div class="form-group grow">
            <label class="form-label">Buscar</label>
            <input type="text" id="dSearch" class="form-control" placeholder="Nome, CPF, CNH..." value="${esc(driverSearch)}">
        </div>
        <div class="form-group">
            <label class="form-label">Status</label>
            <select id="dActiveFilter" class="form-control">
                <option value="">Todos</option>
                <option value="true"  ${driverActiveFilter==='true'?'selected':''}>Ativos</option>
                <option value="false" ${driverActiveFilter==='false'?'selected':''}>Inativos</option>
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Vínculo</label>
            <select id="dVinculoFilter" class="form-control">
                <option value="">Todos</option>
                ${['CLT','Terceirizado','PJ','Temporário','Autônomo'].map(v => `<option value="${v}" ${driverVinculoFilter===v?'selected':''}>${v}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Ordenar</label>
            <select id="dSort" class="form-control">
                <option value="">Nome (A-Z)</option>
                <option value="cnh_asc"  ${driverSort==='cnh_asc'?'selected':''}>CNH mais antiga primeiro</option>
                <option value="cnh_desc" ${driverSort==='cnh_desc'?'selected':''}>CNH mais recente primeiro</option>
            </select>
        </div>
        <div class="form-group" style="justify-content:flex-end">
            <button class="btn btn-primary" id="dFilterBtn"><i class="fa-solid fa-magnifying-glass"></i> Filtrar</button>
            <button class="btn btn-secondary" id="dClearBtn">Limpar</button>
        </div>
    </div>

    ${paged.length ? `
    <div style="${driverViewMode==='list'?'display:flex;flex-direction:column;gap:10px':'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px'}">
    ${paged.map(d => {
        const diff = d.cnhValidade ? Math.floor((new Date(d.cnhValidade+'T00:00:00')-now)/86400000) : null;
        const vinculoColors = { 'CLT':'#16a34a','Terceirizado':'#2563eb','PJ':'#7c3aed','Temporário':'#d97706','Autônomo':'#0891b2' };
        const vinculoBadge = d.vinculo ? `<span style="background:${vinculoColors[d.vinculo]||'#64748b'}20;color:${vinculoColors[d.vinculo]||'#64748b'};border:1px solid ${vinculoColors[d.vinculo]||'#64748b'}40;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">${esc(d.vinculo)}</span>` : '';
        const cnhBadge = diff === null ? '<span style="color:var(--muted)">Não informada</span>'
            : diff < 0  ? '<span class="badge badge-danger"><i class="fa-solid fa-circle-xmark"></i> Vencida</span>'
            : diff <= 30? `<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Vence em ${diff}d</span>`
            : `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> ${fmtDate(d.cnhValidade)}</span>`;
        const initials = (d.nome||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
        if (driverViewMode === 'list') return `
    <div class="card-list-row" style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;display:flex;align-items:center">
      <div style="background:var(--primary);padding:10px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:64px;align-self:stretch">
        <div style="width:38px;height:38px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700">${initials}</div>
        ${d.ativo!==false?'<span class="badge badge-success" style="font-size:9px">Ativo</span>':'<span class="badge badge-muted" style="font-size:9px">Inativo</span>'}
      </div>
      <div style="padding:10px 14px;flex:1;display:flex;align-items:center;gap:20px;flex-wrap:wrap;min-width:0">
        <div style="min-width:140px">
          <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(d.nome)}</div>
          <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px">${esc(d.telefone||'—')} ${vinculoBadge}</div>
        </div>
        <div style="font-size:12px;color:var(--muted)">CNH: <span style="font-weight:600;color:var(--text)">${esc(d.cnhNumero||'—')}</span> <span class="badge badge-info" style="font-size:9px">Cat. ${esc(d.cnhCategoria||'—')}</span></div>
        <div>${cnhBadge}</div>
        ${d.cpf?`<div style="font-size:12px;color:var(--muted)">CPF: <span style="font-weight:600;color:var(--text)">${esc(d.cpf)}</span></div>`:''}
      </div>
      ${canEdit() ? `<div class="card-list-actions">
        <button class="btn btn-secondary btn-sm" data-edit="${d.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-secondary btn-sm" data-dhide="${d.id}" data-dhidden="${!!d.oculto}" title="${d.oculto?'Mostrar':'Ocultar'}"><i class="fa-solid ${d.oculto?'fa-eye':'fa-eye-slash'}"></i></button>
        ${isAdmin() ? `<button class="btn btn-danger btn-sm" data-delete="${d.id}" data-name="${esc(d.nome)}"><i class="fa-solid fa-ban"></i></button>` : ''}
      </div>` : ''}
    </div>`;
        return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column">
      <div style="background:var(--primary);padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:44px;height:44px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.nome)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.7);display:flex;align-items:center;gap:6px">${esc(d.telefone||'—')}${d.vinculo?`<span style="background:rgba(255,255,255,.2);color:#fff;padding:1px 7px;border-radius:20px;font-size:9px;font-weight:700">${esc(d.vinculo)}</span>`:''}</div>
        </div>
        ${d.ativo!==false?'<span class="badge badge-success" style="flex-shrink:0">Ativo</span>':'<span class="badge badge-muted" style="flex-shrink:0">Inativo</span>'}
      </div>
      <div style="padding:14px 16px;flex:1;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:8px;align-items:center">
          <i class="fa-solid fa-id-card" style="color:var(--muted);font-size:12px;width:14px"></i>
          <div style="font-size:12px;color:var(--muted)">CNH</div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(d.cnhNumero||'—')}</span>
            ${d.cnhNumero ? `<button onclick="navigator.clipboard.writeText('${esc(d.cnhNumero)}').then(()=>{this.innerHTML='<i class=\\'fa-solid fa-check\\'></i>';setTimeout(()=>this.innerHTML='<i class=\\'fa-regular fa-copy\\'></i>',1500)})" style="background:var(--border);border:none;border-radius:5px;color:var(--muted);cursor:pointer;padding:2px 6px;font-size:11px;line-height:1.4" title="Copiar CNH"><i class="fa-regular fa-copy"></i></button>` : ''}
            <span class="badge badge-info" style="font-size:10px">Cat. ${esc(d.cnhCategoria||'—')}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <i class="fa-solid fa-calendar" style="color:var(--muted);font-size:12px;width:14px"></i>
          <div style="font-size:12px;color:var(--muted)">Validade</div>
          <div>${cnhBadge}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <i class="fa-solid fa-fingerprint" style="color:var(--muted);font-size:12px;width:14px"></i>
          <div style="font-size:12px;color:var(--muted)">CPF</div>
          <div style="font-size:13px;color:var(--text)">${esc(d.cpf||'—')}</div>
        </div>
      </div>
      ${d.oculto ? '<div style="padding:3px 16px;background:#f1f5f9;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-top:1px solid var(--border)"><i class="fa-solid fa-eye-slash"></i> Oculto</div>' : ''}
      ${canEdit() ? `<div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" data-edit="${d.id}"><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="btn btn-secondary btn-sm" data-dhide="${d.id}" data-dhidden="${!!d.oculto}" title="${d.oculto?'Mostrar':'Ocultar'}"><i class="fa-solid ${d.oculto?'fa-eye':'fa-eye-slash'}"></i> ${d.oculto?'Mostrar':'Ocultar'}</button>
        ${isAdmin() ? `<button class="btn btn-danger btn-sm" data-delete="${d.id}" data-name="${esc(d.nome)}"><i class="fa-solid fa-ban"></i> Desativar</button>` : ''}
      </div>` : ''}
    </div>`;}).join('')}
    </div>
    ${pagination(driverPage, totalPages, p => { driverPage = p; renderDrivers(); })}`
    : emptyState('fa-id-card','Nenhum motorista encontrado')}
    `);

    document.getElementById('addDriverBtn')?.addEventListener('click', () => navigate('drivers','create'));
    document.getElementById('dViewGrid')?.addEventListener('click', () => { driverViewMode='grid'; renderDrivers(); });
    document.getElementById('dViewList')?.addEventListener('click', () => { driverViewMode='list'; renderDrivers(); });
    document.getElementById('dFilterBtn')?.addEventListener('click', () => {
        driverSearch = document.getElementById('dSearch').value;
        driverActiveFilter = document.getElementById('dActiveFilter').value;
        driverVinculoFilter = document.getElementById('dVinculoFilter').value;
        driverSort = document.getElementById('dSort').value;
        driverPage = 1; renderDrivers();
    });
    document.getElementById('dClearBtn')?.addEventListener('click', () => { driverSearch=''; driverActiveFilter=''; driverVinculoFilter=''; driverSort=''; driverPage=1; renderDrivers(); });
    document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => navigate('drivers','edit:'+b.dataset.edit)));
    document.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => {
        if (b.dataset.confirming === 'true') {
            b.dataset.confirming = 'false';
            b.disabled = true;
            b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                await saveDoc('motoristas', { ativo: false }, b.dataset.delete);
                state.cache.drivers = null;
                showFlash('Motorista desativado.');
                renderDrivers();
            } catch(e) { showFlash('Erro: '+e.message,'danger'); renderDrivers(); }
        } else {
            b.dataset.confirming = 'true';
            b.style.background = '#f59e0b';
            b.style.color = '#fff';
            b.innerHTML = '<i class="fa-solid fa-question"></i> Desativar?';
            b.style.width = 'auto';
            b.style.padding = '6px 10px';
            setTimeout(() => {
                if (b.dataset.confirming === 'true') {
                    b.dataset.confirming = 'false';
                    b.style.cssText = '';
                    b.innerHTML = '<i class="fa-solid fa-ban"></i>';
                }
            }, 3000);
        }
    }));
    document.querySelectorAll('[data-dhide]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const nowHidden = btn.dataset.dhidden === 'true';
            try { await saveDoc('motoristas', { oculto: !nowHidden }, btn.dataset.dhide); state.cache.drivers = null; renderDrivers(); }
            catch (e) { showFlash('Erro: ' + e.message, 'danger'); }
        });
    });
    document.getElementById('dToggleHidden')?.addEventListener('click', () => { driverShowHidden = !driverShowHidden; renderDrivers(); });
    attachPagination(p => { driverPage = p; renderDrivers(); });
}

// ── Validadores de dados ──────────────────────────────────────
function validarRENAVAM(renavam) {
    const n = renavam.replace(/\D/g, '');
    if (n.length !== 11) return false;
    const weights = [3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(n[i]) * weights[i];
    const rem = sum % 11;
    const digit = rem < 2 ? 0 : 11 - rem;
    return parseInt(n[10]) === digit;
}

function validarTelefone(tel) {
    const n = tel.replace(/\D/g, '');
    if (n.length < 10 || n.length > 11) return false;
    const ddd = parseInt(n.substring(0, 2));
    const dddsValidos = [11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99];
    return dddsValidos.includes(ddd);
}

function validarPlaca(placa) {
    const p = placa.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (/^[A-Z]{3}\d{4}$/.test(p)) return { valid: true, tipo: 'Padrão antigo' };
    if (/^[A-Z]{3}\d[A-Z]\d{2}$/.test(p)) return { valid: true, tipo: 'Mercosul' };
    return { valid: false };
}

function validarCPF(cpf) {
    const n = cpf.replace(/\D/g, '');
    if (n.length !== 11 || /^(\d)\1{10}$/.test(n)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(n[i]) * (10 - i);
    let d1 = (sum * 10) % 11; if (d1 >= 10) d1 = 0;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(n[i]) * (11 - i);
    let d2 = (sum * 10) % 11; if (d2 >= 10) d2 = 0;
    return parseInt(n[9]) === d1 && parseInt(n[10]) === d2;
}

function validarCNH(cnh) {
    const n = cnh.replace(/\D/g, '');
    if (n.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(n)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(n[i]) * (9 - i);
    let dsc = 0, d1 = sum % 11;
    if (d1 >= 10) { d1 = 0; dsc = 2; }
    sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(n[i]) * (1 + i);
    let d2 = (sum % 11) - dsc;
    if (d2 < 0) d2 += 11;
    if (d2 >= 10) d2 = 0;
    return parseInt(n[9]) === d1 && parseInt(n[10]) === d2;
}

async function renderDriverForm(id) {
    const isEdit = !!id;
    let d = { nome:'', cpf:'', cnhNumero:'', cnhCategoria:'B', cnhValidade:'', telefone:'', cep:'', endereco:'', ativo:true, vinculo:'' };
    if (isEdit) { const data = await getOne('motoristas', id); if (data) d = data; }
    const cats = ['A','B','C','D','E','AB','AC','AD','AE'];

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-id-card" style="color:var(--accent)"></i> ${isEdit?'Editar Motorista':'Novo Motorista'}</h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>
    <div id="cnhExpiryWarning" class="alert" style="display:none"></div>
    <div class="card">
        <div class="card-header"><div class="card-title"><i class="fa-solid fa-pen-to-square"></i> Dados do Motorista</div></div>
        <div class="card-body">
            <form id="driverForm">
                <div class="form-grid">
                    <div class="form-group span-2">
                        <label class="form-label">Nome Completo *</label>
                        <input type="text" name="nome" class="form-control" required value="${esc(d.nome)}" placeholder="Nome completo">
                    </div>
                    <div class="form-group">
                        <label class="form-label">CPF *</label>
                        <div style="position:relative">
                            <input type="text" name="cpf" id="cpfInput" class="form-control" required maxlength="14" value="${esc(d.cpf)}" placeholder="000.000.000-00" data-mask="cpf" style="padding-right:36px">
                            <span id="cpfIcon" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:14px">${d.cpf ? (validarCPF(d.cpf) ? '✅' : '❌') : ''}</span>
                        </div>
                        <div id="cpfMsg" style="font-size:11px;margin-top:4px;${d.cpf && !validarCPF(d.cpf) ? 'color:#dc2626' : 'color:#16a34a'}">${d.cpf ? (validarCPF(d.cpf) ? 'CPF válido' : 'CPF inválido — verifique os dígitos') : ''}</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Telefone</label>
                        <div style="position:relative">
                            <input type="text" name="telefone" id="telefoneInput" class="form-control" value="${esc(d.telefone||'')}" placeholder="(00) 00000-0000" data-mask="phone" style="padding-right:36px">
                            <span id="telefoneIcon" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:14px">${d.telefone ? (validarTelefone(d.telefone) ? '✅' : '❌') : ''}</span>
                        </div>
                        <div id="telefoneMsg" style="font-size:11px;margin-top:4px;${d.telefone && !validarTelefone(d.telefone) ? 'color:#dc2626' : 'color:#16a34a'}">${d.telefone ? (validarTelefone(d.telefone) ? 'Telefone válido' : 'DDD inválido ou número incompleto') : ''}</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Número da CNH *</label>
                        <div style="position:relative">
                            <input type="text" name="cnhNumero" id="cnhNumeroInput" class="form-control" required maxlength="11" value="${esc(d.cnhNumero||'')}" placeholder="00000000000" style="padding-right:36px">
                            <span id="cnhIcon" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:14px">${d.cnhNumero ? (validarCNH(d.cnhNumero) ? '✅' : '❌') : ''}</span>
                        </div>
                        <div id="cnhMsg" style="font-size:11px;margin-top:4px;${d.cnhNumero && !validarCNH(d.cnhNumero) ? 'color:#dc2626' : 'color:#16a34a'}">${d.cnhNumero ? (validarCNH(d.cnhNumero) ? 'CNH válida' : 'Número de CNH inválido — verifique os dígitos') : ''}</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Categoria da CNH *</label>
                        <select name="cnhCategoria" class="form-control">
                            ${cats.map(c => `<option value="${c}" ${d.cnhCategoria===c?'selected':''}>Categoria ${c}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Validade da CNH *</label>
                        <input type="date" id="cnh_validade" name="cnhValidade" class="form-control" required value="${esc(d.cnhValidade||'')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Tipo de Vínculo</label>
                        <select name="vinculo" class="form-control">
                            <option value="">— Não informado —</option>
                            ${['CLT','Terceirizado','PJ','Temporário','Autônomo'].map(v => `<option value="${v}" ${d.vinculo===v?'selected':''}>${v}</option>`).join('')}
                        </select>
                    </div>
                    ${isEdit ? `<div class="form-group">
                        <label class="form-label">Status</label>
                        <select name="ativo" class="form-control">
                            <option value="true" ${d.ativo!==false?'selected':''}>Ativo</option>
                            <option value="false" ${d.ativo===false?'selected':''}>Inativo</option>
                        </select>
                    </div>` : ''}
                    <div class="form-group">
                        <label class="form-label">CEP</label>
                        <div style="display:flex;gap:6px">
                            <input type="text" name="cep" id="cepInput" class="form-control" maxlength="9" value="${esc(d.cep||'')}" placeholder="00000-000">
                            <button type="button" id="buscarCepBtn" class="btn btn-secondary" style="white-space:nowrap;padding:0 14px"><i class="fa-solid fa-magnifying-glass"></i></button>
                        </div>
                    </div>
                    <div class="form-group span-full">
                        <label class="form-label">Endereço</label>
                        <textarea name="endereco" class="form-control">${esc(d.endereco||'')}</textarea>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> ${isEdit?'Salvar':'Cadastrar'}</button>
                </div>
            </form>
        </div>
    </div>`);

    document.getElementById('backBtn').addEventListener('click', () => navigate('drivers'));
    document.getElementById('cancelBtn').addEventListener('click', () => navigate('drivers'));

    document.getElementById('cepInput').addEventListener('input', e => {
        let v = e.target.value.replace(/\D/g,'').slice(0,8);
        if (v.length > 5) v = v.slice(0,5) + '-' + v.slice(5);
        e.target.value = v;
    });
    async function buscarCepDriver() {
        const cep = document.getElementById('cepInput').value.replace(/\D/g,'');
        if (cep.length !== 8) return;
        const btn = document.getElementById('buscarCepBtn');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            const j = await r.json();
            if (!j.erro) document.querySelector('[name="endereco"]').value = [j.logradouro, j.bairro, j.localidade+' - '+j.uf].filter(Boolean).join(', ');
        } catch(e) {}
        btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
    }
    document.getElementById('buscarCepBtn').addEventListener('click', buscarCepDriver);
    document.getElementById('cepInput').addEventListener('blur', () => { if (document.getElementById('cepInput').value.replace(/\D/g,'').length === 8) buscarCepDriver(); });

    applyMasks();

    document.getElementById('telefoneInput')?.addEventListener('input', function() {
        const icon = document.getElementById('telefoneIcon');
        const msg  = document.getElementById('telefoneMsg');
        const n = this.value.replace(/\D/g, '');
        if (n.length < 10) { icon.textContent = ''; msg.textContent = ''; return; }
        if (validarTelefone(this.value)) {
            icon.textContent = '✅'; msg.textContent = 'Telefone válido'; msg.style.color = '#16a34a';
        } else {
            icon.textContent = '❌'; msg.textContent = 'DDD inválido ou número incompleto'; msg.style.color = '#dc2626';
        }
    });

    document.getElementById('cpfInput')?.addEventListener('input', function() {
        const icon = document.getElementById('cpfIcon');
        const msg  = document.getElementById('cpfMsg');
        const v = this.value.replace(/\D/g, '');
        if (v.length < 11) { icon.textContent = ''; msg.textContent = ''; return; }
        if (validarCPF(this.value)) {
            icon.textContent = '✅'; msg.textContent = 'CPF válido'; msg.style.color = '#16a34a';
        } else {
            icon.textContent = '❌'; msg.textContent = 'CPF inválido — verifique os dígitos'; msg.style.color = '#dc2626';
        }
    });

    document.getElementById('cnhNumeroInput')?.addEventListener('input', function() {
        const v = this.value.replace(/\D/g, '').slice(0, 11);
        this.value = v;
        const icon = document.getElementById('cnhIcon');
        const msg  = document.getElementById('cnhMsg');
        if (!v) { icon.textContent = ''; msg.textContent = ''; return; }
        if (v.length < 11) { icon.textContent = ''; msg.textContent = ''; return; }
        if (validarCNH(v)) {
            icon.textContent = '✅'; msg.textContent = 'CNH válida'; msg.style.color = '#16a34a';
        } else {
            icon.textContent = '❌'; msg.textContent = 'Número de CNH inválido — verifique os dígitos'; msg.style.color = '#dc2626';
        }
    });

    document.getElementById('cnh_validade')?.addEventListener('change', function() {
        const w = document.getElementById('cnhExpiryWarning');
        const diff = Math.floor((new Date(this.value+'T00:00:00') - new Date()) / 86400000);
        if (diff < 0) { w.className='alert alert-danger'; w.innerHTML='<i class="fa-solid fa-circle-xmark"></i> CNH vencida!'; w.style.display='flex'; }
        else if (diff < 30) { w.className='alert alert-warning'; w.innerHTML=`<i class="fa-solid fa-triangle-exclamation"></i> CNH vence em <strong>${diff}</strong> dia(s)!`; w.style.display='flex'; }
        else { w.style.display='none'; }
    });

    document.getElementById('driverForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const cpfVal = fd.get('cpf').trim();
        if (cpfVal && !validarCPF(cpfVal)) {
            showFlash('CPF inválido. Verifique os dígitos.', 'danger');
            document.getElementById('cpfInput')?.focus();
            return;
        }
        const telVal = fd.get('telefone').trim();
        if (telVal && !validarTelefone(telVal)) {
            showFlash('Telefone inválido. Verifique o DDD e o número.', 'danger');
            document.getElementById('telefoneInput')?.focus();
            return;
        }
        const cnhNum = fd.get('cnhNumero').trim();
        if (cnhNum && !validarCNH(cnhNum)) {
            showFlash('Número de CNH inválido. Verifique os dígitos.', 'danger');
            document.getElementById('cnhNumeroInput')?.focus();
            return;
        }
        const data = {
            nome: fd.get('nome').trim().toUpperCase(),
            cpf: fd.get('cpf').trim(),
            cnhNumero: fd.get('cnhNumero').trim(),
            cnhCategoria: fd.get('cnhCategoria'),
            cnhValidade: fd.get('cnhValidade'),
            telefone: fd.get('telefone').trim(),
            cep: (fd.get('cep')||'').replace(/\D/g,''),
            endereco: fd.get('endereco').trim(),
            ativo: fd.get('ativo') !== 'false',
            vinculo: fd.get('vinculo') || '',
        };
        try {
            await saveDoc('motoristas', data, id || null);
            state.cache.drivers = null;
            showFlash(isEdit ? 'Motorista atualizado.' : 'Motorista cadastrado.');
            navigate('drivers');
        } catch(err) { showFlash('Erro: '+err.message,'danger'); }
    });
}

// ══════════════════════════════════════════════════════════════
// USAGE
// ══════════════════════════════════════════════════════════════
// UTILIZAÇÃO DIÁRIA
// ══════════════════════════════════════════════════════════════
let usagePage = 1, usageSearch = '', usageStatusFilter = '', usageDateFilter = today(), usageVehicleFilter = '', usageViewMode = 'grid', usageShowHidden = false;

async function renderUsage(sub) {
    if (sub === 'create') { renderUsageForm(null); return; }
    if (sub?.startsWith('edit:')) { renderUsageFinish(sub.split(':')[1]); return; }

    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');
    const [usages, vehicles, drivers] = await Promise.all([
        getAll('utilizacoes', orderBy('dataUtilizacao','desc')),
        getVisibleVehicles(), getDrivers()
    ]);
    const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const driverMap  = Object.fromEntries(drivers.map(d => [d.id, d]));

    const hiddenCountUsg = usages.filter(u => u.oculto).length;
    let filtered = usages.filter(u => {
        const v = vehicleMap[u.veiculoId];
        const m = driverMap[u.motoristaId];
        const q = usageSearch.toLowerCase();
        const matchQ = !q || v?.placa?.toLowerCase().includes(q) || m?.nome?.toLowerCase().includes(q);
        const matchS = !usageStatusFilter || u.status === usageStatusFilter;
        const matchD = !usageDateFilter || u.dataUtilizacao === usageDateFilter;
        const matchV = !usageVehicleFilter || u.veiculoId === usageVehicleFilter;
        const matchH = usageShowHidden || !u.oculto;
        return matchQ && matchS && matchD && matchV && matchH;
    });
    filtered.sort((a, b) => (a.status === 'em_uso' ? 0 : 1) - (b.status === 'em_uso' ? 0 : 1));

    const perPage = 15, total = filtered.length, totalPages = Math.ceil(total/perPage);
    if (usagePage > totalPages) usagePage = 1;
    const paged = filtered.slice((usagePage-1)*perPage, usagePage*perPage);
    const emUsoList     = paged.filter(u => u.status === 'em_uso');
    const finalizadoList = paged.filter(u => u.status !== 'em_uso');

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-road" style="color:var(--accent)"></i> Utilização Diária</h1>
            <p class="page-subtitle">${total} registro(s)</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
            <div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden">
                <button id="viewGrid" title="Grade" style="padding:7px 12px;border:none;cursor:pointer;font-size:14px;background:${usageViewMode==='grid'?'var(--primary)':'var(--card)'};color:${usageViewMode==='grid'?'#fff':'var(--muted)'}"><i class="fa-solid fa-grip"></i></button>
                <button id="viewList" title="Lista" style="padding:7px 12px;border:none;cursor:pointer;font-size:14px;background:${usageViewMode==='list'?'var(--primary)':'var(--card)'};color:${usageViewMode==='list'?'#fff':'var(--muted)'}"><i class="fa-solid fa-list"></i></button>
            </div>
            ${hiddenCountUsg ? `<button class="btn btn-secondary" id="uToggleHidden"><i class="fa-solid ${usageShowHidden?'fa-eye-slash':'fa-eye'}"></i> ${usageShowHidden?'Esconder ocultos':`Ocultos (${hiddenCountUsg})`}</button>` : ''}
            ${canEdit() ? '<button class="btn btn-primary" id="addUsageBtn"><i class="fa-solid fa-plus"></i> Nova Utilização</button>' : ''}
        </div>
    </div>

    <div class="filters-bar">
        <div class="form-group grow">
            <label class="form-label">Buscar (placa/motorista)</label>
            <input type="text" id="uSearch" class="form-control" value="${esc(usageSearch)}" placeholder="Placa ou nome..." list="uSearchList" autocomplete="off">
            <datalist id="uSearchList">
                ${vehicles.map(v => `<option value="${esc(v.placa)}">${esc(vDesc(v))}</option>`).join('')}
                ${drivers.map(d => `<option value="${esc(d.nome)}"></option>`).join('')}
            </datalist>
        </div>
        <div class="form-group">
            <label class="form-label">Veículo</label>
            <select id="uVehicle" class="form-control">
                <option value="">Todos</option>
                ${vehicles.sort((a,b)=>(a.placa||'').localeCompare(b.placa||'')).map(v => `<option value="${v.id}" ${usageVehicleFilter===v.id?'selected':''}>${esc(v.placa)}${vDesc(v)?' — '+esc(vDesc(v)):''}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Data</label>
            <input type="date" id="uDate" class="form-control" value="${esc(usageDateFilter)}">
        </div>
        <div class="form-group">
            <label class="form-label">Status</label>
            <select id="uStatus" class="form-control">
                <option value="">Todos</option>
                <option value="em_uso" ${usageStatusFilter==='em_uso'?'selected':''}>Em Uso</option>
                <option value="finalizado" ${usageStatusFilter==='finalizado'?'selected':''}>Finalizado</option>
            </select>
        </div>
        <div class="form-group" style="justify-content:flex-end">
            <button class="btn btn-primary" id="uFilter"><i class="fa-solid fa-magnifying-glass"></i> Filtrar</button>
            <button class="btn btn-secondary" id="uClear">Limpar</button>
        </div>
    </div>

    ${paged.length ? `
    ${emUsoList.length ? `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--accent)">
        <span class="status-dot dot-blue"></span> Em Uso agora (${emUsoList.length})
      </span>
    </div>
    <div style="${usageViewMode==='list'?'display:flex;flex-direction:column;gap:12px':'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px'};margin-bottom:${finalizadoList.length?'28px':'0'}">
    ${emUsoList.map(u => {
        const v = vehicleMap[u.veiculoId];
        const m = driverMap[u.motoristaId];
        const percurso = (u.kmFinal && u.kmInicial) ? (u.kmFinal - u.kmInicial) : null;
        if (usageViewMode === 'list') return `
    <div class="card-list-row" style="background:var(--card);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:10px;display:flex;align-items:center;gap:0;overflow:hidden;position:relative${u.oculto?';opacity:0.45':''}">
      ${u.oculto?`<div style="position:absolute;top:4px;left:4px;background:#64748b;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;letter-spacing:.5px">OCULTO</div>`:''}
      <div style="background:var(--primary);padding:10px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:90px;align-self:stretch">
        <div style="font-family:monospace;font-size:15px;font-weight:800;color:#fff;letter-spacing:2px">${esc(v?.placa||'—')}</div>
        <span class="badge badge-info" style="font-size:9px"><span class="status-dot dot-blue"></span>Em Uso</span>
      </div>
      <div style="padding:10px 14px;flex:1;display:flex;align-items:center;gap:20px;flex-wrap:wrap;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;min-width:120px">
          <i class="fa-solid fa-user" style="color:var(--muted);font-size:11px"></i>
          <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(m?.nome||'—')}</span>
        </div>
        ${u.destino?`<div style="display:flex;align-items:center;gap:6px">
          <i class="fa-solid fa-location-dot" style="color:var(--muted);font-size:11px"></i>
          <span style="font-size:12px;color:var(--text)">${esc(u.destino)}</span>
        </div>`:''}
        <div style="display:flex;align-items:center;gap:6px">
          <i class="fa-solid fa-clock" style="color:var(--muted);font-size:11px"></i>
          <span style="font-size:12px;color:var(--muted)">Saiu ${u.horaSaida?.substring(0,5)||'—'}</span>
        </div>
        <div style="font-size:12px;color:var(--muted)">KM: <span style="font-weight:600;color:var(--text)">${fmtKm(u.kmInicial)}</span></div>
      </div>
      ${canEdit() ? `<div class="card-list-actions">
        <button class="btn btn-primary btn-sm" data-gps="${u.id}" title="Abrir mapa ao vivo"><i class="fa-solid fa-map-location-dot"></i></button>
        ${m?.telefone ? `<a href="https://wa.me/${waLink(m.telefone)}?text=${encodeURIComponent(waMsgTracker(u,v,m))}" target="_blank" class="btn btn-whatsapp btn-sm" title="Enviar rastreio para ${esc(m?.nome||'')}"><i class="fa-solid fa-satellite-dish"></i><i class="fa-brands fa-whatsapp" style="font-size:9px;margin-left:1px"></i></a>` : ''}
        <button class="btn btn-warning btn-sm" data-km="${u.id}" data-km-ini="${u.kmInicial}" data-km-cur="${u.kmFinal||u.kmInicial}" data-vid="${u.veiculoId}" title="Atualizar KM"><i class="fa-solid fa-gauge-high"></i></button>
        ${m?.telefone ? `<button data-wa-km="${u.id}" data-km-ini="${u.kmInicial}" data-km-cur="${u.kmFinal||u.kmInicial}" data-vid="${u.veiculoId}" data-wa-url="https://wa.me/${waLink(m.telefone)}?text=${encodeURIComponent(`Olá ${m?.nome||''}! Pode nos informar o KM atual do veículo ${v?.placa||''}?\n👉 ${motoristUrl(u,v,m)}`)}" class="btn btn-whatsapp btn-sm" title="Solicitar KM via WhatsApp"><i class="fa-solid fa-gauge-high"></i><i class="fa-brands fa-whatsapp" style="font-size:9px;margin-left:1px"></i></button>` : ''}
        <button class="btn btn-secondary btn-sm" data-swap="${u.id}" title="Trocar motorista no turno"><i class="fa-solid fa-arrows-rotate"></i></button>
        <button class="btn btn-primary btn-sm" data-edit="${u.id}"><i class="fa-solid fa-flag-checkered"></i> Finalizar</button>
        ${isAdmin()?`<button class="btn btn-danger btn-sm" data-delete="${u.id}" data-vid="${u.veiculoId}" data-status="${u.status}" title="Cancelar"><i class="fa-solid fa-ban"></i></button>`:''}
        <button class="btn btn-secondary btn-sm" data-uthide="${u.id}" data-uthidden="${!!u.oculto}" title="${u.oculto?'Mostrar':'Ocultar'}"><i class="fa-solid ${u.oculto?'fa-eye':'fa-eye-slash'}"></i></button>
      </div>` : ''}
    </div>`;
        return `
    <div style="background:var(--card);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;position:relative${u.oculto?';opacity:0.45':''}">
      ${u.oculto?`<div style="position:absolute;top:8px;right:8px;background:#64748b;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.5px;z-index:1">OCULTO</div>`:''}
      <div style="background:var(--primary);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <div style="font-family:monospace;font-size:16px;font-weight:800;color:#fff;letter-spacing:2px">${esc(v?.placa||'—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v ? vDesc(v) : '')}</div>
        </div>
        <span class="badge badge-info" style="flex-shrink:0"><span class="status-dot dot-blue"></span>Em Uso</span>
      </div>
      <div style="padding:14px 16px;flex:1;display:flex;flex-direction:column;gap:9px">
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-user" style="color:var(--muted);font-size:12px;width:14px"></i>
          <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(m?.nome||'—')}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-clock" style="color:var(--muted);font-size:12px;width:14px"></i>
          <span style="font-size:13px;color:var(--text)">Saiu às ${u.horaSaida?.substring(0,5)||'—'}</span>
        </div>
        ${u.destino?`<div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-location-dot" style="color:var(--muted);font-size:12px;width:14px"></i>
          <span style="font-size:13px;color:var(--text);font-weight:500">${esc(u.destino)}</span>
        </div>`:''}
        <div style="display:flex;gap:16px">
          <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">KM Saída</div><div style="font-weight:600;font-size:13px">${fmtKm(u.kmInicial)}</div></div>
        </div>
        ${u.observacoes?`<div style="font-size:11px;color:var(--muted);font-style:italic;border-top:1px solid var(--border);padding-top:8px;margin-top:2px">${esc(u.observacoes)}</div>`:''}
        ${trocasTimeline(u, driverMap)}
      </div>
      ${canEdit() ? `<div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-gps="${u.id}" title="Abrir mapa ao vivo"><i class="fa-solid fa-map-location-dot"></i> Rastrear</button>
        ${m?.telefone ? `<a href="https://wa.me/${waLink(m.telefone)}?text=${encodeURIComponent(waMsgTracker(u,v,m))}" target="_blank" class="btn btn-whatsapp btn-sm" title="Enviar link de rastreio para ${esc(m?.nome||'')}"><i class="fa-solid fa-satellite-dish"></i><i class="fa-brands fa-whatsapp" style="font-size:10px;margin-left:2px"></i> Enviar Rastreio</a>` : ''}
        <button class="btn btn-warning btn-sm" data-km="${u.id}" data-km-ini="${u.kmInicial}" data-km-cur="${u.kmFinal||u.kmInicial}" data-vid="${u.veiculoId}" title="Atualizar KM"><i class="fa-solid fa-gauge-high"></i> KM</button>
        ${m?.telefone ? `<button data-wa-km="${u.id}" data-km-ini="${u.kmInicial}" data-km-cur="${u.kmFinal||u.kmInicial}" data-vid="${u.veiculoId}" data-wa-url="https://wa.me/${waLink(m.telefone)}?text=${encodeURIComponent(`Olá ${m?.nome||''}! Pode nos informar o KM atual do veículo ${v?.placa||''}?\n👉 ${motoristUrl(u,v,m)}`)}" class="btn btn-whatsapp btn-sm" title="Solicitar KM via WhatsApp"><i class="fa-solid fa-gauge-high"></i><i class="fa-brands fa-whatsapp" style="font-size:10px;margin-left:2px"></i> Solicitar KM</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-swap="${u.id}" title="Trocar motorista no turno"><i class="fa-solid fa-arrows-rotate"></i> Trocar Motorista</button>
        <button class="btn btn-primary btn-sm" data-edit="${u.id}">
          <i class="fa-solid fa-flag-checkered"></i> Finalizar
        </button>
        ${isAdmin()?`<button class="btn btn-danger btn-sm" data-delete="${u.id}" data-vid="${u.veiculoId}" data-status="${u.status}" title="Cancelar saída (apaga este registro)"><i class="fa-solid fa-ban"></i> Cancelar</button>`:''}
        <button class="btn btn-secondary btn-sm" data-uthide="${u.id}" data-uthidden="${!!u.oculto}" title="${u.oculto?'Mostrar':'Ocultar'}"><i class="fa-solid ${u.oculto?'fa-eye':'fa-eye-slash'}"></i> ${u.oculto?'Mostrar':'Ocultar'}</button>
      </div>` : ''}
    </div>`;}).join('')}
    </div>` : ''}

    ${finalizadoList.length ? `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#16a34a">
        <i class="fa-solid fa-circle-check" style="font-size:12px"></i> Finalizados (${finalizadoList.length})
      </span>
    </div>
    <div style="${usageViewMode==='list'?'display:flex;flex-direction:column;gap:12px':'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px'}">
    ${finalizadoList.map(u => {
        const v = vehicleMap[u.veiculoId];
        const m = driverMap[u.motoristaId];
        const percurso = (u.kmFinal && u.kmInicial) ? (u.kmFinal - u.kmInicial) : null;
        if (usageViewMode === 'list') return `
    <div class="card-list-row" style="background:var(--card);border:1px solid var(--border);border-left:3px solid #16a34a;border-radius:10px;display:flex;align-items:center;overflow:hidden;position:relative;opacity:${u.oculto?'0.45':'.92'}">
      ${u.oculto?`<div style="position:absolute;top:4px;left:4px;background:#64748b;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;letter-spacing:.5px">OCULTO</div>`:''}
      <div style="background:var(--primary);padding:10px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:90px;align-self:stretch">
        <div style="font-family:monospace;font-size:15px;font-weight:800;color:#fff;letter-spacing:2px">${esc(v?.placa||'—')}</div>
        <span class="badge badge-success" style="font-size:9px"><i class="fa-solid fa-circle-check" style="font-size:8px"></i> OK</span>
      </div>
      <div style="padding:10px 14px;flex:1;display:flex;align-items:center;gap:20px;flex-wrap:wrap;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;min-width:120px">
          <i class="fa-solid fa-user" style="color:var(--muted);font-size:11px"></i>
          <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(m?.nome||'—')}</span>
        </div>
        ${u.destino?`<div style="display:flex;align-items:center;gap:6px">
          <i class="fa-solid fa-location-dot" style="color:var(--muted);font-size:11px"></i>
          <span style="font-size:12px;color:var(--text)">${esc(u.destino)}</span>
        </div>`:''}
        <div style="display:flex;align-items:center;gap:6px">
          <i class="fa-solid fa-clock" style="color:var(--muted);font-size:11px"></i>
          <span style="font-size:12px;color:var(--muted)">${u.horaSaida?.substring(0,5)||'—'} → ${u.horaRetorno?.substring(0,5)||'—'}</span>
        </div>
        <div style="font-size:12px;color:var(--muted)">KM: <span style="font-weight:600;color:var(--text)">${fmtKm(u.kmInicial)}${u.kmFinal?' → '+fmtKm(u.kmFinal):''}</span></div>
        ${percurso!==null?`<div style="font-size:12px;font-weight:700;color:#16a34a">${fmtKm(percurso)}</div>`:''}
      </div>
      ${canEdit() ? `<div class="card-list-actions">
        <button class="btn btn-secondary btn-sm" data-edit="${u.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-secondary btn-sm" data-uthide="${u.id}" data-uthidden="${!!u.oculto}" title="${u.oculto?'Mostrar':'Ocultar'}"><i class="fa-solid ${u.oculto?'fa-eye':'fa-eye-slash'}"></i></button>
      </div>` : ''}
    </div>`;
        return `
    <div style="background:var(--card);border:1px solid var(--border);border-left:3px solid #16a34a;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;position:relative;opacity:${u.oculto?'0.45':'.9'}">
      ${u.oculto?`<div style="position:absolute;top:8px;right:8px;background:#64748b;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.5px;z-index:1">OCULTO</div>`:''}
      <div style="background:var(--primary);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <div style="font-family:monospace;font-size:16px;font-weight:800;color:#fff;letter-spacing:2px">${esc(v?.placa||'—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v ? vDesc(v) : '')}</div>
        </div>
        <span class="badge badge-success" style="flex-shrink:0"><i class="fa-solid fa-circle-check" style="font-size:10px"></i> Finalizado</span>
      </div>
      <div style="padding:14px 16px;flex:1;display:flex;flex-direction:column;gap:9px">
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-user" style="color:var(--muted);font-size:12px;width:14px"></i>
          <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(m?.nome||'—')}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-clock" style="color:var(--muted);font-size:12px;width:14px"></i>
          <span style="font-size:12px;color:var(--muted)">${u.horaSaida?.substring(0,5)||'—'} → ${u.horaRetorno?.substring(0,5)||'—'}</span>
        </div>
        ${u.destino?`<div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-location-dot" style="color:var(--muted);font-size:12px;width:14px"></i>
          <span style="font-size:12px;color:var(--text)">${esc(u.destino)}</span>
        </div>`:''}
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">KM Ini.</div><div style="font-weight:600;font-size:13px">${fmtKm(u.kmInicial)}</div></div>
          ${u.kmFinal?`<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">KM Fim</div><div style="font-weight:600;font-size:13px">${fmtKm(u.kmFinal)}</div></div>`:''}
          ${percurso!==null?`<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Percurso</div><div style="font-weight:700;font-size:14px;color:#16a34a">${fmtKm(percurso)}</div></div>`:''}
        </div>
        ${u.observacoes?`<div style="font-size:11px;color:var(--muted);font-style:italic;border-top:1px solid var(--border);padding-top:8px;margin-top:2px">${esc(u.observacoes)}</div>`:''}
      </div>
      ${canEdit() ? `<div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" data-edit="${u.id}">
          <i class="fa-solid fa-pen"></i> Editar
        </button>
        <button class="btn btn-secondary btn-sm" data-uthide="${u.id}" data-uthidden="${!!u.oculto}" title="${u.oculto?'Mostrar':'Ocultar'}"><i class="fa-solid ${u.oculto?'fa-eye':'fa-eye-slash'}"></i> ${u.oculto?'Mostrar':'Ocultar'}</button>
      </div>` : ''}
    </div>`;}).join('')}
    </div>` : ''}

    ${pagination(usagePage, totalPages, p => { usagePage = p; renderUsage(); })}`
    : emptyState('fa-road','Nenhum registro encontrado')}
    `);

    document.getElementById('addUsageBtn')?.addEventListener('click', () => navigate('usage','create'));
    document.getElementById('viewGrid')?.addEventListener('click', () => { usageViewMode='grid'; renderUsage(); });
    document.getElementById('viewList')?.addEventListener('click', () => { usageViewMode='list'; renderUsage(); });
    document.getElementById('uFilter')?.addEventListener('click', () => {
        usageSearch        = document.getElementById('uSearch').value;
        usageVehicleFilter = document.getElementById('uVehicle').value;
        usageDateFilter    = document.getElementById('uDate').value;
        usageStatusFilter  = document.getElementById('uStatus').value;
        usagePage = 1; renderUsage();
    });
    document.getElementById('uClear')?.addEventListener('click', () => { usageSearch=''; usageVehicleFilter=''; usageDateFilter=''; usageStatusFilter=''; usagePage=1; renderUsage(); });
    document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => navigate('usage','edit:'+b.dataset.edit)));
    document.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.status !== 'em_uso') { showToast('Registros finalizados não podem ser excluídos.','danger'); return; }
        showConfirm('Cancelar esta saída? O veículo voltará a ficar disponível. Use apenas para corrigir lançamentos errados.', async () => {
            try {
                await deleteFireDoc('utilizacoes', b.dataset.delete);
                await saveDoc('veiculos', { status: 'disponivel' }, b.dataset.vid);
                state.cache.vehicles = null;
                showToast('Saída cancelada. Veículo disponível novamente.'); renderUsage();
            } catch(e) { showToast('Erro: '+e.message,'danger'); }
        }, 'Cancelar saída');
    }));
    document.querySelectorAll('[data-gps]').forEach(b => b.addEventListener('click', () => {
        window.open(`${location.origin}/rastreio.html?id=${b.dataset.gps}`, '_blank');
    }));
    document.querySelectorAll('[data-km]').forEach(b => b.addEventListener('click', async () => {
        const kmIni = parseInt(b.dataset.kmIni) || 0;
        const kmCur = parseInt(b.dataset.kmCur) || kmIni;
        const input = prompt(`KM informado pelo motorista:\n(KM inicial: ${fmtKm(kmIni)} | Último registrado: ${fmtKm(kmCur)})`, kmCur);
        if (input === null) return;
        const km = parseInt(String(input).replace(/\D/g, ''));
        if (isNaN(km) || km < kmIni) { showFlash('KM inválido — deve ser maior ou igual ao KM inicial.', 'danger'); return; }
        const orig = b.innerHTML; b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            const [, veh] = await Promise.all([
                saveDoc('utilizacoes', { kmFinal: km }, b.dataset.km),
                getOne('veiculos', b.dataset.vid)
            ]);
            if (!veh || km > (veh.quilometragem || 0)) await saveDoc('veiculos', { quilometragem: km }, b.dataset.vid);
            state.cache.vehicles = null;
            showFlash(`KM atualizado para ${fmtKm(km)}.`);
            renderUsage();
        } catch(e) { showFlash('Erro: '+e.message,'danger'); b.disabled = false; b.innerHTML = orig; }
    }));
    document.querySelectorAll('[data-wa-km]').forEach(b => b.addEventListener('click', async () => {
        const kmIni = parseInt(b.dataset.kmIni) || 0;
        const kmCur = parseInt(b.dataset.kmCur) || kmIni;
        const waUrl = b.dataset.waUrl;
        const input = prompt(`Informe o KM atual do veículo:\n(KM inicial: ${fmtKm(kmIni)} | Último registrado: ${fmtKm(kmCur)})`, kmCur);
        if (input === null) { window.open(waUrl, '_blank'); return; }
        const km = parseInt(String(input).replace(/\D/g, ''));
        if (isNaN(km) || km < kmIni) { showFlash('KM inválido — deve ser maior ou igual ao KM inicial.', 'danger'); return; }
        window.open(waUrl, '_blank');
        const orig = b.innerHTML; b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            const [, veh] = await Promise.all([
                saveDoc('utilizacoes', { kmFinal: km }, b.dataset.waKm),
                getOne('veiculos', b.dataset.vid)
            ]);
            if (!veh || km > (veh.quilometragem || 0)) await saveDoc('veiculos', { quilometragem: km }, b.dataset.vid);
            state.cache.vehicles = null;
            showFlash(`KM atualizado para ${fmtKm(km)}.`);
            renderUsage();
        } catch(e) { showFlash('Erro: '+e.message,'danger'); b.disabled = false; b.innerHTML = orig; }
    }));
    attachPagination(p => { usagePage=p; renderUsage(); });
    document.getElementById('uToggleHidden')?.addEventListener('click', () => { usageShowHidden = !usageShowHidden; renderUsage(); });
    document.querySelectorAll('[data-uthide]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const nowHidden = btn.dataset.uthidden === 'true';
            await saveDoc('utilizacoes', { oculto: !nowHidden }, btn.dataset.uthide);
            renderUsage();
        });
    });
    document.querySelectorAll('[data-swap]').forEach(b => b.addEventListener('click', async () => {
        const u = usages.find(x => x.id === b.dataset.swap);
        if (!u) return;
        const allDrivers = await getDrivers();
        showDriverSwapModal(allDrivers, u, async ({ hora, km, novoId, novoNome }) => {
            try {
                const prevNome = driverMap[u.motoristaId]?.nome || u.motoristaNome || '—';
                const troca = {
                    motoristaId:      u.motoristaId,
                    motoristaNome:    prevNome,
                    novoMotoristaId:  novoId,
                    novoMotoristaNome: novoNome,
                    hora,
                    ...(km !== null ? { km } : {})
                };
                const trocas = [...(u.trocas || []), troca];
                const update = { motoristaId: novoId, motoristaNome: novoNome, trocas };
                if (km !== null) update.kmFinal = km;
                await saveDoc('utilizacoes', update, u.id);
                showFlash(`Motorista trocado para ${novoNome} às ${hora}.`);
                renderUsage();
            } catch(err) { showFlash('Erro: ' + err.message, 'danger'); }
        });
    }));
}

async function renderUsageForm() {
    const [allVehicles, allDrivers] = await Promise.all([getVisibleVehicles(), getDrivers()]);
    const availVehicles = allVehicles.filter(v => v.status === 'disponivel');
    const activeDrivers = allDrivers.filter(d => d.ativo !== false);

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-road" style="color:var(--accent)"></i> Nova Utilização</h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>
    ${!availVehicles.length ? '<div class="alert alert-warning"><i class="fa-solid fa-triangle-exclamation"></i> Nenhum veículo disponível no momento.</div>' : ''}
    <div class="card">
        <div class="card-header"><div class="card-title"><i class="fa-solid fa-pen-to-square"></i> Dados da Utilização</div></div>
        <div class="card-body">
            <form id="usageForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Data *</label>
                        <input type="date" name="dataUtilizacao" class="form-control" required value="${today()}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Hora de Saída *</label>
                        <input type="time" name="horaSaida" class="form-control" required value="${new Date().toTimeString().substring(0,5)}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Veículo *</label>
                        <select name="veiculoId" class="form-control" required>
                            <option value="">— Selecione —</option>
                            ${availVehicles.map(v => `<option value="${v.id}">${esc(v.placa+' — '+vDesc(v))}</option>`).join('')}
                        </select>
                        <div id="rodWarn"></div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Motorista *</label>
                        <select name="motoristaId" class="form-control" required>
                            <option value="">— Selecione —</option>
                            ${activeDrivers.map(d => `<option value="${d.id}">${esc(d.nome)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Quilometragem Inicial *</label>
                        <input type="number" name="kmInicial" id="kmInicialInput" class="form-control" required min="0" placeholder="Selecione o veículo primeiro">
                        <div id="kmInicialHint" style="font-size:11px;margin-top:5px;display:none"></div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Destino / Finalidade *</label>
                        <input type="text" name="destino" class="form-control" required placeholder="Ex: Visita cliente, Entrega, Reunião...">
                    </div>
                    <div class="form-group span-full">
                        <label class="form-label">Observações</label>
                        <textarea name="observacoes" class="form-control" placeholder="Informações adicionais..."></textarea>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-play"></i> Iniciar Utilização</button>
                </div>
            </form>
        </div>
    </div>`);

    document.getElementById('backBtn').addEventListener('click', () => navigate('usage'));
    document.getElementById('cancelBtn').addEventListener('click', () => navigate('usage'));

    document.getElementById('kmInicialInput').addEventListener('input', function() {
        const v = availVehicles.find(x => x.id === document.querySelector('[name="veiculoId"]').value);
        if (v?.quilometragem && parseInt(this.value) !== v.quilometragem) {
            this.style.borderColor = '';
            this.style.background  = '';
            const hint = document.getElementById('kmInicialHint');
            if (hint) hint.innerHTML = `<span style="color:#64748b"><i class="fa-solid fa-pen"></i> KM editado manualmente — odômetro do veículo era <strong>${fmtKm(v.quilometragem)}</strong></span>`;
        }
    });

    document.querySelector('[name="veiculoId"]').addEventListener('change', e => {
        const v = availVehicles.find(x => x.id === e.target.value);
        const w = document.getElementById('rodWarn');
        const kmInput = document.getElementById('kmInicialInput');
        const kmHint  = document.getElementById('kmInicialHint');
        if (kmInput) {
            if (v?.quilometragem) {
                kmInput.value = v.quilometragem;
                kmInput.style.borderColor = '#16a34a';
                kmInput.style.background  = '#f0fdf4';
                if (kmHint) {
                    kmHint.style.display = 'block';
                    kmHint.innerHTML = `<span style="color:#16a34a"><i class="fa-solid fa-circle-check"></i> Odômetro atual do veículo: <strong>${fmtKm(v.quilometragem)}</strong> — você pode corrigir se necessário</span>`;
                }
            } else {
                kmInput.value = '';
                kmInput.style.borderColor = '';
                kmInput.style.background  = '';
                if (kmHint) {
                    kmHint.style.display = v ? 'block' : 'none';
                    if (v) kmHint.innerHTML = `<span style="color:#f59e0b"><i class="fa-solid fa-triangle-exclamation"></i> Odômetro não cadastrado — informe o KM atual do veículo</span>`;
                }
            }
        }
        if (!w) return;
        if (v && isRodizioEnabled() && v.tipo !== 'motos') {
            const d = plateRestrictionDay(v.placa);
            const td = new Date().getDay();
            w.innerHTML = d === td
                ? `<div class="alert alert-warning" style="margin-top:8px;padding:10px 12px;font-size:13px">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <strong>Rodízio hoje</strong> (${DAY_FULL[td]}) — final de placa <strong>${String(v.placa).replace(/\D/g,'').slice(-1)}</strong>.
                   </div>`
                : '';
        } else { w.innerHTML = ''; }
    });

    document.getElementById('usageForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const vid = fd.get('veiculoId');
        const mid = fd.get('motoristaId');
        try {
            const [vehicles, drivers] = await Promise.all([getVisibleVehicles(), getDrivers()]);
            const v = vehicles.find(x => x.id === vid);
            const m = drivers.find(x => x.id === mid);
            const linkToken = genToken();
            const data = {
                veiculoId: vid, motoristaId: mid,
                dataUtilizacao: fd.get('dataUtilizacao'),
                horaSaida: fd.get('horaSaida'), kmInicial: parseInt(fd.get('kmInicial'))||0,
                destino: fd.get('destino').trim(), observacoes: fd.get('observacoes').trim(),
                status: 'em_uso', linkToken,
                veiculoPlaca: v?.placa || '', veiculoDesc: v ? vDesc(v) : '',
                motoristaNome: m?.nome || '',
            };
            const docId = await saveDoc('utilizacoes', data);
            await saveDoc('veiculos', { status: 'em_uso' }, vid);
            state.cache.vehicles = null;
            showFlash('Utilização iniciada com sucesso.');
            const tel  = waLink(m?.telefone);
            const uObj = { ...data, id: docId };
            if (tel) {
                window.open(`https://wa.me/${tel}?text=${encodeURIComponent(waMsg(uObj, v, m))}`, '_blank');
            }
            navigate('usage');
        } catch(err) { showFlash('Erro: '+err.message,'danger'); }
    });
}

async function renderUsageFinish(id) {
    const [u, vehicles, drivers] = await Promise.all([
        getOne('utilizacoes', id), getVisibleVehicles(), getDrivers()
    ]);
    if (!u) { showFlash('Registro não encontrado.','danger'); navigate('usage'); return; }
    const v = vehicles.find(x => x.id === u.veiculoId);
    const m = drivers.find(x => x.id === u.motoristaId);

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-road" style="color:var(--accent)"></i>
                ${u.status==='em_uso'?'Finalizar Utilização':'Editar Utilização'}
            </h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>
    <div class="card">
        <div class="card-header">
            <div class="card-title">
                <i class="fa-solid fa-pen-to-square"></i>
                ${v ? plate(v.placa) : ''} ${esc(vDesc(v)||'')} — ${esc(m?.nome||'—')}
            </div>
        </div>
        <div class="card-body">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:16px;margin-bottom:${u.trocas?.length?'12px':'20px'};padding:16px;background:#f8fafc;border-radius:10px">
                <div><span class="form-label">Data</span><div class="fw-bold">${fmtDate(u.dataUtilizacao)}</div></div>
                <div><span class="form-label">Saída</span><div class="fw-bold">${u.horaSaida?.substring(0,5)||'—'}</div></div>
                <div><span class="form-label">KM Inicial</span><div class="fw-bold">${fmtKm(u.kmInicial)}</div></div>
            </div>
            ${u.trocas?.length ? `<div style="margin-bottom:20px">${trocasTimeline(u, Object.fromEntries(drivers.map(d=>[d.id,d])))}</div>` : ''}
            <div id="kmWarn" class="alert alert-danger" style="display:none"><i class="fa-solid fa-circle-xmark"></i> KM final não pode ser menor que o inicial.</div>
            <form id="finishForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Hora de Retorno</label>
                        <input type="time" name="horaRetorno" class="form-control" value="${u.horaRetorno || (u.status === 'em_uso' ? new Date().toTimeString().substring(0,5) : '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Quilometragem Final (km)</label>
                        <input type="number" id="kmFinal" name="kmFinal" class="form-control" min="${u.kmInicial}" value="${u.kmFinal||''}" placeholder="${u.kmInicial}">
                    </div>
                    ${u.status !== 'em_uso' ? `
                    <div class="form-group">
                        <label class="form-label">Status</label>
                        <select name="status" class="form-control">
                            <option value="em_uso" ${u.status==='em_uso'?'selected':''}>Em Uso</option>
                            <option value="finalizado" ${u.status==='finalizado'?'selected':''}>Finalizado</option>
                        </select>
                    </div>` : '<input type="hidden" name="status" value="finalizado">'}
                    <div class="form-group span-full">
                        <label class="form-label">Destino / Finalidade</label>
                        <input type="text" name="destino" class="form-control" value="${esc(u.destino||'')}" placeholder="Ex: Visita cliente, Entrega, Reunião...">
                    </div>
                    <div class="form-group span-full">
                        <label class="form-label">Observações</label>
                        <textarea name="observacoes" class="form-control">${esc(u.observacoes||'')}</textarea>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancelar</button>
                    <button type="submit" class="btn btn-success"><i class="fa-solid fa-flag-checkered"></i>
                        ${u.status==='em_uso'?'Finalizar Utilização':'Salvar Alterações'}
                    </button>
                </div>
            </form>
        </div>
    </div>`);

    document.getElementById('backBtn').addEventListener('click', () => navigate('usage'));
    document.getElementById('cancelBtn').addEventListener('click', () => navigate('usage'));
    document.getElementById('kmFinal')?.addEventListener('input', function() {
        const w = document.getElementById('kmWarn');
        w.style.display = (this.value && parseInt(this.value) < u.kmInicial) ? 'flex' : 'none';
    });
    document.getElementById('finishForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const kmFinal = parseInt(fd.get('kmFinal')) || null;
        const status  = fd.get('status');
        if (kmFinal && kmFinal < u.kmInicial) { showFlash('KM final inválido.','danger'); return; }
        try {
            await saveDoc('utilizacoes', { horaRetorno: fd.get('horaRetorno')||null, kmFinal, destino: fd.get('destino').trim()||u.destino||'', observacoes: fd.get('observacoes').trim(), status }, id);
            if (status === 'finalizado') {
                await saveDoc('veiculos', { status: 'disponivel', ...(kmFinal ? { quilometragem: kmFinal } : {}) }, u.veiculoId);
                state.cache.vehicles = null;
                state.cache.drivers  = null;
            }
            showFlash(status==='finalizado'?'Utilização finalizada! Veículo marcado como disponível.':'Atualizado.');
            navigate('usage');
        } catch(err) { showFlash('Erro: '+err.message,'danger'); }
    });
}

// ══════════════════════════════════════════════════════════════
// FINES
// ══════════════════════════════════════════════════════════════
let finePage = 1, fineSearch = '', fineStatusFilter = '', fineDateFrom = '', fineDateTo = '';

function findDriverAtTime(usages, hora, driverMap) {
    let usage = usages[0];
    if (hora && usages.length > 1) {
        usage = usages.find(u => {
            const s = u.horaSaida?.substring(0,5) || '00:00';
            const e = u.horaRetorno?.substring(0,5) || '23:59';
            return hora >= s && hora <= e;
        }) || usages[0];
    }
    if (!usage) return null;
    if (!usage.trocas?.length) {
        return { motoristaId: usage.motoristaId, nome: driverMap[usage.motoristaId]?.nome || usage.motoristaNome || '—', byTime: false };
    }
    if (!hora) {
        return { motoristaId: usage.motoristaId, nome: driverMap[usage.motoristaId]?.nome || usage.motoristaNome || '—', byTime: false, hasSwaps: true };
    }
    const t = usage.trocas;
    if (hora < t[0].hora) {
        return { motoristaId: t[0].motoristaId, nome: t[0].motoristaNome || driverMap[t[0].motoristaId]?.nome || '—', byTime: true };
    }
    for (let i = 0; i < t.length - 1; i++) {
        if (hora >= t[i].hora && hora < t[i+1].hora) {
            return { motoristaId: t[i].novoMotoristaId, nome: t[i].novoMotoristaNome || driverMap[t[i].novoMotoristaId]?.nome || '—', byTime: true };
        }
    }
    const last = t[t.length-1];
    return { motoristaId: last.novoMotoristaId, nome: last.novoMotoristaNome || driverMap[last.novoMotoristaId]?.nome || '—', byTime: true };
}

// ══════════════════════════════════════════════════════════════
// MULTAS
// ══════════════════════════════════════════════════════════════
async function renderFines(sub) {
    if (sub === 'create') { renderFineForm(null); return; }
    if (sub?.startsWith('edit:')) { renderFineForm(sub.split(':')[1]); return; }

    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');
    const [fines, vehicles, drivers] = await Promise.all([
        getAll('multas', orderBy('dataInfracao','desc')), getVisibleVehicles(), getDrivers()
    ]);
    const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const driverMap  = Object.fromEntries(drivers.map(d => [d.id, d]));

    let filtered = fines.filter(f => {
        const v = vehicleMap[f.veiculoId];
        const m = driverMap[f.motoristaId];
        const q = fineSearch.toLowerCase();
        const matchQ = !q || v?.placa?.toLowerCase().includes(q) || m?.nome?.toLowerCase().includes(q) || f.tipoInfracao?.toLowerCase().includes(q);
        const matchS = !fineStatusFilter || f.status === fineStatusFilter;
        const matchFrom = !fineDateFrom || f.dataInfracao >= fineDateFrom;
        const matchTo   = !fineDateTo   || f.dataInfracao <= fineDateTo;
        return matchQ && matchS && matchFrom && matchTo;
    });

    const totalValor = filtered.reduce((s,f) => s+(f.valor||0), 0);
    const perPage = 15, total = filtered.length, totalPages = Math.ceil(total/perPage);
    if (finePage > totalPages) finePage = 1;
    const paged = filtered.slice((finePage-1)*perPage, finePage*perPage);

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-triangle-exclamation" style="color:var(--accent)"></i> Multas</h1>
            <p class="page-subtitle">${total} multa(s) · Total: ${fmtMoney(totalValor)}</p>
        </div>
        ${canEdit() ? '<button class="btn btn-primary" id="addFineBtn"><i class="fa-solid fa-plus"></i> Registrar Multa</button>' : ''}
    </div>

    <div class="filters-bar">
        <div class="form-group grow">
            <label class="form-label">Buscar</label>
            <input type="text" id="fSearch" class="form-control" value="${esc(fineSearch)}" placeholder="Placa, motorista, infração...">
        </div>
        <div class="form-group">
            <label class="form-label">De</label>
            <input type="date" id="fDateFrom" class="form-control" value="${fineDateFrom}">
        </div>
        <div class="form-group">
            <label class="form-label">Até</label>
            <input type="date" id="fDateTo" class="form-control" value="${fineDateTo}">
        </div>
        <div class="form-group">
            <label class="form-label">Status</label>
            <select id="fStatus" class="form-control">
                <option value="">Todos</option>
                <option value="pendente" ${fineStatusFilter==='pendente'?'selected':''}>Pendente</option>
                <option value="pago" ${fineStatusFilter==='pago'?'selected':''}>Pago</option>
                <option value="transferido" ${fineStatusFilter==='transferido'?'selected':''}>Transferido</option>
            </select>
        </div>
        <div class="form-group" style="justify-content:flex-end">
            <button class="btn btn-primary" id="fFilter"><i class="fa-solid fa-magnifying-glass"></i> Filtrar</button>
            <button class="btn btn-secondary" id="fClear">Limpar</button>
        </div>
    </div>

    ${paged.length ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px">
    ${paged.map(f => {
        const v = vehicleMap[f.veiculoId];
        const m = driverMap[f.motoristaId];
        const statusColor = {pendente:'#dc2626',pago:'#16a34a',transferido:'#6b7280'}[f.status]||'#6b7280';
        return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;border-left:3px solid ${statusColor}">
      <div style="background:var(--primary);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="min-width:0">
          <div style="font-family:monospace;font-size:16px;font-weight:800;color:#fff;letter-spacing:2px">${esc(v?.placa||'—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.7)">${esc(v ? vDesc(v) : '')}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:18px;font-weight:800;color:#fca5a5">${fmtMoney(f.valor)}</div>
          ${fineStatusBadge(f.status)}
        </div>
      </div>
      <div style="padding:14px 16px;flex:1;display:flex;flex-direction:column;gap:9px">
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-user" style="color:var(--muted);font-size:12px;width:14px"></i>
          <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(m?.nome||'Não identificado')}</span>
          ${f.atribuicaoAutomatica?'<span class="auto-tag"><i class="fa-solid fa-robot"></i> Auto</span>':''}
        </div>
        <div style="display:flex;align-items:flex-start;gap:8px">
          <i class="fa-solid fa-circle-exclamation" style="color:var(--muted);font-size:12px;width:14px;margin-top:2px"></i>
          <span style="font-size:12px;color:var(--text);line-height:1.4">${esc(f.tipoInfracao||'—')}</span>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <div>
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Data / Hora</div>
            <div style="font-weight:600;font-size:13px">${fmtDate(f.dataInfracao)}${f.horaInfracao?`<span style="font-size:12px;font-weight:700;color:var(--accent);margin-left:6px;background:#eff6ff;padding:1px 6px;border-radius:4px">${esc(f.horaInfracao)}</span>`:' <span style="font-size:10px;color:#94a3b8;font-style:italic">sem hora</span>'}</div>
          </div>
          ${f.pontos?`<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Pontos</div><div style="font-weight:700;font-size:13px;color:#f59e0b">${f.pontos} pts</div></div>`:''}
        </div>
        ${!f.motoristaId?`<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:#fef9c3;border-radius:6px;border:1px solid #fde047">
          <i class="fa-solid fa-triangle-exclamation" style="color:#ca8a04;font-size:11px"></i>
          <span style="font-size:11px;color:#92400e;font-weight:600">Motorista não identificado</span>
        </div>`:''}
      </div>
      ${canEdit() ? `<div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        ${!f.motoristaId?`<button class="btn btn-warning btn-sm" data-identify="${f.id}" data-identify-vid="${f.veiculoId}" data-identify-date="${f.dataInfracao}" title="Identificar motorista pelo horário"><i class="fa-solid fa-clock"></i> Identificar</button>`:''}
        <button class="btn btn-secondary btn-sm" data-edit="${f.id}"><i class="fa-solid fa-pen"></i> Editar</button>
        ${isAdmin()?`<button class="btn btn-danger btn-sm" data-delete="${f.id}"><i class="fa-solid fa-trash"></i> Excluir</button>`:''}
      </div>` : ''}
    </div>`;}).join('')}
    </div>
    ${pagination(finePage, totalPages, p => { finePage=p; renderFines(); })}`
    : emptyState('fa-triangle-exclamation','Nenhuma multa encontrada')}
    `);

    document.getElementById('addFineBtn')?.addEventListener('click', () => navigate('fines','create'));
    document.getElementById('fFilter')?.addEventListener('click', () => {
        fineSearch = document.getElementById('fSearch').value;
        fineDateFrom = document.getElementById('fDateFrom').value;
        fineDateTo   = document.getElementById('fDateTo').value;
        fineStatusFilter = document.getElementById('fStatus').value;
        finePage = 1; renderFines();
    });
    document.getElementById('fClear')?.addEventListener('click', () => { fineSearch=''; fineDateFrom=''; fineDateTo=''; fineStatusFilter=''; finePage=1; renderFines(); });
    document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => navigate('fines','edit:'+b.dataset.edit)));
    document.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => {
        showConfirm('Excluir esta multa? A ação não pode ser desfeita.', async () => {
            try { await deleteFireDoc('multas', b.dataset.delete); showToast('Multa excluída.'); renderFines(); }
            catch(e) { showToast('Erro: '+e.message,'danger'); }
        });
    }));
    attachPagination(p => { finePage=p; renderFines(); });
    document.querySelectorAll('[data-identify]').forEach(b => b.addEventListener('click', async () => {
        const vid  = b.dataset.identifyVid;
        const date = b.dataset.identifyDate;
        const hora = prompt(`Multa em ${fmtDate(date)}\n\nInforme o horário da infração (HH:MM):`, '');
        if (hora === null) return;
        const hh = hora.trim();
        if (!/^\d{2}:\d{2}$/.test(hh)) { showFlash('Horário inválido. Use o formato HH:MM (ex: 14:35).', 'danger'); return; }
        try {
            const snap = await getDocs(query(collection(db, 'utilizacoes'), where('veiculoId','==',vid), where('dataUtilizacao','==',date)));
            if (snap.empty) { showFlash('Nenhum registro de uso para este veículo nesta data.', 'warning'); return; }
            const usages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const dMap   = Object.fromEntries(drivers.map(d => [d.id, d]));
            const result = findDriverAtTime(usages, hh, dMap);
            if (result?.motoristaId) {
                await saveDoc('multas', { motoristaId: result.motoristaId, horaInfracao: hh, atribuicaoAutomatica: true }, b.dataset.identify);
                showFlash(`Motorista identificado: ${result.nome}`);
                renderFines();
            } else {
                showFlash('Não foi possível identificar o motorista para este horário.', 'warning');
            }
        } catch(err) { showFlash('Erro: '+err.message, 'danger'); }
    }));
}

async function renderFineForm(id) {
    const isEdit = !!id;
    let f = { veiculoId:'', motoristaId:'', dataInfracao: today(), tipoInfracao:'', valor:'', pontos:0, status:'pendente', atribuicaoAutomatica:false, observacoes:'' };
    if (isEdit) { const data = await getOne('multas', id); if (data) f = data; }

    const [vehicles, drivers] = await Promise.all([getVisibleVehicles(), getDrivers()]);
    const activeDrivers = drivers.filter(d => d.ativo !== false);
    const infracoes = ['Excesso de velocidade (até 20%)','Excesso de velocidade (entre 20% e 50%)','Excesso de velocidade (acima de 50%)',
        'Avanço de sinal vermelho','Estacionamento irregular','Uso de celular ao volante',
        'Não usar cinto de segurança','Ultrapassagem proibida','Trafegar na contramão',
        'Dirigir sob efeito de álcool','CNH vencida','Documentação irregular','Não dar preferência ao pedestre','Outras infrações'];

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-triangle-exclamation" style="color:var(--accent)"></i> ${isEdit?'Editar Multa':'Registrar Multa'}</h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>

    <div class="alert alert-info">
        <i class="fa-solid fa-robot"></i>
        <strong>Atribuição automática:</strong> Selecione o veículo e a data — o sistema identificará o motorista responsável automaticamente.
    </div>

    <div id="autoAssignInfo" class="alert" style="display:none"></div>

    <div class="card">
        <div class="card-header"><div class="card-title"><i class="fa-solid fa-pen-to-square"></i> Dados da Multa</div></div>
        <div class="card-body">
            <form id="fineForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Veículo *</label>
                        <select name="veiculoId" id="fVehicle" class="form-control" required>
                            <option value="">— Selecione o veículo —</option>
                            ${vehicles.map(v => `<option value="${v.id}" ${f.veiculoId===v.id?'selected':''}>${esc(v.placa+' — '+vDesc(v))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Data da Infração *</label>
                        <input type="date" id="fDate" name="dataInfracao" class="form-control" required value="${esc(f.dataInfracao)}" max="${today()}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Horário da Infração</label>
                        <input type="time" id="fTime" name="horaInfracao" class="form-control" value="${esc(f.horaInfracao||'')}">
                        <p class="form-hint">Essencial quando houve troca de motorista no dia.</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Motorista Responsável</label>
                        <select name="motoristaId" id="fDriver" class="form-control">
                            <option value="">— Aguardando atribuição automática —</option>
                            ${activeDrivers.map(d => `<option value="${d.id}" ${f.motoristaId===d.id?'selected':''}>${esc(d.nome)}</option>`).join('')}
                        </select>
                        <p class="form-hint">Preenchido automaticamente ao selecionar veículo e data.</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Tipo de Infração *</label>
                        <select name="tipoInfracao" class="form-control" required>
                            ${infracoes.map(i => `<option value="${esc(i)}" ${f.tipoInfracao===i?'selected':''}>${esc(i)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Valor (R$) *</label>
                        <input type="number" name="valor" class="form-control" required min="0.01" step="0.01" value="${f.valor||''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Pontos na CNH</label>
                        <input type="number" name="pontos" class="form-control" min="0" max="30" value="${f.pontos||0}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Status</label>
                        <select name="status" class="form-control">
                            <option value="pendente" ${f.status==='pendente'?'selected':''}>Pendente</option>
                            <option value="pago" ${f.status==='pago'?'selected':''}>Pago</option>
                            <option value="transferido" ${f.status==='transferido'?'selected':''}>Transferido</option>
                        </select>
                    </div>
                    <div class="form-group span-full">
                        <label class="form-label">Observações</label>
                        <textarea name="observacoes" class="form-control">${esc(f.observacoes||'')}</textarea>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> ${isEdit?'Salvar':'Registrar Multa'}</button>
                </div>
            </form>
        </div>
    </div>`);

    document.getElementById('backBtn').addEventListener('click', () => navigate('fines'));
    document.getElementById('cancelBtn').addEventListener('click', () => navigate('fines'));

    // Auto-assign driver
    let autoAssigned = f.atribuicaoAutomatica || false;
    async function tryAutoAssign() {
        const vid  = document.getElementById('fVehicle').value;
        const date = document.getElementById('fDate').value;
        const hora = document.getElementById('fTime').value || null;
        const info = document.getElementById('autoAssignInfo');
        if (!vid || !date) return;
        try {
            const snap = await getDocs(query(collection(db, 'utilizacoes'), where('veiculoId','==',vid), where('dataUtilizacao','==',date)));
            if (!snap.empty) {
                const usages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                const dMap   = Object.fromEntries(drivers.map(d => [d.id, d]));
                const result = findDriverAtTime(usages, hora, dMap);
                if (result) {
                    document.getElementById('fDriver').value = result.motoristaId || '';
                    autoAssigned = true;
                    if (result.hasSwaps && !hora) {
                        info.className = 'alert alert-warning';
                        info.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Houve <strong>troca de motorista</strong> neste dia. Informe o <strong>Horário da Infração</strong> acima para identificar o condutor correto.`;
                    } else if (result.byTime) {
                        info.className = 'alert alert-success';
                        info.innerHTML = `<i class="fa-solid fa-clock"></i> Motorista identificado pelo horário <strong>${esc(hora)}</strong>: <strong>${esc(result.nome)}</strong>`;
                    } else {
                        info.className = 'alert alert-info';
                        info.innerHTML = `<i class="fa-solid fa-robot"></i> Motorista atribuído automaticamente: <strong>${esc(result.nome)}</strong>`;
                    }
                    info.style.display = 'flex';
                }
            } else {
                autoAssigned = false;
                info.className = 'alert alert-warning';
                info.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Nenhum motorista registrado para este veículo nesta data. Selecione manualmente.';
                info.style.display = 'flex';
            }
        } catch(e) {}
    }

    document.getElementById('fVehicle').addEventListener('change', tryAutoAssign);
    document.getElementById('fDate').addEventListener('change', tryAutoAssign);
    document.getElementById('fTime').addEventListener('change', tryAutoAssign);
    document.getElementById('fDriver').addEventListener('change', () => { autoAssigned = false; });

    document.getElementById('fineForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = {
            veiculoId: fd.get('veiculoId'), motoristaId: fd.get('motoristaId')||null,
            dataInfracao: fd.get('dataInfracao'), horaInfracao: fd.get('horaInfracao')||null, tipoInfracao: fd.get('tipoInfracao'),
            valor: parseFloat(fd.get('valor')), pontos: parseInt(fd.get('pontos'))||0,
            status: fd.get('status'), atribuicaoAutomatica: autoAssigned,
            observacoes: fd.get('observacoes').trim(),
        };
        try {
            await saveDoc('multas', data, id||null);
            showFlash(isEdit?'Multa atualizada.':'Multa registrada.');
            navigate('fines');
        } catch(err) { showFlash('Erro: '+err.message,'danger'); }
    });
}

// ══════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════
let reportType = 'usage', reportDateFrom = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    reportDateTo = today(), reportVid = '', reportMid = '', reportStatus = '';

// ══════════════════════════════════════════════════════════════
// RELATÓRIOS
// ══════════════════════════════════════════════════════════════
async function renderReports() {
    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');
    const [vehicles, drivers] = await Promise.all([getVisibleVehicles(), getDrivers()]);

    async function buildReport() {
        let data = [], summary = {};
        const vehicleMap = Object.fromEntries(vehicles.map(v=>[v.id,v]));
        const driverMap  = Object.fromEntries(drivers.map(d=>[d.id,d]));

        if (reportType === 'usage') {
            let all = await getAll('utilizacoes', orderBy('dataUtilizacao','desc'));
            data = all.filter(u => (!reportVid||u.veiculoId===reportVid) && (!reportMid||u.motoristaId===reportMid)
                && (!reportStatus||u.status===reportStatus) && (!reportDateFrom||u.dataUtilizacao>=reportDateFrom) && (!reportDateTo||u.dataUtilizacao<=reportDateTo));
            const totalKm = data.reduce((s,u) => s+((u.kmFinal&&u.kmInicial)?u.kmFinal-u.kmInicial:0), 0);
            summary = { 'Total de Usos': data.length, 'KM Percorrido': fmtKm(totalKm),
                        'Veículos': new Set(data.map(u=>u.veiculoId)).size, 'Motoristas': new Set(data.map(u=>u.motoristaId)).size };
        }
        if (reportType === 'fines') {
            let all = await getAll('multas', orderBy('dataInfracao','desc'));
            data = all.filter(f => (!reportVid||f.veiculoId===reportVid) && (!reportMid||f.motoristaId===reportMid)
                && (!reportStatus||f.status===reportStatus) && (!reportDateFrom||f.dataInfracao>=reportDateFrom) && (!reportDateTo||f.dataInfracao<=reportDateTo));
            const totalValor = data.reduce((s,f)=>s+(f.valor||0),0);
            const valorPend  = data.filter(f=>f.status==='pendente').reduce((s,f)=>s+(f.valor||0),0);
            const totalPts   = data.reduce((s,f)=>s+(f.pontos||0),0);
            summary = { 'Total de Multas': data.length, 'Valor Total': fmtMoney(totalValor), 'Valor Pendente': fmtMoney(valorPend), 'Total de Pontos': totalPts+' pts' };
        }
        if (reportType === 'vehicles') {
            let allUsages = await getAll('utilizacoes');
            let allFines  = await getAll('multas');
            data = vehicles.map(v => ({
                ...v,
                totalUsos: allUsages.filter(u=>u.veiculoId===v.id).length,
                totalKm:   allUsages.filter(u=>u.veiculoId===v.id&&u.kmFinal).reduce((s,u)=>s+(u.kmFinal-u.kmInicial),0),
                totalMultas: allFines.filter(f=>f.veiculoId===v.id).length,
                valorMultas: allFines.filter(f=>f.veiculoId===v.id).reduce((s,f)=>s+(f.valor||0),0),
            }));
            summary = { 'Total de Veículos': data.length };
        }
        if (reportType === 'drivers') {
            let allUsages = await getAll('utilizacoes');
            let allFines  = await getAll('multas');
            const now = new Date();
            data = drivers.map(d => ({
                ...d,
                diasCnh: d.cnhValidade ? Math.floor((new Date(d.cnhValidade+'T00:00:00')-now)/86400000) : null,
                totalUsos: allUsages.filter(u=>u.motoristaId===d.id).length,
                totalKm:   allUsages.filter(u=>u.motoristaId===d.id&&u.kmFinal).reduce((s,u)=>s+(u.kmFinal-u.kmInicial),0),
                totalMultas: allFines.filter(f=>f.motoristaId===d.id).length,
                valorMultas: allFines.filter(f=>f.motoristaId===d.id).reduce((s,f)=>s+(f.valor||0),0),
            }));
            summary = { 'Total de Motoristas': data.length };
        }
        if (reportType === 'costs') {
            const [fuelAll, manutAll] = await Promise.all([
                getAll('abastecimentos'), getAll('manutencoes')
            ]);
            const months = [];
            for (let i = 5; i >= 0; i--) {
                const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
                months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
            }
            data = months.map(mo => {
                const fuelCost  = fuelAll.filter(f => f.data?.substring(0,7) === mo).reduce((s,f) => s+(f.valorTotal||0), 0);
                const manutCost = manutAll.filter(m => m.data?.substring(0,7) === mo).reduce((s,m) => s+(m.custo||0), 0);
                return { month: mo, fuelCost, manutCost, total: fuelCost + manutCost };
            });
            const totFuel  = data.reduce((s,d)=>s+d.fuelCost,0);
            const totManut = data.reduce((s,d)=>s+d.manutCost,0);
            summary = { 'Combustível (6 meses)': fmtMoney(totFuel), 'Manutenção (6 meses)': fmtMoney(totManut), 'Total Geral': fmtMoney(totFuel+totManut) };
        }
        if (reportType === 'custos-veiculo') {
            const [fuelAll, manutAll, finesAll, usagesAll] = await Promise.all([
                getAll('abastecimentos'), getAll('manutencoes'), getAll('multas'), getAll('utilizacoes')
            ]);
            data = vehicles.map(v => {
                const fuel  = fuelAll.filter(f  => f.veiculoId===v.id && (!reportDateFrom||f.data>=reportDateFrom) && (!reportDateTo||f.data<=reportDateTo));
                const manut = manutAll.filter(m => m.veiculoId===v.id && (!reportDateFrom||m.data>=reportDateFrom) && (!reportDateTo||m.data<=reportDateTo));
                const fines = finesAll.filter(f => f.veiculoId===v.id && (!reportDateFrom||f.dataInfracao>=reportDateFrom) && (!reportDateTo||f.dataInfracao<=reportDateTo));
                const usages = usagesAll.filter(u => u.veiculoId===v.id && u.kmFinal && u.kmInicial);
                const totalCombustivel = fuel.reduce((s,f)=>s+(f.valorTotal||0),0);
                const totalManutencao  = manut.reduce((s,m)=>s+(m.custo||0),0);
                const totalMultas      = fines.reduce((s,f)=>s+(f.valor||0),0);
                const totalKm          = usages.reduce((s,u)=>s+(u.kmFinal-u.kmInicial),0);
                const total = totalCombustivel + totalManutencao + totalMultas;
                return { ...v, totalCombustivel, totalManutencao, totalMultas, totalKm, total, custoPorKm: totalKm>0 ? total/totalKm : null };
            }).sort((a,b) => b.total - a.total);
            const totFuel   = data.reduce((s,v)=>s+v.totalCombustivel,0);
            const totManut  = data.reduce((s,v)=>s+v.totalManutencao,0);
            const totMultas = data.reduce((s,v)=>s+v.totalMultas,0);
            summary = { 'Combustível': fmtMoney(totFuel), 'Manutenção': fmtMoney(totManut), 'Multas': fmtMoney(totMultas), 'Total Geral': fmtMoney(totFuel+totManut+totMultas) };
        }
        return { data, summary, vehicleMap, driverMap };
    }

    const { data, summary, vehicleMap, driverMap } = await buildReport();

    const typeLabels = { usage:'Utilização', fines:'Multas', vehicles:'Veículos', drivers:'Motoristas', costs:'Custos', 'custos-veiculo':'Custo/Veículo' };
    const typeIcons  = { usage:'fa-road', fines:'fa-triangle-exclamation', vehicles:'fa-car', drivers:'fa-id-card', costs:'fa-chart-column', 'custos-veiculo':'fa-receipt' };

    function tableContent() {
        if (!data.length) return emptyState('fa-chart-bar','Nenhum dado encontrado','Ajuste os filtros.');
        if (reportType === 'costs') return `
            <div style="padding:16px"><canvas id="costChart" style="max-height:300px"></canvas></div>
            <table>
                <thead><tr><th>Mês</th><th>Combustível</th><th>Manutenção</th><th>Total</th></tr></thead>
                <tbody>${data.map(d => `<tr>
                    <td>${new Date(d.month+'-15').toLocaleString('pt-BR',{month:'long',year:'numeric'})}</td>
                    <td>${fmtMoney(d.fuelCost)}</td>
                    <td>${fmtMoney(d.manutCost)}</td>
                    <td style="font-weight:700">${fmtMoney(d.total)}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        if (reportType === 'usage') return `<table>
            <thead><tr><th>Data</th><th>Veículo</th><th>Motorista</th><th>Destino</th><th>Saída</th><th>Retorno</th><th>KM Ini.</th><th>KM Fim</th><th>Percurso</th><th>Status</th></tr></thead>
            <tbody>${data.map(u => { const v=vehicleMap[u.veiculoId],m=driverMap[u.motoristaId]; const p=(u.kmFinal&&u.kmInicial)?(u.kmFinal-u.kmInicial):null;
                return `<tr><td>${fmtDate(u.dataUtilizacao)}</td><td>${v?plate(v.placa):'—'}</td><td>${esc(m?.nome||'—')}</td><td>${esc(u.destino||'—')}</td><td>${u.horaSaida?.substring(0,5)||'—'}</td><td>${u.horaRetorno?.substring(0,5)||'—'}</td><td>${fmtKm(u.kmInicial)}</td><td>${u.kmFinal?fmtKm(u.kmFinal):'—'}</td><td>${p!==null?fmtKm(p):'—'}</td><td>${u.status==='finalizado'?'Finalizado':'Em Uso'}</td></tr>`;
            }).join('')}</tbody></table>`;
        if (reportType === 'fines') return `<table>
            <thead><tr><th>Data</th><th>Veículo</th><th>Motorista</th><th>Infração</th><th>Pontos</th><th>Valor</th><th>Status</th></tr></thead>
            <tbody>${data.map(f => { const v=vehicleMap[f.veiculoId],m=driverMap[f.motoristaId];
                return `<tr><td>${fmtDate(f.dataInfracao)}</td><td>${v?plate(v.placa):'—'}</td><td>${esc(m?.nome||'—')}${f.atribuicaoAutomatica?'<span class="auto-tag" style="margin-left:4px">Auto</span>':''}</td><td>${esc(f.tipoInfracao)}</td><td>${f.pontos||'—'}</td><td class="fw-bold">${fmtMoney(f.valor)}</td><td>${fineStatusBadge(f.status)}</td></tr>`;
            }).join('')}
            <tr style="background:#f8fafc;font-weight:700"><td colspan="5" class="text-right">Total:</td><td>${fmtMoney(data.reduce((s,f)=>s+(f.valor||0),0))}</td><td></td></tr>
            </tbody></table>`;
        if (reportType === 'vehicles') return `<table>
            <thead><tr><th>Placa</th><th>Veículo</th><th>Ano</th><th>KM Atual</th><th>Status</th><th>Usos</th><th>KM Percorrido</th><th>Multas</th><th>Valor Multas</th></tr></thead>
            <tbody>${data.map(v => `<tr><td>${plate(v.placa)}</td><td>${esc(vDesc(v))}</td><td>${v.ano}</td><td>${fmtKm(v.quilometragem)}</td><td>${vehicleStatusBadge(v.status)}</td><td>${v.totalUsos}</td><td>${fmtKm(v.totalKm)}</td><td>${v.totalMultas}</td><td>${fmtMoney(v.valorMultas)}</td></tr>`).join('')}</tbody></table>`;
        if (reportType === 'drivers') return `<table>
            <thead><tr><th>Nome</th><th>CPF</th><th>CNH</th><th>Categoria</th><th>Validade CNH</th><th>Usos</th><th>KM</th><th>Multas</th><th>Valor Multas</th></tr></thead>
            <tbody>${data.map(d => `<tr><td class="td-label">${esc(d.nome)}</td><td>${esc(d.cpf||'—')}</td><td>${esc(d.cnhNumero||'—')}</td><td>Cat. ${esc(d.cnhCategoria||'—')}</td>
            <td>${d.diasCnh===null?'—':d.diasCnh<0?'<span style="color:var(--danger);font-weight:700">VENCIDA</span>':fmtDate(d.cnhValidade)}</td>
            <td>${d.totalUsos}</td><td>${fmtKm(d.totalKm)}</td><td>${d.totalMultas}</td><td>${fmtMoney(d.valorMultas)}</td></tr>`).join('')}</tbody></table>`;
        return '';
    }

    const monthOpts = (() => {
        let opts = '<option value="">Personalizado</option>';
        let selMonth = '';
        if (reportDateFrom) {
            const [fy, fm, fd] = reportDateFrom.split('-').map(Number);
            if (fd === 1 && reportDateTo) {
                const lastDay = new Date(fy, fm, 0).getDate();
                const [ty, tm, td] = reportDateTo.split('-').map(Number);
                if (ty===fy && tm===fm && td===lastDay) selMonth = `${fy}-${String(fm).padStart(2,'0')}`;
            }
        }
        for (let i = 0; i < 12; i++) {
            const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
            const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            const lbl = d.toLocaleString('pt-BR', {month:'long', year:'numeric'});
            opts += `<option value="${val}" ${selMonth===val?'selected':''}>${lbl.charAt(0).toUpperCase()+lbl.slice(1)}</option>`;
        }
        return opts;
    })();

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-chart-bar" style="color:var(--accent)"></i> Relatórios</h1>
        </div>
        <div style="display:flex;gap:8px">
            ${(reportType==='usage' || reportType==='custos-veiculo') && data.length ? `<button class="btn btn-secondary" id="rExportCsv"><i class="fa-solid fa-file-csv"></i> CSV</button>` : ''}
            ${data.length ? `<button class="btn btn-primary" id="rExportPdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>` : ''}
        </div>
    </div>

    <div class="report-tabs">
        ${Object.entries(typeLabels).map(([key,lbl]) => `<button class="report-tab${reportType===key?' active':''}" data-rt="${key}">
            <i class="fa-solid ${typeIcons[key]}"></i> ${lbl}
        </button>`).join('')}
    </div>

    ${reportType !== 'vehicles' && reportType !== 'drivers' && reportType !== 'costs' ? `
    <div class="filters-bar">
        ${reportType==='usage' || reportType==='custos-veiculo' ? `<div class="form-group">
            <label class="form-label">Mês de Referência</label>
            <select id="rMonth" class="form-control">${monthOpts}</select>
        </div>` : ''}
        <div class="form-group"><label class="form-label">De</label><input type="date" id="rFrom" class="form-control" value="${reportDateFrom}"></div>
        <div class="form-group"><label class="form-label">Até</label><input type="date" id="rTo" class="form-control" value="${reportDateTo}"></div>
        ${reportType !== 'custos-veiculo' ? `<div class="form-group">
            <label class="form-label">Veículo</label>
            <select id="rVehicle" class="form-control"><option value="">Todos</option>${vehicles.map(v=>`<option value="${v.id}" ${reportVid===v.id?'selected':''}>${esc(v.placa)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
            <label class="form-label">Motorista</label>
            <select id="rDriver" class="form-control"><option value="">Todos</option>${drivers.map(d=>`<option value="${d.id}" ${reportMid===d.id?'selected':''}>${esc(d.nome)}</option>`).join('')}</select>
        </div>` : ''}
        ${reportType==='fines' ? `<div class="form-group">
            <label class="form-label">Status</label>
            <select id="rStatus" class="form-control"><option value="">Todos</option><option value="pendente">Pendente</option><option value="pago">Pago</option><option value="transferido">Transferido</option></select>
        </div>` : ''}
        <div class="form-group" style="justify-content:flex-end">
            <button class="btn btn-primary" id="rGenerate"><i class="fa-solid fa-magnifying-glass"></i> Gerar</button>
        </div>
    </div>` : ''}

    <div class="report-summary">
        ${Object.entries(summary).map(([lbl,val]) => `<div class="report-sum-item"><div class="report-sum-value">${val}</div><div class="report-sum-label">${lbl}</div></div>`).join('')}
    </div>

    <div class="card">
        <div class="card-header">
            <div class="card-title"><i class="fa-solid ${typeIcons[reportType]}"></i> ${typeLabels[reportType]}</div>
            <span style="font-size:12px;color:var(--muted)">${data.length} registro(s)</span>
        </div>
        <div class="table-responsive">${tableContent()}</div>
    </div>`);

    if (reportType === 'costs' && data.length && window.Chart) {
        const ctx = document.getElementById('costChart');
        if (ctx) new window.Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => new Date(d.month+'-15').toLocaleString('pt-BR',{month:'short',year:'2-digit'})),
                datasets: [
                    { label:'Combustível', data: data.map(d=>d.fuelCost),  backgroundColor:'#f59e0b', borderRadius:6 },
                    { label:'Manutenção',  data: data.map(d=>d.manutCost), backgroundColor:'#2563eb', borderRadius:6 }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position:'top' },
                    tooltip: { callbacks: { label: c => `${c.dataset.label}: ${(c.raw).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}` } }
                },
                scales: { y: { ticks: { callback: v => 'R$ '+v.toLocaleString('pt-BR') } } }
            }
        });
    }

    document.querySelectorAll('[data-rt]').forEach(b => b.addEventListener('click', () => {
        reportType = b.dataset.rt; reportVid=''; reportMid=''; reportStatus=''; renderReports();
    }));
    document.getElementById('rGenerate')?.addEventListener('click', () => {
        reportDateFrom = document.getElementById('rFrom')?.value || '';
        reportDateTo   = document.getElementById('rTo')?.value || '';
        reportVid      = document.getElementById('rVehicle')?.value || '';
        reportMid      = document.getElementById('rDriver')?.value || '';
        reportStatus   = document.getElementById('rStatus')?.value || '';
        renderReports();
    });
    document.getElementById('rMonth')?.addEventListener('change', function() {
        if (!this.value) return;
        const [y, m] = this.value.split('-').map(Number);
        reportDateFrom = `${y}-${String(m).padStart(2,'0')}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        reportDateTo = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
        renderReports();
    });
    document.getElementById('rExportCsv')?.addEventListener('click', () => {
        let header, rows, filename;
        if (reportType === 'custos-veiculo') {
            header = ['Veículo','Placa','KM Percorrido','Combustível (R$)','Manutenção (R$)','Multas (R$)','Total (R$)','R$/km'];
            rows = data.map(v => [
                vDesc(v), v.placa, v.totalKm||0,
                v.totalCombustivel.toFixed(2), v.totalManutencao.toFixed(2), v.totalMultas.toFixed(2), v.total.toFixed(2),
                v.custoPorKm!==null?v.custoPorKm.toFixed(2):''
            ].map(c => `"${String(c).replace(/"/g,'""')}"`).join(','));
            filename = `custo_veiculo_${(reportDateFrom||today()).substring(0,7)}.csv`;
        } else {
            header = ['Data','Veículo','Motorista','Destino','Saída','Retorno','KM Inicial','KM Final','Percurso (km)','Status'];
            rows = data.map(u => {
                const v = vehicleMap[u.veiculoId], md = driverMap[u.motoristaId];
                const p = (u.kmFinal && u.kmInicial) ? (u.kmFinal - u.kmInicial) : '';
                return [u.dataUtilizacao||'', v?v.placa:'', md?md.nome:'', u.destino||'',
                        (u.horaSaida||'').substring(0,5), (u.horaRetorno||'').substring(0,5),
                        u.kmInicial||'', u.kmFinal||'', p,
                        u.status==='finalizado'?'Finalizado':'Em Uso']
                    .map(c => `"${String(c).replace(/"/g,'""')}"`).join(',');
            });
            filename = `utilizacoes_${(reportDateFrom||today()).substring(0,7)}.csv`;
        }
        const csv = '﻿' + [header.map(h=>`"${h}"`).join(','), ...rows].join('\r\n');
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'})),
            download: filename
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
    document.getElementById('rExportPdf')?.addEventListener('click', () => {
        const empNome = state.empresa?.nome || 'FrotaControl';
        const periodo = (reportDateFrom && reportDateTo)
            ? `${fmtDate(reportDateFrom)} a ${fmtDate(reportDateTo)}` : 'Período completo';
        let thead = '', tbody = '';
        if (reportType === 'usage') {
            thead = '<tr><th>Data</th><th>Veículo</th><th>Motorista</th><th>Destino</th><th>Saída</th><th>Retorno</th><th>KM Ini.</th><th>KM Fim</th><th>Percurso</th><th>Status</th></tr>';
            tbody = data.map(u => {
                const v = vehicleMap[u.veiculoId], m = driverMap[u.motoristaId];
                const p = (u.kmFinal && u.kmInicial) ? fmtKm(u.kmFinal - u.kmInicial) : '—';
                return `<tr><td>${fmtDate(u.dataUtilizacao)}</td><td>${esc(v?.placa||'—')}</td><td>${esc(m?.nome||'—')}</td><td>${esc(u.destino||'—')}</td><td>${u.horaSaida?.substring(0,5)||'—'}</td><td>${u.horaRetorno?.substring(0,5)||'—'}</td><td>${fmtKm(u.kmInicial)}</td><td>${u.kmFinal?fmtKm(u.kmFinal):'—'}</td><td>${p}</td><td>${u.status==='finalizado'?'Finalizado':'Em Uso'}</td></tr>`;
            }).join('');
        } else if (reportType === 'fines') {
            thead = '<tr><th>Data</th><th>Veículo</th><th>Motorista</th><th>Infração</th><th>Pontos</th><th>Valor</th><th>Status</th></tr>';
            tbody = data.map(f => {
                const v = vehicleMap[f.veiculoId], m = driverMap[f.motoristaId];
                const st = f.status==='pago'?'Pago':f.status==='transferido'?'Transferido':'Pendente';
                return `<tr><td>${fmtDate(f.dataInfracao)}</td><td>${esc(v?.placa||'—')}</td><td>${esc(m?.nome||'—')}</td><td>${esc(f.tipoInfracao||'—')}</td><td>${f.pontos||'—'}</td><td style="font-weight:700">${fmtMoney(f.valor)}</td><td>${st}</td></tr>`;
            }).join('');
            tbody += `<tr style="background:#f8fafc;font-weight:700"><td colspan="5" style="text-align:right">Total:</td><td>${fmtMoney(data.reduce((s,f)=>s+(f.valor||0),0))}</td><td></td></tr>`;
        } else if (reportType === 'vehicles') {
            thead = '<tr><th>Placa</th><th>Veículo</th><th>Ano</th><th>KM Atual</th><th>Status</th><th>Usos</th><th>KM Percorrido</th><th>Multas</th><th>Valor Multas</th></tr>';
            tbody = data.map(v => `<tr><td style="font-weight:700">${esc(v.placa)}</td><td>${esc([v.marca,v.modelo].filter(Boolean).join(' '))}</td><td>${v.ano||'—'}</td><td>${fmtKm(v.quilometragem)}</td><td>${v.status==='disponivel'?'Disponível':v.status==='em_uso'?'Em Uso':'Inativo'}</td><td>${v.totalUsos}</td><td>${fmtKm(v.totalKm)}</td><td>${v.totalMultas}</td><td>${fmtMoney(v.valorMultas)}</td></tr>`).join('');
        } else if (reportType === 'drivers') {
            thead = '<tr><th>Nome</th><th>CPF</th><th>CNH</th><th>Categoria</th><th>Validade CNH</th><th>Usos</th><th>KM</th><th>Multas</th><th>Valor Multas</th></tr>';
            tbody = data.map(d => {
                const cnhSt = d.diasCnh===null?'—':d.diasCnh<0?'<span style="color:#dc2626;font-weight:700">VENCIDA</span>':fmtDate(d.cnhValidade);
                return `<tr><td style="font-weight:600">${esc(d.nome)}</td><td>${esc(d.cpf||'—')}</td><td>${esc(d.cnhNumero||'—')}</td><td>Cat. ${esc(d.cnhCategoria||'—')}</td><td>${cnhSt}</td><td>${d.totalUsos}</td><td>${fmtKm(d.totalKm)}</td><td>${d.totalMultas}</td><td>${fmtMoney(d.valorMultas)}</td></tr>`;
            }).join('');
        } else if (reportType === 'costs') {
            thead = '<tr><th>Mês</th><th>Combustível</th><th>Manutenção</th><th>Total</th></tr>';
            tbody = data.map(d => `<tr><td>${new Date(d.month+'-15').toLocaleString('pt-BR',{month:'long',year:'numeric'})}</td><td>${fmtMoney(d.fuelCost)}</td><td>${fmtMoney(d.manutCost)}</td><td style="font-weight:700">${fmtMoney(d.total)}</td></tr>`).join('');
        } else if (reportType === 'custos-veiculo') {
            thead = '<tr><th>Veículo</th><th>Placa</th><th>KM Percorrido</th><th>Combustível</th><th>Manutenção</th><th>Multas</th><th>Total</th><th>R$/km</th></tr>';
            tbody = data.map(v => `<tr><td>${esc(vDesc(v))}</td><td style="font-weight:700">${esc(v.placa)}</td><td>${v.totalKm>0?fmtKm(v.totalKm):'—'}</td><td>${fmtMoney(v.totalCombustivel)}</td><td>${fmtMoney(v.totalManutencao)}</td><td>${fmtMoney(v.totalMultas)}</td><td style="font-weight:700;color:#2563eb">${fmtMoney(v.total)}</td><td style="color:#64748b">${v.custoPorKm!==null?fmtMoney(v.custoPorKm).replace('R$ ','')+'  /km':'—'}</td></tr>`).join('');
            tbody += `<tr style="background:#f8fafc;font-weight:700"><td colspan="3" style="text-align:right">Total:</td><td>${fmtMoney(data.reduce((s,v)=>s+v.totalCombustivel,0))}</td><td>${fmtMoney(data.reduce((s,v)=>s+v.totalManutencao,0))}</td><td>${fmtMoney(data.reduce((s,v)=>s+v.totalMultas,0))}</td><td style="color:#2563eb">${fmtMoney(data.reduce((s,v)=>s+v.total,0))}</td><td></td></tr>`;
        }
        const sumHtml = Object.entries(summary).map(([lbl, val]) =>
            `<div class="si"><div class="sv">${val}</div><div class="sl">${lbl}</div></div>`
        ).join('');
        const w = window.open('', '_blank');
        w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>${typeLabels[reportType]} — ${esc(empNome)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:24px;background:#fff}
.rh{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #2563eb}
.co{font-size:18px;font-weight:700;color:#2563eb}.rt{font-size:13px;font-weight:600;margin-top:3px}
.meta{text-align:right;color:#64748b;line-height:1.8;font-size:11px}
.sum{display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.si{flex:1;min-width:100px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center}
.sv{font-size:17px;font-weight:700;color:#2563eb}.sl{font-size:10px;color:#64748b;margin-top:2px}
table{width:100%;border-collapse:collapse}
th{background:#1e3a5f;color:#fff;text-align:left;padding:7px 8px;font-size:10px;font-weight:600;white-space:nowrap}
td{padding:6px 8px;border-bottom:1px solid #e2e8f0;vertical-align:middle}
tr:nth-child(even) td{background:#f8fafc}
.ft{margin-top:18px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
@media print{body{padding:8px}@page{margin:1.5cm;size:A4 landscape}}
</style></head><body>
<div class="rh">
  <div><div class="co">${esc(empNome)}</div><div class="rt">${typeLabels[reportType]}</div></div>
  <div class="meta"><div><strong>Período:</strong> ${periodo}</div><div><strong>Gerado em:</strong> ${new Date().toLocaleString('pt-BR')}</div><div><strong>Total:</strong> ${data.length} registro(s)</div></div>
</div>
<div class="sum">${sumHtml}</div>
<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
<div class="ft">FrotaControl — relatório gerado automaticamente</div>
</body></html>`);
        w.document.close();
        setTimeout(() => { w.focus(); w.print(); }, 400);
    });
}

// ══════════════════════════════════════════════════════════════
// MAP — Rastreamento em tempo real
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// TRIAL / PLANO
// ══════════════════════════════════════════════════════════════
function checkTrial() {
    const emp = state.empresa;
    if (!emp) return;
    if (['ativo','basico','profissional','empresarial','pendente'].includes(emp.plano)) return;

    if (emp.plano === 'cancelado') {
        _showCanceladoModal();
        return;
    }

    const expira = emp.trialExpira?.toDate
        ? emp.trialExpira.toDate()
        : (emp.trialExpira ? new Date(emp.trialExpira) : null);

    if (!expira) return;

    const diasRestantes = Math.ceil((expira - new Date()) / 86400000);

    if (diasRestantes <= 0) {
        _showTrialExpiredModal();
        return;
    }
    if (diasRestantes <= 7) {
        _showTrialBanner(diasRestantes);
    }
}

function _showTrialBanner(dias) {
    if (document.getElementById('trialBanner')) return;
    const b = document.createElement('div');
    b.id = 'trialBanner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#f59e0b;color:#fff;font-size:13px;font-weight:600;text-align:center;padding:8px 16px;display:flex;align-items:center;justify-content:center;gap:12px';
    b.innerHTML = `<i class="fa-solid fa-clock"></i> Seu trial expira em <b>${dias} dia${dias !== 1 ? 's' : ''}</b>.
        <a href="planos.html" style="color:#fff;text-decoration:underline;white-space:nowrap">Assinar agora</a>
        <button onclick="document.getElementById('trialBanner').remove()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0 4px;margin-left:8px">×</button>`;
    document.body.prepend(b);
}

function _showTrialExpiredModal() {
    if (document.getElementById('trialExpiredModal')) return;
    const wpp = brandConfig.supportWhatsApp ? `https://wa.me/${brandConfig.supportWhatsApp}` : null;
    const m = document.createElement('div');
    m.id = 'trialExpiredModal';
    m.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.85);display:flex;align-items:center;justify-content:center;padding:20px';
    m.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:40px 36px;max-width:420px;width:100%;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,.4)">
            <div style="width:64px;height:64px;background:#fef3c7;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:20px">⏰</div>
            <h2 style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 10px">Período de teste encerrado</h2>
            <p style="font-size:14px;color:#64748b;margin:0 0 24px;line-height:1.6">
                Seu trial de ${brandConfig.trialDays || 14} dias chegou ao fim.<br>
                Assine um plano para continuar usando o ${brandConfig.name}.
            </p>
            <a href="planos.html" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 24px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:12px">
                <i class="fa-solid fa-crown"></i> Ver planos e preços
            </a>
            ${wpp ? `<a href="${wpp}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 24px;background:#25d366;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;margin-bottom:12px">
                <i class="fa-brands fa-whatsapp"></i> Falar no WhatsApp
            </a>` : ''}
            <button onclick="import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js').then(m=>m.signOut(m.getAuth())).catch(()=>{}).finally(()=>window.location.href='login.html')"
                style="background:none;border:none;color:#94a3b8;font-size:12px;cursor:pointer;padding:4px">
                Sair da conta
            </button>
        </div>`;
    document.body.appendChild(m);
}

function _showCanceladoModal() {
    if (document.getElementById('canceladoModal')) return;
    const wpp = brandConfig.supportWhatsApp ? `https://wa.me/${brandConfig.supportWhatsApp}` : null;
    const m = document.createElement('div');
    m.id = 'canceladoModal';
    m.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.85);display:flex;align-items:center;justify-content:center;padding:20px';
    m.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:40px 36px;max-width:420px;width:100%;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,.4)">
            <div style="width:64px;height:64px;background:#fee2e2;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:20px">🔒</div>
            <h2 style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 10px">Conta suspensa</h2>
            <p style="font-size:14px;color:#64748b;margin:0 0 6px;line-height:1.6">
                Sua assinatura foi cancelada ou está com pagamento em atraso.
            </p>
            <p style="font-size:13px;color:#94a3b8;margin:0 0 24px;line-height:1.6">
                Renove sua assinatura para voltar a usar o ${brandConfig.name}.
            </p>
            <a href="planos.html" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 24px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:12px">
                <i class="fa-solid fa-rotate"></i> Renovar assinatura
            </a>
            ${wpp ? `<a href="${wpp}?text=${encodeURIComponent('Olá! Minha conta no ' + brandConfig.name + ' foi suspensa. Preciso de ajuda para regularizar.')}" target="_blank"
                style="display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 24px;background:#25d366;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;margin-bottom:12px">
                <i class="fa-brands fa-whatsapp"></i> Falar no WhatsApp
            </a>` : ''}
            <button onclick="import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js').then(m=>m.signOut(m.getAuth())).catch(()=>{}).finally(()=>window.location.href='login.html')"
                style="background:none;border:none;color:#94a3b8;font-size:12px;cursor:pointer;padding:4px">
                Sair da conta
            </button>
        </div>`;
    document.body.appendChild(m);
}

// ══════════════════════════════════════════════════════════════
// GPS / RASTREAMENTO
// ══════════════════════════════════════════════════════════════
let mapUnsub    = null;
let gpsWatchId  = null;
let gpsUsageId  = null;
// ══════════════════════════════════════════════════════════════
// GPS / RASTREAMENTO EM TEMPO REAL
// ══════════════════════════════════════════════════════════════
let gpsTrack    = [];
let gpsLastSend = 0;

async function checkGPSBar() {
    try {
        const active = await getAll('utilizacoes', where('status', '==', 'em_uso'));
        if (!active.length) { if (gpsWatchId != null) stopGPS(); return; }
        if (gpsWatchId != null) return; // já rodando
        const u = active[0];
        const vehicles = await getVisibleVehicles();
        const drivers  = await getDrivers();
        const v = vehicles.find(x => x.id === u.veiculoId);
        const m = drivers.find(x => x.id === u.motoristaId);
        startGPS(u.id, v?.placa || '', vDesc(v), m?.nome || '');
    } catch(_) { _setGPSBar('inativo'); }
}

function startGPS(usageId, placa, modelo, motoristaNome) {
    if (!navigator.geolocation) { showFlash('GPS não suportado neste dispositivo', 'danger'); return; }
    gpsUsageId = usageId; gpsTrack = []; gpsLastSend = 0;
    _setGPSBar('ativando');
    gpsWatchId = navigator.geolocation.watchPosition(
        pos => {
            const { latitude: lat, longitude: lng, accuracy: precisao, speed } = pos.coords;
            const velocidade = speed != null ? Math.round(speed * 3.6) : null;
            const ts = Date.now();
            gpsTrack.push({ lat, lng, ts, vel: velocidade });
            if (gpsTrack.length > 100) gpsTrack.shift();
            _setGPSBar('ativo', { velocidade, precisao: Math.round(precisao) });
            if (ts - gpsLastSend < 15000) return;
            gpsLastSend = ts;
            const locData = { lat, lng, ts, precisao: Math.round(precisao) };
            if (velocidade != null) locData.velocidade = velocidade;
            updateDoc(doc(db, 'utilizacoes', usageId), { localizacao: locData, trilha: gpsTrack.slice(-80) })
                .catch(() => {});
            setDoc(doc(db, 'rastreios', usageId), {
                ...locData, placa, modelo, motoristaNome,
                empresaId: state.profile?.empresaId || ''
            }).catch(() => {});
        },
        err => { stopGPS(); },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 }
    );
}

function stopGPS() {
    if (gpsWatchId != null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
    gpsUsageId = null; gpsTrack = [];
    _setGPSBar('inativo');
}

function _setGPSBar(status, loc) {
    const ind = document.getElementById('gpsIndicator');
    if (!ind) return;
    if (status === 'ativo') {
        ind.style.display = 'block';
        ind.style.background = '#22c55e';
        ind.style.animation = 'gpsPulse 2s infinite';
        ind.title = loc?.velocidade != null
            ? `GPS ativo · ${loc.velocidade} km/h · ${loc.precisao}m`
            : 'GPS ativo';
    } else if (status === 'ativando') {
        ind.style.display = 'block';
        ind.style.background = '#f59e0b';
        ind.style.animation = 'gpsAcquire 1s infinite';
        ind.title = 'Obtendo sinal GPS...';
    } else {
        ind.style.display = 'none';
    }
}

async function renderMap() {
    // Ocupa o viewport inteiro no map page
    const pc = document.getElementById('pageContent');
    pc.style.padding = '0';
    pc.style.display = 'flex';
    pc.style.flexDirection = 'column';
    pc.style.height = 'calc(100vh - 62px)';
    pc.style.overflow = 'hidden';

    setContent(`
    <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 16px;background:#fff;border-bottom:1px solid var(--border)">
        <span style="font-size:14px;font-weight:700;color:var(--text)"><i class="fa-solid fa-map-location-dot" style="color:var(--accent)"></i> Rastreamento</span>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
            <span class="badge badge-success" id="statMoving"><i class="fa-solid fa-arrow-up-right-dots"></i> 0 em movimento</span>
            <span class="badge badge-info"    id="statIdle"><i class="fa-solid fa-circle-pause"></i> 0 parado</span>
            <span class="badge badge-muted"   id="statNoSig"><i class="fa-solid fa-ban"></i> 0 sem sinal</span>
        </div>
    </div>

    <div style="position:relative;flex:1;min-height:0">
        <div id="mapContainer" style="position:absolute;top:0;left:0;right:0;bottom:0"></div>
        <div style="position:absolute;bottom:12px;left:12px;background:rgba(255,255,255,.92);
             backdrop-filter:blur(8px);border-radius:10px;padding:8px 12px;font-size:11px;
             display:flex;flex-direction:column;gap:5px;box-shadow:0 2px 12px rgba(0,0,0,.15);z-index:400">
            <div style="display:flex;align-items:center;gap:7px"><span style="width:12px;height:12px;background:#16a34a;border-radius:3px;display:inline-block"></span>Em movimento</div>
            <div style="display:flex;align-items:center;gap:7px"><span style="width:12px;height:12px;background:#2563eb;border-radius:3px;display:inline-block"></span>Parado / idle</div>
            <div style="display:flex;align-items:center;gap:7px"><span style="width:12px;height:12px;background:#64748b;border-radius:3px;display:inline-block"></span>Sem sinal (+10min)</div>
        </div>
    </div>

    <div style="flex-shrink:0;overflow-y:auto;max-height:240px;background:#fff;border-top:1px solid var(--border)">
        <div style="padding:8px 16px 4px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:700;color:var(--text)"><i class="fa-solid fa-list"></i> Veículos em Uso</span>
            <small style="color:var(--muted);font-size:10px"><i class="fa-solid fa-route"></i> trilha · <i class="fa-solid fa-crosshairs"></i> centralizar · <i class="fa-solid fa-satellite-dish"></i> rastreador</small>
        </div>
        <div id="mapVehicleList"><div style="padding:16px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin"></i></div></div>

        <div style="padding:8px 16px 4px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border);margin-top:4px">
            <span style="font-size:12px;font-weight:700;color:var(--text)"><i class="fa-solid fa-microchip"></i> Dispositivos GPS</span>
            <button class="btn btn-primary btn-sm" id="addDeviceBtn"><i class="fa-solid fa-plus"></i> Novo</button>
        </div>
        <div id="devicesSection"><div style="padding:16px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin"></i></div></div>
    </div>`);

    if (typeof L === 'undefined') { showFlash('Leaflet não carregado. Recarregue a página.','danger'); return; }

    const map = L.map('mapContainer').setView([-15.7942, -47.8825], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 100);

    const markers = {}, trails = {};
    const [vehicles, drivers] = await Promise.all([getVisibleVehicles(), getDrivers()]);
    const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const driverMap  = Object.fromEntries(drivers.map(d => [d.id, d]));

    if (mapUnsub) { mapUnsub(); mapUnsub = null; }

    const _empId = state.profile?.empresaId;
    mapUnsub = onSnapshot(
        query(collection(db, 'utilizacoes'),
              ...(_empId ? [where('empresaId', '==', _empId)] : []),
              where('status', '==', 'em_uso')),
        { includeMetadataChanges: false },
        snap => {
            const active  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const now     = Date.now();
            const withLoc = active.filter(u => u.localizacao?.lat != null);
            let nMov = 0, nIdle = 0, nNoSig = active.length - withLoc.length;

            withLoc.forEach(u => {
                const { lat, lng, ts, precisao, velocidade } = u.localizacao;
                const v = vehicleMap[u.veiculoId], m = driverMap[u.motoristaId];
                const minsOld  = ts ? (now - ts) / 60000 : 999;
                const isStale  = minsOld > 10;
                const isMoving = velocidade != null && velocidade > 3;
                if (isStale) nNoSig++; else if (isMoving) nMov++; else nIdle++;

                const color = isStale ? '#64748b' : isMoving ? '#16a34a' : '#2563eb';
                const placa = v?.placa || '???';
                const velTxt = velocidade != null ? `${velocidade} km/h` : '';
                const timeTxt = ts ? new Date(ts).toLocaleTimeString('pt-BR') : '—';

                const icon = L.divIcon({
                    html: `<div style="background:${color};color:#fff;border-radius:8px;padding:3px 8px;
                               font-size:10px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.3);
                               border:2px solid #fff;min-width:52px;text-align:center;white-space:nowrap">
                               <div style="font-size:11px;letter-spacing:.5px">${esc(placa)}</div>
                               ${velTxt ? `<div style="font-size:9px;opacity:.85">${velTxt}</div>` : ''}
                           </div>`,
                    className: '', iconSize: [68, 28], iconAnchor: [34, 14]
                });
                const popup = `<div style="font-family:inherit;min-width:175px">
                    <div style="font-weight:700;font-size:14px;margin-bottom:2px">${esc(placa)}</div>
                    <div style="font-size:12px;color:#64748b;margin-bottom:6px">${esc(v ? vDesc(v) : '—')}</div>
                    <div style="font-size:12px"><b>Motorista:</b> ${esc(m?.nome||'—')}</div>
                    <div style="font-size:12px"><b>Velocidade:</b> ${velocidade != null ? velocidade+' km/h' : '—'}</div>
                    <div style="font-size:12px"><b>Precisão:</b> ${precisao != null ? precisao+'m' : '—'}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:5px"><i class="fa-solid fa-clock"></i> ${timeTxt}</div>
                    ${isStale ? '<div style="font-size:10px;color:#dc2626;margin-top:3px"><i class="fa-solid fa-triangle-exclamation"></i> Sinal desatualizado</div>' : ''}
                </div>`;
                if (markers[u.id]) {
                    markers[u.id].setLatLng([lat, lng]);
                    markers[u.id].setIcon(icon);
                    markers[u.id].getPopup().setContent(popup);
                } else {
                    markers[u.id] = L.marker([lat, lng], { icon }).addTo(map).bindPopup(popup, { maxWidth:240 });
                }
            });

            Object.keys(markers).forEach(id => {
                if (!withLoc.find(u => u.id === id)) {
                    map.removeLayer(markers[id]); delete markers[id];
                    if (trails[id]) { map.removeLayer(trails[id]); delete trails[id]; }
                }
            });

            if (withLoc.length === 1) map.setView([withLoc[0].localizacao.lat, withLoc[0].localizacao.lng], 15);
            else if (withLoc.length > 1) map.fitBounds(withLoc.map(u => [u.localizacao.lat, u.localizacao.lng]), { padding:[50,50] });

            const el = { mv: document.getElementById('statMoving'), id: document.getElementById('statIdle'), ns: document.getElementById('statNoSig') };
            if (el.mv) { el.mv.textContent = `${nMov} em movimento`; el.id.textContent = `${nIdle} parado${nIdle!==1?'s':''}`;  el.ns.textContent = `${nNoSig} sem sinal`; }

            const listEl = document.getElementById('mapVehicleList');
            if (!listEl) return;
            if (!active.length) {
                listEl.innerHTML = `<div class="card-body">${emptyState('fa-car','Nenhum veículo em uso','Inicie uma utilização para ver os veículos aqui.')}</div>`;
                return;
            }

            listEl.innerHTML = `<div class="table-responsive"><table>
                <thead><tr><th>Veículo</th><th>Motorista</th><th>Velocidade</th><th>Última Posição</th><th>Precisão</th><th>Ações</th></tr></thead>
                <tbody>${active.map(u => {
                    const v = vehicleMap[u.veiculoId], m = driverMap[u.motoristaId];
                    const loc = u.localizacao, hasLoc = loc?.lat != null;
                    const minsOld = loc?.ts ? (now - loc.ts) / 60000 : 999;
                    const isStale = hasLoc && minsOld > 10;
                    const ts  = loc?.ts ? new Date(loc.ts).toLocaleTimeString('pt-BR') : null;
                    const vel = loc?.velocidade;
                    const hasTrilha = (u.trilha?.length || 0) > 1;
                    return `<tr>
                        <td>${v ? plate(v.placa)+'<div class="td-sub">'+esc(vDesc(v))+'</div>' : '—'}</td>
                        <td>${esc(m?.nome||'—')}</td>
                        <td>${vel != null ? `<strong>${vel}</strong> km/h` : '—'}</td>
                        <td>${hasLoc
                            ? isStale
                                ? `<span class="badge badge-warning"><i class="fa-solid fa-clock"></i> ${ts} <small>(+${Math.round(minsOld)}min)</small></span>`
                                : `<span class="badge badge-success"><i class="fa-solid fa-satellite-dish"></i> ${ts}</span>`
                            : '<span class="badge badge-muted"><i class="fa-solid fa-ban"></i> Sem sinal</span>'}</td>
                        <td>${loc?.precisao != null ? loc.precisao+'m' : '—'}</td>
                        <td><div style="display:flex;gap:4px;flex-wrap:wrap">
                            ${hasLoc ? `<button class="btn btn-secondary btn-sm" data-center="${u.id}" title="Centralizar no mapa"><i class="fa-solid fa-crosshairs"></i></button>` : ''}
                            ${hasTrilha ? `<button class="btn btn-secondary btn-sm" data-trail="${u.id}" title="Ver trilha"><i class="fa-solid fa-route"></i></button>` : ''}
                            <button class="btn btn-secondary btn-sm" data-copy-link="${u.id}" title="Copiar link para cliente"><i class="fa-solid fa-link"></i></button>
                            <button class="btn btn-secondary btn-sm" data-tracker="${u.id}"
                                data-placa="${esc(v?.placa||'')}" data-mod="${esc(vDesc(v))}"
                                data-mot="${esc(m?.nome||'')}" data-eid="${esc(state.profile?.empresaId||'')}"
                                title="Abrir rastreador no dispositivo do veículo"><i class="fa-solid fa-satellite-dish"></i></button>
                        </div></td>
                    </tr>`;
                }).join('')}</tbody>
            </table></div>`;

            listEl.querySelectorAll('[data-center]').forEach(btn => btn.addEventListener('click', () => {
                const u = active.find(x => x.id === btn.dataset.center);
                if (u?.localizacao) { map.setView([u.localizacao.lat, u.localizacao.lng], 16); markers[u.id]?.openPopup(); }
            }));

            listEl.querySelectorAll('[data-trail]').forEach(btn => btn.addEventListener('click', () => {
                const u = active.find(x => x.id === btn.dataset.trail);
                if (!u?.trilha?.length) return;
                if (trails[u.id]) { map.removeLayer(trails[u.id]); delete trails[u.id]; return; }
                const pts = u.trilha.map(p => [p.lat, p.lng]);
                trails[u.id] = L.polyline(pts, { color:'#7c3aed', weight:3, opacity:.75, dashArray:'6,4' }).addTo(map);
                map.fitBounds(pts, { padding:[40,40] });
                showFlash(`Trilha: ${pts.length} pontos — clique novamente para ocultar`);
            }));

            listEl.querySelectorAll('[data-copy-link]').forEach(btn => btn.addEventListener('click', () => {
                const url = `${location.origin}/rastreio.html?id=${btn.dataset.copyLink}`;
                navigator.clipboard.writeText(url)
                    .then(() => showFlash('Link de rastreamento copiado! Envie para o cliente.'))
                    .catch(() => showFlash('Erro ao copiar link','danger'));
            }));

            listEl.querySelectorAll('[data-tracker]').forEach(btn => btn.addEventListener('click', () => {
                const { tracker: uso, placa, mod, mot, eid } = btn.dataset;
                const url = `${location.origin}/tracker.html?uso=${uso}&placa=${encodeURIComponent(placa)}&mod=${encodeURIComponent(mod)}&mot=${encodeURIComponent(mot)}&eid=${encodeURIComponent(eid)}`;
                navigator.clipboard.writeText(url)
                    .then(() => showFlash('Link do rastreador copiado! Abra no dispositivo fixado no veículo.'))
                    .catch(() => {});
                window.open(url, '_blank');
            }));
        },
        err => showFlash('Erro no rastreamento: ' + err.message, 'danger')
    );

    renderDevicesSection();
    document.getElementById('addDeviceBtn')?.addEventListener('click', () => openDeviceModal(null));
}

// ══════════════════════════════════════════════════════════════
// DISPOSITIVOS GPS — gerenciamento de rastreadores externos
// ══════════════════════════════════════════════════════════════
// DISPOSITIVOS / RASTREIO (app motorista)
// ══════════════════════════════════════════════════════════════
const GPS_FN_URL = 'https://us-central1-frota-empresa-a8202.cloudfunctions.net/gps';

function genToken() {
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function renderDevicesSection() {
    const el = document.getElementById('devicesSection');
    if (!el) return;
    try {
        const [devs, vehicles] = await Promise.all([getAll('dispositivos'), getVisibleVehicles()]);
        const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
        if (!devs.length) {
            el.innerHTML = `<div class="card-body">${emptyState('fa-microchip','Nenhum dispositivo cadastrado','Adicione um rastreador GPS externo para monitorar veículos sem celular do motorista.')}</div>`;
            return;
        }
        el.innerHTML = `<div class="table-responsive"><table>
            <thead><tr><th>Nome</th><th>Veículo</th><th>Token</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>${devs.map(d => {
                const v = vMap[d.veiculoId];
                return `<tr>
                    <td><strong>${esc(d.nome||'—')}</strong></td>
                    <td>${v ? plate(v.placa)+'<div class="td-sub">'+esc(vDesc(v))+'</div>' : '<span style="color:var(--muted)">Sem vínculo</span>'}</td>
                    <td><code style="font-size:11px;background:var(--surface);padding:2px 6px;border-radius:4px">${d.token?.slice(0,8)}••••</code>
                        <button class="btn btn-secondary btn-sm" data-copy-token="${d.token}" title="Copiar URL do webhook"><i class="fa-solid fa-copy"></i></button></td>
                    <td><span class="badge ${d.ativo!==false?'badge-success':'badge-muted'}">${d.ativo!==false?'Ativo':'Inativo'}</span></td>
                    <td><div style="display:flex;gap:4px">
                        <button class="btn btn-secondary btn-sm" data-edit-dev="${d.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-secondary btn-sm" data-del-dev="${d.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                    </div></td>
                </tr>`;
            }).join('')}</tbody></table></div>`;

        el.querySelectorAll('[data-copy-token]').forEach(btn => btn.addEventListener('click', () => {
            const url = `${GPS_FN_URL}?id=DEVICE_ID&token=${btn.dataset.copyToken}&lat={lat}&lng={lng}&speed={speed}&acc={acc}`;
            navigator.clipboard.writeText(url).then(() => showFlash('URL do webhook copiada! Configure no rastreador substituindo DEVICE_ID e os campos do tracker.'));
        }));
        el.querySelectorAll('[data-edit-dev]').forEach(btn => btn.addEventListener('click', () => {
            const d = devs.find(x => x.id === btn.dataset.editDev);
            if (d) openDeviceModal(d);
        }));
        el.querySelectorAll('[data-del-dev]').forEach(btn => btn.addEventListener('click', () => {
            showConfirm('Excluir este dispositivo GPS?', async () => {
                await deleteDoc(doc(db, 'dispositivos', btn.dataset.delDev));
                showToast('Dispositivo removido');
                renderDevicesSection();
            }, 'Excluir dispositivo');
        }));
    } catch(e) {
        el.innerHTML = `<div class="card-body"><p style="color:var(--muted)">Erro ao carregar dispositivos.</p></div>`;
    }
}

function openDeviceModal(dev) {
    const vehicles = state.cache.vehicles || [];
    const isEdit   = !!dev;
    const html = `
    <div id="devModal" style="position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px">
      <div style="background:var(--card);border-radius:18px;padding:28px;width:100%;max-width:460px;box-shadow:0 24px 64px rgba(0,0,0,.35)">
        <h3 style="margin:0 0 20px;font-size:16px">${isEdit?'Editar':'Novo'} Dispositivo GPS</h3>
        <div class="form-group">
          <label>Nome do dispositivo</label>
          <input id="dNome" class="form-control" placeholder="Ex: Rastreador Caminhão 1" value="${esc(dev?.nome||'')}">
        </div>
        <div class="form-group">
          <label>Veículo vinculado <span style="color:var(--muted);font-weight:400">(opcional)</span></label>
          <select id="dVeiculo" class="form-control">
            <option value="">— Nenhum —</option>
            ${vehicles.map(v=>`<option value="${v.id}" ${dev?.veiculoId===v.id?'selected':''}>${v.placa} — ${vDesc(v)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>ID do dispositivo <span style="color:var(--muted);font-weight:400">(IMEI ou nome único)</span></label>
          <input id="dId" class="form-control" placeholder="Ex: 123456789012345 ou rastreador-01" value="${esc(dev?.id||'')}" ${isEdit?'readonly':''}>
        </div>
        <div class="form-group">
          <label>Token de segurança</label>
          <div style="display:flex;gap:8px">
            <input id="dToken" class="form-control" value="${dev?.token||genToken()}" readonly style="font-family:monospace;font-size:12px">
            <button type="button" class="btn btn-secondary" id="regenToken" title="Gerar novo token"><i class="fa-solid fa-arrows-rotate"></i></button>
          </div>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="dAtivo" ${dev?.ativo!==false?'checked':''} style="width:auto">
          <label for="dAtivo" style="margin:0;text-transform:none;font-size:13px">Dispositivo ativo</label>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-secondary" id="cancelDev" style="flex:1">Cancelar</button>
          <button class="btn btn-primary"   id="saveDev"   style="flex:2"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    document.getElementById('regenToken').onclick = () => {
        document.getElementById('dToken').value = genToken();
    };
    document.getElementById('cancelDev').onclick = () => document.getElementById('devModal').remove();
    document.getElementById('saveDev').onclick = async () => {
        const nome     = document.getElementById('dNome').value.trim();
        const veiculoId= document.getElementById('dVeiculo').value;
        const devId    = document.getElementById('dId').value.trim();
        const token    = document.getElementById('dToken').value.trim();
        const ativo    = document.getElementById('dAtivo').checked;
        if (!nome || !devId || !token) { showFlash('Preencha nome, ID e token','danger'); return; }
        const data = { nome, token, ativo, empresaId: state.profile?.empresaId||'' };
        if (veiculoId) data.veiculoId = veiculoId; else data.veiculoId = '';
        await setDoc(doc(db, 'dispositivos', devId), data, { merge: true });
        document.getElementById('devModal').remove();
        showFlash(isEdit ? 'Dispositivo atualizado' : 'Dispositivo cadastrado');
        renderDevicesSection();
    };
}

// ══════════════════════════════════════════════════════════════
// RODÍZIO — Restrição por placa + Escala de uso
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// LICENCIAMENTO
// ══════════════════════════════════════════════════════════════
async function renderLicenciamento() {
    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');
    const vehicles = await getVisibleVehicles(true);
    const now = new Date();
    const anoAtual = now.getFullYear();

    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    // Tabela SP 2026: finais 1-2→Jul, 3-4→Ago, 5-6→Set, 7-8→Out, 9→Nov, 0→Dez
    const FINAL_MES = { '1':7,'2':7,'3':8,'4':8,'5':9,'6':9,'7':10,'8':10,'9':11,'0':12 };

    // Enriquece cada veículo com dados de licenciamento
    const enriched = vehicles.map(v => {
        const digits = (v.placa || '').replace(/\D/g,'');
        const finalPlaca = digits.slice(-1);
        const mesVenc = FINAL_MES[finalPlaca] || null;

        // Sempre calcula pelo ano atual com base no dígito final da placa
        let vencimento = null;
        if (mesVenc) {
            const ultimo = new Date(anoAtual, mesVenc, 0).getDate();
            vencimento = `${anoAtual}-${String(mesVenc).padStart(2,'0')}-${ultimo}`;
        }

        // Pago = licenciamentoPagoEm está no ano atual
        const pagoD = v.licenciamentoPagoEm ? new Date(v.licenciamentoPagoEm + 'T00:00:00') : null;
        const vencD = vencimento ? new Date(vencimento + 'T00:00:00') : null;
        const pago  = pagoD && pagoD.getFullYear() >= anoAtual;
        const diff  = vencD ? Math.floor((vencD - now) / 86400000) : null;

        let statusLabel, statusColor, statusBg;
        if (pago) {
            statusLabel = 'Pago'; statusColor = '#16a34a'; statusBg = '#f0fdf4';
        } else if (diff === null) {
            statusLabel = 'Sem data'; statusColor = '#94a3b8'; statusBg = '#f8fafc';
        } else if (diff < 0) {
            statusLabel = `Vencido há ${Math.abs(diff)}d`; statusColor = '#dc2626'; statusBg = '#fef2f2';
        } else if (diff <= 30) {
            statusLabel = `Vence em ${diff}d`; statusColor = '#d97706'; statusBg = '#fffbeb';
        } else {
            statusLabel = fmtDate(vencimento); statusColor = '#475569'; statusBg = '#f8fafc';
        }

        return { ...v, mesVenc, vencimento, pago, diff, statusLabel, statusColor, statusBg };
    });

    // Contadores para o cabeçalho
    const totalPago    = enriched.filter(v => v.pago).length;
    const totalVencido = enriched.filter(v => !v.pago && v.diff !== null && v.diff < 0).length;
    const totalProximo = enriched.filter(v => !v.pago && v.diff !== null && v.diff >= 0 && v.diff <= 30).length;
    const totalOk      = enriched.filter(v => !v.pago && v.diff !== null && v.diff > 30).length;

    // Agrupa por mês (1-12) + grupo sem data
    const grupos = {};
    enriched.forEach(v => {
        const key = v.mesVenc || 0;
        if (!grupos[key]) grupos[key] = [];
        grupos[key].push(v);
    });

    const ordemMeses = [1,2,3,4,5,6,7,8,9,10,11,12,0];

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-file-certificate" style="color:var(--accent)"></i> Licenciamento</h1>
            <p class="page-subtitle">${vehicles.length} veículo(s)</p>
        </div>
        <button class="btn btn-secondary" id="licPrintBtn"><i class="fa-solid fa-print"></i> PDF</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">
        ${[
            { label:'Pagos',      count:totalPago,    icon:'fa-circle-check',          color:'#16a34a', bg:'#f0fdf4' },
            { label:'Vencidos',   count:totalVencido, icon:'fa-triangle-exclamation',  color:'#dc2626', bg:'#fef2f2' },
            { label:'A vencer',   count:totalProximo, icon:'fa-clock',                 color:'#d97706', bg:'#fffbeb' },
            { label:'Em dia',     count:totalOk,      icon:'fa-calendar-check',        color:'#2563eb', bg:'#eff6ff' },
        ].map(s => `
            <div style="background:#fff;border-radius:14px;padding:14px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">
                <div style="width:36px;height:36px;border-radius:10px;background:${s.bg};display:flex;align-items:center;justify-content:center;margin:0 auto 8px;color:${s.color}"><i class="fa-solid ${s.icon}" style="font-size:15px"></i></div>
                <div style="font-size:22px;font-weight:800;color:var(--text)">${s.count}</div>
                <div style="font-size:11px;color:var(--muted)">${s.label}</div>
            </div>`).join('')}
    </div>

    ${ordemMeses.map(mes => {
        const grupo = grupos[mes];
        if (!grupo?.length) return '';
        const label = mes === 0 ? 'Sem data cadastrada' : MESES[mes - 1];
        const vencidos  = grupo.filter(v => !v.pago && v.diff !== null && v.diff < 0).length;
        const proximos  = grupo.filter(v => !v.pago && v.diff !== null && v.diff >= 0 && v.diff <= 30).length;
        const tagColor  = vencidos ? '#dc2626' : proximos ? '#d97706' : '#16a34a';
        const tagBg     = vencidos ? '#fef2f2' : proximos ? '#fffbeb' : '#f0fdf4';
        const tagText   = vencidos ? `${vencidos} vencido(s)` : proximos ? `${proximos} a vencer` : 'Todos em dia';

        return `
        <div style="background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden;margin-bottom:12px">
            <div style="padding:12px 18px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">
                <span style="font-size:14px;font-weight:700;color:#1e293b"><i class="fa-solid fa-calendar-days" style="color:var(--accent);margin-right:8px"></i>${label}</span>
                <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:11px;color:var(--muted)">${grupo.length} veículo(s)</span>
                    <span style="background:${tagBg};color:${tagColor};border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700">${tagText}</span>
                </div>
            </div>
            ${grupo.sort((a,b) => (a.diff??999) - (b.diff??999)).map(v => {
                const tipoIcon = v.tipo==='motos'?'fa-motorcycle':v.tipo==='caminhoes'?'fa-truck':'fa-car';
                return `
                <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #f8fafc">
                    ${v.foto
                        ? `<img src="${v.foto}" style="width:38px;height:38px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid var(--border)">`
                        : `<div style="width:38px;height:38px;background:#f1f5f9;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted)"><i class="fa-solid ${tipoIcon}"></i></div>`
                    }
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:700;font-size:13px;color:var(--text)">${esc(v.placa)} <span style="font-weight:400;color:var(--muted);font-size:12px">${esc(vDesc(v))}</span></div>
                        <div style="font-size:11px;color:var(--muted);margin-top:2px">Final ${(v.placa||'').slice(-1)} · Vence: ${v.vencimento ? fmtDate(v.vencimento) : '—'}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <span style="background:${v.statusBg};color:${v.statusColor};border-radius:20px;padding:3px 12px;font-size:11px;font-weight:700;display:inline-block">${v.statusLabel}</span>
                        ${!v.pago && canEdit() ? `<div style="margin-top:6px"><button class="btn btn-secondary btn-sm" data-licpago="${v.id}" data-placa="${esc(v.placa)}" data-venc="${v.vencimento||''}"><i class="fa-solid fa-check"></i> Marcar pago</button></div>` : ''}
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }).join('')}
    `);

    document.getElementById('licPrintBtn')?.addEventListener('click', () => window.print());

    document.querySelectorAll('[data-licpago]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const hoje = new Date().toISOString().slice(0, 10);
            btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                await saveDoc('veiculos', { licenciamentoPagoEm: hoje }, btn.dataset.licpago);
                state.cache.vehicles = null;
                showToast(`Licenciamento de ${btn.dataset.placa} marcado como pago!`);
                renderLicenciamento();
            } catch(e) { showToast('Erro: ' + e.message, 'danger'); }
        });
    });
}

// ══════════════════════════════════════════════════════════════
// RODÍZIO / ESCALAS
// ══════════════════════════════════════════════════════════════
async function renderRodizio(sub) {
    if (sub === 'create') { renderEscalaForm(null); return; }
    if (sub?.startsWith('edit:')) { renderEscalaForm(sub.split(':')[1]); return; }

    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');

    const [vehicles, drivers, escalas] = await Promise.all([
        getVisibleVehicles(), getDrivers(), getAll('escalas')
    ]);

    const vehicleMap  = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const driverMap   = Object.fromEntries(drivers.map(d => [d.id, d]));
    const todayDay    = new Date().getDay();
    const todayStr    = today();
    const activeTab   = state.rodizioTab || 'restricao';
    const rodizioOn   = isRodizioEnabled();
    const cityKey     = getRodizioCity();
    const cityModel   = CITY_MODELS[cityKey] || CITY_MODELS.sp;

    const hoje = vehicles.filter(v => v.tipo !== 'motos' && plateRestrictionDay(v.placa) === todayDay);
    const semana = vehicles.filter(v => v.tipo !== 'motos' && plateRestrictionDay(v.placa) !== null);
    const livres  = vehicles.filter(v => v.tipo !== 'motos' && plateRestrictionDay(v.placa) === null);

    const restricaoCards = Object.entries(cityModel.regras).map(([day, finals]) => {
        const d       = parseInt(day);
        const isToday = d === todayDay;
        const vList   = vehicles.filter(v => v.tipo !== 'motos' && plateRestrictionDay(v.placa) === d);
        const tagColor = isToday ? '#dc2626' : '#475569';
        const tagBg    = isToday ? '#fef2f2' : '#f8fafc';

        return `
        <div style="background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden;margin-bottom:12px${isToday?';border:2px solid #fca5a5':''}">
            <div style="padding:12px 18px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;background:${isToday?'#fff5f5':'#fff'}">
                <div style="display:flex;align-items:center;gap:10px">
                    <div style="width:36px;height:36px;border-radius:10px;background:${isToday?'#fef2f2':'#f1f5f9'};display:flex;align-items:center;justify-content:center;color:${isToday?'#dc2626':'#475569'};font-weight:800;font-size:13px">${DAY_NAMES[d]}</div>
                    <div>
                        <div style="font-size:14px;font-weight:700;color:#1e293b">${DAY_FULL[d]} ${isToday?'<span style="background:#fef2f2;color:#dc2626;border-radius:20px;padding:1px 10px;font-size:10px;font-weight:700;margin-left:4px">HOJE</span>':''}</div>
                        <div style="font-size:11px;color:var(--muted)">Finais ${finals.join(' e ')} · ${cityModel.horario}</div>
                    </div>
                </div>
                <span style="background:${tagBg};color:${tagColor};border-radius:20px;padding:2px 12px;font-size:11px;font-weight:700">${vList.length} veículo(s)</span>
            </div>
            <div style="padding:12px 18px;display:flex;flex-wrap:wrap;gap:8px;min-height:44px;align-items:center">
                ${vList.length
                    ? vList.map(v => `
                        <div style="display:flex;align-items:center;gap:6px;padding:5px 10px;background:${isToday?'#fef2f2':'#f8fafc'};border:1px solid ${isToday?'#fecaca':'var(--border)'};border-radius:8px;cursor:pointer" onclick="navigate('vehicles','edit:${v.id}')">
                            ${v.foto ? `<img src="${v.foto}" style="width:22px;height:22px;border-radius:4px;object-fit:cover">` : `<i class="fa-solid ${v.tipo==='motos'?'fa-motorcycle':v.tipo==='caminhoes'?'fa-truck':'fa-car'}" style="color:${isToday?'#dc2626':'var(--muted)'};font-size:12px"></i>`}
                            <span style="font-family:monospace;font-size:12px;font-weight:700;color:${isToday?'#991b1b':'var(--text)'}">${esc(v.placa)}</span>
                            <span style="font-size:10px;color:var(--muted)">${esc(vDesc(v))}</span>
                        </div>`).join('')
                    : '<span style="color:var(--muted);font-size:12px">Nenhum veículo da frota neste dia</span>'
                }
            </div>
        </div>`;
    }).join('');

    const escalaRows = escalas.length ? escalas.map(e => {
        const v = vehicleMap[e.veiculoId];
        const d = driverMap[e.motoristaId];
        const ativeToday = (e.ativo !== false)
            && (e.diasSemana || []).includes(todayDay)
            && (!e.dataInicio || e.dataInicio <= todayStr)
            && (!e.dataFim    || e.dataFim    >= todayStr);
        return `<tr>
            <td>${v ? plate(v.placa)+'<div class="td-sub">'+esc(vDesc(v))+'</div>' : '—'}</td>
            <td>${esc(d?.nome || '—')}</td>
            <td style="font-size:12px">${(e.diasSemana||[]).map(i => DAY_NAMES[i]).join(', ')}</td>
            <td style="font-size:12px">${e.dataInicio ? fmtDate(e.dataInicio) : '—'}${e.dataFim ? ' → '+fmtDate(e.dataFim) : ''}</td>
            <td>${TURNO_LABELS[e.turno] || '—'}</td>
            <td>${ativeToday
                ? '<span class="badge badge-success">Ativo Hoje</span>'
                : (e.ativo !== false ? '<span class="badge badge-info">Agendado</span>' : '<span class="badge">Inativo</span>')}</td>
            <td>
                <button class="btn btn-secondary btn-icon btn-sm" data-edit-esc="${e.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" data-del-esc="${e.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('') : '';

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-rotate" style="color:var(--accent)"></i> Rodízio</h1>
            <p class="page-subtitle">Restrição de circulação por placa e escala de uso da frota</p>
        </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:20px">
        <button class="btn ${activeTab==='restricao'?'btn-primary':'btn-secondary'}" id="tabRestr">
            <i class="fa-solid fa-ban"></i> Restrição por Placa
        </button>
        <button class="btn ${activeTab==='escala'?'btn-primary':'btn-secondary'}" id="tabEsc">
            <i class="fa-solid fa-calendar-days"></i> Escala de Uso
        </button>
    </div>

    <div id="panelRestr" ${activeTab !== 'restricao' ? 'style="display:none"' : ''}>

        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
            <select id="citySelect" class="form-control" style="width:auto;padding:7px 12px;font-size:13px">
                ${Object.entries(CITY_MODELS).map(([k,c]) =>
                    `<option value="${k}" ${k===cityKey?'selected':''}>${c.nome}</option>`).join('')}
            </select>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500">
                <input type="checkbox" id="rodizioToggle" ${rodizioOn ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
                <span id="rodizioToggleLabel">${rodizioOn ? 'Alertas ativados' : 'Alertas desativados'}</span>
            </label>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">
            ${[
                { label:'Restritos hoje', count:hoje.length,   icon:'fa-ban',             color:'#dc2626', bg:'#fef2f2' },
                { label:'Na semana',      count:semana.length,  icon:'fa-calendar-week',   color:'#d97706', bg:'#fffbeb' },
                { label:'Sem rodízio',    count:livres.length,  icon:'fa-circle-check',    color:'#16a34a', bg:'#f0fdf4' },
                { label:'Total frota',    count:vehicles.filter(v=>v.tipo!=='motos').length, icon:'fa-car', color:'#2563eb', bg:'#eff6ff' },
            ].map(s => `
                <div style="background:#fff;border-radius:14px;padding:14px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">
                    <div style="width:36px;height:36px;border-radius:10px;background:${s.bg};display:flex;align-items:center;justify-content:center;margin:0 auto 8px;color:${s.color}"><i class="fa-solid ${s.icon}" style="font-size:15px"></i></div>
                    <div style="font-size:22px;font-weight:800;color:var(--text)">${s.count}</div>
                    <div style="font-size:11px;color:var(--muted)">${s.label}</div>
                </div>`).join('')}
        </div>

        ${restricaoCards}
    </div>

    <div id="panelEsc" ${activeTab !== 'escala' ? 'style="display:none"' : ''}>
        <div class="card">
            <div class="card-header">
                <div class="card-title"><i class="fa-solid fa-calendar-days"></i> Escala de Uso</div>
                <button class="btn btn-primary btn-sm" onclick="navigate('rodizio','create')">
                    <i class="fa-solid fa-plus"></i> Nova Escala
                </button>
            </div>
            <div class="table-responsive">
                ${escalas.length ? `
                <table>
                    <thead><tr><th>Veículo</th><th>Motorista</th><th>Dias</th><th>Período</th><th>Turno</th><th>Status</th><th>Ações</th></tr></thead>
                    <tbody>${escalaRows}</tbody>
                </table>` : emptyState('fa-calendar-days','Nenhuma escala cadastrada. Clique em "Nova Escala" para criar.')}
            </div>
        </div>
    </div>`);

    document.getElementById('tabRestr').addEventListener('click', () => {
        state.rodizioTab = 'restricao';
        document.getElementById('panelRestr').style.display = '';
        document.getElementById('panelEsc').style.display = 'none';
        document.getElementById('tabRestr').className = 'btn btn-primary';
        document.getElementById('tabEsc').className = 'btn btn-secondary';
    });
    document.getElementById('tabEsc').addEventListener('click', () => {
        state.rodizioTab = 'escala';
        document.getElementById('panelEsc').style.display = '';
        document.getElementById('panelRestr').style.display = 'none';
        document.getElementById('tabEsc').className = 'btn btn-primary';
        document.getElementById('tabRestr').className = 'btn btn-secondary';
    });

    // Feriados nacionais — BrasilAPI
    (async () => {
        try {
            const ano = new Date().getFullYear();
            const r = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
            const feriados = await r.json();
            const hoje = new Date(); hoje.setHours(0,0,0,0);
            const proximos = feriados
                .map(f => ({ ...f, d: new Date(f.date + 'T00:00:00') }))
                .filter(f => f.d >= hoje)
                .slice(0, 5);
            if (!proximos.length) return;
            const card = document.createElement('div');
            card.className = 'card mb-16';
            card.style.borderLeft = '3px solid #0d9488';
            card.innerHTML = `
                <div class="card-header" style="background:#f0fdfa">
                    <div class="card-title"><i class="fa-solid fa-calendar-star" style="color:#0d9488"></i> Próximos Feriados Nacionais</div>
                </div>
                <div class="card-body">
                    <div style="display:flex;flex-wrap:wrap;gap:8px">
                    ${proximos.map(f => {
                        const diff = Math.round((f.d - hoje) / 86400000);
                        const label = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : `Em ${diff}d`;
                        const cor = diff === 0 ? '#dc2626' : diff <= 7 ? '#d97706' : '#0d9488';
                        return `<div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:8px 12px;min-width:160px">
                            <div style="font-size:11px;font-weight:700;color:${cor}">${label}</div>
                            <div style="font-weight:600;font-size:13px;color:var(--text)">${f.name}</div>
                            <div style="font-size:11px;color:var(--muted)">${new Date(f.date+'T00:00:00').toLocaleDateString('pt-BR')}</div>
                        </div>`;
                    }).join('')}
                    </div>
                </div>`;
            document.getElementById('panelEsc').prepend(card);
        } catch(e) {}
    })();

    document.getElementById('citySelect').addEventListener('change', e => {
        localStorage.setItem('frotaRodizioCity', e.target.value);
        const m = CITY_MODELS[e.target.value] || CITY_MODELS.sp;
        document.getElementById('cityDesc').innerHTML =
            `Restrição por final de placa — <strong>${m.nome}</strong> — dias úteis das <strong>${m.horario}</strong>.`;
        showFlash(`Modelo alterado para ${m.nome}.`);
        renderRodizio();
    });

    document.getElementById('rodizioToggle').addEventListener('change', e => {
        localStorage.setItem('frotaRodizio', e.target.checked ? 'true' : 'false');
        document.getElementById('rodizioToggleLabel').textContent = e.target.checked ? 'Alertas ativados' : 'Alertas desativados';
        showFlash(`Alertas de rodízio ${e.target.checked ? 'ativados' : 'desativados'}.`);
    });

    document.querySelectorAll('[data-edit-esc]').forEach(b =>
        b.addEventListener('click', () => navigate('rodizio', 'edit:' + b.dataset.editEsc)));

    document.querySelectorAll('[data-del-esc]').forEach(b => {
        b.addEventListener('click', async () => {
            if (!b.dataset.confirm) {
                b.dataset.confirm = '1';
                b.innerHTML = '<i class="fa-solid fa-check"></i>';
                b.title = 'Confirmar exclusão';
                return;
            }
            await deleteFireDoc('escalas', b.dataset.delEsc);
            showFlash('Escala excluída.');
            renderRodizio();
        });
    });

    window.navigate = navigate;
}

async function renderEscalaForm(id) {
    const [vehicles, drivers] = await Promise.all([getVisibleVehicles(), getDrivers()]);
    let item = { diasSemana: [], turno: 'integral', ativo: true };
    if (id) {
        const snap = await getDoc(doc(db, 'escalas', id));
        if (snap.exists()) item = { id: snap.id, ...snap.data() };
    }
    const activeDrivers = drivers.filter(d => d.ativo !== false);

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-calendar-plus" style="color:var(--accent)"></i> ${id ? 'Editar' : 'Nova'} Escala</h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>
    <div class="card">
        <div class="card-body">
            <form id="escalaForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Veículo *</label>
                        <select name="veiculoId" class="form-control" required>
                            <option value="">— Selecione —</option>
                            ${vehicles.map(v => `<option value="${v.id}" ${item.veiculoId===v.id?'selected':''}>${esc(v.placa+' — '+vDesc(v))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Motorista *</label>
                        <select name="motoristaId" class="form-control" required>
                            <option value="">— Selecione —</option>
                            ${activeDrivers.map(d => `<option value="${d.id}" ${item.motoristaId===d.id?'selected':''}>${esc(d.nome)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Turno</label>
                        <select name="turno" class="form-control">
                            <option value="manha"    ${item.turno==='manha'   ?'selected':''}>Manhã</option>
                            <option value="tarde"    ${item.turno==='tarde'   ?'selected':''}>Tarde</option>
                            <option value="integral" ${item.turno==='integral'?'selected':''}>Integral</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Data Início</label>
                        <input type="date" name="dataInicio" class="form-control" value="${item.dataInicio||''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Data Fim</label>
                        <input type="date" name="dataFim" class="form-control" value="${item.dataFim||''}">
                    </div>
                    <div class="form-group span-full">
                        <label class="form-label">Dias da Semana *</label>
                        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
                            ${DAY_NAMES.map((name, i) => `
                            <label style="display:flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;user-select:none;transition:.15s">
                                <input type="checkbox" name="diasSemana" value="${i}" ${(item.diasSemana||[]).includes(i)?'checked':''} style="accent-color:var(--accent)">
                                ${name}
                            </label>`).join('')}
                        </div>
                    </div>
                    <div class="form-group span-full">
                        <label class="form-label">Observações</label>
                        <textarea name="observacoes" class="form-control" placeholder="Ex: Rota Centro, turno diurno...">${esc(item.observacoes||'')}</textarea>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Salvar Escala</button>
                </div>
            </form>
        </div>
    </div>`);

    document.getElementById('backBtn').addEventListener('click',   () => { state.rodizioTab = 'escala'; navigate('rodizio'); });
    document.getElementById('cancelBtn').addEventListener('click', () => { state.rodizioTab = 'escala'; navigate('rodizio'); });

    document.getElementById('escalaForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd   = new FormData(e.target);
        const dias = [...document.querySelectorAll('[name="diasSemana"]:checked')].map(c => parseInt(c.value));
        if (!dias.length) { showFlash('Selecione ao menos um dia da semana.', 'danger'); return; }
        const data = {
            veiculoId:   fd.get('veiculoId'),
            motoristaId: fd.get('motoristaId'),
            diasSemana:  dias,
            turno:       fd.get('turno'),
            dataInicio:  fd.get('dataInicio') || null,
            dataFim:     fd.get('dataFim')    || null,
            observacoes: fd.get('observacoes').trim(),
            ativo: true,
        };
        try {
            await saveDoc('escalas', data, id || null);
            showFlash(id ? 'Escala atualizada.' : 'Escala criada.');
            state.rodizioTab = 'escala';
            navigate('rodizio');
        } catch (err) { showFlash('Erro: ' + err.message, 'danger'); }
    });
}

// ══════════════════════════════════════════════════════════════
// COMBUSTÍVEL
// ══════════════════════════════════════════════════════════════
const FUEL_LABELS = { gasolina:'Gasolina', gasolina_aditivada:'Gasolina Aditivada', etanol:'Etanol', diesel:'Diesel', gnv:'GNV' };
const FUEL_COLORS = { gasolina:'badge-danger', gasolina_aditivada:'badge-danger', etanol:'badge-success', diesel:'badge-warning', gnv:'badge-info' };

// ══════════════════════════════════════════════════════════════
// COMBUSTÍVEL
// ══════════════════════════════════════════════════════════════
async function renderFuel(sub) {
    if (sub === 'create') { renderFuelForm(null); return; }
    if (sub?.startsWith('edit:')) { renderFuelForm(sub.split(':')[1]); return; }

    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px"></i></div>');

    const [records, vehicles, drivers] = await Promise.all([
        getAll('abastecimentos', orderBy('data', 'desc')),
        getVisibleVehicles(), getDrivers()
    ]);

    const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const driverMap  = Object.fromEntries(drivers.map(d => [d.id, d]));

    // Compute km/L: for each vehicle sort records by kmAtual asc
    const kmPerL = {};
    const byVehicle = {};
    records.forEach(r => { if (!byVehicle[r.veiculoId]) byVehicle[r.veiculoId] = []; byVehicle[r.veiculoId].push(r); });
    Object.values(byVehicle).forEach(recs => {
        const sorted = [...recs].filter(r => r.kmAtual > 0).sort((a,b) => a.kmAtual - b.kmAtual);
        sorted.forEach((r, i) => {
            if (i > 0) {
                const km = r.kmAtual - sorted[i-1].kmAtual;
                if (km > 0 && r.litros > 0) kmPerL[r.id] = km / r.litros;
            }
        });
    });

    const kplValues   = Object.values(kmPerL);
    const avgKmL      = kplValues.length ? kplValues.reduce((s,v) => s+v, 0) / kplValues.length : null;
    const totalGasto  = records.reduce((s,r) => s + (r.valorTotal || 0), 0);
    const totalLitros = records.reduce((s,r) => s + (r.litros || 0), 0);

    const filterVId = state.fuelVFilter || '';
    let filtered = filterVId ? records.filter(r => r.veiculoId === filterVId) : records;

    const perPage = 20, fp = state.fuelPage || 1;
    const totalPages = Math.ceil(filtered.length / perPage);
    const paged = filtered.slice((fp-1)*perPage, fp*perPage);

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-gas-pump" style="color:var(--accent)"></i> Controle de Combustível</h1>
            <p class="page-subtitle">${records.length} abastecimento(s)</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary" id="printFuelBtn"><i class="fa-solid fa-print"></i> Exportar PDF</button>
            ${canEdit() ? '<button class="btn btn-primary" id="addFuelBtn"><i class="fa-solid fa-plus"></i> Novo Abastecimento</button>' : ''}
        </div>
    </div>

    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:16px">
        ${statCard('blue','fa-gas-pump','Total Registros', records.length)}
        ${statCard('red','fa-money-bill-wave','Total Gasto', fmtMoney(totalGasto))}
        ${statCard('green','fa-droplet','Total Litros', totalLitros.toLocaleString('pt-BR',{minimumFractionDigits:1})+' L')}
        ${avgKmL ? statCard('teal','fa-gauge-high','Consumo Médio', avgKmL.toFixed(1)+' km/L') : ''}
    </div>

    <div class="filters-bar">
        <div class="form-group grow">
            <label class="form-label">Filtrar por Veículo</label>
            <select id="fuelVFilter" class="form-control">
                <option value="">Todos os veículos</option>
                ${vehicles.map(v => `<option value="${v.id}" ${filterVId===v.id?'selected':''}>${esc(v.placa)} — ${esc(vDesc(v))}</option>`).join('')}
            </select>
        </div>
        <div class="form-group" style="justify-content:flex-end">
            <button class="btn btn-primary" id="fuelFilterBtn"><i class="fa-solid fa-magnifying-glass"></i> Filtrar</button>
            <button class="btn btn-secondary" id="fuelClearBtn">Limpar</button>
        </div>
    </div>

    <div class="card">
        <div class="card-header">
            <div class="card-title"><i class="fa-solid fa-list"></i> Histórico de Abastecimentos</div>
            <span style="font-size:12px;color:var(--muted)">${filtered.length} registro(s)</span>
        </div>
        <div style="padding:16px">
            ${filtered.length ? `
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px">
            ${paged.map(r => {
                const v = vehicleMap[r.veiculoId];
                const m = driverMap[r.motoristaId];
                const kpl = kmPerL[r.id];
                const fuelIcon = { gasolina:'fa-droplet', etanol:'fa-leaf', diesel:'fa-truck', gnv:'fa-wind', gasolina_aditivada:'fa-star-of-life' }[r.tipoCombustivel]||'fa-gas-pump';
                return `
            <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column">
              <div style="background:var(--primary);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px">
                <div style="display:flex;align-items:center;gap:10px;min-width:0">
                  <div style="width:34px;height:34px;background:rgba(255,255,255,.18);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;flex-shrink:0"><i class="fa-solid ${fuelIcon}"></i></div>
                  <div style="min-width:0">
                    <div style="font-family:monospace;font-size:15px;font-weight:800;color:#fff;letter-spacing:2px">${esc(v?.placa||'—')}</div>
                    <div style="font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v ? vDesc(v) : '')}</div>
                  </div>
                </div>
                <span class="badge ${FUEL_COLORS[r.tipoCombustivel]||'badge-muted'}" style="flex-shrink:0;font-size:10px">${esc(FUEL_LABELS[r.tipoCombustivel]||r.tipoCombustivel||'—')}</span>
              </div>
              <div style="padding:14px 16px;flex:1;display:flex;flex-direction:column;gap:9px">
                <div style="display:flex;align-items:center;gap:8px">
                  <i class="fa-solid fa-calendar" style="color:var(--muted);font-size:12px;width:14px"></i>
                  <span style="font-size:13px;color:var(--text)">${fmtDate(r.data)}</span>
                  ${m?`<span style="color:var(--muted);font-size:12px">· ${esc(m.nome)}</span>`:''}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                  <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Litros</div><div style="font-weight:700;font-size:15px;color:var(--text)">${r.litros?r.litros.toLocaleString('pt-BR',{minimumFractionDigits:2})+' L':'—'}</div></div>
                  <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Total</div><div style="font-weight:700;font-size:15px;color:var(--accent)">${r.valorTotal?fmtMoney(r.valorTotal):'—'}</div></div>
                  <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">R$/Litro</div><div style="font-weight:600;font-size:13px">${r.valorLitro?fmtMoney(r.valorLitro):'—'}</div></div>
                  <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">KM Atual</div><div style="font-weight:600;font-size:13px">${r.kmAtual?fmtKm(r.kmAtual):'—'}</div></div>
                </div>
                ${kpl?`<div style="display:flex;align-items:center;gap:8px;padding:8px;background:#f0fdf4;border-radius:8px;margin-top:2px"><i class="fa-solid fa-gauge-high" style="color:#16a34a;font-size:13px"></i><span style="font-size:13px;font-weight:700;color:#16a34a">${kpl.toFixed(1)} km/L</span></div>`:''}
                ${r.posto?`<div style="font-size:11px;color:var(--muted)"><i class="fa-solid fa-location-dot"></i> ${esc(r.posto)}</div>`:''}
              </div>
              ${canEdit() ? `<div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
                <button class="btn btn-secondary btn-sm" data-edit="${r.id}"><i class="fa-solid fa-pen"></i> Editar</button>
                <button class="btn btn-danger btn-sm" data-del="${r.id}"><i class="fa-solid fa-trash"></i> Excluir</button>
              </div>` : ''}
            </div>`; }).join('')}
            </div>
            ${pagination(fp, totalPages, pg => { state.fuelPage = pg; renderFuel(); })}`
            : emptyState('fa-gas-pump', 'Nenhum abastecimento registrado.', canEdit() ? 'Clique em "+ Novo Abastecimento" para começar.' : '')}
        </div>
    </div>`);

    const FUEL_LABELS_LOCAL = { gasolina:'Gasolina', gasolina_aditivada:'Gasolina Adit.', etanol:'Etanol', diesel:'Diesel', gnv:'GNV' };
    document.getElementById('printFuelBtn')?.addEventListener('click', () => {
        openPrintWindow('Relatório de Combustível',
            ['Data','Veículo','Combustível','Litros','R$/L','Total','KM','km/L'],
            filtered.map(r => { const v=vehicleMap[r.veiculoId]; const kpl=kmPerL[r.id];
                return `<tr><td>${fmtDate(r.data)}</td>
                <td style="font-family:monospace;font-weight:700">${esc(v?.placa||'—')}</td>
                <td>${FUEL_LABELS_LOCAL[r.tipoCombustivel]||r.tipoCombustivel||'—'}</td>
                <td>${r.litros?r.litros.toFixed(2)+' L':'—'}</td>
                <td>${r.valorLitro?fmtMoney(r.valorLitro):'—'}</td>
                <td style="font-weight:700">${r.valorTotal?fmtMoney(r.valorTotal):'—'}</td>
                <td>${r.kmAtual?fmtKm(r.kmAtual):'—'}</td>
                <td>${kpl?kpl.toFixed(1)+' km/L':'—'}</td></tr>`;
            }).join(''));
    });

    if (canEdit()) {
        document.getElementById('addFuelBtn')?.addEventListener('click', () => navigate('fuel','create'));
        document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => navigate('fuel','edit:'+b.dataset.edit)));
        document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
            showConfirm('Excluir este abastecimento?', async () => {
                try { await deleteFireDoc('abastecimentos', b.dataset.del); showToast('Abastecimento excluído.'); renderFuel(); }
                catch(e) { showToast('Erro: '+e.message,'danger'); }
            });
        }));
    }
    document.getElementById('fuelFilterBtn').addEventListener('click', () => {
        state.fuelVFilter = document.getElementById('fuelVFilter').value;
        state.fuelPage = 1; renderFuel();
    });
    document.getElementById('fuelClearBtn').addEventListener('click', () => {
        state.fuelVFilter = ''; state.fuelPage = 1; renderFuel();
    });
    attachPagination(pg => { state.fuelPage = pg; renderFuel(); });
    window.navigate = navigate;
}

async function renderFuelForm(id) {
    const isEdit = !!id;
    let item = { veiculoId:'', motoristaId:'', data:today(), tipoCombustivel:'gasolina', litros:'', valorLitro:'', valorTotal:'', kmAtual:'', posto:'', observacoes:'' };
    if (isEdit) { const d = await getOne('abastecimentos', id); if (d) item = d; }

    const [vehicles, drivers] = await Promise.all([getVisibleVehicles(), getDrivers()]);

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-gas-pump" style="color:var(--accent)"></i> ${isEdit?'Editar Abastecimento':'Novo Abastecimento'}</h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>
    <div class="card">
        <div class="card-header"><div class="card-title"><i class="fa-solid fa-pen-to-square"></i> Dados do Abastecimento</div></div>
        <div class="card-body">
            <form id="fuelForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Veículo *</label>
                        <select name="veiculoId" class="form-control" required>
                            <option value="">Selecione...</option>
                            ${vehicles.map(v => `<option value="${v.id}" ${item.veiculoId===v.id?'selected':''}>${esc(v.placa)} — ${esc(vDesc(v))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Motorista</label>
                        <select name="motoristaId" class="form-control">
                            <option value="">— Nenhum —</option>
                            ${drivers.filter(d => d.ativo !== false).map(d => `<option value="${d.id}" ${item.motoristaId===d.id?'selected':''}>${esc(d.nome)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Data *</label>
                        <input type="date" name="data" class="form-control" required value="${item.data||today()}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Combustível *</label>
                        <select name="tipoCombustivel" class="form-control" required>
                            <option value="gasolina" ${item.tipoCombustivel==='gasolina'?'selected':''}>Gasolina</option>
                            <option value="gasolina_aditivada" ${item.tipoCombustivel==='gasolina_aditivada'?'selected':''}>Gasolina Aditivada</option>
                            <option value="etanol" ${item.tipoCombustivel==='etanol'?'selected':''}>Etanol</option>
                            <option value="diesel" ${item.tipoCombustivel==='diesel'?'selected':''}>Diesel</option>
                            <option value="gnv" ${item.tipoCombustivel==='gnv'?'selected':''}>GNV</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Litros *</label>
                        <input type="number" name="litros" id="fuelLitros" class="form-control" required min="0.01" step="0.01" placeholder="Ex: 45.50" value="${item.litros||''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Valor por Litro (R$) *</label>
                        <input type="number" name="valorLitro" id="fuelVlitro" class="form-control" required min="0.01" step="0.001" placeholder="Ex: 5.899" value="${item.valorLitro||''}">
                        <small id="fuelPrecoHint" style="color:#2563eb;font-size:11px;margin-top:3px;display:none"></small>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Valor Total (R$)</label>
                        <input type="number" name="valorTotal" id="fuelVtotal" class="form-control" min="0" step="0.01" placeholder="Calculado automaticamente" value="${item.valorTotal||''}">
                        <small style="color:var(--muted);font-size:11px">Preenchido automaticamente (editável)</small>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Quilometragem Atual</label>
                        <input type="number" name="kmAtual" class="form-control" min="0" step="1" placeholder="Ex: 52000" value="${item.kmAtual||''}">
                        <small style="color:var(--muted);font-size:11px">Necessário para calcular km/L</small>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Posto / Local</label>
                        <input type="text" name="posto" class="form-control" placeholder="Ex: Posto BR — Av. Paulista" value="${esc(item.posto||'')}">
                    </div>
                    <div class="form-group span-full">
                        <label class="form-label">Observações</label>
                        <textarea name="observacoes" class="form-control" placeholder="Observações adicionais...">${esc(item.observacoes||'')}</textarea>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
                </div>
            </form>
        </div>
    </div>`);

    document.getElementById('backBtn').addEventListener('click',   () => navigate('fuel'));
    document.getElementById('cancelBtn').addEventListener('click', () => navigate('fuel'));

    const elL = document.getElementById('fuelLitros');
    const elP = document.getElementById('fuelVlitro');
    const elT = document.getElementById('fuelVtotal');
    function calcTotal() {
        const l = parseFloat(elL.value), p = parseFloat(elP.value);
        if (l > 0 && p > 0) elT.value = (l * p).toFixed(2);
    }
    elL.addEventListener('input', calcTotal);
    elP.addEventListener('input', calcTotal);

    const ANP_PRECOS = { gasolina:5.89, gasolina_aditivada:6.19, etanol:4.19, diesel:6.09, gnv:4.89 };
    const tipoSel2   = document.querySelector('[name="tipoCombustivel"]');
    const hintEl     = document.getElementById('fuelPrecoHint');
    function sugerirPrecoCombu(tipo) {
        const salvo = localStorage.getItem('fuelPreco_' + tipo);
        const preco = salvo || ANP_PRECOS[tipo];
        if (preco && !elP.value) { elP.value = parseFloat(preco).toFixed(3); calcTotal(); }
        if (hintEl && preco) {
            hintEl.textContent = (salvo ? 'Último preço registrado' : 'Referência ANP') + ': R$ ' + parseFloat(preco).toFixed(3).replace('.', ',');
            hintEl.style.display = 'block';
        }
    }
    if (!isEdit) sugerirPrecoCombu(tipoSel2?.value || 'gasolina');
    tipoSel2?.addEventListener('change', e => { elP.value = ''; sugerirPrecoCombu(e.target.value); });

    document.getElementById('fuelForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = {
            veiculoId:       fd.get('veiculoId'),
            motoristaId:     fd.get('motoristaId') || null,
            data:            fd.get('data'),
            tipoCombustivel: fd.get('tipoCombustivel'),
            litros:          parseFloat(fd.get('litros'))     || 0,
            valorLitro:      parseFloat(fd.get('valorLitro')) || 0,
            valorTotal:      parseFloat(fd.get('valorTotal')) || 0,
            kmAtual:         parseInt(fd.get('kmAtual'))      || null,
            posto:           fd.get('posto').trim(),
            observacoes:     fd.get('observacoes').trim(),
        };
        try {
            await saveDoc('abastecimentos', data, id || null);
            const tipo = fd.get('tipoCombustivel'), vl = fd.get('valorLitro');
            if (!isEdit && tipo && vl) localStorage.setItem('fuelPreco_' + tipo, vl);
            showFlash(isEdit ? 'Abastecimento atualizado.' : 'Abastecimento registrado.');
            navigate('fuel');
        } catch(err) { showFlash('Erro: '+err.message,'danger'); }
    });
}

// ══════════════════════════════════════════════════════════════
// USERS (admin only)
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// MANUTENÇÃO
// ══════════════════════════════════════════════════════════════
const MANUT_LABELS = {
    oleo:'Troca de Óleo', filtro_ar:'Filtro de Ar', filtro_comb:'Filtro de Combustível',
    freio:'Freios', correia:'Correia Dentada', fluido_freio:'Fluido de Freio',
    preventiva:'Preventiva', revisao:'Revisão', pneu:'Pneu/Borracha',
    corretiva:'Corretiva', outros:'Outros'
};
const MANUT_COLORS = {
    oleo:'badge-warning', filtro_ar:'badge-info', filtro_comb:'badge-info',
    freio:'badge-danger', correia:'badge-warning', fluido_freio:'badge-info',
    preventiva:'badge-info', corretiva:'badge-danger', revisao:'badge-success',
    pneu:'badge-warning', outros:'badge-secondary'
};
const MANUT_ICONS  = {
    oleo:'fa-oil-can', filtro_ar:'fa-wind', filtro_comb:'fa-droplet',
    freio:'fa-circle-stop', correia:'fa-gear', fluido_freio:'fa-flask',
    preventiva:'fa-shield-halved', corretiva:'fa-triangle-exclamation',
    revisao:'fa-rotate', pneu:'fa-circle-dot', outros:'fa-wrench'
};
const MANUT_NEXT_MONTHS = {
    oleo:6, filtro_ar:12, filtro_comb:12, freio:12, correia:24,
    fluido_freio:24, preventiva:3, revisao:12, pneu:12
};

// ══════════════════════════════════════════════════════════════
// MANUTENÇÃO
// ══════════════════════════════════════════════════════════════
async function renderMaintenance(sub) {
    if (sub === 'create') { renderMaintenanceForm(null); return; }
    if (sub?.startsWith('edit:')) { renderMaintenanceForm(sub.split(':')[1]); return; }

    setContent('<div style="padding:40px;text-align:center;color:var(--muted)"><div style="width:36px;height:36px;border:3px solid #e2e8f0;border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 14px"></div></div>');

    const [records, vehicles] = await Promise.all([
        getAll('manutencoes', orderBy('data','desc')),
        getVisibleVehicles()
    ]);
    const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v]));

    const sf = state.manutSearch || '', vf = state.manutVFilter || '', tf = state.manutTFilter || '', stf = state.manutSFilter || '';
    let filtered = records.filter(m => {
        const v = vehicleMap[m.veiculoId];
        const matchQ = !sf || v?.placa?.toLowerCase().includes(sf.toLowerCase()) || m.descricao?.toLowerCase().includes(sf.toLowerCase()) || m.oficina?.toLowerCase().includes(sf.toLowerCase());
        const matchV = !vf || m.veiculoId === vf;
        const matchT = !tf || m.tipo === tf;
        const matchS = !stf || m.status === stf;
        return matchQ && matchV && matchT && matchS;
    });

    const agendadas   = filtered.filter(m => m.status === 'agendada');
    const concluidas  = filtered.filter(m => m.status === 'concluida');
    const totalCusto  = concluidas.reduce((s, m) => s + (m.custo || 0), 0);
    const perPage = 20, pg = state.manutPage || 1, total = filtered.length;
    const totalPages = Math.ceil(total / perPage);
    const paged = filtered.slice((pg-1)*perPage, pg*perPage);
    const agPaged = paged.filter(m => m.status === 'agendada');
    const conPaged = paged.filter(m => m.status !== 'agendada');

    const cardHtml = (m) => {
        const v  = vehicleMap[m.veiculoId];
        const ag = m.status === 'agendada';
        return `
    <div style="background:var(--card);border:1px solid var(--border);border-left:3px solid ${ag?'#f59e0b':'#16a34a'};border-radius:12px;overflow:hidden;display:flex;flex-direction:column">
      <div style="background:var(--primary);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <i class="fa-solid ${MANUT_ICONS[m.tipo]||'fa-wrench'}" style="color:#fff;font-size:16px;flex-shrink:0"></i>
          <div>
            <div style="font-size:13px;font-weight:700;color:#fff">${MANUT_LABELS[m.tipo]||m.tipo}</div>
            <div style="font-family:monospace;font-size:11px;color:rgba(255,255,255,.7)">${esc(v?.placa||'—')} ${v?'· '+esc(vDesc(v)):''}</div>
          </div>
        </div>
        <span class="badge ${ag?'badge-warning':'badge-success'}" style="flex-shrink:0">${ag?'Agendada':'Concluída'}</span>
      </div>
      <div style="padding:14px 16px;flex:1;display:flex;flex-direction:column;gap:9px">
        ${m.descricao?`<div style="font-size:13px;color:var(--text);font-weight:500">${esc(m.descricao)}</div>`:''}
        <div style="display:flex;flex-wrap:wrap;gap:16px">
          <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Data</div>
               <div style="font-weight:600;font-size:13px">${fmtDate(m.data)}</div></div>
          ${m.kmAtual?`<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">KM</div>
               <div style="font-weight:600;font-size:13px">${fmtKm(m.kmAtual)}</div></div>`:''}
          ${m.custo?`<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Custo</div>
               <div style="font-weight:700;font-size:14px;color:#dc2626">${fmtMoney(m.custo)}</div></div>`:''}
        </div>
        ${m.oficina?`<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)"><i class="fa-solid fa-store" style="font-size:11px"></i> ${esc(m.oficina)}</div>`:''}
        ${m.kmProxima?`<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#d97706;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:5px 8px;margin-top:2px"><i class="fa-solid fa-rotate" style="font-size:11px"></i> Próxima em ${fmtKm(m.kmProxima)}</div>`:''}
      </div>
      ${canEdit() ? `<div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        ${ag && canEdit() ? `<button class="btn btn-primary btn-sm" data-conclude="${m.id}"><i class="fa-solid fa-circle-check"></i> Concluir</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-edit="${m.id}"><i class="fa-solid fa-pen"></i> Editar</button>
        ${isAdmin()?`<button class="btn btn-danger btn-sm" data-delete="${m.id}"><i class="fa-solid fa-trash"></i></button>`:''}
      </div>` : ''}
    </div>`;
    };

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-wrench" style="color:var(--accent)"></i> Manutenção</h1>
            <p class="page-subtitle">${total} registro(s) · Total gasto: ${fmtMoney(totalCusto)}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary" id="printManutBtn"><i class="fa-solid fa-print"></i> Exportar PDF</button>
            ${canEdit() ? '<button class="btn btn-primary" id="addManutBtn"><i class="fa-solid fa-plus"></i> Nova Manutenção</button>' : ''}
        </div>
    </div>

    <div class="filters-bar">
        <div class="form-group grow">
            <label class="form-label">Buscar</label>
            <input type="text" id="mSearch" class="form-control" value="${esc(sf)}" placeholder="Placa, descrição, oficina...">
        </div>
        <div class="form-group">
            <label class="form-label">Veículo</label>
            <select id="mVehicle" class="form-control">
                <option value="">Todos</option>
                ${vehicles.map(v=>`<option value="${v.id}" ${vf===v.id?'selected':''}>${esc(v.placa)} — ${esc(vDesc(v))}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Tipo</label>
            <select id="mTipo" class="form-control">
                <option value="">Todos</option>
                ${Object.entries(MANUT_LABELS).map(([k,v])=>`<option value="${k}" ${tf===k?'selected':''}>${v}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Status</label>
            <select id="mStatus" class="form-control">
                <option value="">Todos</option>
                <option value="agendada" ${stf==='agendada'?'selected':''}>Agendada</option>
                <option value="concluida" ${stf==='concluida'?'selected':''}>Concluída</option>
            </select>
        </div>
        <div class="form-group" style="justify-content:flex-end">
            <button class="btn btn-primary" id="mFilter"><i class="fa-solid fa-magnifying-glass"></i> Filtrar</button>
            <button class="btn btn-secondary" id="mClear">Limpar</button>
        </div>
    </div>

    ${paged.length ? `
    ${agPaged.length ? `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span style="font-size:13px;font-weight:700;color:#d97706"><i class="fa-solid fa-calendar-check"></i> Agendadas (${agendadas.length})</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;margin-bottom:${conPaged.length?'28px':'0'}">
      ${agPaged.map(cardHtml).join('')}
    </div>` : ''}
    ${conPaged.length ? `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span style="font-size:13px;font-weight:700;color:#16a34a"><i class="fa-solid fa-circle-check"></i> Concluídas (${concluidas.length})</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px">
      ${conPaged.map(cardHtml).join('')}
    </div>` : ''}
    ${pagination(pg, totalPages, p => { state.manutPage = p; renderMaintenance(); })}`
    : emptyState('fa-wrench','Nenhuma manutenção encontrada')}
    `);

    document.getElementById('addManutBtn')?.addEventListener('click', () => navigate('manutencao','create'));
    document.getElementById('printManutBtn')?.addEventListener('click', () => {
        openPrintWindow('Relatório de Manutenção',
            ['Veículo','Tipo','Status','Data','KM','Custo','Oficina','Descrição'],
            filtered.map(m => { const v=vehicleMap[m.veiculoId];
                return `<tr><td style="font-family:monospace;font-weight:700">${esc(v?.placa||'—')}</td>
                <td>${MANUT_LABELS[m.tipo]||m.tipo}</td>
                <td>${m.status==='agendada'?'Agendada':'Concluída'}</td>
                <td>${fmtDate(m.data)}</td><td>${m.kmAtual?fmtKm(m.kmAtual):'—'}</td>
                <td style="font-weight:700">${m.custo?fmtMoney(m.custo):'—'}</td>
                <td>${esc(m.oficina||'—')}</td><td>${esc(m.descricao||'—')}</td></tr>`;
            }).join(''));
    });
    document.getElementById('mFilter')?.addEventListener('click', () => {
        state.manutSearch  = document.getElementById('mSearch').value;
        state.manutVFilter = document.getElementById('mVehicle').value;
        state.manutTFilter = document.getElementById('mTipo').value;
        state.manutSFilter = document.getElementById('mStatus').value;
        state.manutPage = 1; renderMaintenance();
    });
    document.getElementById('mClear')?.addEventListener('click', () => {
        state.manutSearch = state.manutVFilter = state.manutTFilter = state.manutSFilter = '';
        state.manutPage = 1; renderMaintenance();
    });
    document.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => navigate('manutencao','edit:'+btn.dataset.edit));
    });
    document.querySelectorAll('[data-conclude]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await saveDoc('manutencoes', { status:'concluida' }, btn.dataset.conclude);
            showFlash('Manutenção concluída!');
            renderMaintenance();
        });
    });
    document.querySelectorAll('[data-delete]').forEach(btn => {
        if (!isAdmin()) return;
        let c = false;
        btn.addEventListener('click', async () => {
            if (!c) { c = true; btn.textContent = 'Confirmar?'; btn.classList.replace('btn-danger','btn-warning'); setTimeout(()=>{c=false;btn.innerHTML='<i class="fa-solid fa-trash"></i>';btn.classList.replace('btn-warning','btn-danger');},3000); return; }
            await deleteDoc(doc(db,'manutencoes',btn.dataset.delete));
            showFlash('Registro excluído.'); renderMaintenance();
        });
    });
}

async function renderMaintenanceForm(id) {
    const [vehicles, existing] = await Promise.all([
        getVisibleVehicles(),
        id ? getDoc(doc(db,'manutencoes',id)).then(d => d.exists()?{id:d.id,...d.data()}:null) : Promise.resolve(null)
    ]);
    const d = existing || {};

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-wrench" style="color:var(--accent)"></i> ${id?'Editar':'Nova'} Manutenção</h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>
    <div class="card" style="max-width:680px">
      <div class="card-body">
        <form id="manutForm">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">Veículo *</label>
              <select name="veiculoId" class="form-control" required>
                <option value="">Selecione...</option>
                ${vehicles.map(v=>`<option value="${v.id}" ${d.veiculoId===v.id?'selected':''}>${esc(v.placa)} — ${esc(vDesc(v))}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Tipo *</label>
              <select name="tipo" class="form-control" required>
                <option value="">Selecione...</option>
                ${Object.entries(MANUT_LABELS).map(([k,v])=>`<option value="${k}" ${d.tipo===k?'selected':''}>${v}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Status *</label>
              <select name="status" class="form-control" required>
                <option value="agendada" ${(!d.status||d.status==='agendada')?'selected':''}>Agendada</option>
                <option value="concluida" ${d.status==='concluida'?'selected':''}>Concluída</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Data *</label>
              <input type="date" name="data" class="form-control" value="${d.data||today()}" required>
            </div>
            <div class="form-group">
              <label class="form-label">KM Atual</label>
              <input type="number" name="kmAtual" class="form-control" value="${d.kmAtual||''}" placeholder="Ex: 45000">
            </div>
            <div class="form-group">
              <label class="form-label">Custo (R$)</label>
              <input type="number" name="custo" class="form-control" step="0.01" value="${d.custo||''}" placeholder="0,00">
            </div>
            <div class="form-group">
              <label class="form-label">Oficina / Fornecedor</label>
              <input type="text" name="oficina" class="form-control" value="${esc(d.oficina||'')}" placeholder="Nome da oficina">
            </div>
            <div class="form-group">
              <label class="form-label">KM Próxima Revisão</label>
              <input type="number" name="kmProxima" class="form-control" value="${d.kmProxima||''}" placeholder="Ex: 50000">
            </div>
            <div class="form-group">
              <label class="form-label">Data Próxima Revisão</label>
              <input type="date" name="dataProxima" id="dataProximaInput" class="form-control" value="${d.dataProxima||''}">
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">Descrição / Observações</label>
              <textarea name="descricao" class="form-control" rows="3" placeholder="Descreva o serviço realizado...">${esc(d.descricao||'')}</textarea>
            </div>
          </div>
          <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="saveBtn"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
          </div>
        </form>
      </div>
    </div>`);

    document.getElementById('backBtn')?.addEventListener('click', () => navigate('manutencao'));
    document.getElementById('cancelBtn')?.addEventListener('click', () => navigate('manutencao'));

    // Auto-suggest dataProxima when tipo is selected
    document.querySelector('[name="tipo"]')?.addEventListener('change', e => {
        const months = MANUT_NEXT_MONTHS[e.target.value];
        if (!months) return;
        const inp = document.getElementById('dataProximaInput');
        if (inp?.value) return;
        const base = new Date();
        base.setMonth(base.getMonth() + months);
        inp.value = base.toISOString().split('T')[0];
    });

    document.getElementById('manutForm').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('saveBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
        const fd = new FormData(e.target);
        const data = {
            veiculoId : fd.get('veiculoId'),
            tipo      : fd.get('tipo'),
            status    : fd.get('status'),
            data      : fd.get('data'),
            kmAtual      : fd.get('kmAtual')    ? Number(fd.get('kmAtual'))    : null,
            kmProxima    : fd.get('kmProxima')  ? Number(fd.get('kmProxima'))  : null,
            dataProxima  : fd.get('dataProxima') || null,
            custo        : fd.get('custo')      ? Number(fd.get('custo'))      : null,
            oficina      : fd.get('oficina').trim()   || null,
            descricao    : fd.get('descricao').trim() || null,
        };
        try {
            await saveDoc('manutencoes', data, id);
            showFlash(id ? 'Manutenção atualizada!' : 'Manutenção registrada!');
            navigate('manutencao');
        } catch(err) {
            showFlash('Erro ao salvar: ' + err.message, 'danger');
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar';
        }
    });
}

// ══════════════════════════════════════════════════════════════
// USUÁRIOS
// ══════════════════════════════════════════════════════════════
let userShowHidden = false;

async function renderUsers(sub) {
    if (!isAdmin()) { showFlash('Acesso negado.','danger'); navigate('dashboard'); return; }
    if (sub === 'create') { renderUserForm(null); return; }
    if (sub?.startsWith('edit:')) { renderUserForm(sub.split(':')[1]); return; }

    const empId = state.profile.empresaId;
    let allSnap;
    try {
        allSnap = await getDocs(collection(db, 'usuarios'));
    } catch(e) {
        setContent(`<div class="empty-state"><p style="color:#dc2626"><b>Erro ao carregar usuários:</b> ${e.message}</p></div>`);
        return;
    }
    const allUsers = allSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const empUsers = allUsers
        .filter(u => u.empresaId === empId || !u.empresaId)
        .sort((a,b) => (a.nome||'').localeCompare(b.nome||'','pt'));
    const hiddenCountU = empUsers.filter(u => u.oculto).length;
    const users = userShowHidden ? empUsers : empUsers.filter(u => !u.oculto);
    // Corrige silenciosamente os que estavam sem empresaId
    allUsers.filter(u => !u.empresaId && empUsers.find(x => x.id === u.id))
            .forEach(u => updateDoc(doc(db, 'usuarios', u.id), { empresaId: empId }).catch(()=>{}));
    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-users-gear" style="color:var(--accent)"></i> Usuários do Sistema</h1>
            <p class="page-subtitle">${users.length} usuário(s)</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
            ${hiddenCountU ? `<button class="btn btn-secondary" id="uToggleHidden"><i class="fa-solid ${userShowHidden?'fa-eye-slash':'fa-eye'}"></i> ${userShowHidden?'Esconder ocultos':`Ocultos (${hiddenCountU})`}</button>` : ''}
            <button class="btn btn-primary" id="addUserBtn"><i class="fa-solid fa-plus"></i> Novo Usuário</button>
        </div>
    </div>

    <div class="alert alert-info">
        <i class="fa-solid fa-circle-info"></i>
        <strong>Perfis:</strong> Administrador (acesso total) · Gerente (pode editar) · Visualizador (somente leitura)
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px">
    ${users.map(u => {
        const initials = (u.nome||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
        const perfilIcon  = u.perfil==='admin'?'fa-shield-halved':u.perfil==='gerente'?'fa-user-tie':'fa-eye';
        const perfilClass = u.perfil==='admin'?'badge-danger':u.perfil==='gerente'?'badge-warning':'badge-info';
        const isMe = u.id === state.profile.id;
        return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column${isMe?';border-top:3px solid var(--accent)':''}${u.oculto?';opacity:0.55':''}">
      <div style="background:var(--primary);padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:46px;height:46px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:17px;font-weight:700;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(u.nome)} ${isMe?'<span style="font-size:10px;background:rgba(255,255,255,.2);border-radius:4px;padding:2px 6px">Você</span>':''}
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.email)}</div>
        </div>
      </div>
      <div style="padding:14px 16px;flex:1;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-user-tag" style="color:var(--muted);font-size:12px;width:14px"></i>
          <span class="badge ${perfilClass}"><i class="fa-solid ${perfilIcon}"></i> ${roleLabel(u.perfil)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-circle" style="color:${u.ativo!==false?'#16a34a':'#9ca3af'};font-size:8px;width:14px"></i>
          <span style="font-size:13px;color:var(--text)">${u.ativo!==false?'Ativo':'Inativo'}</span>
        </div>
      </div>
      ${u.oculto ? '<div style="padding:3px 16px;background:#f1f5f9;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-top:1px solid var(--border)"><i class="fa-solid fa-eye-slash"></i> Oculto</div>' : ''}
      <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" data-edit="${u.id}"><i class="fa-solid fa-pen"></i> Editar</button>
        ${!isMe ? `
        <button class="btn btn-secondary btn-sm" data-uhide="${u.id}" data-uhidden="${!!u.oculto}" title="${u.oculto?'Mostrar':'Ocultar'}"><i class="fa-solid ${u.oculto?'fa-eye':'fa-eye-slash'}"></i> ${u.oculto?'Mostrar':'Ocultar'}</button>
        <button class="btn btn-secondary btn-sm" data-toggle="${u.id}" data-ativo="${u.ativo!==false}">
          <i class="fa-solid ${u.ativo!==false?'fa-ban':'fa-circle-check'}"></i> ${u.ativo!==false?'Desativar':'Ativar'}
        </button>
        <button class="btn btn-danger btn-sm" data-del-user="${u.id}"><i class="fa-solid fa-trash"></i> Excluir</button>` : ''}
      </div>
    </div>`;}).join('')}
    </div>`);

    document.getElementById('addUserBtn').addEventListener('click', () => navigate('users','create'));
    document.getElementById('uToggleHidden')?.addEventListener('click', () => { userShowHidden = !userShowHidden; renderUsers(); });
    document.querySelectorAll('[data-uhide]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const nowHidden = btn.dataset.uhidden === 'true';
            try { await saveDoc('usuarios', { oculto: !nowHidden }, btn.dataset.uhide); renderUsers(); }
            catch (e) { showFlash('Erro: ' + e.message, 'danger'); }
        });
    });
    document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => navigate('users','edit:'+b.dataset.edit)));
    document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
        const isActive = b.dataset.ativo === 'true';
        const action = isActive ? 'Desativar' : 'Ativar';
        if (b.dataset.confirming === 'true') {
            b.dataset.confirming = 'false';
            b.disabled = true;
            b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                await saveDoc('usuarios', { ativo: !isActive }, b.dataset.toggle);
                showFlash(`Usuário ${isActive ? 'desativado' : 'ativado'} com sucesso!`);
                renderUsers();
            } catch(e) { showFlash('Erro: '+e.message,'danger'); renderUsers(); }
        } else {
            b.dataset.confirming = 'true';
            b.style.background = '#f59e0b';
            b.style.color = '#fff';
            b.innerHTML = `<i class="fa-solid fa-question"></i> ${action}?`;
            b.style.width = 'auto';
            b.style.padding = '6px 10px';
            setTimeout(() => {
                if (b.dataset.confirming === 'true') {
                    b.dataset.confirming = 'false';
                    b.style.cssText = '';
                    b.innerHTML = `<i class="fa-solid ${isActive ? 'fa-ban' : 'fa-circle-check'}"></i>`;
                }
            }, 3000);
        }
    }));
    document.querySelectorAll('[data-del-user]').forEach(b => b.addEventListener('click', async () => {
        if (b.dataset.confirming === 'true') {
            b.dataset.confirming = 'false';
            b.disabled = true;
            b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                await deleteFireDoc('usuarios', b.dataset.delUser);
                showFlash('Usuário excluído do sistema.');
                renderUsers();
            } catch(e) { showFlash('Erro: '+e.message,'danger'); renderUsers(); }
        } else {
            b.dataset.confirming = 'true';
            b.style.background = '#dc2626';
            b.style.color = '#fff';
            b.innerHTML = '<i class="fa-solid fa-question"></i> Excluir?';
            b.style.width = 'auto';
            b.style.padding = '6px 10px';
            setTimeout(() => {
                if (b.dataset.confirming === 'true') {
                    b.dataset.confirming = 'false';
                    b.style.cssText = '';
                    b.innerHTML = '<i class="fa-solid fa-trash"></i>';
                }
            }, 3000);
        }
    }));
}

async function renderUserForm(id) {
    if (!isAdmin()) return;
    const isEdit = !!id;
    let u = { nome:'', email:'', perfil:'visualizador', ativo: true };
    if (isEdit) { const data = await getOne('usuarios', id); if (data) u = data; }

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-users-gear" style="color:var(--accent)"></i> ${isEdit?'Editar Usuário':'Novo Usuário'}</h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>
    <div class="card">
        <div class="card-header"><div class="card-title"><i class="fa-solid fa-pen-to-square"></i> Dados do Usuário</div></div>
        <div class="card-body">
            ${!isEdit ? `<div class="alert alert-info"><i class="fa-solid fa-circle-info"></i> O usuário receberá acesso pelo e-mail cadastrado. Informe a senha inicial a ele.</div>` : ''}
            <form id="userForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Nome Completo *</label>
                        <input type="text" name="nome" class="form-control" required value="${esc(u.nome)}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">E-mail *</label>
                        <input type="email" name="email" class="form-control" required value="${esc(u.email)}" ${isEdit?'readonly style="background:#f8fafc"':''}>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Perfil de Acesso *</label>
                        <select name="perfil" class="form-control">
                            <option value="admin" ${u.perfil==='admin'?'selected':''}>Administrador</option>
                            <option value="gerente" ${u.perfil==='gerente'?'selected':''}>Gerente</option>
                            <option value="visualizador" ${u.perfil==='visualizador'?'selected':''}>Visualizador</option>
                        </select>
                    </div>
                    ${isEdit ? `<div class="form-group">
                        <label class="form-label">Status</label>
                        <select name="ativo" class="form-control">
                            <option value="true" ${u.ativo!==false?'selected':''}>Ativo</option>
                            <option value="false" ${u.ativo===false?'selected':''}>Inativo</option>
                        </select>
                    </div>` : ''}
                    ${!isEdit ? `
                    <div class="form-group">
                        <label class="form-label">Senha Inicial *</label>
                        <input type="password" name="senha" class="form-control" required minlength="6" placeholder="Mín. 6 caracteres">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Confirmar Senha *</label>
                        <input type="password" name="senha2" class="form-control" required placeholder="Repita a senha">
                    </div>` : ''}
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> ${isEdit?'Salvar':'Criar Usuário'}</button>
                </div>
            </form>
        </div>
    </div>`);

    document.getElementById('backBtn').addEventListener('click', () => navigate('users'));
    document.getElementById('cancelBtn').addEventListener('click', () => navigate('users'));
    document.getElementById('userForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (isEdit) {
            try {
                await saveDoc('usuarios', { nome: fd.get('nome').trim(), perfil: fd.get('perfil'), ativo: fd.get('ativo') !== 'false' }, id);
                showFlash('Usuário atualizado.'); navigate('users');
            } catch(err) { showFlash('Erro: '+err.message,'danger'); }
        } else {
            const senha = fd.get('senha'), senha2 = fd.get('senha2');
            if (senha !== senha2) { showFlash('As senhas não coincidem.','danger'); return; }
            try {
                // Usa instância secundária para não deslogar o admin atual
                const { initializeApp: initApp2 }                          = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
                const { getAuth: getAuth2, createUserWithEmailAndPassword,
                        sendEmailVerification: sendVerif,
                        signOut: signOut2 }                                 = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
                const secondaryApp  = initApp2(firebaseConfig, 'tmp-' + Date.now());
                const secondaryAuth = getAuth2(secondaryApp);
                const cred = await createUserWithEmailAndPassword(secondaryAuth, fd.get('email').trim(), senha);
                const newUid = cred.user.uid;
                await sendVerif(cred.user);
                await signOut2(secondaryAuth);
                try {
                    await setDoc(doc(db, 'usuarios', newUid), {
                        nome: fd.get('nome').trim(),
                        email: fd.get('email').trim(),
                        perfil: fd.get('perfil'),
                        ativo: true,
                        trocaSenha: true,
                        empresaId: state.profile.empresaId,
                        criadoEm: serverTimestamp()
                    });
                    showFlash('Usuário criado com sucesso.'); navigate('users');
                } catch(fsErr) {
                    showFlash('Usuário criado no Auth mas erro ao salvar perfil: ' + fsErr.message, 'danger');
                }
            } catch(err) {
                const msgs = { 'auth/email-already-in-use':'E-mail já em uso.', 'auth/weak-password':'Senha muito fraca.' };
                showFlash(msgs[err.code]||'Erro: '+err.message,'danger');
            }
        }
    });
}

// ── Apply input masks ─────────────────────────────────────────
function applyMasks() {
    document.querySelectorAll('[data-mask="cpf"]').forEach(el => el.addEventListener('input', () => {
        let v = el.value.replace(/\D/g,'').slice(0,11);
        v = v.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');
        el.value = v;
    }));
    document.querySelectorAll('[data-mask="phone"]').forEach(el => el.addEventListener('input', () => {
        let v = el.value.replace(/\D/g,'').slice(0,11);
        el.value = v.length > 10 ? v.replace(/(\d{2})(\d{5})(\d{4})/,'($1) $2-$3') : v.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3').replace(/-$/,'');
    }));
}

// ══════════════════════════════════════════════════════════════
// MINHA EMPRESA
// ══════════════════════════════════════════════════════════════
function gerarCodigo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 8; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
}

// ══════════════════════════════════════════════════════════════
// EMPRESA
// ══════════════════════════════════════════════════════════════
async function renderEmpresa(sub) {
    if (!isAdmin()) { setContent('<div class="empty-state"><h3>Acesso restrito a administradores.</h3></div>'); return; }
    if (sub === 'edit') { renderEmpresaForm(); return; }

    const emp = state.empresa || {};
    const logoHtml = emp.logo
        ? `<img src="${emp.logo}" style="width:120px;height:120px;object-fit:contain;border-radius:14px;border:2px solid #e2e8f0">`
        : `<div style="width:120px;height:120px;background:linear-gradient(135deg,var(--primary),var(--accent));border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:48px">🏢</div>`;

    const field = (icon, label, val) => `
        <div style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--border)">
            <div style="width:34px;height:34px;background:var(--bg);border:1px solid var(--border);border-radius:8px;
                        display:flex;align-items:center;justify-content:center;color:var(--accent);font-size:13px;flex-shrink:0;margin-top:1px">
                <i class="fa-solid fa-${icon}"></i>
            </div>
            <div style="min-width:0">
                <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:3px">${label}</p>
                <p style="font-size:14px;font-weight:600;color:var(--text);word-break:break-word">${val || '<span style="color:var(--muted);font-weight:400">—</span>'}</p>
            </div>
        </div>`;

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-building" style="color:var(--accent)"></i> Minha Empresa</h1>
        </div>
        <button class="btn btn-primary" onclick="navigate('empresa','edit')"><i class="fa-solid fa-pen-to-square"></i> Editar</button>
    </div>

    <!-- Cabeçalho com logo + nome (empilha em mobile) -->
    <div class="card mb-16">
        <div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
            <div style="flex-shrink:0">${logoHtml}</div>
            <div style="flex:1;min-width:180px">
                <h2 style="font-size:20px;font-weight:800;color:var(--text);line-height:1.2;margin-bottom:4px">${esc(emp.nome || '—')}</h2>
                ${emp.nomeFantasia ? `<p style="font-size:13px;color:var(--muted);margin-bottom:6px">${esc(emp.nomeFantasia)}</p>` : ''}
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
                    ${emp.plano ? `<span class="badge badge-info" style="text-transform:uppercase;font-size:10px">${esc(emp.plano)}</span>` : ''}
                    ${emp.cnpj  ? `<span class="badge badge-muted" style="font-size:10px;font-family:monospace">${esc(emp.cnpj)}</span>` : ''}
                </div>
            </div>
        </div>
    </div>

    <!-- Dados de contato e localização em 2 colunas (1 em mobile) -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:16px">
        <div class="card">
            <div class="card-header"><div class="card-title"><i class="fa-solid fa-address-card"></i> Contato</div></div>
            <div class="card-body" style="padding-top:0;padding-bottom:4px">
                ${field('phone', 'Telefone', emp.telefone ? `<a href="tel:${emp.telefone.replace(/\D/g,'')}" style="color:var(--accent);text-decoration:none">${esc(emp.telefone)}</a>` : '')}
                ${field('envelope', 'E-mail de Contato', emp.emailContato ? `<a href="mailto:${emp.emailContato}" style="color:var(--accent);text-decoration:none">${esc(emp.emailContato)}</a>` : '')}
            </div>
        </div>
        <div class="card">
            <div class="card-header"><div class="card-title"><i class="fa-solid fa-location-dot"></i> Localização</div></div>
            <div class="card-body" style="padding-top:0;padding-bottom:4px">
                ${field('city', 'Cidade / Estado', emp.cidade ? esc(emp.cidade) + (emp.estado ? ' — ' + esc(emp.estado) : '') : '')}
                ${field('road', 'Endereço', emp.endereco ? esc(emp.endereco) : '')}
            </div>
        </div>
    </div>`);

}


async function renderEmpresaForm() {
    if (!isAdmin()) return;
    const emp = state.empresa || {};
    let logoData = emp.logo || null;

    setContent(`
    <div class="page-header">
        <div class="page-title-wrap">
            <h1 class="page-title"><i class="fa-solid fa-building" style="color:var(--accent)"></i> Editar Empresa</h1>
        </div>
        <button class="btn btn-secondary" id="backBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
    </div>
    <div class="card">
        <div class="card-header"><div class="card-title"><i class="fa-solid fa-pen-to-square"></i> Dados da Empresa</div></div>
        <div class="card-body">
            <form id="empresaForm">
                <div style="margin-bottom:20px;padding:16px;background:var(--bg);border-radius:12px;border:1px solid var(--border)">
                    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
                        <div id="logoPreviewWrap" style="flex-shrink:0">
                            ${logoData
                                ? `<img id="logoPreview" src="${logoData}" style="width:80px;height:80px;object-fit:contain;border-radius:10px;border:2px solid var(--border)">`
                                : `<div id="logoPreview" style="width:80px;height:80px;background:linear-gradient(135deg,var(--primary),var(--accent));border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:32px">🏢</div>`}
                        </div>
                        <div style="flex:1;min-width:180px">
                            <p style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">Logo da empresa</p>
                            <p style="font-size:11px;color:var(--muted);margin-bottom:10px">PNG, JPG ou SVG · máx. 200 KB · fundo transparente ideal</p>
                            <div style="display:flex;gap:8px;flex-wrap:wrap">
                                <label class="btn btn-secondary" style="width:auto;cursor:pointer;display:inline-flex;padding:7px 12px;font-size:12px">
                                    <i class="fa-solid fa-upload"></i> Selecionar imagem
                                    <input type="file" id="logoInput" accept="image/*" style="display:none">
                                </label>
                                ${logoData ? `<button type="button" id="removeLogoBtn" class="btn btn-danger" style="width:auto;padding:7px 12px;font-size:12px"><i class="fa-solid fa-trash"></i> Remover</button>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Razão Social *</label>
                        <input type="text" name="nome" class="form-control" required value="${esc(emp.nome || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Nome Fantasia</label>
                        <input type="text" name="nomeFantasia" class="form-control" value="${esc(emp.nomeFantasia || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">CNPJ</label>
                        <input type="text" name="cnpj" class="form-control" data-mask="cnpj" value="${esc(emp.cnpj || '')}" placeholder="00.000.000/0000-00" maxlength="18">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Telefone</label>
                        <input type="text" name="telefone" class="form-control" data-mask="phone" value="${esc(emp.telefone || '')}" placeholder="(11) 99999-9999">
                    </div>
                    <div class="form-group">
                        <label class="form-label">E-mail de Contato</label>
                        <input type="email" name="emailContato" class="form-control" value="${esc(emp.emailContato || '')}" placeholder="contato@suaempresa.com">
                    </div>
                    <div class="form-group">
                        <label class="form-label">CEP</label>
                        <div style="display:flex;gap:6px">
                            <input type="text" name="cep" id="empCepInput" class="form-control" maxlength="9" value="${esc(emp.cep||'')}" placeholder="00000-000">
                            <button type="button" id="buscarEmpCepBtn" class="btn btn-secondary" style="white-space:nowrap;padding:0 14px"><i class="fa-solid fa-magnifying-glass"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Cidade</label>
                        <input type="text" name="cidade" id="empCidade" class="form-control" value="${esc(emp.cidade || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Estado (UF)</label>
                        <input type="text" name="estado" id="empEstado" class="form-control" value="${esc(emp.estado || '')}" maxlength="2" placeholder="SP" style="text-transform:uppercase">
                    </div>
                    <div class="form-group" style="grid-column:1/-1">
                        <label class="form-label">Endereço Completo</label>
                        <input type="text" name="endereco" id="empEndereco" class="form-control" value="${esc(emp.endereco || '')}" placeholder="Rua, número, complemento, bairro">
                    </div>
                </div>
                <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
                    <button type="button" class="btn btn-secondary" id="cancelBtn" style="flex:1;min-width:120px">Cancelar</button>
                    <button type="submit" class="btn btn-primary" id="saveBtn" style="flex:2;min-width:160px"><i class="fa-solid fa-floppy-disk"></i> Salvar alterações</button>
                </div>
            </form>
        </div>
    </div>`);

    document.getElementById('backBtn')?.addEventListener('click', () => navigate('empresa'));
    document.getElementById('cancelBtn')?.addEventListener('click', () => navigate('empresa'));

    // Logo upload
    document.getElementById('logoInput').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 200 * 1024) { showFlash('Imagem muito grande. Máximo: 200 KB.', 'danger'); e.target.value = ''; return; }
        const reader = new FileReader();
        reader.onload = () => {
            logoData = reader.result;
            const wrap = document.getElementById('logoPreviewWrap');
            wrap.innerHTML = `<img id="logoPreview" src="${logoData}" style="width:80px;height:80px;object-fit:contain;border-radius:10px;border:2px solid #e2e8f0">`;
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('removeLogoBtn')?.addEventListener('click', () => {
        logoData = null;
        document.getElementById('logoPreviewWrap').innerHTML =
            `<div id="logoPreview" style="width:80px;height:80px;background:linear-gradient(135deg,var(--primary),var(--accent));border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:32px">🏢</div>`;
    });

    // Mask CNPJ + BrasilAPI auto-fill
    const cnpjInput = document.querySelector('[data-mask="cnpj"]');
    cnpjInput?.addEventListener('input', e => {
        let v = e.target.value.replace(/\D/g,'').slice(0,14);
        v = v.replace(/(\d{2})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1/$2').replace(/(\d{4})(\d{1,2})$/,'$1-$2');
        e.target.value = v;
        if (v.replace(/\D/g,'').length === 14) buscarCnpjEmp(v.replace(/\D/g,''));
    });
    async function buscarCnpjEmp(cnpj) {
        try {
            const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
            if (!r.ok) return;
            const j = await r.json();
            if (j.razao_social) document.querySelector('[name="nome"]').value = j.razao_social;
            if (j.nome_fantasia) document.querySelector('[name="nomeFantasia"]').value = j.nome_fantasia;
            if (j.ddd_telefone_1) document.querySelector('[name="telefone"]').value = j.ddd_telefone_1;
            if (j.municipio) document.getElementById('empCidade').value = j.municipio;
            if (j.uf) document.getElementById('empEstado').value = j.uf;
            if (j.logradouro) document.getElementById('empEndereco').value = [j.tipo_logradouro, j.logradouro, j.numero, j.complemento, j.bairro].filter(Boolean).join(' ');
            if (j.cep) { const c = j.cep.replace(/\D/g,''); document.getElementById('empCepInput').value = c.slice(0,5)+'-'+c.slice(5); }
            showFlash('Dados da empresa preenchidos automaticamente.');
        } catch(e) {}
    }

    // CEP ViaCEP
    document.getElementById('empCepInput').addEventListener('input', e => {
        let v = e.target.value.replace(/\D/g,'').slice(0,8);
        if (v.length > 5) v = v.slice(0,5) + '-' + v.slice(5);
        e.target.value = v;
    });
    async function buscarCepEmp() {
        const cep = document.getElementById('empCepInput').value.replace(/\D/g,'');
        if (cep.length !== 8) return;
        const btn = document.getElementById('buscarEmpCepBtn');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            const j = await r.json();
            if (!j.erro) {
                if (j.logradouro) document.getElementById('empEndereco').value = j.logradouro + (j.complemento ? ', ' + j.complemento : '') + ', ' + j.bairro;
                if (j.localidade) document.getElementById('empCidade').value = j.localidade;
                if (j.uf) document.getElementById('empEstado').value = j.uf;
            }
        } catch(e) {}
        btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
    }
    document.getElementById('buscarEmpCepBtn').addEventListener('click', buscarCepEmp);
    document.getElementById('empCepInput').addEventListener('blur', () => { if (document.getElementById('empCepInput').value.replace(/\D/g,'').length === 8) buscarCepEmp(); });

    applyMasks();

    document.getElementById('empresaForm').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('saveBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
        const fd = new FormData(e.target);
        try {
            const data = {
                nome:         fd.get('nome').trim(),
                nomeFantasia: fd.get('nomeFantasia').trim(),
                cnpj:         fd.get('cnpj').trim(),
                telefone:     fd.get('telefone').trim(),
                emailContato: fd.get('emailContato').trim(),
                cep:          (fd.get('cep')||'').replace(/\D/g,''),
                cidade:       fd.get('cidade').trim(),
                estado:       fd.get('estado').trim().toUpperCase(),
                endereco:     fd.get('endereco').trim(),
                logo:         logoData || null,
                atualizadoEm: serverTimestamp()
            };
            const { setDoc: _setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            await _setDoc(doc(db, 'empresas', state.profile.empresaId), data, { merge: true });

            // Atualiza estado local e sidebar
            state.empresa = { ...state.empresa, ...data };
            document.getElementById('brandName').textContent = data.nome || brandConfig.name;
            if (data.logo) {
                document.getElementById('sidebarLogoIcon').innerHTML =
                    `<img src="${data.logo}" style="width:52px;height:52px;object-fit:contain;border-radius:10px">`;
            } else {
                document.getElementById('sidebarLogoIcon').innerHTML = `<i class="fa-solid fa-car-side"></i>`;
            }

            showFlash('Empresa atualizada com sucesso!');
            navigate('empresa');
        } catch(err) {
            showFlash('Erro ao salvar: ' + err.message, 'danger');
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar';
        }
    });
}

// ══════════════════════════════════════════════════════════════
// INFRAÇÕES CTB
// ══════════════════════════════════════════════════════════════
const CTB_BASE = { leve:88.38, media:130.16, grave:195.23, gravissima:293.47 };
const CTB_PTS  = { leve:3, media:4, grave:5, gravissima:7 };
const CTB_INFRACOES = [
  // Habilitação
  {cod:'162-I',   desc:'Dirigir sem CNH (inabilitado)',                             grav:'gravissima', mult:3},
  {cod:'162-II',  desc:'Dirigir com CNH vencida há mais de 30 dias',               grav:'grave',      mult:1},
  {cod:'162-III', desc:'Dirigir com CNH suspensa ou cassada',                      grav:'gravissima', mult:2},
  {cod:'162-IV',  desc:'Dirigir com CNH de categoria diferente da exigida',        grav:'grave',      mult:1},
  {cod:'162-V',   desc:'Dirigir com permissão provisória vencida >12 meses',       grav:'grave',      mult:1},
  {cod:'163',     desc:'Confiar veículo a pessoa inabilitada ou embriagada',       grav:'grave',      mult:1},
  {cod:'164',     desc:'Emprestar CNH a pessoa inabilitada',                       grav:'grave',      mult:1},
  // Álcool / Drogas
  {cod:'165',     desc:'Dirigir sob efeito de álcool ou substância psicoativa',    grav:'gravissima', mult:5},
  {cod:'165-A',   desc:'Recusar-se a realizar teste de bafômetro',                 grav:'gravissima', mult:5},
  // Racha
  {cod:'166',     desc:'Disputar corrida (racha) em via pública',                  grav:'gravissima', mult:5},
  // Celular / Fone
  {cod:'252-IV',  desc:'Usar celular ao volante',                                  grav:'grave',      mult:1},
  {cod:'252-II',  desc:'Usar fone de ouvido ao volante',                           grav:'grave',      mult:1},
  {cod:'252-I',   desc:'Realizar outra atividade que compromete a direção',        grav:'grave',      mult:1},
  // Cinto / Criança
  {cod:'167',     desc:'Dirigir sem cinto de segurança',                           grav:'grave',      mult:1},
  {cod:'167-A',   desc:'Transportar criança sem dispositivo de retenção adequado', grav:'gravissima', mult:1},
  // Capacete
  {cod:'244-I',   desc:'Conduzir moto sem capacete regulamentado',                 grav:'grave',      mult:1},
  {cod:'244-II',  desc:'Conduzir moto com passageiro sem capacete',                grav:'grave',      mult:1},
  // Velocidade — Art. 218
  {cod:'218-I',   desc:'Excesso de velocidade: até 20% acima do limite',           grav:'leve',       mult:1},
  {cod:'218-II',  desc:'Excesso de velocidade: >20% e ≤50% acima do limite',      grav:'grave',      mult:1},
  {cod:'218-III', desc:'Excesso de velocidade: >50% acima do limite',              grav:'gravissima', mult:1},
  // Semáforo / Sinalização
  {cod:'208',     desc:'Avançar sinal vermelho ou parada obrigatória',             grav:'gravissima', mult:3},
  {cod:'209',     desc:'Descumprir ordem de agente de trânsito',                   grav:'gravissima', mult:3},
  {cod:'210',     desc:'Desrespeitar placa de proibição ou restrição',             grav:'media',      mult:1},
  // Ultrapassagem
  {cod:'214-I',   desc:'Ultrapassar veículo em local proibido por sinalização',    grav:'gravissima', mult:1},
  {cod:'215',     desc:'Ultrapassar veículo que cede passagem a pedestre',         grav:'grave',      mult:1},
  {cod:'216',     desc:'Ultrapassar pela contramão em curva ou aclive sem visib.', grav:'gravissima', mult:1},
  // Pedestre
  {cod:'193',     desc:'Deixar de dar passagem a pedestre na faixa de pedestres',  grav:'grave',      mult:1},
  // Estacionamento — Art. 181
  {cod:'181-I',   desc:'Estacionar em local proibido (sinalizado)',                grav:'media',      mult:1},
  {cod:'181-II',  desc:'Estacionar em garagem ou entrada de imóvel',               grav:'media',      mult:1},
  {cod:'181-III', desc:'Estacionar em vaga de deficiente sem credencial',          grav:'grave',      mult:1},
  {cod:'181-IV',  desc:'Estacionar na faixa de pedestres',                         grav:'media',      mult:1},
  {cod:'181-V',   desc:'Estacionar sobre calçada ou passeio',                      grav:'media',      mult:1},
  {cod:'181-VI',  desc:'Estacionar em ponto de parada de ônibus/táxi',             grav:'media',      mult:1},
  {cod:'181-VII', desc:'Estacionar no lado esquerdo (mão contrária)',               grav:'leve',       mult:1},
  {cod:'181-VIII',desc:'Estacionar impedindo saída de outro veículo',              grav:'media',      mult:1},
  {cod:'181-IX',  desc:'Estacionar junto a hidrante ou marco de incêndio',         grav:'media',      mult:1},
  {cod:'181-XI',  desc:'Estacionar a menos de 5 m de cruzamento ou esquina',      grav:'leve',       mult:1},
  {cod:'181-XIII',desc:'Estacionar em local de carga e descarga',                  grav:'media',      mult:1},
  {cod:'181-XV',  desc:'Estacionar em faixa exclusiva de ônibus',                  grav:'media',      mult:1},
  // Parada proibida — Art. 182
  {cod:'182-I',   desc:'Parar em curva ou aclive com visibilidade reduzida',       grav:'media',      mult:1},
  {cod:'182-II',  desc:'Parar em faixa de pedestres ou cruzamento',               grav:'media',      mult:1},
  {cod:'182-III', desc:'Parar em túnel, ponte ou viaduto',                         grav:'media',      mult:1},
  {cod:'182-IV',  desc:'Parar ao lado de veículo estacionado (fila dupla)',        grav:'media',      mult:1},
  {cod:'182-V',   desc:'Parar sobre trilho de bonde ou trem',                      grav:'media',      mult:1},
  // Documentação — Art. 230
  {cod:'230-I',   desc:'Conduzir veículo sem CRLV (licenciamento)',                grav:'leve',       mult:1},
  {cod:'230-II',  desc:'Conduzir veículo sem placa dianteira ou traseira',         grav:'media',      mult:1},
  {cod:'230-V',   desc:'Conduzir veículo com placa não regulamentada',             grav:'grave',      mult:1},
  {cod:'230-VII', desc:'Conduzir veículo sem equipamento obrigatório',             grav:'media',      mult:1},
  {cod:'230-VIII',desc:'Conduzir veículo com películas (insulfilm) irregulares',   grav:'media',      mult:1},
  {cod:'230-IX',  desc:'Conduzir veículo com pneu inservível ou irregular',        grav:'grave',      mult:1},
  {cod:'230-X',   desc:'Conduzir veículo com faróis ou luzes irregulares',         grav:'media',      mult:1},
  // Outros
  {cod:'231-I',   desc:'Dirigir sem portar CNH (esqueceu em casa)',                grav:'leve',       mult:1},
  {cod:'232',     desc:'Conduzir veículo sem portar CRLV',                         grav:'leve',       mult:1},
  {cod:'233',     desc:'Conduzir veículo com equipamento anti-radar',              grav:'gravissima', mult:3},
  {cod:'237',     desc:'Deixar veículo em movimento sem condutor habilitado',      grav:'grave',      mult:1},
  {cod:'238',     desc:'Recusar identificação ou dados a agente de trânsito',      grav:'grave',      mult:1},
  {cod:'240',     desc:'Usar buzina em excesso ou em local proibido',              grav:'leve',       mult:1},
  {cod:'253',     desc:'Não acionar luz de rodagem diurna quando obrigatório',     grav:'leve',       mult:1},
  {cod:'254-I',   desc:'Trafegar em sentido contrário ao fluxo da via',            grav:'gravissima', mult:1},
  {cod:'255',     desc:'Abrir porta de veículo sem tomar precauções',              grav:'leve',       mult:1},
  {cod:'229',     desc:'Conduzir veículo com carga mal acondicionada',             grav:'grave',      mult:1},
  {cod:'256-I',   desc:'Circular com veículo não registrado',                      grav:'grave',      mult:1},
  // Rodízio / Restrição de circulação
  {cod:'235',     desc:'Transitar em local ou horário proibido pelo poder público (Rodízio)', grav:'grave', mult:1},
];

// ══════════════════════════════════════════════════════════════
// INFRAÇÕES CTB
// ══════════════════════════════════════════════════════════════
function ctbValor(grav, mult) {
    return (CTB_BASE[grav] || 0) * (mult || 1);
}

async function renderInfracoes() {
    let busca = '', filtroGrav = 'todos';

    function buildHtml() {
        const q = busca.toLowerCase().trim();
        const gravLabel = { leve:'Leve', media:'Média', grave:'Grave', gravissima:'Gravíssima' };
        const gravColor = { leve:'#16a34a', media:'#d97706', grave:'#ea580c', gravissima:'#dc2626' };
        const gravBg    = { leve:'#dcfce7', media:'#fef3c7', grave:'#ffedd5', gravissima:'#fee2e2' };

        const lista = CTB_INFRACOES.filter(i => {
            if (filtroGrav !== 'todos' && i.grav !== filtroGrav) return false;
            if (!q) return true;
            return i.cod.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q);
        });

        const cards = lista.map(i => {
            const valor = ctbValor(i.grav, i.mult);
            const multLabel = i.mult > 1 ? ` ×${i.mult}` : '';
            return `
            <div style="background:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.07);border-left:4px solid ${gravColor[i.grav]}">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
                    <span style="font-size:12px;font-weight:700;color:var(--accent);white-space:nowrap">Art. ${esc(i.cod)}</span>
                    <span style="background:${gravBg[i.grav]};color:${gravColor[i.grav]};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;white-space:nowrap">
                        ${gravLabel[i.grav]}${multLabel}
                    </span>
                </div>
                <p style="font-size:13px;color:#1e293b;margin:0 0 10px;line-height:1.4">${esc(i.desc)}</p>
                <div style="display:flex;gap:16px">
                    <span style="font-size:11px;color:#64748b"><i class="fa-solid fa-circle-dot" style="color:${gravColor[i.grav]};margin-right:4px"></i>${CTB_PTS[i.grav]} pontos</span>
                    <span style="font-size:13px;font-weight:700;color:${gravColor[i.grav]}">R$ ${valor.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                </div>
            </div>`;
        }).join('');

        const empty = lista.length === 0
            ? `<div style="text-align:center;padding:40px 16px;color:#94a3b8"><i class="fa-solid fa-magnifying-glass" style="font-size:32px;margin-bottom:12px;display:block"></i>Nenhuma infração encontrada.</div>` : '';

        const gravBtns = ['todos','leve','media','grave','gravissima'].map(g => {
            const lbl = {todos:'Todos',leve:'Leve',media:'Média',grave:'Grave',gravissima:'Gravíssima'}[g];
            const active = filtroGrav === g;
            return `<button data-ctbgrav="${g}" style="padding:6px 14px;border-radius:20px;border:1.5px solid ${active?'var(--accent)':'#e2e8f0'};background:${active?'var(--accent)':'#fff'};color:${active?'#fff':'#475569'};font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">${lbl}</button>`;
        }).join('');

        setContent(`
            <div style="padding:16px;max-width:700px;margin:0 auto">
                <div style="background:#fff;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
                    <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0 0 3px">
                        <i class="fa-solid fa-book-open" style="color:var(--accent)"></i> Infrações CTB
                    </h2>
                    <p style="font-size:11px;color:#94a3b8;margin:0 0 12px">Res. CONTRAN 809/2021</p>
                    <input id="ctbBusca" type="search" placeholder="Buscar por artigo ou descrição..." value="${esc(busca)}"
                        style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:10px">
                    <div style="display:flex;gap:6px;flex-wrap:wrap">${gravBtns}</div>
                </div>

                <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;padding:0 2px">
                    ${lista.length} infração${lista.length !== 1 ? 'ões' : ''}
                </div>

                <div style="display:flex;flex-direction:column;gap:10px">
                    ${cards}${empty}
                </div>
            </div>
        `);

        document.getElementById('ctbBusca').addEventListener('input', e => { busca = e.target.value; buildHtml(); });
        document.querySelectorAll('[data-ctbgrav]').forEach(btn => {
            btn.addEventListener('click', () => { filtroGrav = btn.dataset.ctbgrav; buildHtml(); });
        });
    }

    buildHtml();
}

// ══════════════════════════════════════════════════════════════
// BANNER DE SEGURANÇA
// ══════════════════════════════════════════════════════════════
const SAFETY_MSGS = [
    { icon:'fa-beer-mug-empty',      text:'Se beber, não dirija. Vidas dependem de você.' },
    { icon:'fa-mobile-screen-button',text:'Celular no bolso. Atenção na estrada.' },
    { icon:'fa-gauge-high',          text:'Respeite o limite de velocidade. Não há pressa que valha uma vida.' },
    { icon:'fa-person-seat-reclined',text:'Use o cinto de segurança. Sempre, em todos os bancos.' },
    { icon:'fa-bed',                 text:'Sono ao volante é tão perigoso quanto dirigir bêbado.' },
    { icon:'fa-road',                text:'Mantenha distância segura do veículo à frente.' },
    { icon:'fa-turn-up',             text:'Sinalizar é respeitar. Sempre use o pisca ao mudar de faixa.' },
    { icon:'fa-person-walking',      text:'Respeite a faixa de pedestres. Eles não têm para-choque.' },
    { icon:'fa-cloud-rain',          text:'Chuva forte? Reduza a velocidade e ligue os faróis.' },
    { icon:'fa-wrench',              text:'Carro revisado é carro seguro. Manutenção em dia salva vidas.' },
    { icon:'fa-clock',               text:'Pausa a cada 2 horas em viagens longas. Descansado você chega.' },
    { icon:'fa-fire',                text:'Verifique o extintor do veículo periodicamente.' },
    { icon:'fa-eye',                 text:'Faróis acesos, mesmo de dia. Você fica mais visível.' },
    { icon:'fa-tire',                text:'Pneus calibrados garantem frenagem e estabilidade.' },
    { icon:'fa-triangle-exclamation',text:'Não force ultrapassagens em curvas ou na contramão.' },
    { icon:'fa-lightbulb',           text:'Revise as luzes do veículo mensalmente.' },
    { icon:'fa-id-card',             text:'CNH em dia. Motorista regular é motorista seguro.' },
    { icon:'fa-arrows-left-right',   text:'Na chuva, aumente ainda mais a distância do carro da frente.' },
    { icon:'fa-headphones',          text:'Fone de ouvido ao volante tira o foco. Evite.' },
    { icon:'fa-star',                text:'Direção segura começa antes de ligar o carro. Planeje a rota.' },
];

// ── Banner de segurança ───────────────────────────────────────
function showSafetyBanner() {
    const el = document.getElementById('safetyBanner');
    if (!el) return;
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const msg = SAFETY_MSGS[dayOfYear % SAFETY_MSGS.length];
    el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 20px;background:linear-gradient(90deg,#1e3a5f,#2563eb);color:#fff;font-size:12px;flex-shrink:0';
    el.innerHTML = `<i class="fa-solid ${msg.icon}" style="opacity:.85;flex-shrink:0"></i><span>${msg.text}</span>`;
}

// ══════════════════════════════════════════════════════════════
// AJUDA
// ══════════════════════════════════════════════════════════════
async function renderAjuda() {
    const sections = [
        {
            icon:'fa-gauge-high', title:'Dashboard', color:'#2563eb',
            steps:[
                'A tela inicial mostra um resumo da frota: total de veículos, motoristas, km rodados e gastos.',
                'Alertas automáticos avisam quando o <b>seguro</b> ou o <b>IPVA</b> de algum veículo vence em até 30 dias.',
                'O gráfico de combustível mostra gasto (R$) e litros abastecidos nos últimos 6 meses.',
                'Os cartões de rodízio mostram quais placas estão restritas hoje em SP.',
                'Clique em qualquer cartão para ir direto ao módulo correspondente.',
            ]
        },
        {
            icon:'fa-car', title:'Veículos', color:'#0d9488',
            steps:[
                'Acesse Veículos no menu e toque em <b>+ Novo Veículo</b> (ou no botão azul <b>+</b> no canto inferior direito no celular).',
                'Preencha placa, marca, modelo, ano e <b>RENAVAM</b> — obrigatório para consultar multas no DETRAN SP.',
                'Informe as datas de vencimento do <b>Seguro</b> e do <b>IPVA</b> para receber alertas automáticos no dashboard.',
                'Use <b>Consultar Multas</b> no card do veículo para ver débitos diretamente no DETRAN SP.',
                'Para ocultar um veículo inativo, abra o card e clique em <b>Ocultar</b>. Para ver ocultos, clique em <b>Mostrar Ocultos</b> no topo da lista.',
                'No celular, deslize o card para a esquerda para revelar o botão de excluir.',
            ]
        },
        {
            icon:'fa-id-card', title:'Motoristas', color:'#7c3aed',
            steps:[
                'Cadastre motoristas em <b>Motoristas → + Novo Motorista</b>.',
                'Informe nome, CNH, categoria e vencimento da habilitação.',
                'Motoristas com CNH vencida aparecem com alerta em vermelho.',
                'Oculte motoristas inativos da mesma forma que os veículos.',
            ]
        },
        {
            icon:'fa-road', title:'Utilização Diária', color:'#ea580c',
            steps:[
                'Registra saídas e devoluções de veículos por motorista.',
                'Toque em <b>+ Nova Utilização</b>, selecione o veículo, motorista, destino e km inicial.',
                'Ao devolver, encontre o registro na lista e toque em <b>Finalizar</b>, informando km final.',
                'O sistema calcula automaticamente a distância percorrida.',
                'Use o filtro de data para ver utilizações de outros dias.',
            ]
        },
        {
            icon:'fa-triangle-exclamation', title:'Multas', color:'#dc2626',
            steps:[
                'Registre manualmente multas em <b>Multas → + Nova Multa</b>.',
                'Vincule a multa a um veículo e, se conhecido, ao motorista responsável.',
                'Para consultar débitos no DETRAN SP automaticamente, vá em <b>Veículos</b>, abra o card e clique em <b>Consultar Multas</b> (requer RENAVAM cadastrado).',
                'A consulta usa a API Infosimples e consome créditos da conta configurada.',
            ]
        },
        {
            icon:'fa-book-open', title:'Infrações CTB', color:'#0891b2',
            steps:[
                'Tabela de referência com todas as infrações do Código de Trânsito Brasileiro.',
                'Busque pelo número do artigo (ex: <b>162</b>) ou pela descrição (ex: <b>celular</b>).',
                'Filtre por gravidade: Leve, Média, Grave ou Gravíssima.',
                'Cada card mostra artigo, descrição, pontos na CNH e valor da multa.',
            ]
        },
        {
            icon:'fa-map-location-dot', title:'Rastreamento GPS', color:'#16a34a',
            steps:[
                'Visualize em tempo real a posição dos veículos com rastreador GPS.',
                'Cadastre um dispositivo em <b>Rastreamento → Novo</b> e anote o Token gerado.',
                'Configure o rastreador GPS para enviar dados para a URL do endpoint exibida na tela (compatível com Coban, Sinotrack, Suntech e similares).',
                'Clique na mira para centralizar o mapa no veículo.',
                'O ponto verde piscando no canto da tela indica que há GPS ativo.',
            ]
        },
        {
            icon:'fa-rotate', title:'Rodízio', color:'#d97706',
            steps:[
                'Mostra quais veículos da frota estão com restrição de rodízio hoje.',
                'O sistema identifica automaticamente o dia de restrição pelo último dígito da placa.',
                'Veículos restritos aparecem destacados em vermelho.',
            ]
        },
        {
            icon:'fa-gas-pump', title:'Combustível', color:'#059669',
            steps:[
                'Registre abastecimentos em <b>Combustível → + Novo Abastecimento</b>.',
                'Informe veículo, data, litros abastecidos, valor por litro e km atual.',
                'O sistema calcula o consumo médio em <b>km/L</b> automaticamente.',
                'O histórico de gastos aparece no gráfico do Dashboard.',
                'Use a exportação PDF para relatório de combustível por período.',
            ]
        },
        {
            icon:'fa-wrench', title:'Manutenção', color:'#7c3aed',
            steps:[
                'Agende e registre manutenções em <b>Manutenção → + Nova Manutenção</b>.',
                'Defina tipo (preventiva/corretiva), veículo, data e km.',
                'Manutenções próximas do vencimento aparecem como alerta no Dashboard.',
                'Marque como concluída ao finalizar o serviço.',
            ]
        },
        {
            icon:'fa-chart-bar', title:'Relatórios', color:'#2563eb',
            steps:[
                'Gere relatórios de utilizações, multas, combustível e manutenções com filtro por período.',
                'Clique em <b>PDF</b> para exportar o relatório — uma janela de impressão abrirá para salvar ou imprimir.',
                'Os módulos de Combustível e Manutenção também têm botão de exportar PDF direto na lista.',
            ]
        },
        {
            icon:'fa-users-gear', title:'Usuários', color:'#475569',
            steps:[
                'Disponível apenas para <b>Administradores</b>.',
                'Cadastre novos usuários em <b>Usuários → + Novo Usuário</b>.',
                'Perfis disponíveis: <b>Visualizador</b> (somente leitura), <b>Operador</b> (registra utilizações) e <b>Admin</b> (acesso total).',
                'O usuário recebe e-mail com senha temporária e deve trocar no primeiro acesso.',
            ]
        },
        {
            icon:'fa-building', title:'Minha Empresa', color:'#0f766e',
            steps:[
                'Configure nome, CNPJ, endereço e logo da empresa.',
                'O logo aparece no topo do menu lateral.',
            ]
        },
        {
            icon:'fa-wifi-slash', title:'Uso Offline', color:'#f59e0b',
            steps:[
                'O sistema funciona mesmo sem internet — dados salvos continuam visíveis.',
                'Ações feitas offline (cadastros, registros) ficam na fila e são enviadas automaticamente ao reconectar.',
                'Um banner amarelo na parte inferior avisa quando você está sem conexão.',
                'Para instalar o app na tela inicial do celular, acesse pelo navegador e aceite o convite de instalação que aparece automaticamente.',
            ]
        },
    ];

    let openIdx = null;

    function buildHtml() {
        const cards = sections.map((s, i) => {
            const open = openIdx === i;
            const stepsList = s.steps.map(st =>
                `<li style="padding:5px 0;font-size:13px;color:#475569;line-height:1.5;border-bottom:1px solid #f1f5f9">${st}</li>`
            ).join('');
            return `
            <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.07);overflow:hidden">
                <button data-idx="${i}" style="width:100%;display:flex;align-items:center;gap:12px;padding:14px 16px;background:none;border:none;cursor:pointer;text-align:left">
                    <span style="width:36px;height:36px;border-radius:10px;background:${s.color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        <i class="fa-solid ${s.icon}" style="color:${s.color};font-size:15px"></i>
                    </span>
                    <span style="flex:1;font-size:14px;font-weight:700;color:#1e293b">${s.title}</span>
                    <i class="fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'}" style="color:#94a3b8;font-size:12px"></i>
                </button>
                ${open ? `<div style="padding:0 16px 14px">
                    <ol style="margin:0;padding-left:18px;list-style:decimal">${stepsList}</ol>
                </div>` : ''}
            </div>`;
        }).join('');

        setContent(`
            <div style="padding:16px;max-width:680px;margin:0 auto">
                <div style="background:linear-gradient(135deg,var(--primary),var(--accent));border-radius:14px;padding:20px;margin-bottom:16px;color:#fff">
                    <h2 style="font-size:18px;font-weight:700;margin:0 0 6px"><i class="fa-solid fa-circle-question"></i> Central de Ajuda</h2>
                    <p style="font-size:13px;opacity:.85;margin:0">Toque em um módulo para ver como usar.</p>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px" id="ajudaList">
                    ${cards}
                </div>
                <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:20px">FrotaControl • Dúvidas? Entre em contato com o suporte.</p>
            </div>
        `);

        document.querySelectorAll('[data-idx]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.idx);
                openIdx = openIdx === i ? null : i;
                buildHtml();
            });
        });
    }

    buildHtml();
}

// ── Modal de sugestão ─────────────────────────────────────────
function showSugestaoModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
        <div style="background:var(--card,#fff);border-radius:16px;padding:28px 24px;width:100%;max-width:440px;box-shadow:0 24px 64px rgba(0,0,0,.3)">
            <h2 style="font-size:17px;font-weight:700;color:var(--text,#1e293b);margin:0 0 6px">
                <i class="fa-solid fa-lightbulb" style="color:var(--accent,#2563eb)"></i> Enviar sugestão
            </h2>
            <p style="font-size:13px;color:var(--muted,#64748b);margin:0 0 18px">Tem alguma ideia ou melhoria? Conta pra gente!</p>
            <textarea id="sugestaoTxt" rows="5" placeholder="Descreva sua sugestão..."
                style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e2e8f0);border-radius:10px;font-size:14px;resize:vertical;box-sizing:border-box;background:var(--bg,#f8fafc);color:var(--text,#1e293b);font-family:inherit"></textarea>
            <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end">
                <button id="sugestaoCancel" style="padding:10px 18px;border:1.5px solid var(--border,#e2e8f0);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;background:transparent;color:var(--text,#1e293b)">Cancelar</button>
                <button id="sugestaoSend" style="padding:10px 20px;background:linear-gradient(135deg,var(--accent,#2563eb),var(--accent-dk,#1d4ed8));color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">
                    <i class="fa-solid fa-paper-plane"></i> Enviar
                </button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('sugestaoCancel').addEventListener('click', () => overlay.remove());
    document.getElementById('sugestaoSend').addEventListener('click', () => {
        const txt = document.getElementById('sugestaoTxt').value.trim();
        if (!txt) { showToast('Escreva sua sugestão antes de enviar.', 'warning'); return; }

        const empresa   = state.empresa?.nome || 'desconhecida';
        const empresaId = state.empresa?.id   || '';
        const userEmail = state.user?.email   || '';
        const userName  = document.getElementById('headerUserName')?.textContent || '';

        const btn = document.getElementById('sugestaoSend');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

        try {
            await addDoc(collection(db, 'sugestoes'), {
                texto:      txt,
                empresa:    empresa,
                empresaId:  empresaId,
                userName:   userName,
                userEmail:  userEmail,
                lida:       false,
                ts:         serverTimestamp(),
            });
        } catch(e) {
            showToast('Erro ao enviar sugestão. Tente novamente.', 'danger');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar';
            return;
        }

        overlay.remove();
        showToast('Sugestão enviada! Obrigado pelo feedback.');
    });
}

document.getElementById('sugestaoBtn').addEventListener('click', showSugestaoModal);

// Expose navigate globally for inline button handlers
window.navigate = navigate;
