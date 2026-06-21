# FrotaControl — Documentação do Projeto

## Visão Geral
SaaS de gestão de frota empresarial. Multi-tenant: cada empresa tem dados isolados no Firestore.

**URL produção:** https://frotacontrol.api.br  
**URL Firebase:** https://frota-empresa-a8202.web.app  
**Stack:** Firebase Hosting + Firestore + Auth (SDK 10.12.0 ES modules CDN) + Cloud Functions (Node.js)

---

## Deploy

```bash
firebase deploy --only hosting          # só frontend
firebase deploy --only functions        # só backend
firebase deploy --only hosting,functions  # tudo
firebase deploy --only hosting,firestore:rules  # hosting + regras
```

> Sempre incrementar a versão do service worker em `sw.js` a cada deploy de hosting.  
> Versão atual: `frotacontrol-v116`

> **ATENÇÃO — memória:** a máquina tem 4 GB de RAM. Fechar o VSCode antes de rodar `firebase deploy`, senão dá "Falha ao inicializar o thread". Rodar o deploy direto no terminal do Windows.

---

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `assets/js/app.js` | SPA principal (~7000 linhas) |
| `assets/js/config.js` | Marca, MercadoPago, trial |
| `assets/css/style.css` | Estilos globais |
| `sw.js` | Service worker (cache PWA) |
| `functions/index.js` | Cloud Functions |
| `functions/.env` | Credenciais (MP_ACCESS_TOKEN, EMAIL etc.) |
| `index.html` | App principal (SPA shell) |
| `landing.html` | Landing page pública |
| `signup.html` | Cadastro de nova empresa |
| `login.html` | Login |
| `planos.html` | Planos e checkout MercadoPago |
| `sucesso.html` | Pós-pagamento |
| `admin-planos.html` | Painel superadmin — planos |
| `admin-logs.html` | Painel superadmin — logs |
| `tracker.html` | GPS sender (abre no celular do motorista) |
| `rastreio.html` | Mapa ao vivo (gestor visualiza) |
| `motorista.html` | Portal do motorista |

---

## Configuração (config.js)

```js
superadminEmail: 'rbeto45@gmail.com'
supportWhatsApp: '5511974678968'
trialDays:       14
palette:         'blue'  // blue | green | purple | red | teal
mpPublicKey:     'APP_USR-03fbdd56-c7c4-4d90-80f6-2285870cc816'
```

---

## MercadoPago

- **Modo:** Checkout Pro (`/checkout/preferences`) — funciona sem conta MP
- **Public Key:** `APP_USR-03fbdd56-c7c4-4d90-80f6-2285870cc816` (config.js)
- **Access Token:** em `functions/.env` → `MP_ACCESS_TOKEN`
- **Webhook:** `https://us-central1-frota-empresa-a8202.cloudfunctions.net/mpWebhook`
- **Retorno sucesso:** `https://frotacontrol.api.br/sucesso.html`
- **Retorno falha:** `https://frotacontrol.api.br/planos.html`
- O dono da conta MP não pode pagar para si mesmo — testar com aba anônima

## Planos e preços

| Plano | Preço | Veículos | Motoristas |
|---|---|---|---|
| Trial | grátis 14 dias | 3 | 5 |
| Básico | R$79/mês | 10 | 20 |
| Profissional | R$149/mês | 30 | 100 |
| Empresarial | R$299/mês | ilimitado | ilimitado |

Campo `plano` na coleção `empresas`: `trial` → `pendente` → `basico/profissional/empresarial`  
Campo `planoExpiraEm`: Timestamp 30 dias após pagamento aprovado  
Campo `trialExpira`: Timestamp 14 dias após cadastro

---

## Cloud Functions

| Função | Tipo | Descrição |
|---|---|---|
| `criarAssinatura` | onCall | Cria preferência de pagamento MP |
| `mpWebhook` | onRequest | Recebe webhook MP, ativa plano |
| `atualizarCartao` | onCall | Atualiza cartão de assinatura MP |
| `lembreteRenovacao` | scheduled | Envia e-mail de lembrete 7 e 3 dias antes de vencer |
| `bemVindo` | Firestore onCreate | E-mail de boas-vindas quando empresa é criada |
| `gps` | onRequest | Recebe localização de dispositivos GPS físicos |
| `deleteAuthUser` | onCall | Deleta usuário do Firebase Auth (só admin) |
| `consultarMultas` | onCall | Consulta multas via Infosimples API |

