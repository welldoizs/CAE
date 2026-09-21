(() => {
  'use strict';

  const SUPABASE_URL = 'https://kigljplotmlzeiivrymq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_sS5QFRQeYl1uJXXzfyJdxw_ZjVO3vn4';

  // Para login/senha, o Pen funciona normalmente no preview. Para links de e-mail
  // do Supabase, prefira o Debug/Preview direto do CodePen. Se necessário, coloque
  // aqui a URL https direta do seu Pen; deixando vazio, o código usa a página atual.
  const CODEPEN_AUTH_REDIRECT_URL = '';

  const TABLE = Object.freeze({
    profiles: 'cae_profiles',
    chat: 'cae_chat_messages',
    reports: 'cae_chat_reports',
    vents: 'cae_vents',
    posts: 'cae_posts',
    reactions: 'cae_post_reactions',
    announcements: 'cae_announcements',
    events: 'cae_events',
    polls: 'cae_polls',
    pollOptions: 'cae_poll_options',
    pollVotes: 'cae_poll_votes',
    logs: 'cae_admin_logs'
  });

  const AUDIO_BUCKET = 'cae-audios';
  // O CAE aceita somente contas com o domínio institucional definido aqui.
  const SCHOOL_EMAIL_DOMAIN = '@escola';

  const GUIDED_QUESTIONS = [
    'O que aconteceu hoje?',
    'Como isso fez você se sentir?',
    'O que está sendo mais difícil neste momento?',
    'O que você gostaria que alguém entendesse?'
  ];

  const FEELINGS = [
    'Não tenho vontade de conversar com ninguém',
    'Estou cansado de fingir que está tudo bem',
    'Estou preocupado com alguma coisa',
    'Estou irritado e não sei exatamente por quê',
    'Aconteceu alguma coisa e não consigo parar de pensar nisso',
    'Só queria que alguém me ouvisse'
  ];

  const REACTIONS = [['❤️', 'heart'], ['👍', 'like'], ['🤝', 'support']];

  const state = {
    supabase: null,
    user: null,
    profile: null,
    session: null,
    realtime: null,
    currentView: 'home-view',
    currentPanel: 'announcements',
    initialized: false,
    hydrating: false,
    guidedIndex: 0,
    guidedAnswers: [],
    selectedFeeling: null,
    recorder: null,
    recordingChunks: [],
    audioBlob: null,
    audioMime: '',
    audioObjectUrl: null,
    lastHydratedAccessToken: null,
    chatLoading: false,
    profileCache: new Map(),
    muralLoading: false,
    muralQueued: false,
    pendingChatRulesResolve: null,
    lastSignupEmail: ''
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const isStaff = () => ['admin', 'moderator'].includes(state.profile?.role);

  const escapeHTML = (value) => {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  };

  const makeId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const fallbackPublicId = (userId) => {
    const compact = String(userId || '').replaceAll('-', '').slice(0, 10).toUpperCase();
    return `Estudante${compact || '0000000000'}`;
  };

  const publicTagFromProfile = (profile, userId = '') => {
    const value = String(profile?.public_id || '').trim();
    return `#${(value || fallbackPublicId(userId)).replace(/^#/, '')}`;
  };

  const publicTagForUser = (userId) => {
    const cached = state.profileCache.get(userId);
    if (cached?.public_id) return `#${String(cached.public_id).replace(/^#/, '')}`;
    if (userId === state.user?.id && state.profile?.public_id) return publicTagFromProfile(state.profile, userId);
    return `#${fallbackPublicId(userId)}`;
  };

  async function preloadPublicProfiles(userIds) {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    const missing = ids.filter(id => !state.profileCache.has(id));
    if (!missing.length || !state.supabase) return;
    try {
      const { data, error } = await state.supabase.rpc('cae_get_public_profiles', { p_user_ids: missing });
      if (error) throw error;
      (data || []).forEach(profile => state.profileCache.set(profile.user_id, profile));
    } catch (error) {
      console.warn('PUBLIC PROFILES', error);
      missing.forEach(id => {
        if (!state.profileCache.has(id)) state.profileCache.set(id, { user_id: id, public_id: fallbackPublicId(id) });
      });
    }
  }

  const initials = (name) => String(name || 'CA').replace('Estudante #', '').replace('#Estudante', '').slice(0, 2) || 'CA';

  const validEmail = (email) => /^[^\s@]+@[^\s@]+$/.test(String(email || ''));
  const validSchoolEmail = (email) => {
    const normalized = String(email || '').trim().toLowerCase();
    return validEmail(normalized) && normalized.endsWith(SCHOOL_EMAIL_DOMAIN);
  };
  const schoolEmailMessage = `Use seu e-mail escolar terminando em ${SCHOOL_EMAIL_DOMAIN}.`;

  const formatDate = (value) => {
    try {
      return value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    } catch {
      return String(value || '');
    }
  };

  const formatDateOnly = (value) => {
    try {
      return value ? new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR') : '';
    } catch {
      return String(value || '');
    }
  };

  const getField = (row, keys, fallback = '') => {
    for (const key of keys) {
      if (row && row[key] !== undefined && row[key] !== null) return row[key];
    }
    return fallback;
  };

  const errorMessage = (error) => {
    const raw = String(error?.message || error?.error_description || error?.details || error || 'Ocorreu um erro.');
    if (/CAE_USER_BANNED/i.test(raw)) return 'Esta conta está bloqueada pela moderação.';
    if (/CAE_USER_TIMEOUT/i.test(raw)) return 'Sua conta está em timeout e não pode enviar mensagens até o prazo terminar.';
    if (/CAE_CHAT_LOW_VALUE/i.test(raw)) return 'A mensagem parece automática/genérica demais para o chat. Escreva de forma mais direta e pessoal.';
    if (/CAE_CHAT_BLOCKED/i.test(raw)) return 'Essa mensagem não pode ser enviada pelo filtro automático do CAE.';
    if (/CAE_CHAT_SPAM/i.test(raw)) return 'Evite repetir mensagens ou enviar muitas mensagens seguidas. Aguarde um pouco.';
    if (/CAE_CHAT_TOO_LONG/i.test(raw)) return 'A mensagem é longa demais.';
    if (/PROFILE_NOT_FOUND/i.test(raw)) return 'A conta existe, mas seu perfil do CAE ainda não foi criado. Faça login uma vez e tente novamente.';
    if (/TARGET_USER_NOT_FOUND/i.test(raw)) return 'Nenhuma conta foi encontrada com esse ID público.';
    if (/SELF_MODERATION_NOT_ALLOWED/i.test(raw)) return 'Você não pode aplicar essa ação na própria conta.';
    if (/ONLY_ADMIN/i.test(raw)) return 'Somente administradores podem alterar cargos.';
    if (/INVALID_ROLE/i.test(raw)) return 'Cargo inválido.';
    if (/INVALID_MODERATION_ACTION/i.test(raw)) return 'Ação de moderação inválida.';
    if (/INVALID_TIMEOUT/i.test(raw)) return 'Escolha um timeout entre 1 minuto e 7 dias.';
    if (/invalid login credentials/i.test(raw)) return 'E-mail ou senha incorretos.';
    if (/email not confirmed/i.test(raw)) return 'Confirme seu e-mail antes de entrar.';
    if (/already registered|user already registered/i.test(raw)) return 'Este e-mail já possui uma conta.';
    if (/password.*6|at least 6/i.test(raw)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/rate limit|too many requests/i.test(raw)) return 'Você está enviando muito rápido. Aguarde alguns segundos.';
    if (/row-level security|rls|not allowed|permission denied/i.test(raw)) return 'O banco bloqueou essa ação. Verifique as políticas RLS do CAE.';
    if (/relation .* does not exist|table .* does not exist/i.test(raw)) return 'Uma tabela do CAE ainda não existe no Supabase.';
    if (/column .* does not exist/i.test(raw)) return 'Uma coluna do CAE está diferente do esperado no Supabase.';
    if (/desabafo hoje/i.test(raw)) return 'Você já enviou um desabafo hoje.';
    if (/cae_poll_votes_one_per_user|duplicate key.*poll/i.test(raw)) return 'Você já votou nessa enquete.';
    if (/cae_post_reactions|duplicate key/i.test(raw)) return 'Essa reação já está registrada.';
    if (/failed to fetch|networkerror|load failed|err_name_not_resolved|name_not_resolved|dns|502|bad gateway|503|service unavailable|504|gateway timeout/i.test(raw)) return 'O CAE não conseguiu alcançar o servidor do Supabase. Confirme se o Project URL é exatamente https://kigljplotmlzeiivrymq.supabase.co e se o projeto está ativo.';
    if (/project.*paused|paused.*project|540/i.test(raw)) return 'O projeto do Supabase está pausado. Abra o projeto no Dashboard e clique em Resume project para reativá-lo.';
    return raw;
  };

  // Filtro do chat: a lista cobre palavrões, insultos e abreviações comuns em PT-BR.
  // O filtro é propositalmente conservador no chat público; desabafos privados seguem
  // para moderação humana em vez de serem alterados automaticamente.
  const CHAT_REDACT_TERMS = [
    'merda','porra','caralho','puta','puto','putinha','vadia','vagabunda','vagabundo',
    'babaca','otario','otaria','idiota','imbecil','burro','burra','jumento','retardado',
    'retardada','desgracado','desgracada','arrombado','arrombada','fdp','filhodaputa',
    'filho da puta','filho de puta','piranha','cuzão','cusao','cuzao','cuzona','corno',
    'corna','escroto','escrota','nojento','nojenta','safado','safada','canalha',
    'desgraça','desgraca','cacete','foda','fodase','foda-se','vai se foder','vai tomar no cu',
    'tomar no cu','vai pra puta que pariu','puta que pariu','buceta','boceta','xoxota',
    'xereca','xota','piroca','pica','pau no cu','rola','porra','gozar','gozada',
    'viado','viadao','veado','bicha','traveco','marica','maricas','sapatão','sapatao',
    'cracker','macaco','preto imundo','negro imundo','judeu imundo','mulherzinha',
    'nazi','nazista','hitler','heil hitler','white power','kkk'
  ];
  const CHAT_REDACT_PATTERNS = CHAT_REDACT_TERMS
    .sort((a,b)=>b.length-a.length)
    .map(term => new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`, 'giu'));
  const CHAT_HARD_BLOCK_PATTERNS = [
    /\b(?:manda|mand[a-z]*|envia|enviarem)\s+(?:foto|nudes?|pack)\b/i,
    /\b(?:nudes?|pack)\s+(?:gratis|gr[aá]tis|pra mim|para mim)\b/i,
    /\b(?:sexo|transa|ficar)\s+(?:comigo|escondido|escondida)\b/i,
    /\b(?:vou|vamos)\s+(?:te )?(?:matar|estuprar|machucar|bater)\b/i,
    /\b(?:meu|minha)\s+(?:endereço|telefone|senha)\b/i
  ];
  const CHAT_AI_FILLER_PATTERNS = [
    /como uma intelig[eê]ncia artificial/i,/como modelo de linguagem/i,/sou uma ia\b/i,
    /texto gerado por ia/i,/aqui est[aá] uma resposta/i,/é importante ressaltar/i,
    /em suma/i,/em conclus[aã]o/i,/neste contexto/i,/espero que (?:isso|esta resposta) ajude/i,
    /caros leitores/i,/conclus[aã]o:/i
  ];

  function normalizeModerationText(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[4@]/g,'a').replace(/[3]/g,'e').replace(/[1!|]/g,'i')
      .replace(/[0]/g,'o').replace(/[5$]/g,'s').replace(/[7]/g,'t')
      .replace(/(.)\\1{2,}/g,'$1')
      .replace(/[^a-z0-9!?\\s]/gi, ' ')
      .replace(/\\s+/g, ' ').trim();
  }

  function moderateChatText(rawBody) {
    let text = String(rawBody || '').trim();
    const normalized = normalizeModerationText(text);
    if (!normalized) return { blocked: true, reason: 'Escreva uma mensagem antes de enviar.' };
    if (CHAT_HARD_BLOCK_PATTERNS.some(pattern => pattern.test(text))) {
      return { blocked: true, reason: 'Essa mensagem não pode ser enviada pelo filtro automático do CAE.' };
    }
    const normalizedTerms = CHAT_REDACT_TERMS.some(term => {
      const normalizedTerm = normalizeModerationText(term);
      if (!normalizedTerm) return false;
      return normalizedTerm.includes(' ')
        ? normalized.includes(` ${normalizedTerm} `) || normalized.startsWith(`${normalizedTerm} `) || normalized.endsWith(` ${normalizedTerm}`)
        : normalized.split(/\s+/).includes(normalizedTerm);
    });
    if (normalizedTerms) {
      for (const pattern of CHAT_REDACT_PATTERNS) text = text.replace(pattern, '###');
      // Também limpa formas simples de evasão do filtro.
      const normalizedAgain = normalizeModerationText(text);
      if (CHAT_REDACT_TERMS.some(term => {
        const t = normalizeModerationText(term);
        if (!t) return false;
        return t.includes(' ')
          ? normalizedAgain.includes(` ${t} `) || normalizedAgain.startsWith(`${t} `) || normalizedAgain.endsWith(` ${t}`)
          : normalizedAgain.split(/\s+/).includes(t);
      })) {
        return { blocked: true, reason: 'Essa mensagem contém linguagem que não é permitida no chat do CAE.' };
      }
    }

    const fillerScore = CHAT_AI_FILLER_PATTERNS.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
    const personalCue = /\b(eu|meu|minha|meus|minhas|sinto|sent[ií]|estou|t[oô]|hoje|aconteceu|comigo|pra mim|para mim|acho|penso)\b/i.test(text);
    if (text.length >= 180 && fillerScore >= 3 && !personalCue) {
      return { blocked: true, reason: 'Essa mensagem parece texto automático/genérico demais para o chat. Escreva de forma mais direta ou conte o que está acontecendo com você.' };
    }

    for (const pattern of CHAT_REDACT_PATTERNS) text = text.replace(pattern, '###');
    const visibleChars = text.replace(/[^\p{L}\p{N}]+/gu, '').length;
    const hashCount = (text.match(/#/g) || []).length;
    if (visibleChars === 0 || (hashCount > 0 && hashCount / Math.max(1, text.length) > 0.75)) {
      return { blocked: true, reason: 'A mensagem foi bloqueada porque o conteúdo não ficou adequado para o chat.' };
    }
    return { blocked: false, text, redacted: text !== rawBody };
  }

  function chatRulesNeverAgain() {
    try { return localStorage.getItem('cae_chat_rules_never_again_v1') === '1'; } catch { return false; }
  }

  function openChatRulesModal() {
    const modal = $('chat-rules-modal');
    if (!modal) return Promise.resolve(true);
    if (chatRulesNeverAgain()) return Promise.resolve(true);
    $('chat-rules-never').checked = false;
    setStatus('chat-rules-status', '');
    modal.classList.remove('hidden');
    return new Promise(resolve => { state.pendingChatRulesResolve = resolve; });
  }

  function finishChatRules(accepted) {
    const modal = $('chat-rules-modal');
    const resolve = state.pendingChatRulesResolve;
    state.pendingChatRulesResolve = null;
    if (accepted && $('chat-rules-never')?.checked) {
      try { localStorage.setItem('cae_chat_rules_never_again_v1', '1'); } catch { /* armazenamento pode estar bloqueado */ }
    }
    modal?.classList.add('hidden');
    resolve?.(accepted);
  }

  async function requireChatRules() {
    return await openChatRulesModal();
  }

  function loadExternalScript(src, isReady) {
    if (isReady()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === src);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureDependencies() {
    try {
      await loadExternalScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', () => Boolean(window.supabase?.createClient));
      await loadExternalScript('https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js', () => Boolean(window.lucide?.createIcons));
      return true;
    } catch (error) {
      console.error('DEPENDENCIES', error);
      setStatus('login-status', 'Não foi possível carregar as bibliotecas do CAE. Verifique sua conexão com a internet e tente novamente.');
      return false;
    }
  }

  function refreshIcons() {
    try { window.lucide?.createIcons?.(); } catch (error) { console.warn('LUCIDE', error); }
  }

  function setStatus(id, message, type = 'error') {
    const el = $(id);
    if (!el) return;
    if (!message) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="message ${type === 'ok' ? 'ok' : 'error'}">${escapeHTML(message)}</div>`;
  }

  function toast(message, type = 'ok') {
    let stack = $('cae-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'cae-toast-stack';
      stack.className = 'cae-toast-stack';
      document.body.appendChild(stack);
    }
    const item = document.createElement('div');
    item.className = `cae-toast ${type === 'error' ? 'error' : ''}`;
    item.innerHTML = `<span>${escapeHTML(message)}</span><button type="button" aria-label="Fechar">×</button>`;
    item.querySelector('button').addEventListener('click', () => item.remove());
    stack.appendChild(item);
    window.setTimeout(() => item.remove(), 5000);
  }

  function setBusy(button, busy, busyText = 'Aguarde...') {
    if (!button) return;
    if (busy) {
      if (!button.dataset.normalHTML) button.dataset.normalHTML = button.innerHTML;
      button.disabled = true;
      button.textContent = busyText;
      button.setAttribute('aria-busy', 'true');
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.normalHTML) button.innerHTML = button.dataset.normalHTML;
      refreshIcons();
    }
  }

  function showAuth() {
    document.body.classList.add('auth-mode');
    $('auth-screen')?.classList.remove('hidden');
    $('app')?.classList.add('hidden');
  }

  function showApp() {
    document.body.classList.remove('auth-mode');
    $('auth-screen')?.classList.add('hidden');
    $('app')?.classList.remove('hidden');
  }

  function ensureClient() {
    if (state.supabase) return true;
    if (!window.supabase?.createClient) {
      setStatus('login-status', 'A biblioteca do Supabase não carregou. Verifique a conexão com a internet.');
      return false;
    }
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      setStatus('login-status', 'A configuração do Supabase está incompleta.');
      return false;
    }
    try {
      state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
      });
      return true;
    } catch (error) {
      console.error('SUPABASE INIT', error);
      setStatus('login-status', `Não foi possível iniciar o Supabase: ${errorMessage(error)}`);
      return false;
    }
  }

  function currentRedirect() {
    const configured = CODEPEN_AUTH_REDIRECT_URL.trim();
    if (configured) return configured;
    return window.location.href.split('#')[0];
  }

  function todayStartISO() {
    // O limite diário do CAE segue o dia civil de São Paulo (UTC-3).
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return new Date(`${values.year}-${values.month}-${values.day}T03:00:00.000Z`).toISOString();
  }

  async function loadProfile() {
    const { data, error } = await state.supabase.from(TABLE.profiles).select('id,display_name,public_id,role,is_banned,timeout_until').eq('id', state.user.id).maybeSingle();
    if (error) throw error;

    if (data) {
      state.profile = data;
    } else {
      const { data: created, error: createError } = await state.supabase
        .from(TABLE.profiles)
        .insert({ id: state.user.id, display_name: 'Estudante', role: 'student' })
        .select('id,display_name,public_id,role,is_banned,timeout_until')
        .single();
      if (createError) {
        if (createError.code === '23505') {
          const { data: existing, error: existingError } = await state.supabase
            .from(TABLE.profiles)
            .select('id,display_name,public_id,role,is_banned,timeout_until')
            .eq('id', state.user.id)
            .maybeSingle();
          if (existingError) throw existingError;
          if (!existing) throw createError;
          state.profile = existing;
        } else {
          throw createError;
        }
      } else {
        state.profile = created;
      }
    }

    // Campos de moderação são opcionais até a migração SQL ser aplicada.
    // Assim o CAE continua abrindo enquanto o banco ainda estiver na estrutura antiga.
    try {
      const { data: moderation } = await state.supabase.from(TABLE.profiles).select('is_banned,timeout_until').eq('id', state.user.id).maybeSingle();
      if (moderation) Object.assign(state.profile, moderation);
    } catch (error) {
      console.warn('PROFILE MODERATION FIELDS', error);
      state.profile.is_banned = Boolean(state.profile.is_banned);
      state.profile.timeout_until = state.profile.timeout_until || null;
    }

    const name = state.profile.display_name || publicName(state.user.id);
    if ($('account-name')) $('account-name').textContent = name;
    state.profile.public_id = state.profile.public_id || fallbackPublicId(state.user.id);
    state.profileCache.set(state.user.id, state.profile);
    if ($('account-public-id')) $('account-public-id').textContent = `Seu ID público: ${publicTagFromProfile(state.profile, state.user.id)}`;
    if ($('account-email')) $('account-email').textContent = state.user.email || '';
    if ($('account-avatar')) $('account-avatar').textContent = initials(name);
    $('nav-admin')?.classList.toggle('hidden', !isStaff());

    if (state.profile.is_banned) {
      setStatus('login-status', 'Esta conta foi bloqueada pela moderação.');
      return false;
    }
    if (state.profile.timeout_until && new Date(state.profile.timeout_until) > new Date()) {
      toast(`Você está em timeout até ${formatDate(state.profile.timeout_until)}. O chat ficará bloqueado até lá.`, 'error');
    }
    return true;
  }

  function isEmailConfirmed(user) {
    return Boolean(user?.email_confirmed_at || user?.confirmed_at);
  }

  function showConfirmationNeeded(email = '') {
    state.lastSignupEmail = email || state.lastSignupEmail || '';
    setStatus('signup-status', 'Cadastro quase pronto. Confirme seu e-mail pelo link que enviamos antes de entrar no CAE.', 'ok');
    $('resend-confirmation')?.classList.toggle('hidden', !state.lastSignupEmail);
  }

  async function resendConfirmation() {
    const email = (state.lastSignupEmail || $('signup-email')?.value || '').trim().toLowerCase();
    if (!validEmail(email)) return toast('Digite o e-mail usado no cadastro.', 'error');
    try {
      const { error } = await state.supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: currentRedirect() } });
      if (error) throw error;
      toast('Novo e-mail de confirmação enviado.');
    } catch (error) {
      console.error('RESEND CONFIRMATION', error);
      toast(errorMessage(error), 'error');
    }
  }

  function setAuthMode(mode) {
    const login = mode === 'login';
    $('login-form')?.classList.toggle('hidden', !login);
    $('signup-form')?.classList.toggle('hidden', login);
    $('auth-tab-login')?.classList.toggle('active', login);
    $('auth-tab-signup')?.classList.toggle('active', !login);
    $('resend-confirmation')?.classList.toggle('hidden', login || !state.lastSignupEmail);
    setStatus('login-status', '');
    setStatus('signup-status', '');
  }

  async function login(event) {
    event.preventDefault();
    if (!ensureClient()) return;
    const email = $('login-email')?.value.trim().toLowerCase();
    const password = $('login-password')?.value || '';
    if (!validSchoolEmail(email)) return setStatus('login-status', schoolEmailMessage);
    if (!password) return setStatus('login-status', 'Digite sua senha.');

    const button = $('login-button');
    setBusy(button, true, 'Entrando...');
    try {
      const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user || !data.session) throw new Error('O login não retornou uma sessão válida.');
      if (!isEmailConfirmed(data.user)) {
        await state.supabase.auth.signOut();
        return setStatus('login-status', 'Confirme seu e-mail antes de entrar no CAE.');
      }
      state.user = data.user;
      state.session = data.session;
      $('login-password').value = '';
      await hydrateSession(data.session);
    } catch (error) {
      console.error('LOGIN', error);
      setStatus('login-status', errorMessage(error));
    } finally { setBusy(button, false); }
  }

  async function signup(event) {
    event.preventDefault();
    if (!ensureClient()) return;
    const email = $('signup-email')?.value.trim().toLowerCase();
    const password = $('signup-password')?.value || '';
    if (!validSchoolEmail(email)) return setStatus('signup-status', schoolEmailMessage);
    if (password.length < 6) return setStatus('signup-status', 'A senha precisa ter pelo menos 6 caracteres.');

    const button = $('signup-button');
    setBusy(button, true, 'Criando...');
    try {
      const { data, error } = await state.supabase.auth.signUp({ email, password, options: { emailRedirectTo: currentRedirect() } });
      if (error) throw error;
      state.lastSignupEmail = email;
      $('resend-confirmation')?.classList.remove('hidden');
      if (!isEmailConfirmed(data.user)) {
        showConfirmationNeeded(email);
        return;
      }
      if (data.user && data.session) {
        state.user = data.user;
        state.session = data.session;
        await hydrateSession(data.session);
      }
    } catch (error) {
      console.error('SIGNUP', error);
      setStatus('signup-status', errorMessage(error));
    } finally { setBusy(button, false); }
  }

  async function magicLogin() {
    if (!ensureClient()) return;
    const email = $('login-email')?.value.trim().toLowerCase();
    if (!validSchoolEmail(email)) return setStatus('login-status', schoolEmailMessage);
    const button = $('magic-button');
    setBusy(button, true, 'Enviando...');
    try {
      const { error } = await state.supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: currentRedirect() } });
      if (error) throw error;
      setStatus('login-status', 'Enviamos um link de acesso para seu e-mail.', 'ok');
    } catch (error) {
      console.error('MAGIC LINK', error);
      setStatus('login-status', errorMessage(error));
    } finally { setBusy(button, false); }
  }

  async function forgotPassword() {
    if (!ensureClient()) return;
    const email = $('login-email')?.value.trim().toLowerCase();
    if (!validSchoolEmail(email)) return setStatus('login-status', schoolEmailMessage);
    try {
      const { error } = await state.supabase.auth.resetPasswordForEmail(email, { redirectTo: currentRedirect() });
      if (error) throw error;
      setStatus('login-status', 'Confira seu e-mail para redefinir sua senha.', 'ok');
    } catch (error) {
      console.error('RESET PASSWORD', error);
      setStatus('login-status', errorMessage(error));
    }
  }

  function openPasswordModal() {
    $('password-modal')?.classList.remove('hidden');
    $('new-password')?.focus();
  }

  function closePasswordModal() {
    $('password-modal')?.classList.add('hidden');
    $('password-form')?.reset();
    setStatus('password-status', '');
  }

  async function submitPasswordRecovery(event) {
    event.preventDefault();
    const first = $('new-password')?.value || '';
    const second = $('new-password-confirm')?.value || '';
    if (first.length < 6) return setStatus('password-status', 'A senha precisa ter pelo menos 6 caracteres.');
    if (first !== second) return setStatus('password-status', 'As senhas não são iguais.');
    try {
      const { error } = await state.supabase.auth.updateUser({ password: first });
      if (error) throw error;
      closePasswordModal();
      toast('Senha alterada com sucesso.');
      if (state.user) await hydrateSession(state.session, true);
    } catch (error) {
      console.error('PASSWORD UPDATE', error);
      setStatus('password-status', errorMessage(error));
    }
  }

  async function logout() {
    try {
      if (state.realtime) {
        await state.supabase?.removeChannel(state.realtime);
        state.realtime = null;
      }
      await state.supabase?.auth.signOut();
    } catch (error) { console.warn('LOGOUT', error); }
    state.user = null;
    state.profile = null;
    state.session = null;
    state.lastHydratedAccessToken = null;
      state.lastHydratedAccessToken=null;
    closePasswordModal();
    showAuth();
    setAuthMode('login');
  }

  async function hydrateSession(session, force = false) {
    if (!session?.user || state.hydrating) return;
    if (!force && session.access_token && state.lastHydratedAccessToken === session.access_token) return;
    state.hydrating = true;
    try {
      state.session = session;
      state.user = session.user;
      if (!validSchoolEmail(session.user.email)) {
        await state.supabase.auth.signOut();
        setStatus('login-status', schoolEmailMessage);
        showAuth();
        return;
      }
      if (!isEmailConfirmed(session.user)) {
        await state.supabase.auth.signOut();
        setStatus('login-status', 'Confirme seu e-mail antes de entrar no CAE.');
        showAuth();
        return;
      }
      const allowed = await loadProfile();
      if (!allowed) {
        await state.supabase.auth.signOut();
        showAuth();
        return;
      }
      showApp();
      showView(state.currentView || 'home-view');
      prepareFeelings();
      await Promise.allSettled([loadChat(), loadMural(), loadHistory()]);
      subscribeRealtime();
      if (isStaff()) await loadAdmin();
      state.lastHydratedAccessToken = session.access_token || null;
      refreshIcons();
    } catch (error) {
      console.error('HYDRATE', error);
      toast(`A conta entrou, mas o carregamento teve um problema: ${errorMessage(error)}`, 'error');
      showApp();
      showView('home-view');
    } finally { state.hydrating = false; }
  }

  const VIEW_IDS = new Set([
    'home-view',
    'chat-view',
    'desabafo-view',
    'mural-view',
    'history-view',
    'help-view',
    'account-view',
    'admin-view'
  ]);

  function showView(id) {
    if (!state.user) return showAuth();
    if (!VIEW_IDS.has(id)) id = 'home-view';
    if (id === 'admin-view' && !isStaff()) id = 'home-view';

    $$('.view').forEach(view => view.classList.remove('active'));
    const next = $(id);
    if (!next) return;
    next.classList.add('active');
    state.currentView = id;
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === id));

    if (id === 'chat-view') loadChat();
    if (id === 'mural-view') loadMural();
    if (id === 'history-view') loadHistory();
    if (id === 'admin-view' && isStaff()) loadAdmin();

    refreshIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchMuralPanel(panel) {
    state.currentPanel = panel;
    $$('[data-panel]').forEach(button => button.classList.toggle('active', button.dataset.panel === panel));
    $$('.panel').forEach(el => el.classList.remove('active'));
    $(`panel-${panel}`)?.classList.add('active');
    if (state.user) loadMural();
  }

  function prepareFeelings() {
    const list = $('feelings-list');
    if (!list || list.dataset.ready === '1') return;
    list.dataset.ready = '1';
    list.innerHTML = FEELINGS.map(feeling => `
      <button class="option feeling-button" type="button" data-feeling="${escapeHTML(feeling)}">
        <i data-lucide="heart"></i><span><b>${escapeHTML(feeling)}</b><small>Você pode escrever mais depois.</small></span>
      </button>`).join('');
    refreshIcons();
  }

  function openComposer(type) {
    $$('.compose').forEach(el => el.classList.add('hidden'));
    $(`compose-${type}`)?.classList.remove('hidden');
    if (type === 'guided') {
      state.guidedIndex = 0;
      state.guidedAnswers = [];
      renderGuided();
    }
    if (type === 'feelings') {
      state.selectedFeeling = null;
      $('feeling-area')?.classList.add('hidden');
      $$('#feelings-list [data-feeling]').forEach(button => button.classList.remove('active'));
    }
    if (type === 'audio') {
      if (!state.audioBlob) resetRecordingUI();
    }
    refreshIcons();
  }

  function renderGuided() {
    const i = state.guidedIndex;
    $('guided-progress').textContent = `PERGUNTA ${i + 1} DE ${GUIDED_QUESTIONS.length}`;
    $('guided-question').textContent = GUIDED_QUESTIONS[i];
    $('guided-answer').value = state.guidedAnswers[i] || '';
    $('guided-back').disabled = i === 0;
    $('guided-next').textContent = i === GUIDED_QUESTIONS.length - 1 ? 'Enviar desabafo' : 'Próxima';
    $('guided-progress-bar').style.width = `${((i + 1) / GUIDED_QUESTIONS.length) * 100}%`;
  }

  async function finishVent(type, body = null, feeling = null, audioPath = null) {
    if (!state.user) return false;
    if (!body && !audioPath) return false;
    const { error } = await state.supabase.from(TABLE.vents).insert({
      user_id: state.user.id,
      type,
      body: body || null,
      feeling: feeling || null,
      audio_url: audioPath || null,
      status: 'pending'
    });
    if (error) throw error;
    await loadHistory();
    $$('.compose').forEach(el => el.classList.add('hidden'));
    toast('Desabafo enviado para moderação. Obrigado por confiar no CAE.');
    return true;
  }

  async function sendFreeVent() {
    const text = $('free-text')?.value.trim();
    if (!text) return toast('Escreva seu desabafo antes de enviar.', 'error');
    const button = $('send-free');
    setBusy(button, true, 'Enviando...');
    try {
      await finishVent('free', text);
      $('free-text').value = '';
      $('free-counter').textContent = '0 / 2000';
    } catch (error) {
      console.error('VENT FREE', error);
      toast(errorMessage(error), 'error');
    } finally { setBusy(button, false); }
  }

  function selectFeeling(feeling, button) {
    if (!state.user) return;
    state.selectedFeeling = feeling;
    $$('#feelings-list [data-feeling]').forEach(el => el.classList.remove('active'));
    button?.classList.add('active');
    $('selected-feeling').textContent = feeling;
    $('feeling-area').classList.remove('hidden');
    $('feeling-text').focus();
  }

  async function sendFeelingVent() {
    if (!state.selectedFeeling) return toast('Escolha uma frase primeiro.', 'error');
    const text = $('feeling-text')?.value.trim();
    if (!text) return toast('Escreva um pouco mais antes de enviar.', 'error');
    const button = $('send-feeling');
    setBusy(button, true, 'Enviando...');
    try {
      await finishVent('feelings', text, state.selectedFeeling);
      $('feeling-text').value = '';
      state.selectedFeeling = null;
    } catch (error) {
      console.error('VENT FEELING', error);
      toast(errorMessage(error), 'error');
    } finally { setBusy(button, false); }
  }

  async function guidedNext() {
    state.guidedAnswers[state.guidedIndex] = $('guided-answer').value.trim();
    if (state.guidedIndex < GUIDED_QUESTIONS.length - 1) {
      state.guidedIndex += 1;
      renderGuided();
      $('guided-answer').focus();
      return;
    }

    const body = GUIDED_QUESTIONS.map((question, index) => `${question}\n${state.guidedAnswers[index] || '(sem resposta)'}`).join('\n\n');
    if (!state.guidedAnswers.some(Boolean)) return toast('Responda pelo menos uma pergunta antes de enviar.', 'error');
    const button = $('guided-next');
    setBusy(button, true, 'Enviando...');
    try { await finishVent('guided', body); }
    catch (error) { console.error('VENT GUIDED', error); toast(errorMessage(error), 'error'); }
    finally { setBusy(button, false); }
  }

  function guidedBack() {
    if (state.guidedIndex === 0) return;
    state.guidedAnswers[state.guidedIndex] = $('guided-answer').value.trim();
    state.guidedIndex -= 1;
    renderGuided();
  }


  function resetRecordingUI() {
    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
      state.audioObjectUrl = null;
    }
    const preview = $('audio-preview');
    if (preview) {
      preview.pause();
      preview.removeAttribute('src');
      preview.load();
      preview.classList.add('hidden');
    }
    state.audioBlob = null;
    state.recordingChunks = [];
    state.recorder = null;
    $('record-status').textContent = 'Pronto para gravar.';
    $('record-start').disabled = false;
    $('record-stop').disabled = true;
    $('record-clear').disabled = true;
    $('record-send').disabled = true;
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Seu navegador não permite gravação de áudio aqui.', 'error');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mime = candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
      state.audioMime = mime;
      state.recordingChunks = [];
      state.audioBlob = null;
      try {
        state.recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch (error) {
        stream.getTracks().forEach(track => track.stop());
        throw error;
      }
      state.recorder.ondataavailable = event => { if (event.data?.size) state.recordingChunks.push(event.data); };
      state.recorder.onerror = event => { console.error('MEDIA RECORDER', event); toast('A gravação encontrou um erro.', 'error'); };
      state.recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const type = state.audioMime || 'audio/webm';
        state.audioBlob = new Blob(state.recordingChunks, { type });
        state.audioObjectUrl = URL.createObjectURL(state.audioBlob);
        const preview = $('audio-preview');
        preview.src = state.audioObjectUrl;
        preview.classList.remove('hidden');
        $('record-status').textContent = 'Gravação pronta. Ouça e envie quando estiver confortável.';
        $('record-start').disabled = false;
        $('record-stop').disabled = true;
        $('record-clear').disabled = false;
        $('record-send').disabled = false;
      };
      state.recorder.start();
      $('record-status').textContent = 'Gravando... toque em Parar quando terminar.';
      $('record-start').disabled = true;
      $('record-stop').disabled = false;
      $('record-clear').disabled = true;
      $('record-send').disabled = true;
    } catch (error) {
      console.error('RECORD', error);
      toast('Não foi possível acessar o microfone. Confira a permissão do navegador.', 'error');
    }
  }

  function stopRecording() {
    if (state.recorder?.state && state.recorder.state !== 'inactive') state.recorder.stop();
  }

  function clearRecording() { resetRecordingUI(); }

  async function uploadAudio(blob) {
    if (!blob || !state.user) throw new Error('Áudio inválido.');
    const mime = blob.type || 'audio/webm';
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
    const path = `${state.user.id}/${makeId()}.${ext}`;
    const { error } = await state.supabase.storage.from(AUDIO_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
    if (error) throw error;
    return path;
  }

  async function sendAudioVent() {
    if (!state.audioBlob) return toast('Grave um áudio primeiro.', 'error');
    const button = $('record-send');
    setBusy(button, true, 'Enviando...');
    try {
      const path = await uploadAudio(state.audioBlob);
      try {
        await finishVent('audio', null, null, path);
      } catch (error) {
        // Se o registro do desabafo falhar, não deixamos um arquivo órfão no Storage.
        await state.supabase.storage.from(AUDIO_BUCKET).remove([path]).catch(cleanupError => console.warn('AUDIO CLEANUP', cleanupError));
        throw error;
      }
      resetRecordingUI();
    } catch (error) {
      console.error('AUDIO VENT', error);
      toast(errorMessage(error), 'error');
    } finally { setBusy(button, false); }
  }

  async function loadChat() {
    if (!state.user || !state.supabase || state.chatLoading) return;
    const box = $('chat-messages');
    if (!box) return;
    state.chatLoading = true;
    try {
      const { data, error } = await state.supabase.from(TABLE.chat)
        .select('id,user_id,body,created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: true }).limit(200);
      if (error) throw error;
      await preloadPublicProfiles((data || []).map(message => message.user_id));
      renderChat(data || []);
      setStatus('chat-error', '');
    } catch (error) {
      console.error('CHAT LOAD', error);
      box.innerHTML = '';
      setStatus('chat-error', errorMessage(error));
    } finally { state.chatLoading = false; }
  }

  function renderChat(messages) {
    const box = $('chat-messages');
    if (!box) return;
    if (!messages.length) {
      box.innerHTML = '<div class="message">Ainda não há mensagens. Seja a primeira pessoa a conversar. 🌿</div>';
      return;
    }
    box.innerHTML = messages.map(message => {
      const name = publicTagForUser(message.user_id);
      const own = message.user_id === state.user.id;
      return `<article class="chat-message">
        <div class="chat-avatar">${escapeHTML(initials(name))}</div>
        <div class="chat-bubble">
          <div><span class="chat-name">${escapeHTML(name)}</span><span class="chat-time">${escapeHTML(formatDate(message.created_at))}</span></div>
          <div class="chat-body">${escapeHTML(message.body).replace(/\n/g, '<br>')}</div>
          ${!own ? `<div class="chat-actions"><button type="button" data-report-message="${escapeHTML(message.id)}">Denunciar</button></div>` : ''}
          ${isStaff() ? `<div class="chat-actions"><button type="button" data-hide-message="${escapeHTML(message.id)}">Remover</button></div>` : ''}
        </div>
      </article>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  async function sendChat(event) {
    event.preventDefault();
    const body = $('chat-input')?.value.trim();
    if (!body || !state.user) return;
    if (body.length > 1500) return toast('A mensagem é longa demais.', 'error');
    if (state.profile?.is_banned) return toast('Sua conta está bloqueada e não pode enviar mensagens.', 'error');
    if (state.profile?.timeout_until && new Date(state.profile.timeout_until) > new Date()) return toast(`Você está em timeout até ${formatDate(state.profile.timeout_until)}.`, 'error');
    if (!(await requireChatRules())) return;
    const moderation = moderateChatText(body);
    if (moderation.blocked) return toast(moderation.reason, 'error');
    const finalBody = moderation.text;
    const button = $('chat-send');
    setBusy(button, true, 'Enviando...');
    try {
      const { error } = await state.supabase.from(TABLE.chat).insert({ user_id: state.user.id, body: finalBody });
      if (error) throw error;
      $('chat-input').value = '';
      if (moderation.redacted) toast('Algumas palavras foram ocultadas automaticamente pelo filtro do CAE.');
      await loadChat();
    } catch (error) {
      console.error('CHAT SEND', error);
      toast(errorMessage(error), 'error');
    } finally { setBusy(button, false); $('chat-input')?.focus(); }
  }

  async function reportMessage(messageId) {
    const reason = window.prompt('Por que você quer denunciar esta mensagem?');
    if (!reason?.trim()) return;
    try {
      const { error } = await state.supabase.from(TABLE.reports).insert({ message_id: messageId, reporter_id: state.user.id, reason: reason.trim(), status: 'pending' });
      if (error) throw error;
      toast('Denúncia enviada para a moderação.');
      if (isStaff()) await loadAdmin();
    } catch (error) { console.error('REPORT', error); toast(errorMessage(error), 'error'); }
  }

  async function hideMessage(messageId) {
    if (!isStaff()) return false;
    if (!window.confirm('Remover completamente esta mensagem do chat? Essa ação não pode ser desfeita.')) return false;
    try {
      const { error } = await state.supabase.from(TABLE.chat).delete().eq('id', messageId);
      if (error) throw error;
      await logAdmin('remove_chat_message', 'chat_message', messageId);
      toast('Mensagem removida completamente.');
      await loadChat();
      if (isStaff()) await loadAdmin();
      return true;
    } catch (error) { console.error('REMOVE MESSAGE',error); toast(errorMessage(error),'error'); return false; }
  }

  function subscribeRealtime() {
    if (!state.supabase || !state.user) return;
    if (state.realtime) state.supabase.removeChannel(state.realtime);
    state.realtime = state.supabase.channel(`cae-${state.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.chat }, () => { if (state.currentView === 'chat-view') loadChat(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.posts }, () => { if (state.currentView === 'mural-view') queueMuralReload(); if (state.currentView === 'admin-view' && isStaff()) loadAdmin(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.announcements }, () => { if (state.currentView === 'mural-view') queueMuralReload(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.events }, () => { if (state.currentView === 'mural-view') queueMuralReload(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.polls }, () => { if (state.currentView === 'mural-view') queueMuralReload(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.pollOptions }, () => { if (state.currentView === 'mural-view') queueMuralReload(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.pollVotes }, () => { if (state.currentView === 'mural-view') queueMuralReload(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.reports }, () => { if (state.currentView === 'admin-view' && isStaff()) loadAdmin(); })
      .subscribe(status => console.debug('CAE Realtime:', status));
  }

  function queueMuralReload() {
    if (state.muralLoading) { state.muralQueued = true; return; }
    window.clearTimeout(queueMuralReload.timer);
    queueMuralReload.timer = window.setTimeout(() => loadMural(), 180);
  }

  async function loadAnnouncements() {
    const list = $('announcement-list');
    if (!list) return;
    const { data, error } = await state.supabase.from(TABLE.announcements).select('*').order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    list.innerHTML = data?.length ? data.map(row => `<article class="card"><div class="eyebrow">Aviso · ${escapeHTML(formatDate(row.created_at))}</div><h3>${escapeHTML(getField(row,['title'],'Aviso'))}</h3><p>${escapeHTML(getField(row,['body'],'')).replace(/\n/g,'<br>')}</p></article>`).join('') : '<div class="card"><p>Nenhum aviso publicado ainda.</p></div>';
  }

  async function loadEvents() {
    const list = $('event-list');
    if (!list) return;
    const { data, error } = await state.supabase.from(TABLE.events).select('*').order('event_date', { ascending: true }).limit(20);
    if (error) throw error;
    list.innerHTML = data?.length ? data.map(row => {
      const date = getField(row,['event_date'],null); const time = String(getField(row,['event_time'],'')).slice(0,5);
      return `<article class="card"><div class="eyebrow">${escapeHTML(formatDateOnly(date))}${time ? ` · ${escapeHTML(time)}` : ''}</div><h3>${escapeHTML(getField(row,['title'],'Evento'))}</h3><p>${escapeHTML(getField(row,['description'],'')).replace(/\n/g,'<br>')}</p><p class="cae-muted">${escapeHTML(getField(row,['place'],'')).replace(/\n/g,'<br>')}</p></article>`;
    }).join('') : '<div class="card"><p>Nenhum evento publicado ainda.</p></div>';
  }

  async function loadPosts() {
    const list = $('post-list');
    if (!list) return;
    const { data, error } = await state.supabase.from(TABLE.posts).select('*').order('created_at',{ascending:false}).limit(50);
    if (error) throw error;
    const posts = (data || []).filter(post => ['approved'].includes(String(post.status || 'approved')) || post.user_id === state.user.id || isStaff());
    await preloadPublicProfiles(posts.map(post => post.user_id));
    const postIds = posts.map(post => post.id);

    let reactions = [];
    if (postIds.length) {
      const result = await state.supabase.from(TABLE.reactions).select('id,post_id,user_id,reaction').in('post_id', postIds);
      if (result.error) throw result.error;
      reactions = result.data || [];
    }

    if (!posts.length) { list.innerHTML = '<div class="card"><p>Ainda não há publicações aprovadas.</p></div>'; return; }
    list.innerHTML = posts.map(post => {
      const status = String(post.status || 'approved');
      const reactionHTML = REACTIONS.map(([emoji,key]) => {
        const count = reactions.filter(r => r.post_id === post.id && String(r.reaction) === key).length;
        const active = reactions.some(r => r.post_id === post.id && r.user_id === state.user.id && String(r.reaction) === key);
        return `<button type="button" class="cae-reaction ${active?'active':''}" data-react-post="${escapeHTML(post.id)}" data-reaction="${escapeHTML(key)}">${emoji} ${count}</button>`;
      }).join('');
      const canDelete = post.user_id === state.user.id || isStaff();
      const deleteHTML = canDelete ? `<div class="actions"><button class="btn danger" type="button" data-delete-post="${escapeHTML(post.id)}"><i data-lucide="trash-2"></i>Excluir</button></div>` : '';
      return `<article class="card"><div class="cae-post-meta"><span>${escapeHTML(publicTagForUser(post.user_id))}</span><span>·</span><span>${escapeHTML(getField(post,['category'],'Geral'))}</span><span>·</span><span>${escapeHTML(formatDate(post.created_at))}</span>${post.user_id===state.user.id?'<span>· sua publicação</span>':''}</div><p>${escapeHTML(getField(post,['body'],'')).replace(/\n/g,'<br>')}</p>${status!=='approved'?`<div class="cae-muted">Status: ${escapeHTML(status==='pending'?'aguardando moderação':status)}</div>`:''}${status==='approved'?`<div class="cae-reactions">${reactionHTML}</div>`:''}${deleteHTML}</article>`;
    }).join('');
  }

  async function loadPolls() {
    const list = $('poll-list');
    if (!list) return;
    const { data: polls, error } = await state.supabase.from(TABLE.polls).select('*').order('created_at',{ascending:false}).limit(20);
    if (error) throw error;
    if (!polls?.length) { list.innerHTML='<div class="card"><p>Nenhuma enquete publicada ainda.</p></div>'; return; }
    const ids = polls.map(p=>p.id);
    const [optionsResult, votesResult, resultsResult] = await Promise.all([
      state.supabase.from(TABLE.pollOptions).select('id,poll_id,text').in('poll_id',ids),
      state.supabase.from(TABLE.pollVotes).select('id,poll_id,option_id').in('poll_id',ids).eq('user_id',state.user.id),
      state.supabase.rpc('cae_get_poll_results',{poll_ids:ids})
    ]);
    if (optionsResult.error) throw optionsResult.error;
    if (votesResult.error) throw votesResult.error;
    if (resultsResult.error) throw resultsResult.error;
    const options = optionsResult.data || []; const mine = votesResult.data || []; const results = resultsResult.data || [];

    list.innerHTML = polls.map(poll => {
      const closesAt = getField(poll,['closes_at'],null);
      const expired = closesAt ? new Date(closesAt) <= new Date() : false;
      const selected = mine.find(v=>v.poll_id===poll.id);
      const pollOptions = options.filter(o=>o.poll_id===poll.id);
      const pollResults = results.filter(r=>r.poll_id===poll.id);
      const total = pollResults.reduce((sum,row)=>sum+Number(row.vote_count||0),0);
      const optionHTML = pollOptions.map(option => {
        const count = Number(pollResults.find(r=>r.option_id===option.id)?.vote_count||0);
        const pct = total ? Math.round(count/total*100) : 0;
        return `<div class="cae-result-row"><div class="cae-poll-option"><span>${escapeHTML(option.text)}</span><span class="cae-muted">${count} · ${pct}%</span>${!selected&&!expired?`<button class="btn secondary" type="button" data-vote-option="${escapeHTML(option.id)}" data-vote-poll="${escapeHTML(poll.id)}">Votar</button>`:''}</div><div class="cae-bar"><span style="width:${pct}%"></span></div></div>`;
      }).join('');
      return `<article class="card"><div class="eyebrow">Enquete${closesAt?` · até ${escapeHTML(formatDate(closesAt))}`:''}</div><h3>${escapeHTML(getField(poll,['question'],'Enquete'))}</h3><p class="cae-muted">${selected?'Seu voto foi registrado.':expired?'Enquete encerrada.':'Escolha uma opção.'}</p><div class="cae-results">${optionHTML}</div></article>`;
    }).join('');
  }

  async function votePoll(optionId, pollId) {
    try {
      const { data: existing, error: existingError } = await state.supabase.from(TABLE.pollVotes).select('id').eq('poll_id',pollId).eq('user_id',state.user.id).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return toast('Você já votou nessa enquete.','error');
      const { error } = await state.supabase.from(TABLE.pollVotes).insert({poll_id:pollId,option_id:optionId,user_id:state.user.id});
      if (error) throw error;
      toast('Voto registrado.');
      await loadPolls();
    } catch (error) { console.error('VOTE',error); toast(errorMessage(error),'error'); }
  }

  async function loadMural() {
    if (!state.supabase || !state.user || state.muralLoading) return;
    state.muralLoading = true;
    state.muralQueued = false;
    try {
      const tasks = [loadAnnouncements(),loadEvents(),loadPosts(),loadPolls()];
      const results = await Promise.allSettled(tasks);
      if (results.some(r=>r.status==='rejected')) toast('Uma parte do mural não pôde ser carregada.','error');
    } finally {
      state.muralLoading = false;
      if (state.muralQueued) queueMuralReload();
      refreshIcons();
    }
  }

  async function sendPost() {
    if (!state.user) return;
    const body = $('post-body')?.value.trim();
    const category = $('post-category')?.value || 'Geral';
    if (!body) return setStatus('post-status','Escreva alguma coisa antes de enviar.');
    const button = $('post-send');
    setBusy(button,true,'Enviando...');
    try {
      const { error } = await state.supabase.from(TABLE.posts).insert({user_id:state.user.id,category,body,status:'pending'});
      if (error) throw error;
      $('post-body').value='';
      setStatus('post-status','Enviado para administradores e moderadores. Ele só ficará público depois de aprovado.','ok');
      toast('Sua publicação foi enviada para administradores e moderadores para revisão.');
      await loadPosts();
      if (isStaff()) await loadAdmin();
    } catch (error) { console.error('POST',error); setStatus('post-status',errorMessage(error)); }
    finally { setBusy(button,false); }
  }

  async function deletePost(id) {
    if (!state.user) return;
    if (!window.confirm('Excluir esta publicação? Esta ação não pode ser desfeita.')) return;
    try {
      let query = state.supabase.from(TABLE.posts).delete().eq('id', id);
      if (!isStaff()) query = query.eq('user_id', state.user.id);
      const { error } = await query;
      if (error) throw error;
      if (isStaff()) await logAdmin('delete_post','post',id);
      toast('Publicação excluída.');
      await loadPosts();
      if (isStaff()) await loadAdmin();
    } catch (error) {
      console.error('DELETE POST', error);
      toast(errorMessage(error), 'error');
    }
  }

  async function toggleReaction(postId,reaction) {
    const lockKey = `${postId}:${reaction}`;
    if (!state.pendingReactions) state.pendingReactions = new Set();
    if (state.pendingReactions.has(lockKey)) return;

    const button = document.querySelector(
      `[data-react-post="${CSS.escape(String(postId))}"][data-reaction="${CSS.escape(String(reaction))}"]`
    );
    state.pendingReactions.add(lockKey);
    if (button) button.disabled = true;

    try {
      const { data: mine, error: findError } = await state.supabase
        .from(TABLE.reactions)
        .select('id')
        .eq('post_id', postId)
        .eq('user_id', state.user.id)
        .eq('reaction', reaction)
        .maybeSingle();

      if (findError) throw findError;

      if (mine) {
        const { error } = await state.supabase
          .from(TABLE.reactions)
          .delete()
          .eq('id', mine.id);
        if (error) throw error;
      } else {
        // Atomic against UNIQUE(post_id, user_id, reaction). If another
        // rapid click already inserted it, Supabase simply ignores the duplicate.
        const { error } = await state.supabase
          .from(TABLE.reactions)
          .upsert(
            { post_id: postId, user_id: state.user.id, reaction },
            { onConflict: 'post_id,user_id,reaction', ignoreDuplicates: true }
          );
        if (error) throw error;
      }

      await loadPosts();
    } catch (error) {
      console.error('REACTION', error);
      toast(errorMessage(error), 'error');
    } finally {
      state.pendingReactions.delete(lockKey);
    }
  }

  async function deleteVent(id, audioPath = null) {
    if (!state.user) return;
    if (!window.confirm('Excluir este desabafo? Esta ação não pode ser desfeita.')) return;
    try {
      let query = state.supabase.from(TABLE.vents).delete().eq('id', id);
      if (!isStaff()) query = query.eq('user_id', state.user.id);
      const { error } = await query;
      if (error) throw error;
      if (audioPath) {
        const { error: storageError } = await state.supabase.storage.from(AUDIO_BUCKET).remove([audioPath]);
        if (storageError) console.warn('AUDIO DELETE', storageError);
      }
      if (isStaff()) await logAdmin('delete_vent','vent',id);
      toast('Desabafo excluído.');
      await loadHistory();
      if (isStaff()) await loadAdmin();
    } catch (error) {
      console.error('DELETE VENT', error);
      toast(errorMessage(error), 'error');
    }
  }

  async function moderateVent(id, status) {
    if (!isStaff()) return;
    const label = status === 'approved' ? 'aprovar' : 'recusar';
    if (!window.confirm(`${label[0].toUpperCase()+label.slice(1)} este desabafo?`)) return;
    try {
      const { error } = await state.supabase.from(TABLE.vents).update({
        status,
        moderated_at: new Date().toISOString(),
        moderated_by: state.user.id
      }).eq('id', id);
      if (error) throw error;
      await logAdmin(status === 'approved' ? 'approve_vent' : 'reject_vent', 'vent', id);
      toast(status === 'approved' ? 'Desabafo aprovado.' : 'Desabafo recusado.');
      await loadAdmin();
      await loadHistory();
    } catch (error) {
      console.error('MODERATE VENT', error);
      toast(errorMessage(error), 'error');
    }
  }

  async function loadHistory() {
    const list = $('history-list'); if(!list||!state.user||!state.supabase)return;
    try {
      const {data,error}=await state.supabase.from(TABLE.vents).select('*').eq('user_id',state.user.id).order('created_at',{ascending:false}).limit(50);
      if(error)throw error;
      if(!data?.length){list.innerHTML='<div class="card"><p>Você ainda não enviou nada.</p><p class="cae-muted">Quando enviar um desabafo, ele aparecerá aqui.</p></div>';return;}
      const labels={free:'Texto livre',guided:'Perguntas guiadas',feelings:'Sentimentos',audio:'Áudio'};
      const statusLabels={pending:'aguardando moderação',approved:'aprovado',rejected:'recusado'};
      list.innerHTML=data.map(vent=>{
        const type=String(vent.type||'free');
        const body=getField(vent,['body'],'');
        const feeling=getField(vent,['feeling'],'');
        const audioPath=getField(vent,['audio_url'],'');
        const status=String(getField(vent,['status'],'pending'));
        const statusHTML=`<span class="cae-status cae-status-${escapeHTML(status)}">${escapeHTML(statusLabels[status]||status)}</span>`;
        return `<article class="card">
          <div class="eyebrow">${escapeHTML(labels[type]||'Desabafo')} · ${escapeHTML(formatDate(vent.created_at))}</div>
          <div class="cae-post-meta" style="margin-top:8px">${statusHTML}</div>
          ${status==='rejected'?'<div class="notice" style="margin-top:10px">Este desabafo não foi aprovado pela moderação.</div>':''}
          ${feeling?`<div class="notice" style="margin-top:10px">${escapeHTML(feeling)}</div>`:''}
          ${body?`<p>${escapeHTML(body).replace(/\n/g,'<br>')}</p>`:''}
          ${audioPath?`<div class="actions"><button class="btn secondary" type="button" data-play-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>`:''}
          <div class="actions"><button class="btn danger" type="button" data-delete-vent="${escapeHTML(vent.id)}" data-audio-path="${escapeHTML(audioPath)}"><i data-lucide="trash-2"></i>Excluir</button></div>
        </article>`;
      }).join('');
      refreshIcons();
    }catch(error){console.error('HISTORY',error);list.innerHTML=`<div class="card"><p class="cae-danger">${escapeHTML(errorMessage(error))}</p></div>`;}
  }

  async function playPrivateAudio(path) {
    try {
      const {data,error}=await state.supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path,600);
      if(error)throw error;
      const card=document.createElement('div'); card.className='card'; card.innerHTML='<div class="eyebrow">Áudio</div>';
      const audio=document.createElement('audio'); audio.controls=true; audio.src=data.signedUrl; audio.style.width='100%';
      card.appendChild(audio); $('history-list')?.prepend(card); await audio.play().catch(()=>{});
    }catch(error){console.error('AUDIO PLAY',error);toast(`Não foi possível abrir este áudio: ${errorMessage(error)}`,'error');}
  }

  async function logAdmin(action,targetType=null,targetId=null,details={}) {
    if(!isStaff()||!state.user)return;
    const {error}=await state.supabase.from(TABLE.logs).insert({admin_id:state.user.id,action,target_type:targetType,target_id:targetId,details});
    if(error)console.warn('ADMIN LOG',error);
  }

  function ensurePollAdminForm() {
    if(!isStaff()||$('poll-form'))return;
    const placeholder=$('poll-admin-card-placeholder');
    if(!placeholder)return;
    placeholder.innerHTML=`<div class="eyebrow">Enquetes</div><h3>Nova enquete</h3><form id="poll-form"><div class="field"><label for="poll-question">Pergunta</label><input id="poll-question" required maxlength="300" placeholder="O que a escola deveria melhorar?"></div><div class="field"><label>Opções</label><input class="poll-option-input" required maxlength="120" placeholder="Opção 1"><input class="poll-option-input" required maxlength="120" placeholder="Opção 2"><input class="poll-option-input" maxlength="120" placeholder="Opção 3"><input class="poll-option-input" maxlength="120" placeholder="Opção 4"></div><div class="field"><label for="poll-closes">Encerramento (opcional)</label><input id="poll-closes" type="datetime-local"></div><button class="btn primary" type="submit">Publicar enquete</button></form>`;
    $('poll-form').addEventListener('submit',createPoll);
  }

  async function createPoll(event) {
    event.preventDefault(); if(!isStaff())return;
    const question=$('poll-question')?.value.trim(); const closes=$('poll-closes')?.value; const options=$$('.poll-option-input').map(input=>input.value.trim()).filter(Boolean);
    if(!question||options.length<2)return toast('A enquete precisa de uma pergunta e pelo menos duas opções.','error');
    const button=event.submitter; setBusy(button,true,'Publicando...');
    let pollId=null;
    try {
      const {data:poll,error:pollError}=await state.supabase.from(TABLE.polls).insert({question,closes_at:closes?new Date(closes).toISOString():null,published_by:state.user.id}).select('*').single();
      if(pollError)throw pollError; pollId=poll.id;
      const {error:optionError}=await state.supabase.from(TABLE.pollOptions).insert(options.map(text=>({poll_id:poll.id,text})));
      if(optionError)throw optionError;
      await logAdmin('create_poll','poll',poll.id,{options});
      event.target.reset(); toast('Enquete publicada.'); await loadPolls();
    }catch(error){
      console.error('CREATE POLL',error);
      toast(errorMessage(error),'error');
      if(pollId)console.warn('A enquete foi criada, mas as opções falharam. Verifique o banco:',pollId);
    }finally{setBusy(button,false);}
  }

  async function moderatePost(id,status) {
    if(!isStaff())return;
    if(!window.confirm(status==='approved'?'Aprovar esta publicação?':'Recusar esta publicação?'))return;
    try{
      const {error}=await state.supabase.from(TABLE.posts).update({status,moderated_at:new Date().toISOString(),moderated_by:state.user.id}).eq('id',id); if(error)throw error;
      await logAdmin(status==='approved'?'approve_post':'reject_post','post',id); toast(status==='approved'?'Publicação aprovada.':'Publicação recusada.'); await loadAdmin(); await loadPosts();
    }catch(error){console.error('MODERATE POST',error);toast(errorMessage(error),'error');}
  }

  async function resolveReport(id) {
    if(!isStaff())return;
    try{const {error}=await state.supabase.from(TABLE.reports).update({status:'resolved',resolved_at:new Date().toISOString(),resolved_by:state.user.id}).eq('id',id);if(error)throw error;await logAdmin('resolve_report','chat_report',id);toast('Denúncia resolvida.');await loadAdmin();}catch(error){console.error('RESOLVE REPORT',error);toast(errorMessage(error),'error');}
  }

  async function hideReportedMessage(messageId,reportId){
    if(!isStaff())return;
    await hideMessage(messageId);
  }

  async function createAnnouncement(event){
    event.preventDefault();if(!isStaff())return;const title=$('announcement-title').value.trim();const body=$('announcement-body').value.trim();if(!title||!body)return;
    const button=event.submitter;setBusy(button,true,'Publicando...');try{const {error}=await state.supabase.from(TABLE.announcements).insert({title,body,published_by:state.user.id});if(error)throw error;event.target.reset();await logAdmin('create_announcement','announcement');toast('Aviso publicado.');await loadAnnouncements();}catch(error){console.error('ANNOUNCEMENT',error);toast(errorMessage(error),'error');}finally{setBusy(button,false);}
  }

  async function createEvent(event){
    event.preventDefault();if(!isStaff())return;const payload={title:$('event-title').value.trim(),event_date:$('event-date').value,event_time:$('event-time').value,place:$('event-place').value.trim(),description:$('event-description').value.trim(),published_by:state.user.id};if(Object.values(payload).slice(0,5).some(v=>!v))return;
    const button=event.submitter;setBusy(button,true,'Publicando...');try{const {error}=await state.supabase.from(TABLE.events).insert(payload);if(error)throw error;event.target.reset();await logAdmin('create_event','event');toast('Evento publicado.');await loadEvents();}catch(error){console.error('EVENT',error);toast(errorMessage(error),'error');}finally{setBusy(button,false);}
  }

  async function adminSetRoleByIdentifier() {
    if (state.profile?.role !== 'admin') return toast('Somente administradores podem alterar cargos.', 'error');
    const identifier = $('admin-user-identifier')?.value.trim();
    const role = $('admin-user-role')?.value;
    if (!identifier) return toast('Digite o ID público da conta, por exemplo #EstudanteABC123.', 'error');
    if (!['student', 'moderator', 'admin'].includes(role)) return;
    const button = $('admin-role-button');
    setBusy(button, true, 'Salvando...');
    try {
      const { data, error } = await state.supabase.rpc('cae_set_role_by_public_id', { p_public_id: identifier, p_role: role });
      if (error) throw error;
      const target = Array.isArray(data) ? data[0] : data;
      await logAdmin('set_role', 'user', target?.id || target?.result_id || null, { identifier, role });
      toast(role === 'admin' ? 'Conta promovida a administrador.' : role === 'moderator' ? 'Conta promovida a moderador.' : 'Cargo removido. A conta voltou a estudante.');
      if ((target?.id || target?.result_id) === state.user.id) {
        state.profile.role = role;
        $('nav-admin')?.classList.toggle('hidden', !isStaff());
      }
      $('admin-user-identifier').value = '';
    } catch (error) {
      console.error('SET ROLE', error);
      toast(errorMessage(error), 'error');
    } finally { setBusy(button, false); }
  }

  async function adminModerateUser(action) {
    if (!isStaff()) return;
    const identifier = $('admin-user-identifier')?.value.trim();
    if (!identifier) return toast('Digite o ID público da conta, por exemplo #EstudanteABC123.', 'error');
    let minutes = null;
    if (action === 'timeout') {
      minutes = Number($('admin-timeout-duration')?.value || 0);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) return toast('Escolha um timeout entre 1 minuto e 7 dias.', 'error');
    }
    const labels = { ban: 'bloquear esta conta', unban: 'retirar o bloqueio desta conta', timeout: `aplicar timeout de ${minutes} minuto(s)`, clear_timeout: 'remover o timeout desta conta' };
    if (!window.confirm(`Tem certeza que deseja ${labels[action]}?`)) return;
    const button = document.querySelector(`[data-user-moderation="${action}"]`);
    setBusy(button, true, 'Aplicando...');
    try {
      const { data, error } = await state.supabase.rpc('cae_moderate_user_by_public_id', { p_public_id: identifier, p_action: action, p_minutes: minutes });
      if (error) throw error;
      const target = Array.isArray(data) ? data[0] : data;
      await logAdmin(action, 'user', target?.id || target?.result_id || null, { identifier, minutes });
      const messages = { ban: 'Conta bloqueada.', unban: 'Bloqueio removido.', timeout: `Timeout aplicado por ${minutes} minuto(s).`, clear_timeout: 'Timeout removido.' };
      toast(messages[action]);
      await loadAdmin();
    } catch (error) {
      console.error('MODERATE USER', error);
      toast(errorMessage(error), 'error');
    } finally { setBusy(button, false); }
  }

  async function loadAdmin(){
    if(!state.supabase||!isStaff())return;ensurePollAdminForm();
    const roleEditor = $('admin-user-role');
    const roleButton = $('admin-role-button');
    const canManageRoles = state.profile?.role === 'admin';
    if (roleEditor) roleEditor.disabled = !canManageRoles;
    if (roleButton) roleButton.classList.toggle('hidden', !canManageRoles);
    try{
      const [approved,pending,vents,reports,pendingVents]=await Promise.all([
        state.supabase.from(TABLE.posts).select('id',{count:'exact',head:true}).eq('status','approved'),
        state.supabase.from(TABLE.posts).select('id',{count:'exact',head:true}).eq('status','pending'),
        state.supabase.from(TABLE.vents).select('id',{count:'exact',head:true}),
        state.supabase.from(TABLE.reports).select('id',{count:'exact',head:true}).eq('status','pending'),
        state.supabase.from(TABLE.vents).select('id',{count:'exact',head:true}).eq('status','pending')
      ]);
      [approved,pending,vents,reports,pendingVents].forEach(result=>{if(result.error)throw result.error;});
      $('stat-approved').textContent=String(approved.count||0);$('stat-pending').textContent=String(pending.count||0);$('stat-vents').textContent=String(vents.count||0);$('stat-reports').textContent=String(reports.count||0);

      const {data:posts,error:postsError}=await state.supabase.from(TABLE.posts).select('*').eq('status','pending').order('created_at',{ascending:true}).limit(100);if(postsError)throw postsError;
      $('admin-post-list').innerHTML=posts?.length?posts.map(post=>`<article class="card"><div class="cae-post-meta">${escapeHTML(getField(post,['category'],'Geral'))} · ${escapeHTML(formatDate(post.created_at))}</div><p>${escapeHTML(getField(post,['body'],''))}</p><div class="actions"><button class="btn primary" type="button" data-approve-post="${escapeHTML(post.id)}">Aprovar</button><button class="btn secondary" type="button" data-reject-post="${escapeHTML(post.id)}">Recusar</button></div></article>`).join(''):'<div class="card"><p>Nenhum post pendente.</p></div>';

      const {data:pendingVentRows,error:pendingVentError}=await state.supabase.from(TABLE.vents).select('*').eq('status','pending').order('created_at',{ascending:true}).limit(100);
      if(pendingVentError)throw pendingVentError;
      await preloadPublicProfiles((pendingVentRows||[]).map(vent=>vent.user_id));
      const ventLabels={free:'Texto livre',guided:'Perguntas guiadas',feelings:'Sentimentos',audio:'Áudio'};
      const pendingVentHTML=(pendingVentRows||[]).map(vent=>{
        const body=getField(vent,['body'],'');
        const feeling=getField(vent,['feeling'],'');
        const audioPath=getField(vent,['audio_url'],'');
        const audioHTML=audioPath?`<div class="admin-audio"><div class="cae-muted">Áudio enviado</div><button class="btn secondary" type="button" data-admin-play-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button><audio class="admin-audio-player hidden" controls></audio></div>`:'';
        return `<article class="card"><div class="cae-post-meta">${escapeHTML(ventLabels[String(vent.type)]||'Desabafo')} · ${escapeHTML(publicTagForUser(vent.user_id))} · ${escapeHTML(formatDate(vent.created_at))}</div>${feeling?`<div class="notice" style="margin-top:10px">${escapeHTML(feeling)}</div>`:''}${body?`<p>${escapeHTML(body).replace(/\n/g,'<br>')}</p>`:''}${audioHTML}<div class="actions"><button class="btn primary" type="button" data-approve-vent="${escapeHTML(vent.id)}">Aprovar</button><button class="btn secondary" type="button" data-reject-vent="${escapeHTML(vent.id)}">Recusar</button><button class="btn danger" type="button" data-delete-vent="${escapeHTML(vent.id)}" data-audio-path="${escapeHTML(audioPath)}">Excluir</button></div></article>`;
      }).join('');
      const adminVentList=$('admin-vent-list');
      if(adminVentList) adminVentList.innerHTML=pendingVentHTML||'<div class="card"><p>Nenhum desabafo aguardando moderação.</p></div>';
      const {data:reportRows,error:reportError}=await state.supabase.from(TABLE.reports).select('*').eq('status','pending').order('created_at',{ascending:true}).limit(100);if(reportError)throw reportError;
      let reportedMessages = [];
      const messageIds = [...new Set((reportRows || []).map(report => report.message_id).filter(Boolean))];
      if (messageIds.length) {
        const { data: messageRows, error: messageError } = await state.supabase.from(TABLE.chat).select('id,user_id,body,created_at,deleted_at').in('id', messageIds);
        if (messageError) throw messageError;
        reportedMessages = messageRows || [];
        await preloadPublicProfiles(reportedMessages.map(message => message.user_id));
      }
      $('admin-report-list').innerHTML=reportRows?.length?reportRows.map(report=>{
        const message = reportedMessages.find(row => row.id === report.message_id);
        const messageHTML = message ? `<div class="notice" style="margin:10px 0"><div class="cae-post-meta">Mensagem de ${escapeHTML(publicTagForUser(message.user_id))} · ${escapeHTML(formatDate(message.created_at))}</div><p>${escapeHTML(message.body).replace(/\n/g,'<br>')}</p></div>` : '<div class="notice" style="margin:10px 0">A mensagem denunciada já foi removida.</div>';
        const removeButton = message ? `<button class="btn danger" type="button" data-hide-reported="${escapeHTML(report.message_id)}" data-report-id="${escapeHTML(report.id)}">Remover mensagem</button>` : '';
        return `<article class="card"><div class="cae-post-meta">Denúncia · ${escapeHTML(formatDate(report.created_at))}</div><p><b>Motivo:</b> ${escapeHTML(report.reason)}</p>${messageHTML}<div class="actions">${removeButton}<button class="btn secondary" type="button" data-resolve-report="${escapeHTML(report.id)}">Resolver sem remover</button></div></article>`;
      }).join(''):'<div class="card"><p>Nenhuma denúncia pendente.</p></div>';
    }catch(error){console.error('ADMIN',error);toast(`Painel admin: ${errorMessage(error)}`,'error');}
  }

  function bindDelegatedEvents(){
    document.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.matches('[data-open-view]'))showView(button.dataset.openView);
      if(button.matches('[data-view]'))showView(button.dataset.view);
      if(button.matches('[data-compose]'))openComposer(button.dataset.compose);
      if(button.matches('[data-panel]'))switchMuralPanel(button.dataset.panel);
      if(button.matches('[data-report-message]'))await reportMessage(button.dataset.reportMessage);
      if(button.matches('[data-hide-message]'))await hideMessage(button.dataset.hideMessage);
      if(button.matches('[data-feeling]'))selectFeeling(button.dataset.feeling,button);
      if(button.matches('[data-delete-post]'))await deletePost(button.dataset.deletePost);
      if(button.matches('[data-react-post]'))await toggleReaction(button.dataset.reactPost,button.dataset.reaction);
      if(button.matches('[data-delete-vent]'))await deleteVent(button.dataset.deleteVent,button.dataset.audioPath);
      if(button.matches('[data-approve-vent]'))await moderateVent(button.dataset.approveVent,'approved');
      if(button.matches('[data-reject-vent]'))await moderateVent(button.dataset.rejectVent,'rejected');
      if(button.matches('[data-vote-option]'))await votePoll(button.dataset.voteOption,button.dataset.votePoll);
      if(button.matches('[data-play-audio]'))await playPrivateAudio(button.dataset.playAudio);
      if(button.matches('[data-admin-play-audio]')) {
        try {
          const {data,error}=await state.supabase.storage.from(AUDIO_BUCKET).createSignedUrl(button.dataset.adminPlayAudio,600);
          if(error) throw error;
          const player=button.closest('.admin-audio')?.querySelector('.admin-audio-player');
          if(player){player.src=data.signedUrl;player.classList.remove('hidden');player.play().catch(()=>{});}
        } catch(error){toast(`Não foi possível abrir este áudio: ${errorMessage(error)}`,'error');}
      }
      if(button.matches('[data-approve-post]'))await moderatePost(button.dataset.approvePost,'approved');
      if(button.matches('[data-reject-post]'))await moderatePost(button.dataset.rejectPost,'rejected');
      if(button.matches('[data-resolve-report]'))await resolveReport(button.dataset.resolveReport);
      if(button.matches('[data-hide-reported]'))await hideReportedMessage(button.dataset.hideReported,button.dataset.reportId);
      if(button.matches('[data-action="logout"]'))await logout();
      if(button.matches('[data-user-action="set-role"]'))await adminSetRoleByIdentifier();
      if(button.matches('[data-user-moderation]'))await adminModerateUser(button.dataset.userModeration);
    });
  }

  function bindEvents(){
    $('auth-tab-login')?.addEventListener('click',()=>setAuthMode('login'));
    $('auth-tab-signup')?.addEventListener('click',()=>setAuthMode('signup'));
    $('login-form')?.addEventListener('submit',login);
    $('signup-form')?.addEventListener('submit',signup);
    $('resend-confirmation')?.addEventListener('click',resendConfirmation);
    $('magic-button')?.addEventListener('click',magicLogin);
    $('forgot-button')?.addEventListener('click',forgotPassword);
    $('password-form')?.addEventListener('submit',submitPasswordRecovery);
    $('password-modal-close')?.addEventListener('click',closePasswordModal);
    $('password-modal-cancel')?.addEventListener('click',closePasswordModal);
    $('password-modal')?.addEventListener('click',event=>{if(event.target.id==='password-modal')closePasswordModal();});
    $('logout-button')?.addEventListener('click',logout);
    $('brand-home')?.addEventListener('click',()=>showView('home-view'));
    $('chat-form')?.addEventListener('submit',sendChat);
    $('chat-rules-button')?.addEventListener('click',()=>{ if (!chatRulesNeverAgain()) openChatRulesModal().then(()=>{}); else { $('chat-rules-never').checked = true; $('chat-rules-modal')?.classList.remove('hidden'); } });
    $('chat-rules-accept')?.addEventListener('click',()=>finishChatRules(true));
    $('chat-rules-cancel')?.addEventListener('click',()=>finishChatRules(false));
    $('chat-rules-close')?.addEventListener('click',()=>finishChatRules(false));
    $('chat-rules-modal')?.addEventListener('click',event=>{if(event.target.id==='chat-rules-modal')finishChatRules(false);});
    $('send-free')?.addEventListener('click',sendFreeVent);
    $('send-feeling')?.addEventListener('click',sendFeelingVent);
    $('guided-next')?.addEventListener('click',guidedNext);
    $('guided-back')?.addEventListener('click',guidedBack);
    $('record-start')?.addEventListener('click',startRecording);
    $('record-stop')?.addEventListener('click',stopRecording);
    $('record-clear')?.addEventListener('click',clearRecording);
    $('record-send')?.addEventListener('click',sendAudioVent);
    $('post-send')?.addEventListener('click',sendPost);
    $('announcement-form')?.addEventListener('submit',createAnnouncement);
    $('event-form')?.addEventListener('submit',createEvent);
    $('poll-form')?.addEventListener('submit',createPoll);

    $('free-text')?.addEventListener('input',()=>{const n=$('free-text').value.length;$('free-counter').textContent=`${n} / 2000`;});
    $$('textarea').forEach(area=>{
      area.addEventListener('input',()=>{area.style.height='auto';area.style.height=`${Math.min(area.scrollHeight,320)}px`;});
      area.addEventListener('keydown',event=>{if(area.id==='chat-input'&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('chat-form')?.requestSubmit();}});
    });
    bindDelegatedEvents();
  }

  function initAuthListener(){
    state.supabase.auth.onAuthStateChange((event,session)=>{
      console.debug('CAE AUTH:',event);
      if(event==='SIGNED_OUT'){state.user=null;state.profile=null;state.session=null;state.lastHydratedAccessToken=null;showAuth();return;}
      if(event==='PASSWORD_RECOVERY'){state.session=session;state.user=session?.user||null;setTimeout(openPasswordModal,0);return;}
      if(session?.user)setTimeout(()=>hydrateSession(session),0);
    });
  }

  async function init(){
    if(state.initialized)return;state.initialized=true;bindEvents();
    if(!(await ensureDependencies()))return;
    refreshIcons();
    if(!ensureClient())return;
    initAuthListener();
    const {data,error}=await state.supabase.auth.getSession();
    if(error){console.error('SESSION',error);setStatus('login-status',errorMessage(error));return;}
    if(data.session?.user)await hydrateSession(data.session);else{showAuth();setAuthMode('login');}
  }

  init();
})();