---

## Módulos do app (navegação via `navigate()`)

- `dashboard` — painel principal com clima, alertas, ações rápidas
- `vehicles` / `veiculos` — cadastro e gestão de veículos
- `drivers` / `motoristas` — cadastro de motoristas
- `usage` / `utilizacoes` — controle de saídas e devoluções
- `fuel` / `abastecimentos` — abastecimentos
- `maintenance` / `manutencoes` — manutenções
- `fines` / `multas` — multas
- `schedules` / `escalas` — escalas de motoristas
- `map` — mapa de rastreamento ao vivo
- `reports` — relatórios
- `settings` — configurações da empresa
- `usuarios` — gestão de usuários

---

## Perfis de usuário

| Perfil | Acesso |
|---|---|
| `superadmin` | Tudo + painel admin |
| `admin` | Tudo da empresa |
| `gerente` | Edita, não gerencia usuários |
| `visualizador` | Só leitura |

Dono da plataforma: `rbeto45@gmail.com` com perfil `superadmin`

---

## Categorias de veículo

- `empresa` — frota da empresa (visível para todos)
- `pessoal` — veículo pessoal do gestor (visível só para admin/superadmin)
- `locado` — veículo alugado
- `terceiro` — veículo de terceiros

Helper `getVisibleVehicles()` centraliza o filtro em todo o app.

---

## Dark Mode

- Toggle `#darkToggle` no header (ícone lua/sol)
- Classe `html.dark` adicionada ao `<html>` (não ao `body`) para evitar FOUC
- Script inline no `<head>` do `index.html` aplica antes de renderizar:
  ```html
  <script>if(localStorage.getItem('frotaDark')==='1')document.documentElement.classList.add('dark');</script>
  ```
- Persistência: `localStorage` chave `frotaDark` (`'1'` = escuro, `'0'` = claro)
- Variáveis CSS sobrescritas em `html.dark`: `--bg`, `--card`, `--border`, `--text`, `--muted`, `--shadow`, `--shadow-md`
- No mobile, o header tem gradiente escuro — o ícone usa `color: rgba(255,255,255,.85)` via `@media (max-width: 768px)`
- Dark mode e paleta de cor (blue/green/purple etc.) são sistemas independentes — paleta muda `--primary`/`--accent`, dark mode muda `--bg`/`--card`/`--text`

---

## Relatórios (`renderReports`)

Abas disponíveis (`reportType`):

| Tipo | Descrição |
|---|---|
| `usage` | Utilizações — filtro por período, veículo, motorista, status |
| `fines` | Multas — filtro por período, veículo, motorista, status |
| `vehicles` | Resumo por veículo — usos, KM, multas |
| `drivers` | Resumo por motorista — usos, KM, multas, validade CNH |
| `costs` | Custos mensais — combustível + manutenção (últimos 6 meses, gráfico de barras) |
| `custos-veiculo` | **Custo total por veículo** — combustível + manutenção + multas, filtro por período, R$/km, exporta CSV e PDF |

Variáveis de estado do módulo: `reportType`, `reportDateFrom`, `reportDateTo`, `reportVid`, `reportMid`, `reportStatus`

### Custo por Veículo (`custos-veiculo`)
- Agrega `abastecimentos.valorTotal` + `manutencoes.custo` + `multas.valor` por veículo
- Filtra por `data` (abastecimentos/manutenções) e `dataInfracao` (multas) no intervalo selecionado
- Calcula `custoPorKm = total / totalKm` usando utilizações com kmFinal
- Ordena do veículo mais caro para o mais barato
- Linha de totais no rodapé da tabela

---

## Rastreamento GPS

- **`tracker.html`** — abre no celular do motorista, envia localização via Firestore
- **`rastreio.html`** — mapa ao vivo para o gestor
- Botão "Enviar Rastreio" nos cards de utilização ativa → gera link WhatsApp para motorista
- Marcador animado no mapa: SVG top-view do carro, rotaciona pelo bearing, verde = em movimento, azul = parado
- Coleção Firestore: `rastreios/{utilizacaoId}`

### GPS físico (planejado — hardware não comprado)
- Dispositivo: LILYGO T-SIM7600G-H ou T-A7670G (ESP32 + 4G + GPS)
- Firmware ESP32 escreve em `rastreios/{deviceId}` no Firestore
- Endpoint: `https://us-central1-frota-empresa-a8202.cloudfunctions.net/gps`
- Atualiza KM do veículo automaticamente ao finalizar trajeto

---

## Widget de clima (dashboard)

- Usa `navigator.geolocation` para pegar localização real do usuário
- Reverse geocoding via Nominatim (OpenStreetMap) para nome da cidade
- Fallback: IP geolocation via `ipapi.co` se permissão negada
- Dados meteorológicos: Open-Meteo API (grátis, sem chave)
- Mostra: temperatura, sensação térmica, umidade, vento, condição

---

## Widget de plano (sidebar)

- `#planWidget` — sempre visível no rodapé da sidebar
- Mostra nome do plano + dias restantes / contagem regressiva
- Últimos 7 dias: contagem regressiva em tempo real
- Últimas 48h: vermelho
- Banner superior (`#safetyBanner`) nos últimos 7 dias e quando vencido

---

## Onboarding

- Modal aparece para empresas criadas nos últimos 7 dias (verifica `criadoEm`)
- Controle via `localStorage`: chave `onboardingVisto_{empresaId}`
- Mostra 4 passos: veículos → motoristas → utilização → GPS
- Botão principal navega direto para cadastro de veículos

---

## Alertas de manutenção

- Por KM: alerta quando faltam ≤ 1000 km para próxima manutenção
- Por data: alerta quando `dataProxima` vence em ≤ 15 dias
- De-duplicado por veículo+tipo (só o mais recente por combinação)
- Auto-sugestão de `dataProxima` ao selecionar tipo de manutenção

---

## Rodízio

Cidades suportadas: São Paulo, Campinas, Santos, Sorocaba, BH, Curitiba, Goiânia, Brasília  
Restrição por último dígito da placa, dias úteis.  
Aparece no dashboard quando há veículos restritos no dia atual.

---

## Logs de atividade

- Coleção `logs` gravada pelo app.js em: login, criou, editou, excluiu
- Módulos logados: `LOG_MODULES` (veiculos, motoristas, utilizacoes, multas, abastecimentos, manutencoes, escalas, dispositivos)
- `admin-logs.html` — filtros por empresa/módulo/data, exportação CSV
- Regras Firestore: autenticados gravam, só superadmin lê

---

## Notificações superadmin

- **ntfy.sh** — push notifications via tópico `frotacontrol-rbeto`
- **CallMeBot** — WhatsApp automático (chave em `config.js → callmebotApiKey`)
- Disparadas em: novo cadastro, pagamento aprovado, lembrete de renovação

---

## Melhorias futuras planejadas

- [ ] Pagamento recorrente com MercadoPago Preapproval (assinaturas automáticas)
- [ ] OBD2 — monitorar dados do motor em tempo real
  - Opção 1 (simples): Adaptador ELM327 Bluetooth ~R$40 + celular + Web Bluetooth API
  - Opção 2 (robusta): ESP32 + OBD2 + chip 4G instalado permanentemente no carro
- [ ] Checklist de vistoria antes da saída (com fotos)
- [x] Relatório de custo total por veículo (combustível + manutenção + multas) — implementado em `custos-veiculo`
- [ ] Agendamento de veículos / calendário de disponibilidade
- [ ] Controle de documentos com alerta de vencimento (IPVA, licenciamento, seguro)
- [ ] Painel superadmin com métricas de negócio (MRR, clientes ativos, churn)
- [ ] Link de indicação com trial estendido

---

## Atenção — bugs conhecidos

- Funções duplicadas em app.js causam SyntaxError silencioso que trava o loading screen
- Sempre verificar se uma função já existe antes de adicionar nova com mesmo nome
