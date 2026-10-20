(() => {
  'use strict';

  const SUPABASE_URL = 'https://kigljplotmlzeiivrymq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_sS5QFRQeYl1uJXXzfyJdxw_ZjVO3vn4';

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
    logs: 'cae_admin_logs',
    support: 'cae_support_messages',
    privateConversations: 'cae_private_conversations',
    privateParticipants: 'cae_private_conversation_participants',
    privateRequests: 'cae_private_chat_requests',
    privateMessages: 'cae_private_messages',
    notifications: 'cae_notifications',
    moods: 'cae_mood_entries',
    bookmarks: 'cae_bookmarks',
    preferences: 'cae_user_preferences',
    deletionRequests: 'cae_account_deletion_requests',
    contentReports: 'cae_content_reports',
    sharedPodcasts: 'cae_shared_podcasts'
  });

  const AUDIO_BUCKET = 'cae-audios';

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

  const REACTIONS = [['❤️', 'heart'], ['👍', 'like'], ['👎', 'dislike']];

  const state = {
    supabase: null,
    user: null,
    profile: null,
    session: null,
    realtime: null,
    currentView: 'home-view',
    currentPanel: 'posts',
    historyFilter: 'vents',
    ventHistoryFilter: 'free',
    initialized: false,
    hydrating: false,
    guidedIndex: 0,
    guidedAnswers: [],
    selectedFeeling: null,
    ventVisibility: 'public',
    recorder: null,
    recordingChunks: [],
    audioBlob: null,
    audioMime: '',
    audioObjectUrl: null,
    publicVoiceFilter: 'anonymized',
    lastHydratedAccessToken: null,
    chatLoading: false,
    chatCooldownUntil: 0,
    chatCooldownTimer: null,
    chatRulesPendingSend: false,
    chatRulesSessionAccepted: false,
    muralLoading: false,
    muralQueued: false,
    supportConversationUserId: null,
    supportOpen: false,
    publicDirectory: new Map(),
    publicVentFilter: 'free',
    adminPrivateFilter: 'free',
    adminVentFilter: 'free',
    reportedMessageIds: new Set(),
    privateChatData: { conversations: [], incoming_requests: [], outgoing_requests: [] },
    privateSelectedConversationId: null,
    notifications: [],
    notificationsOpen: false,
    adminNotifications: [],
    adminNotificationsOpen: false,
    privateReplyVentId: null,
    adminPrivateChatData: [] ,
    adminPostRows: [],
    adminPostFilter: 'all',
    recordingStream: null,
    recordingContext: null,
    voiceTestRecorder: null,
    voiceTestChunks: [],
    voiceTestStream: null,
    voiceTestContext: null,
    voiceTestObjectUrl: null,
    ttsRecognition: null,
    ttsDictationRunning: false,
    ttsFinalTranscript: '',
    ttsDictationBaseText: '',
    ttsRecognitionResults: [],
    ttsRecognitionChoices: {},
    ttsLastProgressPercent: -1,
    ttsPipeline: null,
    ttsPipelinePromise: null,
    ttsFemaleWorker: null,
    ttsFemaleWorkerUrl: null,
    ttsFemaleRequestId: 0,
    ttsFemalePending: null,
    ttsVoiceStyle: 'female',
    ttsGenerating: false,
    audioSource: null,
    bookmarks: new Set(),
    bookmarkRows: [],
    moodRows: [],
    eventRows: [],
    notificationsEnabled: true,
    reducedMotion: false,
    ttsCancelled: false
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const MURAL_ACTIVITY_LABELS = Object.freeze({
    announcements: 'avisos',
    events: 'eventos',
    posts: 'publicações',
    polls: 'enquetes',
    podcasts: 'recomendações de podcasts'
  });

  function muralActivityStorageKey(panel) {
    return state.user ? `cae:mural:last-seen:${state.user.id}:${panel}` : '';
  }

  function markMuralPanelSeen(panel) {
    if (!state.user || !MURAL_ACTIVITY_LABELS[panel]) return;
    try {
      window.localStorage.setItem(muralActivityStorageKey(panel), String(Date.now()));
    } catch (error) {
      console.warn('MURAL ACTIVITY STORAGE', error);
    }
    const badge = $(`mural-unread-${panel}`);
    if (badge) {
      badge.textContent = '0';
      badge.classList.add('hidden');
      badge.setAttribute('aria-label', `Nenhuma nova entrada: ${MURAL_ACTIVITY_LABELS[panel]}.`);
    }
  }

  function updateMuralActivityBadge(panel, rows) {
    const badge = $(`mural-unread-${panel}`);
    if (!badge || !state.user) return;
    if (state.currentView === 'mural-view' && state.currentPanel === panel) {
      markMuralPanelSeen(panel);
      return;
    }
    try {
      const key = muralActivityStorageKey(panel);
      const stored = window.localStorage.getItem(key);
      let lastSeen = Number(stored);
      if (!stored || !Number.isFinite(lastSeen) || lastSeen <= 0) {
        lastSeen = Date.now();
        window.localStorage.setItem(key, String(lastSeen));
      }
      const unread = (rows || []).filter(row => {
        const createdAt = Date.parse(row?.created_at || '');
        return Number.isFinite(createdAt) && createdAt > lastSeen;
      }).length;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.toggle('hidden', unread === 0);
      badge.setAttribute('aria-label', `${unread} ${unread === 1 ? "nova entrada" : "novas entradas"} em ${MURAL_ACTIVITY_LABELS[panel]}.`);
    } catch (error) {
      badge.classList.add('hidden');
      console.warn('MURAL ACTIVITY STORAGE', error);
    }
  }

  // No CAE, moderador e administrador possuem a mesma permissão de equipe.
  // Mantemos os dois valores antigos no banco por compatibilidade.
  const isStaff = () => ['admin', 'moderator'].includes(state.profile?.role);
  const isAdmin = () => isStaff();

  const escapeHTML = (value) => {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  };

  const publicName = (userId) => {
    const identity = state.publicDirectory.get(userId);
    if (identity?.public_code) return `#${identity.public_code}`;
    const compact = String(userId || '').replaceAll('-', '').slice(0, 6).toUpperCase();
    return `#${compact || '000000'}`;
  };

  const publicCode = (userId) => state.publicDirectory.get(userId)?.public_code || state.profile?.public_code || '—';

  async function loadPublicDirectory() {
    if (!state.supabase) return;
    try {
      const { data, error } = await state.supabase.rpc('cae_public_directory');
      if (error) throw error;
      state.publicDirectory = new Map((data || []).map(row => [row.user_id, row]));
      const mine = state.publicDirectory.get(state.user?.id);
      if (mine) {
        if ($('account-public-id')) $('account-public-id').textContent = `Seu código público: #${mine.public_code}`;
        if ($('account-name')) $('account-name').textContent = 'Conta anônima';
        if ($('account-avatar')) $('account-avatar').textContent = String(mine.public_code || 'CA').replace(/[^A-Za-z0-9]/g,'').slice(0,2).toUpperCase() || 'CA';
      }
    } catch (error) {
      console.warn('PUBLIC DIRECTORY', error);
    }
  }

  function findAccountByIdentifier(identifier) {
    const q = String(identifier || '').trim().replace(/^#/, '').toLocaleLowerCase('pt-BR');
    if (!q) return null;
    const rows = [...state.publicDirectory.values()];
    return rows.find(row => String(row.public_code || '').toLocaleLowerCase('pt-BR') === q) || null;
  }

  function renderAdminTarget(inputId, targetId, statusId) {
    const target = findAccountByIdentifier($(inputId)?.value);
    const box = $(targetId);
    const status = $(statusId);
    if (!box) return target;
    if (!$(inputId)?.value.trim()) { box.classList.add('hidden'); box.innerHTML = ''; if (status) status.textContent = ''; return null; }
    if (!target) {
      box.classList.remove('hidden');
      box.innerHTML = '<span class="cae-danger">Nenhuma conta encontrada. Confira o código público.</span>';
      return null;
    }
    box.classList.remove('hidden');
    box.innerHTML = `<strong>Código público</strong><span>#${escapeHTML(target.public_code || '—')}</span>`;
    return target;
  }

  const initials = (name) => 'CA';

  const validSchoolEmail = (email) => /^[^\s@]+@escola\.pr\.gov\.br$/i.test(String(email || '').trim());

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
    if (/invalid login credentials/i.test(raw)) return 'E-mail ou senha incorretos.';
    if (/email not confirmed/i.test(raw)) return 'Confirme seu e-mail antes de entrar.';
    if (/already registered|user already registered/i.test(raw)) return 'Este e-mail já possui uma conta.';
    if (/password.*6|at least 6/i.test(raw)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/CAE_ADMIN_REQUIRED/i.test(raw)) return 'Essa ação é exclusiva da equipe de moderação.';
    if (/rate limit|too many requests/i.test(raw)) return 'Você está enviando muito rápido. Aguarde alguns segundos.';
    if (/row-level security|rls|not allowed|permission denied/i.test(raw)) return 'O banco bloqueou essa ação. Verifique as políticas RLS do CAE.';
    if (/relation .* does not exist|table .* does not exist/i.test(raw)) return 'Uma tabela do CAE ainda não existe no Supabase.';
    if (/column .* does not exist/i.test(raw)) return 'Uma coluna do CAE está diferente do esperado no Supabase.';
    return raw;
  };

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
    $('auth-screen')?.classList.remove('hidden');
    $('app')?.classList.add('hidden');
  }

  function showApp() {
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
    return `${window.location.origin}${window.location.pathname}`;
  }

  function readAuthRedirectError() {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    const query = String(window.location.search || '').replace(/^\?/, '');
    const params = new URLSearchParams(hash || query);
    const code = params.get('error_code') || params.get('error') || '';
    const description = params.get('error_description') || '';
    if (!code && !description) return false;
    const text = `${code} ${description}`.toLowerCase();
    if (/expired|otp_expired|invalid.*token|token.*invalid|access_denied/.test(text)) {
      setStatus('login-status', 'O link de recuperação expirou ou não é mais válido. Solicite um novo link.');
    } else {
      setStatus('login-status', 'Não foi possível concluir o acesso pelo link enviado por e-mail. Solicite um novo link.');
    }
    return true;
  }

  function clearAuthHash() {
    if (!window.location.hash) return;
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  }

  async function loadProfile() {
    const profileFields = 'id,role,banned_until,timeout_until,timeout_reason,ban_reason,public_code,join_number';
    const { data, error } = await state.supabase.from(TABLE.profiles).select(profileFields).eq('id', state.user.id).maybeSingle();
    if (error) throw error;

    if (data) {
      state.profile = data;
    } else {
      const { data: created, error: createError } = await state.supabase
        .from(TABLE.profiles)
        .insert({ id: state.user.id, role: 'student' })
        .select(profileFields)
        .single();
      if (createError) throw createError;
      state.profile = created;
    }

    const code = publicCode(state.user.id);
    if ($('account-name')) $('account-name').textContent = 'Conta anônima';
    if ($('account-email')) $('account-email').textContent = '';
    if ($('account-public-id')) $('account-public-id').textContent = `Seu código público: #${code}`;
    if ($('account-avatar')) $('account-avatar').textContent = String(code || 'CA').replace(/[^A-Za-z0-9]/g,'').slice(0,2).toUpperCase() || 'CA';
    $('nav-admin')?.classList.toggle('hidden', !isStaff());
    $$('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin()));
    const roleButton = $('admin-role-button');
    if (roleButton) { roleButton.disabled = !isStaff(); roleButton.title = isStaff() ? 'Alterar permissão da equipe' : 'Somente a equipe de moderação pode alterar permissões.'; }

    if (state.profile.banned_until && new Date(state.profile.banned_until) > new Date()) {
      const reason = String(state.profile.ban_reason || '').trim();
      toast(`Sua conta está bloqueada${reason ? ` até ${formatDate(state.profile.banned_until)}. Motivo: ${reason}` : ` até ${formatDate(state.profile.banned_until)}.`}`, 'error');
    }
    if (state.profile.timeout_until && new Date(state.profile.timeout_until) > new Date()) {
      const reason = String(state.profile.timeout_reason || '').trim();
      toast(`Sua conta está em timeout${reason ? ` até ${formatDate(state.profile.timeout_until)}. Motivo: ${reason}` : ` até ${formatDate(state.profile.timeout_until)}.`}`, 'error');
    }
  }

  function getCaptchaToken(formId, statusId) {
    const form = $(formId);
    const field = form?.querySelector('[name="cf-turnstile-response"]');
    const token = String(field?.value || '').trim();
    if (!token) {
      setStatus(statusId, 'Complete a verificação de segurança antes de continuar.');
      return null;
    }
    return token;
  }

  // O Turnstile usa tokens de uso único. Reinicie apenas o widget do formulário
  // atual para que a próxima tentativa receba um token novo.
  function resetCaptcha(formId) {
    const form = $(formId);
    const widget = form?.querySelector('.cf-turnstile');
    try {
      if (window.turnstile && widget) {
        // O contêiner permite reiniciar individualmente widgets renderizados automaticamente.
        window.turnstile.reset(widget);
      }
    } catch (resetError) {
      console.warn('CAPTCHA reset', resetError);
    }
  }

  function setAuthMode(mode) {
    const login = mode === 'login';
    $('login-form')?.classList.toggle('hidden', !login);
    $('signup-form')?.classList.toggle('hidden', login);
    $('auth-tab-login')?.classList.toggle('active', login);
    $('auth-tab-signup')?.classList.toggle('active', !login);
    setStatus('login-status', '');
    setStatus('signup-status', '');
  }

  async function login(event) {
    event.preventDefault();
    if (!ensureClient()) return;
    const email = $('login-email')?.value.trim().toLowerCase();
    const password = $('login-password')?.value || '';
    if (!validSchoolEmail(email)) return setStatus('login-status', 'Use seu e-mail escolar, terminado em @escola.pr.gov.br.');
    if (!password) return setStatus('login-status', 'Digite sua senha.');

    const button = $('login-button');
    setBusy(button, true, 'Entrando...');
    try {
      const captchaToken = getCaptchaToken('login-form', 'login-status');
    if (!captchaToken) return;
    const { data, error } = await state.supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
      if (error) throw error;
      if (!data.user || !data.session) throw new Error('O login não retornou uma sessão válida.');
      state.user = data.user;
      state.session = data.session;
      $('login-password').value = '';
      await hydrateSession(data.session);
    } catch (error) {
      console.error('LOGIN', error);
      resetCaptcha('login-form');
      setStatus('login-status', errorMessage(error));
    } finally { setBusy(button, false); }
  }

  async function signup(event) {
    event.preventDefault();
    if (!ensureClient()) return;
    const email = $('signup-email')?.value.trim().toLowerCase();
    const password = $('signup-password')?.value || '';
    if (!validSchoolEmail(email)) return setStatus('signup-status', 'Para criar uma conta, use seu e-mail escolar terminado em @escola.pr.gov.br.');
    if (password.length < 6) return setStatus('signup-status', 'A senha precisa ter pelo menos 6 caracteres.');

    const button = $('signup-button');
    setBusy(button, true, 'Criando...');
    try {
      const captchaToken = getCaptchaToken('signup-form', 'signup-status');
      if (!captchaToken) return;
      const { data, error } = await state.supabase.auth.signUp({ email, password, options: { emailRedirectTo: currentRedirect(), captchaToken } });
      if (error) throw error;
      if (data.user && data.session) {
        state.user = data.user;
        state.session = data.session;
        await hydrateSession(data.session);
      } else {
        openEmailConfirmationModal(email);
      }
    } catch (error) {
      console.error('SIGNUP', error);
      resetCaptcha('signup-form');
      setStatus('signup-status', errorMessage(error));
    } finally { setBusy(button, false); }
  }

  function openEmailConfirmationModal(email='') {
    const modal = $('email-confirm-modal');
    if (!modal) return setStatus('signup-status', 'E-mail enviado! Verifique sua caixa de entrada. Se não encontrar, confira também spam ou lixo eletrônico.', 'ok');
    modal.dataset.email = email;
    $('email-confirm-status') && setStatus('email-confirm-status', '');
    modal.classList.remove('hidden');
    refreshIcons();
  }

  function closeEmailConfirmationModal() { $('email-confirm-modal')?.classList.add('hidden'); }

  async function resendConfirmation() {
    const email = $('email-confirm-modal')?.dataset.email || $('signup-email')?.value.trim().toLowerCase();
    if (!validSchoolEmail(email)) return setStatus('email-confirm-status', 'Use o e-mail escolar terminado em @escola.pr.gov.br.');
    try {
      const { error } = await state.supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      setStatus('email-confirm-status', 'Novo e-mail enviado. Confira a caixa de entrada e também spam ou lixo eletrônico.', 'ok');
    } catch (error) { console.error('RESEND CONFIRMATION', error); setStatus('email-confirm-status', errorMessage(error)); }
  }

  async function magicLogin() {
    if (!ensureClient()) return;
    const email = $('login-email')?.value.trim().toLowerCase();
    if (!validSchoolEmail(email)) return setStatus('login-status', 'Use seu e-mail escolar, terminado em @escola.pr.gov.br.');
    const button = $('magic-button');
    setBusy(button, true, 'Enviando...');
    try {
      const captchaToken = getCaptchaToken('login-form', 'login-status');
    if (!captchaToken) return;
    const { error } = await state.supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: currentRedirect(), captchaToken } });
      if (error) throw error;
      setStatus('login-status', 'Enviamos um link de acesso para seu e-mail.', 'ok');
    } catch (error) {
      console.error('MAGIC LINK', error);
      resetCaptcha('login-form');
      setStatus('login-status', errorMessage(error));
    } finally { setBusy(button, false); }
  }

  async function forgotPassword() {
    if (!ensureClient()) return;
    const email = $('login-email')?.value.trim().toLowerCase();
    if (!validSchoolEmail(email)) return setStatus('login-status', 'Use seu e-mail escolar, terminado em @escola.pr.gov.br.');
    try {
      const captchaToken = getCaptchaToken('login-form', 'login-status');
    if (!captchaToken) return;
    const { error } = await state.supabase.auth.resetPasswordForEmail(email, { redirectTo: currentRedirect(), captchaToken });
      if (error) throw error;
      setStatus('login-status', 'Confira seu e-mail para redefinir sua senha.', 'ok');
    } catch (error) {
      console.error('RESET PASSWORD', error);
      resetCaptcha('login-form');
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
      clearAuthHash();
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
    state.privateChatData = { conversations: [], incoming_requests: [], outgoing_requests: [] };
    state.privateSelectedConversationId = null;
    state.notifications = [];
    openNotificationsPanel(false);
    closePasswordModal();
    showAuth();
    setAuthMode('login');
  }

  async function hydrateSession(session, force = false) {
    if (!session?.user || state.hydrating) return;
    if (!validSchoolEmail(session.user.email)) {
      await state.supabase?.auth.signOut();
      showAuth();
      setAuthMode('login');
      setStatus('login-status', 'O CAE aceita apenas e-mails terminados em @escola.pr.gov.br.');
      return;
    }
    if (!force && session.access_token && state.lastHydratedAccessToken === session.access_token) return;
    state.hydrating = true;
    try {
      state.session = session;
      state.user = session.user;
      await loadProfile();
      if (state.profile?.banned_until && new Date(state.profile.banned_until) > new Date()) {
        await state.supabase.auth.signOut();
        return;
      }
      await loadPublicDirectory();
      showApp();
      showView(state.currentView || 'home-view');
      prepareFeelings();
    openComposer('free');
      await loadUserPreferences();
      await Promise.allSettled([loadNotifications(), loadBookmarks()]);
      subscribeRealtime();
      state.lastHydratedAccessToken = session.access_token || null;
      refreshIcons();
    } catch (error) {
      console.error('HYDRATE', error);
      toast(`A conta entrou, mas o carregamento teve um problema: ${errorMessage(error)}`, 'error');
      showApp();
      showView('home-view');
    } finally { state.hydrating = false; }
  }

  function showAdminPanel(panel) {
    if (!isStaff()) return;
    const allowed = ['vents','posts','announcements','events','polls','podcasts','reports','private_chats','support','accounts'];
    let value = allowed.includes(panel) ? panel : 'vents';
    if (value === 'accounts' && !isStaff()) value = 'vents';
    $$('[data-admin-tab]').forEach(button => {
      const active = button.dataset.adminTab === value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('[data-admin-panel]').forEach(panelEl => {
      const active = panelEl.dataset.adminPanel === value;
      panelEl.classList.toggle('active', active);
      panelEl.classList.toggle('hidden', !active);
    });
    if (value === 'private_chats') loadAdminPrivateChats();
    if (value === 'podcasts') loadAdminSharedPodcasts();
    refreshIcons();
  }

  function ensureViewHelpButton(viewId) {
    const view = $(viewId);
    if (!view) return;
    const heading = view.querySelector(':scope > .section-head, :scope > .home-simple-head');
    if (!heading || heading.querySelector('[data-site-help]')) return;
    const titles = {
      'home-view': ['Página inicial', 'Use os atalhos para abrir as áreas principais do CAE. Desabafos é para escrever ou ler relatos; Mural reúne avisos, eventos, publicações, enquetes e podcasts; Histórico guarda seus registros pessoais e itens salvos.'],
      'chat-view': ['Chat público', 'Converse com outros estudantes usando seu código público. Não compartilhe dados pessoais, senhas ou informações que identifiquem você. Use Denunciar se encontrar uma mensagem inadequada.'],
      'private-conversations-view': ['Conversas privadas', 'Você pode convidar alguém pelo código público. A conversa só começa depois que a outra pessoa aceitar. As mensagens podem ser verificadas pela equipe em situações de segurança.'],
      'mural-view': ['Mural', 'Aqui ficam avisos, eventos, publicações, enquetes e podcasts. Use as abas para trocar de assunto. Você pode salvar conteúdos para encontrá-los depois no Histórico.'],
      'history-view': ['Seu histórico', 'Reúne seus desabafos, registros privados de bem-estar e conteúdos salvos. As abas organizam cada tipo de registro; seus dados pessoais ficam visíveis apenas para sua conta.'],
      'help-view': ['Ajuda e contatos', 'Encontre serviços de apoio e canais de contato. Em risco imediato, use os telefones de emergência exibidos nesta página.'],
      'account-view': ['Sua conta', 'Consulte seu código público, opções de privacidade e preferências. O código público ajuda a conversar sem exibir seu e-mail ou nome real.'],
      'privacy-view': ['Central de privacidade', 'Veja quais dados são usados pelo CAE, como funciona o anonimato e quais controles você pode solicitar.'],
      'admin-view': ['Central da equipe', 'Área exclusiva de moderação. Cada aba reúne uma tarefa: revisar conteúdos, analisar denúncias, gerenciar recomendações e atender solicitações.'],
      'admin-private-history-view': ['Histórico privado', 'Área restrita à equipe autorizada para verificar desabafos privados em situações previstas pelas regras de segurança.']
    };
    const content = titles[viewId] || ['Sobre esta área', 'Esta seção reúne as ferramentas indicadas pelo título. Leia as instruções próximas a cada botão antes de enviar ou compartilhar informações.'];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'help-question';
    button.dataset.siteHelp = '1';
    button.dataset.helpTitle = content[0];
    button.dataset.helpText = content[1];
    button.textContent = '?';
    const actions = heading.querySelector('.home-simple-actions');
    if (actions) actions.appendChild(button);
    else heading.appendChild(button);
  }

  function showView(id) {
    if (!state.user) return showAuth();
    if (id === 'admin-view' && !isStaff()) id = 'home-view';
    if (id === 'admin-private-history-view' && !isStaff()) id = 'home-view';
    $$('.view').forEach(view => view.classList.remove('active'));
    $(id)?.classList.add('active');
    ensureViewHelpButton(id);
    state.currentView = id;
    $$('.nav [data-view]').forEach(button => {
      const active = button.dataset.view === id;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    if (id === 'chat-view') { loadChat(); }
    if (id === 'private-conversations-view') loadPrivateChatData(state.privateSelectedConversationId);
    if (id === 'desabafo-view') loadPublicVents();
    if (id === 'mural-view') { loadMural(); loadCommunityPodcasts(); }
    if (id === 'history-view') loadHistory(state.historyFilter);
    if (id === 'admin-view' && isStaff()) { showAdminPanel('vents'); loadAdmin(); loadAdminNotifications(); }
    if (id === 'admin-private-history-view' && isStaff()) loadAdminPrivateHistory();
    if (id === 'help-view') loadSupportChat();
    refreshIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchMuralPanel(panel) {
    if (!MURAL_ACTIVITY_LABELS[panel]) return;
    state.currentPanel = panel;
    $$('[data-panel]').forEach(button => {
      const active = button.dataset.panel === panel;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $$('.panel').forEach(el => {
      const active = el.id === `panel-${panel}`;
      el.classList.toggle('active', active);
      el.setAttribute('aria-hidden', String(!active));
    });
    markMuralPanelSeen(panel);
    if (panel === 'podcasts') loadCommunityPodcasts();
    if (state.user) loadMural();
  }

  function bindTabArrowNavigation(container, selector, activate) {
    if (!container) return;
    container.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = $$(selector);
      const current = event.target.closest('[role="tab"]');
      const index = tabs.indexOf(current);
      if (index < 0 || !tabs.length) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      activate(tabs[nextIndex]);
    });
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
    const value = ['free','guided','feelings','audio'].includes(type) ? type : 'free';
    $$('.compose').forEach(el => el.classList.add('hidden'));
    $$('[data-compose]').forEach(button => button.classList.toggle('active', button.dataset.compose === value));
    $(`compose-${value}`)?.classList.remove('hidden');
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
      updateAudioAnonymityNotice();
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

  function setVentVisibility(visibility) {
    const value = visibility === 'private' ? 'private' : 'public';
    state.ventVisibility = value;
    $$('[data-vent-visibility]').forEach(button => {
      const active = button.dataset.ventVisibility === value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const help = $('vent-visibility-help');
    if (help) {
      help.textContent = value === 'private'
        ? 'Este desabafo não será publicado. Textos privados ficam com você e administradores; áudios privados também podem ser revisados pela moderação autorizada.'
        : 'Depois de aprovado, fica disponível para todos na área Desabafos.';
    }
    updateAudioAnonymityNotice();
    refreshIcons();
  }

  function ensureAccountCanInteract() {
    if (state.profile?.banned_until && new Date(state.profile.banned_until) > new Date()) {
      const reason = String(state.profile.ban_reason || '').trim();
      toast(`Sua conta está bloqueada${reason ? `. Motivo: ${reason}` : '.'}`, 'error');
      return false;
    }
    if (state.profile?.timeout_until && new Date(state.profile.timeout_until) > new Date()) {
      const reason = String(state.profile.timeout_reason || '').trim();
      toast(`Você está em timeout${reason ? `. Motivo: ${reason}` : '.'}`, 'error');
      return false;
    }
    return true;
  }

  async function finishVent(type, body = null, feeling = null, audioPath = null) {
    if (!ensureAccountCanInteract()) return false;
    if (!body && !audioPath) return false;
    const { error } = await state.supabase.from(TABLE.vents).insert({
      user_id: state.user.id,
      type,
      body: body || null,
      feeling: feeling || null,
      audio_url: audioPath || null,
      visibility: state.ventVisibility
    });
    if (error) throw error;
    await loadHistory();
    setVentVisibility('public');
    $$('.compose').forEach(el => el.classList.add('hidden'));
    toast('Desabafo enviado.');
    return true;
  }

  async function sendFreeVent() {
    const text = $('free-text')?.value.trim();
    if (!text) return toast('Escreva seu desabafo antes de enviar.', 'error');
    const button = $('send-free');
    setBusy(button, true, 'Enviando...');
    try {
      const sent = await finishVent('free', text);
      if (!sent) return;
      $('free-text').value = '';
      $('free-counter').textContent = '0 / 2000';
    } catch (error) {
      console.error('VENT FREE', error);
      toast(errorMessage(error), 'error');
    } finally { setBusy(button, false); }
  }

  function selectFeeling(feeling, button) {
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
      const sent = await finishVent('feelings', text, state.selectedFeeling);
      if (!sent) return;
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

  function updateAudioAnonymityNotice() {
    selectPublicVoiceFilter(state.publicVoiceFilter);
    const picker = $('voice-filter-picker');
    picker?.classList.toggle('hidden', state.ventVisibility !== 'public');
    const note = $('audio-anonymity-text');
    if (!note) return;
    note.textContent = state.ventVisibility === 'public'
      ? 'Quando este desabafo estiver público, sua voz receberá um filtro real antes do envio para dificultar sua identificação. Áudio privado não recebe esse filtro.'
      : 'Este desabafo está privado, então o áudio não recebe o filtro de anonimização. Ele fica acessível somente às pessoas autorizadas.';
  }

  function resetRecordingUI() {
    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
      state.audioObjectUrl = null;
    }
    if (state.recordingStream) {
      state.recordingStream.getTracks().forEach(track => track.stop());
      state.recordingStream = null;
    }
    if (state.recordingContext) {
      state.recordingContext.close().catch(() => {});
      state.recordingContext = null;
    }
    const preview = $('audio-preview');
    if (preview) {
      preview.pause();
      preview.removeAttribute('src');
      preview.load();
      preview.classList.add('hidden');
    }
    state.audioBlob = null;
    state.audioSource = null;
    state.recordingChunks = [];
    state.recorder = null;
    $('record-status').textContent = 'Pronto para gravar.';
    $('record-start').disabled = false;
    $('record-stop').disabled = true;
    $('record-clear').disabled = true;
    $('record-send').disabled = true;
    updateAudioAnonymityNotice();
  }

  const PUBLIC_VOICE_FILTERS = Object.freeze({
    anonymized: { label: 'Anônimo', description: 'Filtro mais forte para alterar bastante o timbre da voz.', color: 'blue' },
    robot: { label: 'Robótico', description: 'Timbre metálico e modulado, deixando a voz menos natural.', color: 'violet' },
    radio: { label: 'Rádio', description: 'Faixa de frequência reduzida, parecida com uma transmissão de rádio.', color: 'slate' },
    muffled: { label: 'Abafado', description: 'Corta parte das frequências para deixar a voz mais fechada e diferente.', color: 'cyan' }
  });

  function selectPublicVoiceFilter(filter) {
    if (state.recorder?.state === 'recording') return toast('Pare a gravação antes de trocar o filtro de voz.', 'error');
    if (state.voiceTestRecorder?.state === 'recording') return toast('Pare o teste antes de trocar o filtro de voz.', 'error');
    const value = PUBLIC_VOICE_FILTERS[filter] ? filter : 'anonymized';
    state.publicVoiceFilter = value;
    document.querySelectorAll('[data-voice-filter]').forEach(button => {
      const active = button.dataset.voiceFilter === value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const selected = $('audio-filter-selected');
    if (selected) selected.textContent = `${PUBLIC_VOICE_FILTERS[value].label}: ${PUBLIC_VOICE_FILTERS[value].description}`;
    clearVoiceTestPreview();
    const status=$('voice-filter-test-status');
    if(status)status.textContent='O teste é local e não é enviado.';
  }

  function stopVoiceTestResources() {
    if(state.voiceTestStream){state.voiceTestStream.getTracks().forEach(track=>track.stop());state.voiceTestStream=null;}
    if(state.voiceTestContext){state.voiceTestContext.close().catch(()=>{});state.voiceTestContext=null;}
    state.voiceTestRecorder=null;
  }

  function clearVoiceTestPreview() {
    if(state.voiceTestObjectUrl){URL.revokeObjectURL(state.voiceTestObjectUrl);state.voiceTestObjectUrl=null;}
    const preview=$('voice-filter-test-preview');
    if(preview){preview.pause();preview.removeAttribute('src');preview.load();preview.classList.add('hidden');}
  }

  async function testSelectedVoiceFilter(button) {
    if(state.recorder?.state==='recording')return toast('Pare a gravação principal antes de testar um filtro.','error');
    if(state.ttsDictationRunning)return toast('Pare a transcrição por voz antes de testar um filtro.','error');
    if(state.voiceTestRecorder?.state==='recording'){state.voiceTestRecorder.stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return toast('Seu navegador não permite o teste de áudio.','error');
    try{
      clearVoiceTestPreview();stopVoiceTestResources();
      const rawStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      const AudioContextCtor=window.AudioContext||window.webkitAudioContext;
      if(!AudioContextCtor)throw new Error('Seu navegador não suporta os filtros de voz necessários.');
      const context=new AudioContextCtor();if(context.state==='suspended')await context.resume();
      const source=context.createMediaStreamSource(rawStream),destination=context.createMediaStreamDestination();
      const filter=buildPublicVoiceFilter(context);source.connect(filter.input);let current=filter.input;
      for(const node of filter.nodes.slice(1)){current.connect(node);current=node;}
      current.connect(filter.output);filter.output.connect(destination);
      const candidates=['audio/webm;codecs=opus','audio/webm','audio/mp4'];const mime=candidates.find(type=>MediaRecorder.isTypeSupported?.(type))||'';
      const recorder=mime?new MediaRecorder(destination.stream,{mimeType:mime}):new MediaRecorder(destination.stream);
      state.voiceTestRecorder=recorder;state.voiceTestChunks=[];state.voiceTestStream=rawStream;state.voiceTestContext=context;
      const startedAt=Date.now();
      const timer=window.setInterval(()=>{const elapsed=Math.min(5000,Date.now()-startedAt),remaining=Math.max(0,5000-elapsed);const status=$('voice-filter-test-status');if(status)status.textContent=`Gravando teste… ${Math.ceil(remaining/1000)} s. Fale normalmente.`;if(elapsed>=5000&&recorder.state!=='inactive'){window.clearInterval(timer);recorder.stop();}},100);
      recorder.ondataavailable=event=>{if(event.data?.size)state.voiceTestChunks.push(event.data);};
      recorder.onerror=event=>{window.clearInterval(timer);console.error('VOICE TEST',event);stopVoiceTestResources();const status=$('voice-filter-test-status');if(status)status.textContent='O teste falhou. Tente novamente.';};
      recorder.onstop=()=>{window.clearInterval(timer);const blob=new Blob(state.voiceTestChunks,{type:mime||'audio/webm'});if(state.voiceTestObjectUrl)URL.revokeObjectURL(state.voiceTestObjectUrl);state.voiceTestObjectUrl=URL.createObjectURL(blob);const preview=$('voice-filter-test-preview');if(preview){preview.src=state.voiceTestObjectUrl;preview.classList.remove('hidden');}const status=$('voice-filter-test-status');if(status)status.textContent=`Teste pronto com “${PUBLIC_VOICE_FILTERS[state.publicVoiceFilter].label}”. Não foi enviado.`;stopVoiceTestResources();if(button){button.disabled=false;button.innerHTML='<i data-lucide="mic-2"></i>Testar este filtro (até 5 s)';refreshIcons();}};
      recorder.start();button.disabled=false;button.innerHTML='<i data-lucide="square"></i>Parar teste';refreshIcons();const status=$('voice-filter-test-status');if(status)status.textContent='Gravando teste… até 5 s. Fale normalmente.';
    }catch(error){console.error('VOICE TEST START',error);stopVoiceTestResources();const status=$('voice-filter-test-status');if(status)status.textContent='Não foi possível iniciar o teste.';toast(error?.message||'Não foi possível acessar o microfone.','error');}
  }

  function createVoiceFilterCurve(amount = 2.4) {
    const curve = new Float32Array(44100);
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2) / curve.length - 1;
      curve[i] = Math.tanh(x * amount) * 0.82;
    }
    return curve;
  }

  function buildPublicVoiceFilter(context) {
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const shaper = context.createWaveShaper();
    const compressor = context.createDynamicsCompressor();
    const output = context.createGain();
    highpass.type = 'highpass';
    lowpass.type = 'lowpass';
    output.gain.value = 0.82;
    compressor.threshold.value = -24;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;

    const extras = [];
    let nodes = [highpass, lowpass, shaper, compressor];

    switch (state.publicVoiceFilter) {
      case 'robot': {
        highpass.frequency.value = 190;
        lowpass.frequency.value = 2700;
        shaper.curve = createVoiceFilterCurve(4.5);
        shaper.oversample = '4x';
        const ringGain = context.createGain();
        const ring = context.createOscillator();
        ring.frequency.value = 46;
        ring.connect(ringGain.gain);
        ring.start();
        nodes.push(ringGain);
        const tremolo = context.createOscillator();
        const depth = context.createGain();
        tremolo.frequency.value = 12;
        depth.gain.value = 0.13;
        tremolo.connect(depth).connect(output.gain);
        tremolo.start();
        extras.push(ring, ringGain, tremolo, depth);
        break;
      }
      case 'radio':
        highpass.frequency.value = 320;
        lowpass.frequency.value = 2300;
        shaper.curve = createVoiceFilterCurve(3.0);
        shaper.oversample = '4x';
        break;
      case 'muffled':
        highpass.frequency.value = 85;
        lowpass.frequency.value = 1450;
        shaper.curve = createVoiceFilterCurve(1.55);
        shaper.oversample = '2x';
        break;
      default: {
        highpass.frequency.value = 170;
        lowpass.frequency.value = 3000;
        shaper.curve = createVoiceFilterCurve(4.1);
        shaper.oversample = '4x';
        const ringGain = context.createGain();
        const ring = context.createOscillator();
        ring.frequency.value = 33;
        ring.connect(ringGain.gain);
        ring.start();
        nodes.push(ringGain);
        extras.push(ring, ringGain);
        break;
      }
    }

    return { input: highpass, nodes, output, extras };
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Seu navegador não permite gravação de áudio aqui.', 'error');
    if (!ensureAccountCanInteract()) return;
    if (state.ttsDictationRunning) stopTtsDictation();
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mime = candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
      state.audioMime = mime;
      state.recordingChunks = [];
      state.audioBlob = null;
      state.audioSource = null;
      if (state.audioObjectUrl) { URL.revokeObjectURL(state.audioObjectUrl); state.audioObjectUrl = null; }
      const previousPreview = $('audio-preview');
      if (previousPreview) { previousPreview.pause(); previousPreview.removeAttribute('src'); previousPreview.load(); previousPreview.classList.add('hidden'); }
      state.recordingStream = rawStream;

      let recordStream = rawStream;
      if (state.ventVisibility === 'public') {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
          rawStream.getTracks().forEach(track => track.stop());
          state.recordingStream = null;
          throw new Error('Seu navegador não suporta os filtros de voz necessários para publicar este áudio. Tente usar um navegador atualizado.');
        }
        const context = new AudioContextCtor();
        if (context.state === 'suspended') await context.resume();
        const source = context.createMediaStreamSource(rawStream);
        const destination = context.createMediaStreamDestination();
        const filter = buildPublicVoiceFilter(context);
        let current = source;
        current.connect(filter.input);
        current = filter.input;
        for (const node of filter.nodes.slice(1)) {
          current.connect(node);
          current = node;
        }
        current.connect(filter.output);
        filter.output.connect(destination);
        state.recordingContext = context;
        recordStream = destination.stream;
      }

      state.recorder = mime ? new MediaRecorder(recordStream, { mimeType: mime }) : new MediaRecorder(recordStream);
      state.recorder.ondataavailable = event => { if (event.data?.size) state.recordingChunks.push(event.data); };
      state.recorder.onerror = event => { console.error('MEDIA RECORDER', event); toast('A gravação encontrou um erro.', 'error'); };
      state.recorder.onstop = () => {
        const type = state.audioMime || 'audio/webm';
        state.audioBlob = new Blob(state.recordingChunks, { type });
        state.audioSource = 'recorded';
        state.audioObjectUrl = URL.createObjectURL(state.audioBlob);
        const preview = $('audio-preview');
        preview.src = state.audioObjectUrl;
        preview.classList.remove('hidden');
        $('record-status').textContent = state.ventVisibility === 'public'
          ? `Gravação com filtro “${PUBLIC_VOICE_FILTERS[state.publicVoiceFilter].label}” pronta. Ouça antes de enviar.`
          : 'Gravação pronta. Ouça antes de enviar.';
        $('record-start').disabled = false;
        $('record-stop').disabled = true;
        $('record-clear').disabled = false;
        $('record-send').disabled = false;
        if (state.recordingStream) { state.recordingStream.getTracks().forEach(track => track.stop()); state.recordingStream = null; }
        if (state.recordingContext) { state.recordingContext.close().catch(() => {}); state.recordingContext = null; }
      };
      state.recorder.start();
      $('record-status').textContent = state.ventVisibility === 'public'
        ? `Gravando com filtro “${PUBLIC_VOICE_FILTERS[state.publicVoiceFilter].label}”...`
        : 'Gravando... toque em Parar quando terminar.';
      $('record-start').disabled = true;
      $('record-stop').disabled = false;
      $('record-clear').disabled = true;
      $('record-send').disabled = true;
    } catch (error) {
      console.error('RECORD', error);
      if (state.recordingStream) state.recordingStream.getTracks().forEach(track => track.stop());
      state.recordingStream = null;
      if (state.recordingContext) { state.recordingContext.close().catch(() => {}); state.recordingContext = null; }
      toast(error?.message || 'Não foi possível acessar o microfone. Confira a permissão do navegador.', 'error');
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
    const path = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
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
        const sent = await finishVent('audio', null, null, path);
        if (!sent) { await state.supabase.storage.from(AUDIO_BUCKET).remove([path]).catch(() => {}); return; }
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

  const TTS_TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
  const TTS_PORTUGUESE_MODEL = 'Xenova/mms-tts-por';
  // Usa o arquivo ESM compilado do pacote para evitar a reescrita de módulos internos pelo CDN.
  const TTS_PIPER_MODULE_URL = 'https://unpkg.com/piper-tts-web@1.1.2/dist/piper-tts-web.js';
  // Os arquivos da voz feminina ficam no próprio repositório do CAE.
  // Assim, a síntese não depende do Hugging Face e respeita o caminho do GitHub Pages.
  const TTS_DII_CONFIG_URL = new URL('assets/voices/dii_pt-BR.onnx.json', document.baseURI).href;
  const TTS_DII_MODEL_URL = new URL('assets/voices/dii_pt-BR.onnx', document.baseURI).href;
  const TTS_PIPER_ASSETS = 'https://unpkg.com/piper-tts-web@1.1.2/dist/';

  function chooseTextVoice(style) {
    if (state.ttsGenerating) return;
    const nextStyle = style === 'male' ? 'male' : 'female';
    if (nextStyle !== state.ttsVoiceStyle) {
      // Mantém apenas o mecanismo escolhido na memória para reduzir o uso de RAM.
      if (nextStyle === 'male' && state.ttsFemaleWorker) destroyFemaleTtsWorker();
      if (nextStyle === 'female' && state.ttsPipeline) {
        state.ttsPipeline = null;
        state.ttsPipelinePromise = null;
      }
    }
    state.ttsVoiceStyle = nextStyle;
    $$('[data-tts-voice]').forEach(button => {
      const active = button.dataset.ttsVoice === state.ttsVoiceStyle;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (state.audioSource === 'tts') resetRecordingUI();
    const status = $('tts-generation-status');
    if (status) status.textContent = state.ttsVoiceStyle === 'female'
      ? ''
      : 'Voz masculina selecionada. A voz atual foi mantida.';
  }

  function setTtsDictationStatus(message) {
    const node = $('tts-dictation-status');
    if (node) node.textContent = message;
  }

  function updateTtsDictationButton(running) {
    const button = $('tts-dictate');
    if (!button) return;
    button.innerHTML = running
      ? '<i data-lucide="square"></i>Parar de ouvir'
      : '<i data-lucide="mic"></i>Falar e transcrever';
    refreshIcons();
  }

  function stopTtsDictation() {
    try { state.ttsRecognition?.stop(); } catch (_) {}
    state.ttsDictationRunning = false;
    updateTtsDictationButton(false);
    state.ttsFinalTranscript = $('tts-transcript')?.value.trim() || state.ttsFinalTranscript;
  }

  function renderTtsTranscriptFromResults() {
    const recognizedParts = (state.ttsRecognitionResults || []).map((result, index) => {
      const selected = Number(state.ttsRecognitionChoices?.[index]) || 0;
      return result?.alternatives?.[selected] || result?.alternatives?.[0] || '';
    }).filter(Boolean);
    const recognizedText = recognizedParts.join(' ').replace(/\s+/g, ' ').trim();
    state.ttsFinalTranscript = [state.ttsDictationBaseText, recognizedText]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const textarea = $('tts-transcript');
    if (textarea) {
      const transcript = state.ttsFinalTranscript.slice(0, 1600);
      if (textarea.value !== transcript) textarea.value = transcript;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
    }
  }

  function renderTtsTranscriptAlternatives() {
    const container = $('tts-transcript-alternatives');
    if (!container) return;
    let targetIndex = -1;
    for (let index = (state.ttsRecognitionResults || []).length - 1; index >= 0; index--) {
      const result = state.ttsRecognitionResults[index];
      const unique = [...new Set((result?.alternatives || []).map(text => text.trim()).filter(Boolean))];
      if (result?.isFinal && unique.length > 1) { targetIndex = index; break; }
    }
    if (targetIndex < 0) {
      container.replaceChildren();
      container.classList.add('hidden');
      return;
    }
    const alternatives = [];
    state.ttsRecognitionResults[targetIndex].alternatives.forEach((rawText, index) => {
      const text = String(rawText || '').trim();
      if (text && !alternatives.some(option => option.text === text)) alternatives.push({ text, index });
    });
    const selectedIndex = Number(state.ttsRecognitionChoices?.[targetIndex]) || 0;
    const options = alternatives.filter(option => option.index !== selectedIndex).slice(0, 2);
    if (!options.length) {
      container.replaceChildren();
      container.classList.add('hidden');
      return;
    }
    container.replaceChildren();
    const label = document.createElement('span');
    label.className = 'cae-muted';
    label.textContent = 'O navegador também entendeu:';
    container.append(label);
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ghost btn-small';
      button.textContent = option.text;
      button.addEventListener('click', () => {
        state.ttsRecognitionChoices[targetIndex] = option.index;
        renderTtsTranscriptFromResults();
        renderTtsTranscriptAlternatives();
      });
      container.append(button);
    }
    container.classList.remove('hidden');
  }

  function startTtsDictation() {
    if (state.ttsGenerating) return toast('Espere a geração de voz terminar antes de iniciar outra ação.', 'error');
    if (state.recorder?.state === 'recording' || state.voiceTestRecorder?.state === 'recording') {
      toast('Pare a gravação ou o teste de filtro antes de iniciar a transcrição.', 'error');
      return;
    }
    if (state.ttsDictationRunning) {
      stopTtsDictation();
      setTtsDictationStatus('Escuta encerrada. Revise a transcrição antes de gerar a voz.');
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setTtsDictationStatus('Este navegador não oferece transcrição por voz. Você ainda pode digitar o texto manualmente.');
      toast('Este navegador não permite falar para preencher o texto. Você pode digitar e gerar o áudio normalmente.', 'error');
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;
      // Quando o navegador oferece viés contextual, prioriza termos comuns do CAE.
      // Esse recurso é experimental; a transcrição continua funcionando sem ele.
      try {
        if ('phrases' in recognition && typeof window.SpeechRecognitionPhrase === 'function') {
          recognition.phrases = ['CAE', 'desabafo', 'desabafar', 'mural', 'enquete', 'moderação', 'São José dos Pinhais', 'Paraná', 'Ipê', 'áudio', 'estudante', 'aluno', 'professor', 'professora', 'acolhimento', 'orientação', 'ansiedade', 'bullying']
            .map(phrase => new window.SpeechRecognitionPhrase(phrase, 3));
        }
      } catch (phraseError) { console.debug('TTS CONTEXT HINTS', phraseError); }
      // A lista de resultados contém a sessão inteira; reconstruímos o texto a cada
      // evento para evitar repetir trechos finais enviados novamente pelo navegador.
      state.ttsDictationBaseText = $('tts-transcript')?.value.trim() || '';
      state.ttsFinalTranscript = state.ttsDictationBaseText;
      state.ttsRecognitionResults = [];
      state.ttsRecognitionChoices = {};
      const alternativesBox = $('tts-transcript-alternatives');
      if (alternativesBox) { alternativesBox.replaceChildren(); alternativesBox.classList.add('hidden'); }
      state.ttsRecognition = recognition;
      state.ttsDictationRunning = true;
      updateTtsDictationButton(true);
      setTtsDictationStatus('Ouvindo… fale normalmente. Toque em “Parar de ouvir” quando terminar.');

      recognition.onresult = event => {
        // Atualiza os resultados da sessão e preserva as alternativas disponíveis.
        state.ttsRecognitionResults = Array.from(event.results || []).map(result => {
          const alternatives = [];
          for (let index = 0; index < (result?.length || 0); index++) {
            const phrase = String(result[index]?.transcript || '').trim();
            if (phrase && !alternatives.includes(phrase)) alternatives.push(phrase);
          }
          return { alternatives, isFinal: Boolean(result?.isFinal) };
        });
        renderTtsTranscriptFromResults();
        renderTtsTranscriptAlternatives();
      };
      recognition.onerror = event => {
        const descriptions = {
          'not-allowed': 'Permissão do microfone negada. Autorize o microfone nas configurações do navegador.',
          'service-not-allowed': 'Não foi possível reconhecer sua fala. Você pode digitar o texto.',
          'no-speech': 'Não detectei fala. Tente novamente ou digite o texto.',
          'network': 'É preciso estar conectado à internet para reconhecer a fala neste navegador.',
          'audio-capture': 'Não consegui acessar o microfone.'
        };
        setTtsDictationStatus(descriptions[event.error] || 'A transcrição foi interrompida. Revise o texto e tente novamente.');
      };
      recognition.onend = () => {
        state.ttsDictationRunning = false;
        state.ttsFinalTranscript = $('tts-transcript')?.value.trim() || state.ttsFinalTranscript;
        updateTtsDictationButton(false);
        if (state.ttsRecognition === recognition) state.ttsRecognition = null;
        if (($('tts-transcript')?.value || '').trim()) setTtsDictationStatus('Texto pronto. Confira, corrija se precisar e gere o áudio.');
      };
      recognition.start();
    } catch (error) {
      state.ttsDictationRunning = false;
      state.ttsRecognition = null;
      updateTtsDictationButton(false);
      setTtsDictationStatus('Não consegui iniciar a gravação. Confira se o navegador pode usar o microfone.');
      console.error('TTS DICTATION', error);
    }
  }

  async function loadPortugueseTtsModel() {
    if (state.ttsPipeline) return state.ttsPipeline;
    if (state.ttsPipelinePromise) return state.ttsPipelinePromise;
    state.ttsPipelinePromise = (async () => {
      const status = $('tts-generation-status');
      if (status) status.textContent = 'Carregando o mecanismo de voz… Na primeira utilização, o navegador baixa o modelo e guarda os arquivos em cache.';
      const transformers = await import(TTS_TRANSFORMERS_URL);
      if (transformers.env) {
        transformers.env.allowLocalModels = false;
        transformers.env.allowRemoteModels = true;
        transformers.env.useBrowserCache = true;
        // Executa o WASM em worker para reduzir os travamentos da interface durante
        // o carregamento e a geração de áudio, principalmente em celulares.
        try {
          if (transformers.env.backends?.onnx?.wasm) {
            transformers.env.backends.onnx.wasm.proxy = true;
            transformers.env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(2, Number(navigator.hardwareConcurrency) || 2));
          }
        } catch (workerConfigError) {
          console.warn('TTS WORKER CONFIG', workerConfigError);
        }
      }
      state.ttsLastProgressPercent = -1;
      const progressCallback = progress => {
        if (!status) return;
        if (progress?.status === 'progress' && Number.isFinite(progress.progress)) {
          const percent = Math.max(0, Math.min(100, Math.floor(progress.progress)));
          // Atualizar o DOM em cada fragmento baixado pode gerar trabalho desnecessário.
          if (percent === 0 || percent === 100 || percent - state.ttsLastProgressPercent >= 5) {
            state.ttsLastProgressPercent = percent;
            status.textContent = `Preparando a voz: ${percent}%.`;
          }
        } else if (progress?.status === 'done') {
          status.textContent = 'Voz pronta. Criando o áudio…';
        }
      };
      const synthesizer = await transformers.pipeline('text-to-speech', TTS_PORTUGUESE_MODEL, {
        quantized: true,
        progress_callback: progressCallback
      });
      state.ttsPipeline = synthesizer;
      return synthesizer;
    })();
    try {
      return await state.ttsPipelinePromise;
    } finally {
      state.ttsPipelinePromise = null;
    }
  }

  function destroyFemaleTtsWorker() {
    const pending = state.ttsFemalePending;
    state.ttsFemalePending = null;
    if (pending) pending.reject(new Error('A geração da voz feminina foi interrompida.'));
    try { state.ttsFemaleWorker?.terminate(); } catch (_) {}
    state.ttsFemaleWorker = null;
    if (state.ttsFemaleWorkerUrl) {
      URL.revokeObjectURL(state.ttsFemaleWorkerUrl);
      state.ttsFemaleWorkerUrl = null;
    }
  }

  function createFemaleTtsWorker() {
    if (state.ttsFemaleWorker) return state.ttsFemaleWorker;
    if (!window.Worker || !window.Blob || !URL.createObjectURL) {
      throw new Error('Este navegador não oferece suporte ao processamento em segundo plano da voz feminina.');
    }
    const workerSource = `
      let enginePromise = null;
      let piperModulePromise = null;
      const PIPER_MODULE_URL = ${JSON.stringify(TTS_PIPER_MODULE_URL)};
      const ONNX_BASE = ${JSON.stringify(`${TTS_PIPER_ASSETS}onnx/`)};
      const PIPER_BASE = ${JSON.stringify(`${TTS_PIPER_ASSETS}piper/`)};
      const CONFIG_URL = ${JSON.stringify(TTS_DII_CONFIG_URL)};
      const MODEL_URL = ${JSON.stringify(TTS_DII_MODEL_URL)};

      async function loadPiperModule() {
        if (!piperModulePromise) {
          piperModulePromise = import(PIPER_MODULE_URL).catch(error => {
            piperModulePromise = null;
            console.error('PIPER BUNDLE LOAD FAILED', PIPER_MODULE_URL, error);
            throw new Error('Não foi possível baixar o mecanismo da voz feminina. Verifique a conexão com a internet e tente novamente.');
          });
        }
        return piperModulePromise;
      }

      async function createEngine(requestId) {
        self.postMessage({ type: 'status', id: requestId, message: 'Preparando a voz feminina…' });
        const piperModule = await loadPiperModule();
        const PiperWebEngine = piperModule.PiperWebEngine;
        const OnnxWebRuntime = piperModule.OnnxWebRuntime;
        const PhonemizeWebRuntime = piperModule.PhonemizeWebRuntime;
        if (!PiperWebEngine || !OnnxWebRuntime || !PhonemizeWebRuntime) {
          throw new Error('A distribuição do Piper carregou, mas não disponibilizou os componentes necessários.');
        }
        let voiceDataPromise = null;
        const voiceProvider = {
          async fetch() {
            if (!voiceDataPromise) {
              self.postMessage({ type: 'status', id: requestId, message: 'Carregando a voz feminina do CAE…' });
              voiceDataPromise = (async () => {
                const [configResponse, modelResponse] = await Promise.all([
                  fetch(CONFIG_URL, { credentials: 'same-origin', cache: 'force-cache' }),
                  fetch(MODEL_URL, { credentials: 'same-origin', cache: 'force-cache' })
                ]);
                if (!configResponse.ok || !modelResponse.ok) {
                  throw new Error('Não encontrei os arquivos locais da voz feminina. Confira se a pasta assets/voices foi enviada junto com o CAE.');
                }
                const [config, model] = await Promise.all([configResponse.json(), modelResponse.arrayBuffer()]);
                if (config?.lang_code !== 'pt-BR' || config?.espeak?.voice !== 'pt-br') {
                  throw new Error('A configuração da voz feminina está inválida ou não corresponde ao português brasileiro.');
                }
                if (!model || model.byteLength < 60000000) {
                  throw new Error('O modelo feminino veio incompleto. Atualize os arquivos do CAE e tente novamente.');
                }
                return [config, model];
              })().catch(error => {
                voiceDataPromise = null;
                throw error;
              });
            }
            return voiceDataPromise;
          },
          destroy() { voiceDataPromise = null; }
        };
        const engine = new PiperWebEngine({
          onnxRuntime: new OnnxWebRuntime({ basePath: ONNX_BASE, numThreads: 1 }),
          phonemizeRuntime: new PhonemizeWebRuntime({ basePath: PIPER_BASE }),
          expressionRuntime: { destroy() {} },
          voiceProvider
        });
        return engine;
      }

      self.onmessage = async event => {
        const { id, text } = event.data || {};
        if (!id || !text) return;
        try {
          if (!enginePromise) enginePromise = createEngine(id);
          const engine = await enginePromise;
          self.postMessage({ type: 'status', id, message: 'Gerando o áudio com a voz feminina…' });
          const result = await engine.generate(text, 'pt-BR-dii', 0);
          if (!result?.file || !result.file.size) throw new Error('A voz feminina não conseguiu criar um áudio válido.');
          self.postMessage({ type: 'done', id, file: result.file });
        } catch (error) {
          try { enginePromise?.then(engine => engine?.destroy?.()).catch(() => {}); } catch (_) {}
          enginePromise = null;
          self.postMessage({ type: 'error', id, message: error?.message || 'Não foi possível gerar a voz feminina.' });
        }
      };
    `;
    const workerBlob = new Blob([workerSource], { type: 'text/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);
    const worker = new Worker(workerUrl, { type: 'module' });
    state.ttsFemaleWorkerUrl = workerUrl;
    state.ttsFemaleWorker = worker;
    worker.onmessage = event => {
      const data = event.data || {};
      if (state.ttsFemaleWorkerUrl && data.type === 'status') {
        URL.revokeObjectURL(state.ttsFemaleWorkerUrl);
        state.ttsFemaleWorkerUrl = null;
      }
      const pending = state.ttsFemalePending;
      if (!pending || data.id !== pending.id) return;
      if (data.type === 'status') {
        if (pending.onStatus) pending.onStatus(data.message);
      } else if (data.type === 'done') {
        state.ttsFemalePending = null;
        pending.resolve(data.file);
      } else if (data.type === 'error') {
        state.ttsFemalePending = null;
        pending.reject(new Error(data.message || 'Não foi possível gerar a voz feminina.'));
      }
    };
    worker.onerror = event => {
      const pending = state.ttsFemalePending;
      state.ttsFemalePending = null;
      if (pending) pending.reject(new Error(event.message || 'O processamento da voz feminina foi interrompido.'));
      destroyFemaleTtsWorker();
    };
    return worker;
  }

  function generateFemaleTtsAudio(text) {
    const worker = createFemaleTtsWorker();
    const id = ++state.ttsFemaleRequestId;
    return new Promise((resolve, reject) => {
      state.ttsFemalePending = {
        id,
        resolve,
        reject,
        onStatus: message => {
          const status = $('tts-generation-status');
          if (status && message) status.textContent = message;
        }
      };
      worker.postMessage({ id, text });
    });
  }

  // Aumenta ou reduz o tom por reamostragem. Não tenta imitar uma pessoa específica.
  function adjustNarrationPitch(samples, semitones) {
    const source = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    if (!source.length || !semitones) return source;
    const factor = Math.pow(2, semitones / 12);
    const length = Math.max(1, Math.floor(source.length / factor));
    const result = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const position = i * factor;
      const left = Math.min(source.length - 1, Math.floor(position));
      const right = Math.min(source.length - 1, left + 1);
      const fraction = position - left;
      result[i] = source[left] * (1 - fraction) + source[right] * fraction;
    }
    return result;
  }

  function createWavBlob(samples, sampleRate) {
    const data = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    if (!data.length || !Number.isFinite(sampleRate)) throw new Error('A síntese não gerou um áudio válido.');
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + data.length * bytesPerSample);
    const view = new DataView(buffer);
    const writeText = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + data.length * bytesPerSample, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, data.length * bytesPerSample, true);
    let offset = 44;
    for (let i = 0; i < data.length; i++, offset += 2) {
      const sample = Math.max(-1, Math.min(1, data[i]));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function generateTextVoice() {
    if (state.ttsGenerating) return;
    state.ttsCancelled = false;
    const text = $('tts-transcript')?.value.trim() || '';
    if (!text) {
      toast('Fale para transcrever ou digite o texto que você quer transformar em voz.', 'error');
      $('tts-transcript')?.focus();
      return;
    }
    if (text.length > 1600) {
      toast('O texto está muito longo. Reduza para até 1.600 caracteres para gerar o áudio.', 'error');
      return;
    }
    if (!ensureAccountCanInteract()) return;
    const cancelButton = $('tts-cancel');
    if (cancelButton) cancelButton.classList.toggle('hidden', state.ttsVoiceStyle !== 'female');
    state.ttsGenerating = true;
    const button = $('tts-generate');
    setBusy(button, true, 'Gerando voz…');
    const status = $('tts-generation-status');
    try {
      stopTtsDictation();
      let blob;
      if (state.ttsVoiceStyle === 'female') {
        if (status) status.textContent = 'Preparando a voz feminina…';
        const generatedFile = await generateFemaleTtsAudio(text);
        if (!(generatedFile instanceof Blob) || !generatedFile.size) {
          throw new Error('A voz feminina não conseguiu criar um áudio válido. Tente novamente com um texto menor.');
        }
        blob = generatedFile.type ? generatedFile : new Blob([generatedFile], { type: 'audio/wav' });
      } else {
        const synthesizer = await loadPortugueseTtsModel();
        if (status) status.textContent = 'Gerando o áudio em português. Isso pode levar um pouco em celulares mais simples…';
        const output = await synthesizer(text);
        const sampleRate = Number(output?.sampling_rate) || 16000;
        const rawAudio = output?.audio;
        if (!rawAudio || !rawAudio.length) throw new Error('O mecanismo não retornou áudio. Tente novamente com um texto menor.');
        // Mantém a voz masculina atual e seu tom grave, sem alterar o comportamento já conhecido.
        const processedSamples = adjustNarrationPitch(rawAudio, -2.2);
        blob = createWavBlob(processedSamples, sampleRate);
      }
      if (state.audioObjectUrl) URL.revokeObjectURL(state.audioObjectUrl);
      state.audioBlob = blob;
      state.audioSource = 'tts';
      state.audioMime = 'audio/wav';
      state.recordingChunks = [];
      state.audioObjectUrl = URL.createObjectURL(blob);
      const preview = $('audio-preview');
      if (preview) {
        preview.src = state.audioObjectUrl;
        preview.classList.remove('hidden');
        preview.load();
      }
      const voiceLabel = state.ttsVoiceStyle === 'female' ? 'feminina' : 'masculina';
      $('record-status').textContent = `Áudio com voz sintética ${voiceLabel} pronto. Ouça no player acima e toque em “Enviar áudio” para publicar.`;
      $('record-start').disabled = false;
      $('record-stop').disabled = true;
      $('record-clear').disabled = false;
      $('record-send').disabled = false;
      if (status) status.textContent = `Áudio gerado com voz sintética ${voiceLabel}. Ouça o resultado antes de enviar. A transcrição não é anexada ao desabafo.`;
    } catch (error) {
      if (state.ttsVoiceStyle === 'female') destroyFemaleTtsWorker();
      console.error('TEXT TO VOICE', error);
      if (state.ttsCancelled) {
        if (status) status.textContent = 'Geração cancelada. Você pode tentar novamente quando quiser.';
      } else {
        if (status) status.textContent = error?.message || 'Não foi possível gerar a voz. Confira a conexão e tente novamente.';
        toast(error?.message || 'Não foi possível gerar a voz. Tente novamente.', 'error');
      }
    } finally {
      state.ttsGenerating = false;
      if (cancelButton) cancelButton.classList.add('hidden');
      setBusy(button, false);
    }
  }

  async function loadReportedMessageIds() {
    if (!state.user || !state.supabase) return;
    try {
      const { data, error } = await state.supabase.from(TABLE.reports).select('message_id').eq('reporter_id', state.user.id).limit(500);
      if (error) throw error;
      state.reportedMessageIds = new Set((data || []).map(row => String(row.message_id)));
    } catch (error) {
      console.warn('REPORTED MESSAGES', error);
    }
  }

  const CHAT_RULES_STORAGE_KEY = 'cae_chat_rules_accepted_v1';

  function chatRulesAccepted() {
    if (state.chatRulesSessionAccepted) return true;
    try { return window.localStorage.getItem(CHAT_RULES_STORAGE_KEY) === '1'; }
    catch (error) { console.warn('CHAT RULES STORAGE', error); return false; }
  }

  function openChatRules(pendingSend = false) {
    state.chatRulesPendingSend = pendingSend;
    const modal = $('chat-rules-modal');
    if (!modal) {
      console.error('CAE: #chat-rules-modal não encontrado no HTML.');
      return;
    }
    const checkbox = $('chat-rules-never');
    if (checkbox) checkbox.checked = false;
    setStatus('chat-rules-status', '');
    modal.classList.remove('hidden');
    modal.removeAttribute('hidden');
    modal.style.display = 'grid';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.zIndex = '99999';
    document.body.classList.add('modal-open');
    setTimeout(() => $('chat-rules-accept')?.focus(), 0);
    refreshIcons();
  }

  function closeChatRules(clearPending = true) {
    if (clearPending) state.chatRulesPendingSend = false;
    const modal = $('chat-rules-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      modal.style.visibility = 'hidden';
    }
    document.body.classList.remove('modal-open');
  }

  async function acceptChatRules() {
    const persist = Boolean($('chat-rules-never')?.checked);
    state.chatRulesSessionAccepted = true;
    if (persist) {
      try { window.localStorage.setItem(CHAT_RULES_STORAGE_KEY, '1'); }
      catch (error) { console.warn('CHAT RULES STORAGE', error); }
    }
    const shouldSend = state.chatRulesPendingSend;
    closeChatRules();
    if (shouldSend) {
      state.chatRulesPendingSend = false;
      await sendChat();
    }
  }

  async function loadChat() {
    if (!state.user || !state.supabase || state.chatLoading) return;
    const box = $('chat-messages');
    if (!box) return;
    state.chatLoading = true;
    try {
      await loadReportedMessageIds();
      const { data, error } = await state.supabase.from(TABLE.chat)
        .select('id,user_id,body,created_at,deleted_at')
        .order('created_at', { ascending: true }).limit(200);
      if (error) throw error;
      const visible = (data || []).filter(message => !state.reportedMessageIds.has(String(message.id)));
      renderChat(visible);
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
      const name = publicName(message.user_id);
      const own = message.user_id === state.user.id;
      const deleted = Boolean(message.deleted_at);
      return `<article class="chat-message">
        <div class="chat-avatar">${escapeHTML(initials(name))}</div>
        <div class="chat-bubble">
          <div><span class="chat-name">${escapeHTML(name)}</span><span class="chat-time">${escapeHTML(formatDate(message.created_at))}</span></div>
          <div class="chat-body">${deleted ? '<i>Mensagem removida pela moderação.</i>' : escapeHTML(message.body).replace(/\n/g, '<br>')}</div>
          ${!deleted ? `<div class="chat-actions chat-actions-row"><button type="button" data-report-message="${escapeHTML(message.id)}">Denunciar</button>${isStaff() && !own ? `<button type="button" class="chat-admin-action" data-direct-timeout="${escapeHTML(message.user_id)}" title="Timeout de 10 minutos">Timeout</button><button type="button" class="chat-admin-action danger" data-direct-ban="${escapeHTML(message.user_id)}">Banir</button>` : ''}</div>` : ''}
          ${!deleted && isStaff() ? `<div class="chat-actions"><button type="button" data-hide-message="${escapeHTML(message.id)}">Ocultar</button></div>` : ''}
          ${deleted && isStaff() ? `<div class="chat-actions"><button type="button" data-delete-message="${escapeHTML(message.id)}">Excluir definitivamente</button></div>` : ''}
        </div>
      </article>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function updateChatCooldownUI() {
    const button = $('chat-send');
    if (!button) return;
    const remaining = Math.max(0, state.chatCooldownUntil - Date.now());
    if (remaining <= 0) {
      if (state.chatCooldownTimer) {
        clearInterval(state.chatCooldownTimer);
        state.chatCooldownTimer = null;
      }
      button.disabled = false;
      button.textContent = 'Enviar';
      return;
    }
    button.disabled = true;
    button.textContent = `Aguarde ${Math.ceil(remaining / 1000)}s`;
  }

  function startChatCooldown() {
    state.chatCooldownUntil = Date.now() + 10000;
    if (state.chatCooldownTimer) clearInterval(state.chatCooldownTimer);
    updateChatCooldownUI();
    state.chatCooldownTimer = setInterval(updateChatCooldownUI, 250);
  }

  async function sendChat(event) {
    if (event?.preventDefault) event.preventDefault();
    const body = $('chat-input')?.value.trim();
    if (!body || !state.user) return;
    if (!chatRulesAccepted()) {
      openChatRules(true);
      return;
    }
    const remaining = state.chatCooldownUntil - Date.now();
    if (remaining > 0) {
      toast(`Aguarde ${Math.ceil(remaining / 1000)} segundos para enviar outra mensagem.`, 'error');
      updateChatCooldownUI();
      return;
    }
    if (!ensureAccountCanInteract()) return;
    if (body.length > 1500) return toast('A mensagem é longa demais.', 'error');
    const button = $('chat-send');
    setBusy(button, true, 'Enviando...');
    try {
      const { error } = await state.supabase.from(TABLE.chat).insert({ user_id: state.user.id, body });
      if (error) throw error;
      $('chat-input').value = '';
      startChatCooldown();
      await loadChat();
    } catch (error) {
      console.error('CHAT SEND', error);
      toast(errorMessage(error), 'error');
    } finally {
      if (Date.now() >= state.chatCooldownUntil) setBusy(button, false);
      updateChatCooldownUI();
      $('chat-input')?.focus();
    }
  }

  function ensureReasonModal() {
    let modal = $('cae-moderation-reason-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'cae-moderation-reason-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.style.cssText = 'position:fixed;inset:0;display:none;place-items:center;background:rgba(0,0,0,.55);z-index:100000;padding:20px;';
    modal.innerHTML = `
      <div role="dialog" aria-modal="true" style="width:min(560px,100%);background:var(--card,#fff);color:var(--text,#222);border-radius:18px;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.28);">
        <h3 id="cae-moderation-reason-title" style="margin:0 0 8px;">Motivo da moderação</h3>
        <p id="cae-moderation-reason-help" style="margin:0 0 14px;">Escreva o motivo que será mostrado à pessoa.</p>
        <textarea id="cae-moderation-reason-input" maxlength="1000" rows="5" placeholder="Ex.: mensagens ofensivas repetidas..." style="width:100%;box-sizing:border-box;resize:vertical;min-height:120px;"></textarea>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">
          <button type="button" id="cae-moderation-reason-cancel" class="btn secondary">Cancelar</button>
          <button type="button" id="cae-moderation-reason-confirm" class="btn primary">Continuar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function askModerationReason(action, label) {
    return new Promise(resolve => {
      const modal = ensureReasonModal();
      const actionLabels = {
        ban: 'banir',
        timeout: 'dar timeout em',
        reject_content: 'recusar'
      };
      const actionLabel = actionLabels[action] || 'moderar';
      const title = $('cae-moderation-reason-title');
      const help = $('cae-moderation-reason-help');
      const input = $('cae-moderation-reason-input');
      const confirmButton = $('cae-moderation-reason-confirm');
      const cancelButton = $('cae-moderation-reason-cancel');
      if (title) title.textContent = `Motivo para ${actionLabel} ${label}`;
      if (help) help.textContent = action === 'reject_content'
        ? 'Explique de forma clara por que o conteúdo não foi aprovado. O estudante receberá esse motivo em uma notificação.'
        : 'Esse motivo será mostrado à pessoa punida.';
      if (input) input.value = '';
      modal.style.display = 'grid';
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');

      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        confirmButton?.removeEventListener('click', onConfirm);
        cancelButton?.removeEventListener('click', onCancel);
        input?.removeEventListener('keydown', onKeydown);
        resolve(value);
      };
      const onConfirm = () => {
        const value = String(input?.value || '').trim();
        if (!value) return toast(action === 'reject_content' ? 'É necessário explicar por que o conteúdo foi recusado.' : 'É necessário informar um motivo para aplicar a punição.', 'error');
        if (value.length > 1000) return toast('O motivo pode ter no máximo 1000 caracteres.', 'error');
        finish(value);
      };
      const onCancel = () => finish(null);
      const onKeydown = event => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) onConfirm();
      };
      confirmButton?.addEventListener('click', onConfirm);
      cancelButton?.addEventListener('click', onCancel);
      input?.addEventListener('keydown', onKeydown);
      setTimeout(() => input?.focus(), 0);
    });
  }

  async function reportMessage(messageId) {
    const reason = window.prompt('Por que você quer denunciar esta mensagem?');
    if (!reason?.trim()) return;
    try {
      const { error } = await state.supabase.from(TABLE.reports).insert({ message_id: messageId, reporter_id: state.user.id, reason: reason.trim() });
      if (error) throw error;
      state.reportedMessageIds.add(String(messageId));
      await loadChat();
      toast('Denúncia enviada. A mensagem foi ocultada para você e encaminhada à moderação.');
      if (isStaff()) await loadAdmin();
    } catch (error) { console.error('REPORT', error); toast(errorMessage(error), 'error'); }
  }

  async function directAccountModeration(userId, action, sourceButton = null) {
    if (!isStaff()) return toast('Somente a equipe de moderação pode banir ou aplicar timeout.', 'error');
    const target = state.publicDirectory.get(userId);
    if (!target || userId === state.user.id) return toast('Essa conta não pode ser moderada diretamente.', 'error');
    const label = `#${target.public_code || 'conta'}`;
    const reason = await askModerationReason(action, label);
    if (!reason) return;
    const message = action === 'ban'
      ? `Bloquear ${label} permanentemente?\n\nMotivo: ${reason}`
      : `Aplicar timeout de 10 minutos em ${label}?\n\nMotivo: ${reason}`;
    if (!window.confirm(message)) return;
    setBusy(sourceButton, true, 'Aplicando...');
    try {
      const { error } = await state.supabase.rpc('cae_staff_moderate_account_with_reason', {
        p_target_user_id: userId,
        p_action: action,
        p_minutes: action === 'timeout' ? 10 : null,
        p_reason: reason
      });
      if (error) throw error;
      await logAdmin(`direct_account_${action}`, 'profile', userId, action === 'timeout' ? { minutes: 10, source: 'chat', reason } : { source: 'chat', reason });
      toast(action === 'ban' ? `${label} foi bloqueado.` : `${label} recebeu timeout por 10 minutos.`);
      await loadProfile();
      await loadChat();
      if (isStaff()) await loadAdmin();
    } catch (error) {
      console.error('DIRECT ACCOUNT MODERATION', error);
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(sourceButton, false);
    }
  }

  async function hideMessage(messageId) {
    if (!isStaff()) return false;
    if (!window.confirm('Ocultar esta mensagem do chat?')) return false;
    try {
      const { error } = await state.supabase.from(TABLE.chat).update({ deleted_at: new Date().toISOString() }).eq('id', messageId);
      if (error) throw error;
      await logAdmin('hide_chat_message', 'chat_message', messageId);
      toast('Mensagem ocultada.');
      await loadChat();
      if (isStaff()) await loadAdmin();
      return true;
    } catch (error) { console.error('HIDE MESSAGE', error); toast(errorMessage(error), 'error'); return false; }
  }

  async function deleteStaffContent(contentType, contentId, label='conteúdo') {
    if (!isStaff() || !state.supabase) return false;
    const safeType = String(contentType || '').trim().toLowerCase();
    const safeId = String(contentId || '').trim();
    if (!safeType || !safeId) return false;
    if (!window.confirm(`Excluir ${label} permanentemente? Esta ação não pode ser desfeita.`)) return false;
    try {
      const { error } = await state.supabase.rpc('cae_staff_delete_content', {
        p_content_type: safeType,
        p_content_id: safeId
      });
      if (error) throw error;
      await logAdmin('delete_content', safeType, safeId, { label });
      toast(`${label.charAt(0).toUpperCase()+label.slice(1)} excluído permanentemente.`);
      if (safeType === 'chat_message') await loadChat();
      if (safeType === 'support_message') { await loadSupportChat(); await loadAdminSupport(); }
      if (safeType === 'post') { await loadPosts(); }
      if (safeType === 'announcement') { await loadAnnouncements(); }
      if (safeType === 'event') { await loadEvents(); }
      if (safeType === 'poll') { await loadPolls(); }
      if (safeType === 'vent') { await loadPublicVents(); await loadHistory(); }
      if (isStaff()) await loadAdmin();
      return true;
    } catch (error) {
      console.error('DELETE STAFF CONTENT', error);
      toast(errorMessage(error), 'error');
      return false;
    }
  }

  async function deleteChatMessage(messageId) {
    return deleteStaffContent('chat_message', messageId, 'esta mensagem');
  }


  function openAdminNotificationsPanel(force = null) {
    if (!isStaff()) return;
    const panel = $('admin-notifications-panel');
    const button = $('admin-notifications-button');
    if (!panel || !button) return;
    state.adminNotificationsOpen = force === null ? !state.adminNotificationsOpen : Boolean(force);
    panel.classList.toggle('hidden', !state.adminNotificationsOpen);
    button.setAttribute('aria-expanded', String(state.adminNotificationsOpen));
  }

  async function loadAdminNotifications() {
    const shell = $('.admin-notification-shell');
    if (!isStaff() || !state.user || !state.supabase) {
      shell?.classList.add('hidden');
      return;
    }
    shell?.classList.remove('hidden');
    try {
      const { data, error } = await state.supabase.from('cae_admin_notifications')
        .select('id,user_id,type,title,body,target_view,target_id,created_at,read_at')
        .order('created_at', { ascending: false }).limit(60);
      if (error) throw error;
      state.adminNotifications = data || [];
      const unread = state.adminNotifications.filter(item => !item.read_at).length;
      const badge = $('admin-notifications-badge');
      if (badge) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.toggle('hidden', unread === 0);
      }
      const list = $('admin-notifications-list');
      if (!list) return;
      list.innerHTML = state.adminNotifications.length ? state.adminNotifications.map(item =>
        `<button type="button" class="notification-item ${item.read_at ? '' : 'unread'}" data-open-admin-notification="${escapeHTML(item.id)}"><span class="notification-icon"><i data-lucide="bell-ring"></i></span><span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.body)}</small><em>${escapeHTML(formatDate(item.created_at))}</em></span></button>`
      ).join('') : '<div class="notification-empty"><i data-lucide="bell-off"></i><p>Nenhum alerta administrativo ainda.</p></div>';
      refreshIcons();
    } catch (error) {
      console.error('ADMIN NOTIFICATIONS', error);
      const list = $('admin-notifications-list');
      if (list) list.innerHTML = '<div class="notification-empty"><p class="cae-danger">Não foi possível carregar os alertas da equipe.</p></div>';
    }
  }

  async function markAdminNotificationRead(id) {
    if (!isStaff() || !id || !state.user) return;
    const { error } = await state.supabase.from('cae_admin_notifications')
      .update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', state.user.id);
    if (error) console.warn('ADMIN NOTIFICATION READ', error);
  }

  async function markAllAdminNotificationsRead() {
    if (!isStaff() || !state.user) return;
    const { error } = await state.supabase.from('cae_admin_notifications')
      .update({ read_at: new Date().toISOString() }).eq('user_id', state.user.id).is('read_at', null);
    if (error) return toast(errorMessage(error), 'error');
    await loadAdminNotifications();
  }

  async function openAdminNotification(id) {
    if (!isStaff()) return;
    const item = state.adminNotifications.find(row => String(row.id) === String(id));
    if (!item) return;
    await markAdminNotificationRead(id);
    openAdminNotificationsPanel(false);
    const tabs = {
      new_vent: 'vents',
      new_post: 'posts',
      new_podcast: 'podcasts',
      content_report: 'reports',
      chat_report: 'reports',
      account_deletion: 'accounts',
      support_message: 'support'
    };
    showView('admin-view');
    showAdminPanel(tabs[item.type] || 'vents');
    await loadAdminNotifications();
  }

  function openNotificationsPanel(force = null) {
    const panel = $('notifications-panel');
    const button = $('notifications-button');
    if (!panel || !button) return;
    state.notificationsOpen = force === null ? !state.notificationsOpen : Boolean(force);
    panel.classList.toggle('hidden', !state.notificationsOpen);
    button.setAttribute('aria-expanded', String(state.notificationsOpen));
  }

  async function loadNotifications() {
    if (!state.user || !state.supabase) return;
    try {
      const { data, error } = await state.supabase.from(TABLE.notifications)
        .select('id,user_id,type,title,body,target_view,target_id,created_at,read_at')
        .order('created_at',{ascending:false}).limit(60);
      if (error) throw error;

      // Alertas administrativos entram no mesmo sininho, mas só são consultados
      // e exibidos quando a conta pertence à equipe.
      let adminRows = [];
      if (isStaff()) {
        const adminResult = await state.supabase.from('cae_admin_notifications')
          .select('id,user_id,type,title,body,target_view,target_id,created_at,read_at')
          .order('created_at',{ascending:false}).limit(60);
        if (adminResult.error) throw adminResult.error;
        adminRows = (adminResult.data || []).map(item => ({ ...item, notification_source: 'admin' }));
      }
      state.notifications = [
        ...(data || []).map(item => ({ ...item, notification_source: 'user' })),
        ...adminRows
      ].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0,60);

      const unread = state.notifications.filter(n => !n.read_at).length;
      const badge = $('notifications-badge');
      if (badge) { badge.textContent = unread > 99 ? '99+' : String(unread); badge.classList.toggle('hidden', unread === 0 || !state.notificationsEnabled); }
      document.querySelector('.notification-shell')?.classList.toggle('hidden', !state.notificationsEnabled);
      const list = $('notifications-list');
      if (!list) return;
      list.innerHTML = state.notifications.length ? state.notifications.map(n => `<button type="button" class="notification-item ${n.read_at?'':'unread'}" data-open-notification="${escapeHTML(n.id)}" data-notification-source="${n.notification_source}"><span class="notification-icon"><i data-lucide="${n.notification_source==='admin'?'bell-ring':n.type==='private_message'||n.type==='staff_reply'||n.type==='vent_reply'?'message-circle':n.type==='content_rejected'?'shield-alert':n.type.includes('request')?'user-plus':'bell'}"></i></span><span><strong>${escapeHTML(n.title)}</strong><small>${escapeHTML(n.body)}</small><em>${escapeHTML(formatDate(n.created_at))}</em></span></button>`).join('') : '<div class="notification-empty"><i data-lucide="bell-off"></i><p>Nenhuma notificação ainda.</p></div>';
      refreshIcons();
    } catch (error) { console.warn('NOTIFICATIONS', error); }
  }

  async function markNotificationRead(id, source = 'user') {
    if (!id || !state.user) return;
    const table = source === 'admin' && isStaff() ? 'cae_admin_notifications' : TABLE.notifications;
    const { error } = await state.supabase.from(table).update({read_at:new Date().toISOString()}).eq('id',id).eq('user_id',state.user.id);
    if (error) console.warn('NOTIFICATION READ', error);
  }

  async function markAllNotificationsRead() {
    if (!state.user) return;
    const readAt = new Date().toISOString();
    const { error } = await state.supabase.from(TABLE.notifications).update({read_at:readAt}).eq('user_id',state.user.id).is('read_at',null);
    if (error) return toast(errorMessage(error),'error');
    if (isStaff()) {
      const adminResult = await state.supabase.from('cae_admin_notifications').update({read_at:readAt}).eq('user_id',state.user.id).is('read_at',null);
      if (adminResult.error) return toast(errorMessage(adminResult.error),'error');
    }
    await loadNotifications();
  }

  async function openNotification(id) {
    const notification = state.notifications.find(n => String(n.id) === String(id));
    if (!notification) return;
    if (notification.notification_source === 'admin' && !isStaff()) return;
    await markNotificationRead(id, notification.notification_source);
    openNotificationsPanel(false);
    if (notification.notification_source === 'admin') {
      const tabs = { new_vent:'vents', new_post:'posts', new_podcast:'podcasts', content_report:'reports', chat_report:'reports', account_deletion:'accounts', support_message:'support' };
      showView('admin-view');
      showAdminPanel(tabs[notification.type] || 'vents');
      await loadNotifications();
      return;
    }
    const target = notification.target_view || 'private-conversations-view';
    showView(target);
    if (target === 'private-conversations-view' && notification.target_id) await loadPrivateChatData(notification.target_id);
  }

  function renderPrivateTarget() {
    const target = findAccountByIdentifier($('private-chat-code')?.value);
    const box = $('private-chat-target');
    if (!box) return target;
    if (!target || target.user_id === state.user.id) { box.classList.toggle('hidden', !$('private-chat-code')?.value.trim()); box.innerHTML = target ? '<span class="cae-danger">Este é o seu próprio código.</span>' : '<span class="cae-danger">Nenhuma conta encontrada.</span>'; return target; }
    box.classList.remove('hidden');
    box.innerHTML = `<strong>Destino</strong><span>#${escapeHTML(target.public_code || '—')}</span>`;
    return target;
  }

  async function requestPrivateChat() {
    if (!state.user) return;
    const target = renderPrivateTarget();
    if (!target || target.user_id === state.user.id) return toast('Digite um código público válido de outra pessoa.','error');
    const button = $('private-chat-request'); setBusy(button,true,'Enviando...');
    try {
      const { error } = await state.supabase.rpc('cae_request_private_chat',{p_target_user_id:target.user_id});
      if (error) throw error;
      setStatus('private-chat-request-status', `Convite enviado para #${target.public_code}. A conversa só começa depois que a pessoa aceitar.`,'ok');
      toast('Convite enviado.');
      $('private-chat-code').value=''; $('private-chat-target')?.classList.add('hidden');
      await loadPrivateChatData();
    } catch(error){console.error('PRIVATE REQUEST',error);setStatus('private-chat-request-status',errorMessage(error));}
    finally{setBusy(button,false);}
  }

  function renderPrivateRequests(data) {
    const list=$('private-request-list'); const count=$('private-request-count');
    const incoming=data.incoming_requests||[];
    if(count)count.textContent=String(incoming.length);
    if(!list)return;
    list.innerHTML=incoming.length?incoming.map(r=>`<article class="private-request-item"><div><strong>#${escapeHTML(r.requester_code||'conta')}</strong><small>Quer iniciar uma conversa privada com você.</small><em>${escapeHTML(formatDate(r.created_at))}</em></div><div class="actions"><button class="btn primary btn-small" type="button" data-private-request-action="accept" data-private-request-id="${escapeHTML(r.id)}">Aceitar</button><button class="btn secondary btn-small" type="button" data-private-request-action="reject" data-private-request-id="${escapeHTML(r.id)}">Recusar</button></div></article>`).join(''):'<div class="private-chat-empty compact"><p>Nenhuma solicitação pendente.</p></div>';
  }

  function otherPrivateParticipant(conversation) {
    return (conversation.participants||[]).find(p=>p.user_id!==state.user.id) || null;
  }

  function renderPrivateConversationList(conversations) {
    const sidebar=document.querySelector('.private-chat-sidebar');
    if(!sidebar)return;
    let box=$('private-conversation-list');
    if(!box){
      const card=document.createElement('div'); card.className='card'; card.innerHTML='<div class="eyebrow">Suas conversas</div><h3>Conversas ativas</h3><div id="private-conversation-list" class="private-conversation-list"></div>'; sidebar.appendChild(card); box=$('private-conversation-list');
    }
    box.innerHTML=conversations.length?conversations.map(c=>{const other=otherPrivateParticipant(c);const last=(c.messages||[]).at(-1);return `<button type="button" class="private-conversation-item ${c.id===state.privateSelectedConversationId?'active':''}" data-private-conversation-id="${escapeHTML(c.id)}"><span class="notification-icon"><i data-lucide="${c.source_type==='vent_reply'?'message-circle':'lock-keyhole'}"></i></span><span><strong>#${escapeHTML(other?.public_code||'conversa')}</strong><small>${escapeHTML(last?.body||'Conversa iniciada')}</small><em>${escapeHTML(last?.created_at?formatDate(last.created_at):'')}</em></span></button>`}).join(''):'<div class="private-chat-empty compact"><p>Você ainda não tem conversas ativas.</p></div>';
  }

  function renderPrivateThread(conversation) {
    const head=$('private-chat-thread-head'), thread=$('private-chat-thread'), form=$('private-chat-form');
    if(!head||!thread||!form)return;
    if(!conversation){
      head.innerHTML='<div><div class="eyebrow">Conversa</div><strong>Selecione uma conversa</strong></div><span class="cae-muted">Privada</span>';
      thread.innerHTML='<div class="private-chat-empty"><i data-lucide="message-circle-lock"></i><h3>Suas conversas aparecem aqui.</h3><p class="muted">Aceite um convite recebido ou abra uma conversa já autorizada.</p></div>';
      form.classList.add('hidden'); refreshIcons(); return;
    }
    const other=otherPrivateParticipant(conversation);
    head.innerHTML=`<div><div class="eyebrow">${conversation.source_type==='vent_reply'?'Resposta da equipe':'Conversa privada'}</div><strong>#${escapeHTML(other?.public_code||'conta')}</strong></div><span class="cae-muted">Somente participantes</span>`;
    thread.innerHTML=(conversation.messages||[]).map(m=>`<div class="private-message ${m.sender_id===state.user.id?'own':''}"><div class="private-message-label">${m.sender_id===state.user.id?'Você':`#${escapeHTML((conversation.participants||[]).find(p=>p.user_id===m.sender_id)?.public_code||'conta')}`} · ${escapeHTML(formatDate(m.created_at))}</div><div class="private-message-body">${escapeHTML(m.body).replace(/\n/g,'<br>')}</div>${m.sender_id!==state.user.id?`<div class="private-message-actions"><button class="btn ghost btn-small" type="button" data-report-content="private_message" data-report-id="${escapeHTML(m.id)}">Denunciar</button></div>`:''}</div>`).join('') || '<div class="private-chat-empty compact"><p>A conversa está pronta. Mande a primeira mensagem.</p></div>';
    form.classList.remove('hidden');
    thread.scrollTop=thread.scrollHeight;
    refreshIcons();
  }

  async function loadPrivateChatData(preferredId=null) {
    if(!state.user||!state.supabase)return;
    try{
      const {data,error}=await state.supabase.rpc('cae_get_my_private_chat_data');if(error)throw error;
      state.privateChatData = data || {conversations:[],incoming_requests:[],outgoing_requests:[]};
      renderPrivateRequests(state.privateChatData);
      renderPrivateConversationList(state.privateChatData.conversations||[]);
      const list=state.privateChatData.conversations||[];
      const preferred=preferredId || state.privateSelectedConversationId;
      state.privateSelectedConversationId = list.some(c=>String(c.id)===String(preferred)) ? preferred : (list[0]?.id||null);
      const selected=list.find(c=>String(c.id)===String(state.privateSelectedConversationId));
      renderPrivateThread(selected||null);
      refreshIcons();
    }catch(error){console.error('PRIVATE CHAT LOAD',error);$('private-chat-thread')?.replaceChildren();toast(`Conversas privadas: ${errorMessage(error)}`,'error');}
  }

  async function respondPrivateRequest(requestId,accept) {
    try{const {data,error}=await state.supabase.rpc('cae_respond_private_chat_request',{p_request_id:requestId,p_accept:accept});if(error)throw error;toast(accept?'Convite aceito.':'Convite recusado.');await loadPrivateChatData(data?.conversation_id||null);}catch(error){console.error('PRIVATE REQUEST RESPOND',error);toast(errorMessage(error),'error');}
  }

  async function sendPrivateMessage(event) {
    event.preventDefault();
    if(!state.privateSelectedConversationId)return;
    const input=$('private-chat-input');const body=input?.value.trim();if(!body)return;
    if(!ensureAccountCanInteract())return;
    const button=$('private-chat-send');setBusy(button,true,'Enviando...');
    try{const {error}=await state.supabase.rpc('cae_send_private_message',{p_conversation_id:state.privateSelectedConversationId,p_body:body});if(error)throw error;input.value='';await loadPrivateChatData(state.privateSelectedConversationId);}catch(error){console.error('PRIVATE SEND',error);toast(errorMessage(error),'error');}finally{setBusy(button,false);input?.focus();}
  }

  function openPrivateReplyModal(ventId, code) {
    state.privateReplyVentId=ventId;
    const modal=$('private-reply-modal'); if(!modal)return;
    $('private-reply-title').textContent=`Responder a ${code||'este desabafo'}`;
    $('private-reply-input').value=''; setStatus('private-reply-status',''); modal.classList.remove('hidden'); $('private-reply-input').focus(); refreshIcons();
  }
  function closePrivateReplyModal(){state.privateReplyVentId=null;$('private-reply-modal')?.classList.add('hidden');$('private-reply-input').value='';setStatus('private-reply-status','');}
  async function sendPrivateVentReply(){
    if(!isStaff()||!state.privateReplyVentId)return;
    const body=$('private-reply-input')?.value.trim();if(!body)return setStatus('private-reply-status','Escreva a resposta antes de enviar.');
    const button=$('private-reply-send');setBusy(button,true,'Enviando...');
    try{const {data,error}=await state.supabase.rpc('cae_staff_reply_to_vent',{p_vent_id:state.privateReplyVentId,p_body:body});if(error)throw error;closePrivateReplyModal();toast('Resposta privada enviada. A pessoa receberá uma notificação.');await loadAdmin();}catch(error){console.error('VENT PRIVATE REPLY',error);setStatus('private-reply-status',errorMessage(error));}finally{setBusy(button,false);}
  }

  async function loadAdminPrivateChats(){
    if(!isStaff()||!state.supabase)return;
    const list=$('admin-private-chat-list'); if(!list)return;
    try{
      const {data,error}=await state.supabase.rpc('cae_admin_private_chat_feed');if(error)throw error;
      state.adminPrivateChatData=data||[];
      if(!state.adminPrivateChatData.length){list.innerHTML='<div class="private-chat-empty"><i data-lucide="shield-check"></i><h3>Nenhuma conversa privada disponível.</h3><p class="muted">As conversas privadas ativas aparecerão aqui quando necessário para uma verificação de segurança.</p></div>';refreshIcons();return;}
      list.innerHTML=state.adminPrivateChatData.map(c=>{const participants=(c.participants||[]).map(p=>`#${escapeHTML(p.public_code||'conta')}`).join(' · ');const msgs=c.messages||[];return `<article class="card admin-private-chat-review"><div class="admin-panel-heading"><div><div class="eyebrow">${c.source_type==='vent_reply'?'Resposta a desabafo':'Conversa por convite'}</div><h3>${participants}</h3></div><span class="security-lock"><i data-lucide="eye"></i></span></div><p class="cae-muted">${msgs.length} mensagem${msgs.length===1?'':'ns'} · ${escapeHTML(formatDate(c.created_at))}</p><div class="admin-private-readonly-thread">${msgs.map(m=>`<div class="private-message readonly"><div class="private-message-label">#${escapeHTML((c.participants||[]).find(p=>p.user_id===m.sender_id)?.public_code||'conta')} · ${escapeHTML(formatDate(m.created_at))}</div><div class="private-message-body">${escapeHTML(m.body).replace(/\n/g,'<br>')}</div><div class="actions" style="margin-top:8px"><button class="btn danger btn-small" type="button" data-delete-content="1" data-content-type="private_message" data-content-id="${escapeHTML(m.id)}" data-content-label="esta mensagem privada">Excluir</button></div></div>`).join('')}</div><div class="notice"><b>Somente leitura.</b> A equipe pode verificar, mas não pode participar por esta área. Excluir uma mensagem é uma ação de moderação.</div></article>`}).join('');
      refreshIcons();
    }catch(error){console.error('ADMIN PRIVATE CHATS',error);list.innerHTML=`<div class="private-chat-empty"><p class="cae-danger">${escapeHTML(errorMessage(error))}</p></div>`;}
  }

  function subscribeRealtime() {
    if (!state.supabase || !state.user) return;
    if (state.realtime) state.supabase.removeChannel(state.realtime);
    state.realtime = state.supabase.channel(`cae-${state.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.chat }, () => loadChat())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.posts }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.announcements }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.events }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.polls }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.pollOptions }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.pollVotes }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.vents }, () => { loadPublicVents(); if (isStaff()) loadAdmin(); if (isStaff()) loadAdminPrivateHistory(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.support }, () => { loadSupportChat(); if (isStaff()) loadAdminSupport(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.notifications }, () => { loadNotifications(); if (state.currentView === 'private-conversations-view' && state.privateSelectedConversationId) loadPrivateChatData(state.privateSelectedConversationId); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cae_admin_notifications', filter: `user_id=eq.${state.user.id}` }, () => { if (isStaff()) loadNotifications(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.privateMessages }, () => { if (state.currentView === 'private-conversations-view') loadPrivateChatData(state.privateSelectedConversationId); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.privateRequests }, () => { if (state.currentView === 'private-conversations-view') loadPrivateChatData(state.privateSelectedConversationId); loadNotifications(); })
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
    updateMuralActivityBadge('announcements', data || []);
    list.innerHTML = data?.length ? data.map(row => {
      const staffActions = isStaff() ? `<div class="actions" style="margin-top:12px"><button class="btn danger" type="button" data-delete-content="1" data-content-type="announcement" data-content-id="${escapeHTML(row.id)}" data-content-label="este aviso">Excluir</button></div>` : '';
      return `<article class="card mural-searchable"><div class="eyebrow">Aviso · ${escapeHTML(formatDate(row.created_at))}</div><h3>${escapeHTML(getField(row,['title'],'Aviso'))}</h3><p>${escapeHTML(getField(row,['body'],'')).replace(/\n/g,'<br>')}</p><div class="actions">${bookmarkButtonHTML('announcement',row.id)}</div>${staffActions}</article>`;
    }).join('') : '<div class="card mural-empty-state"><span class="mural-empty-icon"><i data-lucide="megaphone"></i></span><h3>Nenhum aviso por enquanto</h3><p class="muted">Quando a equipe compartilhar um aviso, ele aparecerá aqui.</p></div>';
  }

  async function loadEvents() {
    const list = $('event-list');
    if (!list) return;
    const { data, error } = await state.supabase.from(TABLE.events).select('*').order('event_date', { ascending: true }).limit(20);
    if (error) throw error;
    state.eventRows = data || [];
    updateMuralActivityBadge('events', data || []);
    list.innerHTML = data?.length ? data.map(row => {
      const date = getField(row,['event_date'],null); const time = String(getField(row,['event_time'],'')).slice(0,5);
      const staffActions = isStaff() ? `<div class="actions" style="margin-top:12px"><button class="btn danger" type="button" data-delete-content="1" data-content-type="event" data-content-id="${escapeHTML(row.id)}" data-content-label="este evento">Excluir</button></div>` : '';
      return `<article class="card mural-searchable"><div class="eyebrow">${escapeHTML(formatDateOnly(date))}${time ? ` · ${escapeHTML(time)}` : ''}</div><h3>${escapeHTML(getField(row,['title'],'Evento'))}</h3><p>${escapeHTML(getField(row,['description'],'')).replace(/\n/g,'<br>')}</p><p class="cae-muted">${escapeHTML(getField(row,['place'],'')).replace(/\n/g,'<br>')}</p><div class="actions"><button class="btn secondary btn-small" type="button" data-download-event="${escapeHTML(row.id)}"><i data-lucide="calendar-plus"></i>Adicionar ao calendário</button>${bookmarkButtonHTML('event',row.id)}</div>${staffActions}</article>`;
    }).join('') : '<div class="card mural-empty-state"><span class="mural-empty-icon"><i data-lucide="calendar-days"></i></span><h3>Nenhum evento por enquanto</h3><p class="muted">Os próximos encontros e atividades da comunidade serão anunciados aqui.</p></div>';
  }

  async function loadPosts() {
    const list = $('post-list');
    if (!list) return;
    const { data, error } = await state.supabase.from(TABLE.posts).select('*').order('created_at',{ascending:false}).limit(50);
    if (error) throw error;
    const posts = (data || []).filter(post => ['approved'].includes(String(post.status || 'approved')) || post.user_id === state.user.id || isStaff());
    updateMuralActivityBadge('posts', posts);
    const postIds = posts.map(post => post.id);

    let reactions = [];
    if (postIds.length) {
      const result = await state.supabase.from(TABLE.reactions).select('id,post_id,user_id,reaction').in('post_id', postIds);
      if (!result.error) reactions = result.data || [];
    }

    if (!posts.length) {
      list.innerHTML = '<div class="card mural-empty-state"><span class="mural-empty-icon"><i data-lucide="message-square-text"></i></span><h3>O mural começa com uma conversa</h3><p class="muted">Ainda não há publicações aprovadas. As novas mensagens aparecem aqui depois da revisão da equipe; você já pode enviar a primeira pelo formulário acima.</p></div>';
      return;
    }
    list.innerHTML = posts.map(post => {
      const status = String(post.status || 'approved');
      const reactionHTML = REACTIONS.map(([emoji,key]) => {
        const count = reactions.filter(r => r.post_id === post.id && String(r.reaction) === key).length;
        const active = reactions.some(r => r.post_id === post.id && r.user_id === state.user.id && String(r.reaction) === key);
        return `<button type="button" class="cae-reaction ${active?'active':''}" data-react-post="${escapeHTML(post.id)}" data-reaction="${escapeHTML(key)}">${emoji} ${count}</button>`;
      }).join('');
      const staffActions = isStaff() ? `<div class="actions" style="margin-top:12px"><button class="btn danger" type="button" data-delete-content="1" data-content-type="post" data-content-id="${escapeHTML(post.id)}" data-content-label="esta publicação">Excluir</button></div>` : '';
      const reportAction = post.user_id !== state.user.id && status === 'approved' ? `<button class="btn ghost btn-small" type="button" data-report-content="post" data-report-id="${escapeHTML(post.id)}">Denunciar</button>` : '';
      return `<article class="card mural-searchable"><div class="cae-post-meta"><span>${escapeHTML(getField(post,['category'],'Geral'))}</span><span>·</span><span>${escapeHTML(formatDate(post.created_at))}</span>${post.user_id===state.user.id?'<span>· sua publicação</span>':''}</div><p>${escapeHTML(getField(post,['body'],'')).replace(/\n/g,'<br>')}</p>${status!=='approved'?`<div class="cae-muted">Status: ${escapeHTML(status==='pending'?'aguardando moderação':status)}</div>`:''}${status==='approved'?`<div class="cae-reactions">${reactionHTML}</div>`:''}<div class="actions">${bookmarkButtonHTML('post',post.id)}${reportAction}</div>${staffActions}</article>`;
    }).join('');
  }

  async function loadPolls() {
    const list = $('poll-list');
    if (!list) return;
    const { data: polls, error } = await state.supabase.from(TABLE.polls).select('*').order('created_at',{ascending:false}).limit(20);
    if (error) throw error;
    updateMuralActivityBadge('polls', polls || []);
    if (!polls?.length) {
      list.innerHTML = '<div class="card mural-empty-state"><span class="mural-empty-icon"><i data-lucide="vote"></i></span><h3>Nenhuma enquete por enquanto</h3><p class="muted">Quando houver uma votação, ela aparecerá aqui para você participar.</p></div>';
      return;
    }
    const ids = polls.map(p=>p.id);
    const [optionsResult, votesResult, resultsResult] = await Promise.all([
      state.supabase.from(TABLE.pollOptions).select('id,poll_id,text,option_text').in('poll_id',ids),
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
        return `<div class="cae-result-row"><div class="cae-poll-option"><span>${escapeHTML(option.text ?? option.option_text ?? '')}</span><span class="cae-muted">${count} · ${pct}%</span>${!selected&&!expired?`<button class="btn secondary" type="button" data-vote-option="${escapeHTML(option.id)}" data-vote-poll="${escapeHTML(poll.id)}">Votar</button>`:''}</div><div class="cae-bar"><span style="width:${pct}%"></span></div></div>`;
      }).join('');
      const adminActions = isStaff() ? `<div class="actions" style="margin-top:12px"><button class="btn secondary" type="button" data-delete-poll="${escapeHTML(poll.id)}">Excluir enquete</button></div>` : '';
      return `<article class="card mural-searchable"><div class="eyebrow">Enquete${closesAt?` · até ${escapeHTML(formatDate(closesAt))}`:''}</div><h3>${escapeHTML(getField(poll,['question'],'Enquete'))}</h3><p class="cae-muted">${selected?'Seu voto foi registrado.':expired?'Enquete encerrada.':'Escolha uma opção.'}</p><div class="cae-results">${optionHTML}</div><div class="actions">${bookmarkButtonHTML('poll',poll.id)}</div>${adminActions}</article>`;
    }).join('');
  }

  async function deletePoll(pollId) {
    return deleteStaffContent('poll',pollId,'esta enquete');
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

  function safePodcastUrl(value) {
    try { const url = new URL(String(value || '').trim()); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch (_) { return ''; }
  }

  function communityPodcastCardHTML(row, staff = false) {
    const mine = row.user_id === state.user.id;
    const approved = row.status === 'approved';
    const report = !mine && approved
      ? `<button class="btn ghost btn-small" type="button" data-report-content="podcast" data-report-id="${escapeHTML(row.id)}">Denunciar</button>` : '';
    const remove = staff ? `<button class="btn danger btn-small" type="button" data-delete-shared-podcast="${escapeHTML(row.id)}">Excluir</button>` : '';
    const status = mine && row.status === 'pending' ? '<span class="cae-status cae-status-pending">Em análise</span>' :
      mine && row.status === 'rejected' ? '<span class="cae-status cae-status-rejected">Não publicado</span>' : '';
    const listen = approved ? `<a class="btn primary btn-small" href="${escapeHTML(row.url)}" target="_blank" rel="noopener noreferrer">Ouvir podcast</a>` :
      mine && row.status === 'rejected' ? '<p class="cae-muted">Esta recomendação não foi publicada.</p>' : '';
    const bookmark = approved ? bookmarkButtonHTML('podcast', row.id) : '';
    return `<article class="card community-podcast-card"><div class="eyebrow">${escapeHTML(row.category || 'Geral')} · ${escapeHTML(formatDate(row.created_at))}</div><div class="own-vent-meta"><h3>${escapeHTML(row.title)}</h3>${status}</div>${row.description ? `<p>${escapeHTML(row.description)}</p>` : ''}${approved ? '<p class="cae-muted">Recomendação anônima da comunidade</p>' : ''}<div class="actions">${listen}${bookmark}${report}</div>${remove}</article>`;
  }

  async function loadCommunityPodcasts() {
    const list = $('community-podcast-list');
    if (!list || !state.user || !state.supabase) return;
    try {
      const { data, error } = await state.supabase.from(TABLE.sharedPodcasts)
        .select('id,user_id,title,description,category,url,status,created_at')
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      const visibleRows = (data || []).filter(row => row.status === 'approved' || row.user_id === state.user.id);
      updateMuralActivityBadge('podcasts', visibleRows);
      list.innerHTML = visibleRows.length ? visibleRows.map(row => communityPodcastCardHTML(row)).join('') :
        '<div class="card"><p>Ainda não há recomendações. Você pode ser a primeira pessoa a compartilhar uma!</p></div>';
      refreshIcons();
    } catch (error) {
      console.error('COMMUNITY PODCASTS', error);
      list.innerHTML = '<div class="card"><p class="cae-danger">Não foi possível carregar as recomendações.</p></div>';
    }
  }

  async function submitCommunityPodcast(event) {
    event.preventDefault();
    if (!state.user || !state.supabase || !ensureAccountCanInteract()) return;
    const title = $('podcast-share-title')?.value.trim() || '';
    const category = $('podcast-share-category')?.value || 'Geral';
    const description = $('podcast-share-description')?.value.trim() || '';
    const url = safePodcastUrl($('podcast-share-url')?.value);
    if (title.length < 2 || !url) return setStatus('podcast-share-status', 'Informe um título e um link válido começando com https://.');
    const button = $('podcast-share-form')?.querySelector('button[type="submit"]');
    setBusy(button, true, 'Enviando…');
    try {
      const { error } = await state.supabase.from(TABLE.sharedPodcasts).insert({ user_id: state.user.id, title, description, category, url, status: 'pending' });
      if (error) throw error;
      $('podcast-share-form').reset();
      setStatus('podcast-share-status', 'Recomendação enviada! Ela aparecerá para todos depois da aprovação da equipe.', 'ok');
      await loadCommunityPodcasts();
      if (isStaff()) await loadAdminSharedPodcasts();
    } catch (error) {
      console.error('PODCAST SUBMIT', error);
      setStatus('podcast-share-status', errorMessage(error));
    } finally { setBusy(button, false); }
  }

  async function loadAdminSharedPodcasts() {
    if (!isStaff() || !state.supabase) return;
    const pendingList = $('admin-podcast-pending-list'), approvedList = $('admin-podcast-approved-list');
    if (!pendingList || !approvedList) return;
    try {
      const { data, error } = await state.supabase.from(TABLE.sharedPodcasts)
        .select('id,user_id,title,description,category,url,status,created_at')
        .order('created_at', { ascending: false }).limit(150);
      if (error) throw error;
      const rows = data || [];
      const pending = rows.filter(row => row.status === 'pending');
      const approved = rows.filter(row => row.status === 'approved');
      pendingList.innerHTML = pending.length ? pending.map(row =>
        `<article class="card"><div class="eyebrow">Enviado em ${escapeHTML(formatDate(row.created_at))} · ${escapeHTML(row.category)}</div><h3>${escapeHTML(row.title)}</h3><p>${escapeHTML(row.description || 'Sem descrição.')}</p><p><a href="${escapeHTML(row.url)}" target="_blank" rel="noopener noreferrer">Ver link enviado</a></p><p class="cae-muted">Conta de origem para moderação: ${escapeHTML(publicName(row.user_id))}</p><div class="actions"><button class="btn primary btn-small" type="button" data-moderate-shared-podcast="approved" data-podcast-id="${escapeHTML(row.id)}">Aprovar</button><button class="btn danger btn-small" type="button" data-moderate-shared-podcast="rejected" data-podcast-id="${escapeHTML(row.id)}">Recusar</button></div></article>`
      ).join('') : '<div class="card"><p>Nenhuma recomendação pendente.</p></div>';
      approvedList.innerHTML = approved.length ? approved.map(row => communityPodcastCardHTML(row, true)).join('') : '<div class="card"><p>Nenhuma recomendação publicada.</p></div>';
      refreshIcons();
    } catch (error) {
      console.error('ADMIN PODCASTS', error);
      pendingList.innerHTML = '<div class="card"><p class="cae-danger">Não foi possível carregar as recomendações.</p></div>';
    }
  }

  async function moderateSharedPodcast(id, status) {
    if (!isStaff() || !['approved', 'rejected'].includes(status)) return;
    const reason = status === 'rejected' ? await askModerationReason('reject_content','esta recomendação de podcast') : null;
    if (status === 'rejected' && !reason) return;
    if (!window.confirm(status === 'approved' ? 'Aprovar e publicar esta recomendação?' : `Recusar esta recomendação?\\n\\nMotivo: ${reason}`)) return;
    try {
      const { error } = await state.supabase.from(TABLE.sharedPodcasts).update({ status, moderation_reason: reason, moderated_at: new Date().toISOString(), moderated_by: state.user.id }).eq('id', id);
      if (error) throw error;
      toast(status === 'approved' ? 'Podcast aprovado e publicado.' : 'Recomendação recusada. O estudante foi notificado com o motivo.');
      await Promise.all([loadAdminSharedPodcasts(), loadCommunityPodcasts()]);
    } catch (error) { console.error('PODCAST MODERATION', error); toast(errorMessage(error), 'error'); }
  }

  async function deleteSharedPodcast(id) {
    if (!isStaff() || !window.confirm('Excluir esta recomendação permanentemente?')) return;
    try {
      const { error } = await state.supabase.from(TABLE.sharedPodcasts).delete().eq('id', id);
      if (error) throw error;
      toast('Recomendação excluída.');
      await Promise.all([loadAdminSharedPodcasts(), loadCommunityPodcasts()]);
    } catch (error) { console.error('PODCAST DELETE', error); toast(errorMessage(error), 'error'); }
  }

  async function loadMural() {
    if (!state.supabase || !state.user || state.muralLoading) return;
    state.muralLoading = true;
    state.muralQueued = false;
    try {
      await loadBookmarks();
      const tasks = [loadAnnouncements(),loadEvents(),loadPosts(),loadPolls()];
      const results = await Promise.allSettled(tasks);
      const parts=['Avisos','Eventos','Publicações','Enquetes'];
      const targets=['announcement-list','event-list','post-list','poll-list'];
      results.forEach((result,index)=>{
        if (result.status !== 'rejected') return;
        console.error(`MURAL ${parts[index]}`,result.reason);
        const target=$(targets[index]);
        if (target) target.innerHTML = '<div class="card"><p class="cae-danger">Não foi possível carregar ' + parts[index].toLowerCase() + ': ' + escapeHTML(errorMessage(result.reason)) + '</p></div>';
      });
      if (results.some(r=>r.status==='rejected')) toast('Uma parte do mural não pôde ser carregada. Veja a mensagem exibida na respectiva aba.','error');
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
      setStatus('post-status','Enviado para moderação.','ok');
      toast('Sua publicação foi enviada para moderação.');
      await loadPosts();
      if (isStaff()) await Promise.allSettled([loadAdmin(), loadAdminNotifications()]);
    } catch (error) { console.error('POST',error); setStatus('post-status',errorMessage(error)); }
    finally { setBusy(button,false); }
  }

  async function toggleReaction(postId, reaction) {
    try {
      const { error } = await state.supabase.rpc('cae_set_post_reaction', { p_post_id: postId, p_reaction: reaction });
      if (error) throw error;
      await loadPosts();
    } catch (error) { console.error('REACTION', error); toast(errorMessage(error), 'error'); }
  }

  function guidedIllustrationHTML() {
    return `<div class="guided-illustration-wrap guided-illustration-wrap-inline" aria-hidden="true"><svg class="guided-illustration" viewBox="0 0 120 74"><rect x="8" y="9" width="84" height="56" rx="14" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 25h42M24 37h28M24 49h18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="91" cy="50" r="20" fill="currentColor" opacity=".12"/><path d="m80 50 7 7 15-17" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
  }

  function renderVentBody(type, body, className='public-vent-body') {
    const value=String(body||'').trim();
    if(!value)return '';
    if(type==='guided'){
      const blocks=value.split(/\n\s*\n/).map(block=>block.trim()).filter(Boolean);
      const items=blocks.map(block=>{
        const lines=block.split('\n');
        const question=lines.shift()?.trim()||'Pergunta';
        const answer=lines.join('\n').trim()||'(sem resposta)';
        return `<div class="guided-public-item"><div class="guided-public-question">${escapeHTML(question)}</div><div class="guided-public-answer">${escapeHTML(answer).replace(/\n/g,'<br>')}</div></div>`;
      }).join('');
      return `<div class="guided-public-list">${guidedIllustrationHTML()}${items}</div>`;
    }
    return `<div class="${className}">${escapeHTML(value).replace(/\n/g,'<br>')}</div>`;
  }

  async function loadPublicVents(filter = state.publicVentFilter) {
    const list = $('public-vent-list');
    if (!list || !state.user || !state.supabase) return;
    state.publicVentFilter = ['free','guided','feelings','audio'].includes(filter) ? filter : 'free';
    $$('[data-public-filter]').forEach(button => {
      const active=button.dataset.publicFilter===state.publicVentFilter;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    });
    try {
      const { data, error } = await state.supabase.from(TABLE.vents)
        .select('id,user_id,type,body,feeling,audio_url,status,created_at')
        .eq('visibility','public').eq('status','approved').eq('type',state.publicVentFilter)
        .order('created_at',{ascending:false}).limit(100);
      if (error) throw error;
      if (!data?.length) {
        const empty = {
          free: 'Nenhum desabafo de texto livre foi aprovado ainda.',
          guided: 'Nenhum desabafo de perguntas guiadas foi aprovado ainda.',
          feelings: 'Nenhum desabafo de “Como eu me sinto” foi aprovado ainda.',
          audio: 'Nenhum desabafo em áudio foi aprovado ainda.'
        }[state.publicVentFilter];
        list.innerHTML=`<div class="public-vent-empty"><p>${escapeHTML(empty)}</p><p class="cae-muted">Quando houver conteúdo aprovado, ele aparecerá aqui.</p></div>`;
        return;
      }
      list.innerHTML=data.map(vent=>{
        const body=getField(vent,['body'],'');
        const feeling=getField(vent,['feeling'],'');
        const audioPath=getField(vent,['audio_url'],'');
        const typeLabel={free:'Texto livre',guided:'Perguntas guiadas',feelings:'Como eu me sinto',audio:'Áudio'}[state.publicVentFilter]||'Desabafo';
        const staffActions=isStaff()?`<div class="actions public-content-actions"><button class="btn danger btn-small" type="button" data-delete-vent="${escapeHTML(vent.id)}" data-audio-path="${escapeHTML(audioPath)}"><i data-lucide="trash-2"></i>Excluir</button></div>`:'';
        const reportAction = vent.user_id !== state.user.id ? `<button class="btn ghost btn-small" type="button" data-report-content="vent" data-report-id="${escapeHTML(vent.id)}">Denunciar</button>` : '';
        return `<article class="card public-vent-card"><div class="public-vent-type"><span class="vent-tab-icon"><i data-lucide="${state.publicVentFilter==='guided'?'list-checks':state.publicVentFilter==='feelings'?'heart':state.publicVentFilter==='audio'?'mic':'pen-line'}"></i></span><strong>${escapeHTML(typeLabel)}</strong></div><div class="cae-post-meta">${escapeHTML(publicName(vent.user_id))} · ${escapeHTML(formatDate(vent.created_at))}</div>${feeling?`<div class="public-vent-feeling">${escapeHTML(feeling)}</div>`:''}${renderVentBody(vent.type,body)}${audioPath?`<div class="public-vent-audio"><button class="btn secondary" type="button" data-play-public-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>`:''}<div class="actions">${reportAction}</div>${staffActions}</article>`;
      }).join('');
      refreshIcons();
    } catch(error){console.error('PUBLIC VENTS',error);list.innerHTML=`<div class="public-vent-empty"><p class="cae-danger">${escapeHTML(errorMessage(error))}</p></div>`;}
  }

  async function playPublicVentAudio(path,button) {
    try { const {data,error}=await state.supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path,600); if(error)throw error; const card=button?.closest('.public-vent-card'); if(!card)return; let audio=card.querySelector('audio[data-public-vent-audio]'); if(!audio){audio=document.createElement('audio');audio.controls=true;audio.dataset.publicVentAudio='1';audio.style.width='100%';audio.style.marginTop='10px';card.querySelector('.public-vent-audio')?.appendChild(audio);} audio.src=data.signedUrl; await audio.play().catch(()=>{}); } catch(error){console.error('PUBLIC VENT AUDIO',error);toast(`Não foi possível abrir este áudio: ${errorMessage(error)}`,'error');}
  }

  async function loadHistory(section = state.historyFilter) {
    state.historyFilter = ['vents', 'mood', 'saved'].includes(section) ? section : 'vents';
    $$('[data-history-filter]').forEach(button => {
      const active = button.dataset.historyFilter === state.historyFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $('history-vents-panel')?.classList.toggle('hidden', state.historyFilter !== 'vents');
    $('history-mood-panel')?.classList.toggle('hidden', state.historyFilter !== 'mood');
    $('history-saved-panel')?.classList.toggle('hidden', state.historyFilter !== 'saved');
    if (state.historyFilter === 'mood') return loadMoodEntries();
    if (state.historyFilter === 'saved') return loadSavedContent();
    return loadVentHistory(state.ventHistoryFilter);
  }

  async function loadVentHistory(filter = state.ventHistoryFilter) {
    const list = $('history-list');
    if (!list || !state.user || !state.supabase) return;
    state.ventHistoryFilter = ['free', 'guided', 'feelings', 'audio'].includes(filter) ? filter : 'free';
    $$('[data-vent-history-filter]').forEach(button => {
      const active = button.dataset.ventHistoryFilter === state.ventHistoryFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    try {
      const { data, error } = await state.supabase.from(TABLE.vents).select('*')
        .eq('user_id', state.user.id).eq('type', state.ventHistoryFilter)
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      if (!data?.length) {
        list.innerHTML = '<div class="card"><p>Nenhum desabafo nesta categoria.</p><p class="cae-muted">Quando você enviar um desabafo deste tipo, ele aparecerá aqui.</p></div>';
        return;
      }
      const visibilityLabel = v => v === 'private' ? 'Privado' : 'Público';
      list.innerHTML = data.map(vent => {
        const body = getField(vent, ['body'], '');
        const feeling = getField(vent, ['feeling'], '');
        const audioPath = getField(vent, ['audio_url'], '');
        const status = privateVentStatus(vent.status);
        const statusClass = vent.status === 'approved' ? 'cae-status-approved' : vent.status === 'rejected' ? 'cae-status-rejected' : 'cae-status-pending';
        return `<article class="card own-vent-card"><div class="own-vent-meta"><div><div class="eyebrow">${escapeHTML(visibilityLabel(vent.visibility))} · ${escapeHTML(formatDate(vent.created_at))}</div></div><span class="cae-status ${statusClass}">${escapeHTML(status)}</span></div>${feeling ? `<div class="notice" style="margin-top:10px"><b>${escapeHTML(feeling)}</b></div>` : ''}${body ? renderVentBody(vent.type, body, 'own-vent-body') : ''}${audioPath ? `<div class="actions" style="margin-top:10px"><button class="btn secondary" type="button" data-play-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>` : ''}<div class="actions" style="margin-top:12px"><button class="btn danger" type="button" data-delete-vent="${escapeHTML(vent.id)}" data-audio-path="${escapeHTML(audioPath)}">Excluir</button></div></article>`;
      }).join('');
      filterHistoryCards();
      refreshIcons();
    } catch (error) {
      console.error('HISTORY', error);
      list.innerHTML = `<div class="card"><p class="cae-danger">${escapeHTML(errorMessage(error))}</p></div>`;
    }
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

  async function playAdminPrivateAudio(path, button) {
    if (!isStaff()) return;
    try {
      const { data, error } = await state.supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path, 600);
      if (error) throw error;
      const wrapper = button?.closest('[data-private-vent-card], .admin-vent-review-card');
      if (!wrapper) throw new Error('Não encontrei o cartão deste áudio na fila de moderação.');
      const audioHost = wrapper.querySelector('.admin-audio') || wrapper;
      let audio = audioHost.querySelector('audio[data-private-admin-audio]');
      if (!audio) {
        audio = document.createElement('audio');
        audio.controls = true;
        audio.dataset.privateAdminAudio = '1';
        audio.style.width = '100%';
        audio.style.marginTop = '10px';
        audio.preload = 'metadata';
        audioHost.appendChild(audio);
      }
      audio.src = data.signedUrl;
      audio.load();
      await audio.play().catch(() => {});
    } catch (error) {
      console.error('ADMIN PRIVATE AUDIO', error);
      toast(`Não foi possível abrir este áudio: ${errorMessage(error)}`, 'error');
    }
  }

  function privateVentStatus(status) {
    const value = String(status || 'pending');
    return value === 'approved' ? 'Aprovado' : value === 'rejected' ? 'Recusado' : 'Pendente';
  }

  async function fetchAdminPrivateVents(){
    if(!isStaff()||!state.supabase)return [];
    const {data,error}=await state.supabase.from(TABLE.vents).select('id,user_id,type,body,feeling,audio_url,status,visibility,created_at,moderated_at').eq('visibility','private').order('created_at',{ascending:false}).limit(500);
    if(error)throw error; return data||[];
  }

  function renderAdminPrivateVentCards(data,targetId,filter=state.adminPrivateFilter){
    const list=$(targetId);if(!list)return;
    state.adminPrivateFilter = ['free','guided','feelings','audio'].includes(filter) ? filter : 'free';
    $$('[data-private-filter]').forEach(button => {
      const active=button.dataset.privateFilter===state.adminPrivateFilter;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    });
    const filtered=(data||[]).filter(vent=>String(vent.type||'free')===state.adminPrivateFilter);
    if(!filtered.length){list.innerHTML='<div class="admin-private-empty"><h3>Nenhum desabafo nesta categoria</h3><p class="cae-muted">Quando houver registros privados deste tipo, eles aparecerão aqui.</p></div>';return;}
    const grouped=new Map();
    filtered.forEach(vent=>{const key=publicName(vent.user_id);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(vent);});
    list.innerHTML=[...grouped.entries()].map(([code,vents])=>{
      const cards=vents.map(vent=>{
        const body=getField(vent,['body'],'');const feeling=getField(vent,['feeling'],'');const audioPath=getField(vent,['audio_url'],'');const status=privateVentStatus(vent.status);const cls=vent.status==='approved'?'cae-status-approved':vent.status==='rejected'?'cae-status-rejected':'cae-status-pending';
        const typeLabel=labelsForType(vent.type); const typeIcon={free:'pen-line',guided:'list-checks',feelings:'heart',audio:'mic'}[vent.type]||'notebook-pen';
        return `<article class="card admin-private-vent-card" data-private-vent-card><div class="admin-private-vent-meta"><div><div class="public-vent-type"><span class="vent-tab-icon"><i data-lucide="${typeIcon}"></i></span><strong>${escapeHTML(typeLabel)}</strong></div><span class="eyebrow">${escapeHTML(formatDate(vent.created_at))}</span></div><span class="cae-status ${cls}">${escapeHTML(status)}</span></div>${feeling?`<div class="admin-private-feeling"><b>Sentimento</b><span>${escapeHTML(feeling)}</span></div>`:''}${body?renderVentBody(vent.type,body,'admin-private-body'):''}${audioPath?`<div class="admin-audio"><div class="cae-muted">Áudio privado</div><button class="btn secondary" type="button" data-play-admin-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>`:''}<div class="actions admin-private-actions"><button class="btn danger" type="button" data-delete-vent="${escapeHTML(vent.id)}" data-audio-path="${escapeHTML(audioPath)}">Excluir</button></div></article>`;
      }).join('');
      return `<section class="admin-private-user-group"><div class="admin-private-user-head"><div><div class="eyebrow">Usuário</div><h3>${escapeHTML(code)}</h3><p class="cae-muted">${vents.length} registro${vents.length===1?'':'s'} nesta categoria.</p></div></div><div class="admin-private-user-feed">${cards}</div></section>`;
    }).join('');
    refreshIcons();
  }

  async function loadAdminPrivateVents(){
    const card=$('admin-private-vents-card');if(!card)return;const staff=isStaff();card.classList.toggle('hidden',!staff);if(!staff)return;
    try{const data=await fetchAdminPrivateVents();$('admin-private-count').textContent=String(data.length);}catch(error){console.error('ADMIN PRIVATE SUMMARY',error);$('admin-private-count').textContent='—';}
  }

  async function loadAdminPrivateHistory(filter=state.adminPrivateFilter){
    if(!isStaff())return;const list=$('admin-private-history-list');if(!list)return;list.innerHTML='<div class="admin-private-empty"><p>Carregando histórico...</p></div>';
    try{
      const data=await fetchAdminPrivateVents();
      state.adminPrivateFilter=['free','guided','feelings','audio'].includes(filter)?filter:'free';
      const counts=data.reduce((a,v)=>{a.total++;a[v.status||'pending']=(a[v.status||'pending']||0)+1;return a;},{total:0,pending:0,approved:0,rejected:0});
      $('admin-private-history-count').textContent=String(counts.total);$('admin-private-history-pending').textContent=String(counts.pending);$('admin-private-history-approved').textContent=String(counts.approved);$('admin-private-history-rejected').textContent=String(counts.rejected);
      renderAdminPrivateVentCards(data,'admin-private-history-list',state.adminPrivateFilter);
    }catch(error){console.error('ADMIN PRIVATE HISTORY',error);list.innerHTML=`<div class="admin-private-empty"><p class="cae-danger">${escapeHTML(errorMessage(error))}</p></div>`;}
  }

  function renderSupportMessages(messages,targetId,currentUserId=state.user?.id,conversationUserId=null){
    const box=$(targetId);if(!box)return;
    if(!messages?.length){box.innerHTML='<div class="support-empty"><p>Nenhuma mensagem nesta conversa.</p><p class="cae-muted">Envie uma mensagem para iniciar o atendimento.</p></div>';return;}
    const adminView=targetId==='admin-support-thread';
    const code=conversationUserId?publicName(conversationUserId):'';
    const header=adminView?`<div class="support-thread-head"><div><div class="eyebrow">Atendimento</div><strong>${escapeHTML(code)}</strong></div><span class="cae-muted">${messages.length} mensagem${messages.length===1?'':'ns'}</span></div>`:'';
    box.innerHTML=header+messages.map(message=>{
      const own=message.sender_id===currentUserId;
      const label=adminView?(own?'Você · equipe':code):(own?'Você':'Equipe do CAE');
      const canDelete=adminView ? isStaff() : own;
      const deleteButton=canDelete?`<button class="support-delete" type="button" data-delete-support="${escapeHTML(message.id)}" aria-label="Apagar mensagem" title="Apagar mensagem">Apagar</button>`:'';
      return `<div class="support-message ${own?'support-message-own':'support-message-staff'}"><div class="support-message-label">${escapeHTML(label)} · ${escapeHTML(formatDate(message.created_at))}</div><div class="support-message-body">${escapeHTML(message.body).replace(/\n/g,'<br>')}</div>${deleteButton}</div>`;
    }).join('');
    box.scrollTop=box.scrollHeight;
  }

  async function loadSupportChat(){const box=$('support-messages');if(!box||!state.user||!state.supabase)return;try{const {data,error}=await state.supabase.from(TABLE.support).select('id,conversation_user_id,sender_id,body,created_at').eq('conversation_user_id',state.user.id).order('created_at',{ascending:true}).limit(200);if(error)throw error;renderSupportMessages(data||[],'support-messages',state.user.id,state.user.id);}catch(error){console.error('SUPPORT LOAD',error);box.innerHTML=`<div class="support-empty"><p class="cae-danger">${escapeHTML(errorMessage(error))}</p></div>`;}}

  async function sendSupportMessage(event) {
    event.preventDefault();
    if (!state.user || !state.supabase || !ensureAccountCanInteract()) return;

    const input = $('support-input');
    const body = input?.value.trim();
    if (!body) return;

    const button = $('support-send');
    setBusy(button, true, 'Enviando...');
    try {
      const { error } = await state.supabase.from(TABLE.support).insert({
        conversation_user_id: state.user.id,
        sender_id: state.user.id,
        body
      });
      if (error) throw error;

      input.value = '';
      await loadSupportChat();
      if (isStaff()) await loadAdminSupport();
    } catch (error) {
      console.error('SUPPORT SEND', error);
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(button, false);
      input?.focus();
    }
  }

  async function deleteSupportMessage(id){
    if(!state.user||!state.supabase)return;
    const target=String(id||'').trim();if(!target)return;
    if(isStaff()) { await deleteStaffContent('support_message',target,'esta mensagem'); return; }
    if(!window.confirm('Apagar esta mensagem permanentemente?'))return;
    try{
      const {error}=await state.supabase.from(TABLE.support).delete().eq('id',target).eq('sender_id',state.user.id).eq('conversation_user_id',state.user.id);
      if(error)throw error;
      toast('Mensagem apagada.');
      await loadSupportChat();
    }catch(error){console.error('SUPPORT DELETE',error);toast(errorMessage(error),'error');}
  }

  async function loadAdminSupport(){const select=$('admin-support-conversation');const thread=$('admin-support-thread');const count=$('admin-support-count');if(!select||!thread||!state.user||!isStaff())return;try{const {data,error}=await state.supabase.from(TABLE.support).select('id,conversation_user_id,sender_id,body,created_at').order('created_at',{ascending:true}).limit(500);if(error)throw error;const grouped=new Map();(data||[]).forEach(message=>{const id=message.conversation_user_id;if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(message);});if(count)count.textContent=String(grouped.size);const conversations=[...grouped.entries()].sort((a,b)=>new Date(b[1][b[1].length-1].created_at)-new Date(a[1][a[1].length-1].created_at));const current=state.supportConversationUserId||'';select.innerHTML='<option value="">Selecionar conversa</option>'+conversations.map(([id,messages])=>`<option value="${escapeHTML(id)}">${escapeHTML(publicName(id))} · ${messages.length} mensagem${messages.length===1?'':'ns'}</option>`).join('');if(conversations.some(([id])=>id===current))select.value=current;else{state.supportConversationUserId=conversations[0]?.[0]||null;select.value=state.supportConversationUserId||'';}const selected=select.value||'';state.supportConversationUserId=selected||null;renderSupportMessages(selected?grouped.get(selected):[],'admin-support-thread',state.user.id,selected||null);if(selected){thread.insertAdjacentHTML('beforeend','<form id="admin-support-form" class="chat-form support-admin-form"><textarea id="admin-support-input" maxlength="2000" placeholder="Responder ao estudante..."></textarea><button class="btn primary" id="admin-support-send" type="submit">Enviar</button></form>');}}catch(error){console.error('ADMIN SUPPORT LOAD',error);thread.innerHTML=`<div class="support-empty"><p class="cae-danger">${escapeHTML(errorMessage(error))}</p></div>`;}}

  function renderSelectedAdminSupportConversation(){state.supportConversationUserId=$('admin-support-conversation')?.value||null;loadAdminSupport();}

  async function sendAdminSupportMessage(event) {
    event.preventDefault();
    if (!isStaff() || !state.user || !state.supportConversationUserId) {
      return toast('Selecione uma conversa primeiro.', 'error');
    }

    const input = $('admin-support-input');
    const body = input?.value.trim();
    if (!body) return;

    const button = $('admin-support-send');
    setBusy(button, true, 'Enviando...');
    try {
      const { error } = await state.supabase.from(TABLE.support).insert({
        conversation_user_id: state.supportConversationUserId,
        sender_id: state.user.id,
        body
      });
      if (error) throw error;

      input.value = '';
      await loadAdminSupport();
    } catch (error) {
      console.error('ADMIN SUPPORT SEND', error);
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(button, false);
      input?.focus();
    }
  }

  async function setAccountRole() {
    if (!isStaff()) return toast('Esta área é restrita à equipe de moderação.', 'error');
    const target = renderAdminTarget('admin-role-identifier', 'admin-role-target', 'admin-role-status');
    if (!target) return toast('Selecione uma conta válida.', 'error');
    if (target.user_id === state.user.id) return toast('Não altere o próprio cargo por esta tela.', 'error');
    const role = $('admin-user-role')?.value;
    const button = $('admin-role-button');
    setBusy(button, true, 'Salvando...');
    try {
      const { error } = await state.supabase.rpc('cae_admin_set_role', { p_target_user_id: target.user_id, p_role: role });
      if (error) throw error;
      const label = { student: 'Estudante', moderator: 'Moderador', admin: 'Administrador' }[role] || role;
      if (state.publicDirectory.has(target.user_id)) state.publicDirectory.get(target.user_id).role = role;
      $('admin-role-status').textContent = `#${target.public_code || '—'} agora está como ${label}.`;
      toast(`Cargo atualizado: ${label}.`);
      await logAdmin('set_role', 'profile', target.user_id, { role });
      await loadAdmin();
    } catch (error) {
      console.error('SET ROLE', error);
      $('admin-role-status').textContent = '';
      toast(errorMessage(error), 'error');
    } finally { setBusy(button, false); }
  }

  async function moderateAccount(action, button = null) {
    if (!isStaff()) return toast('Somente a equipe de moderação pode moderar contas.', 'error');
    const target = renderAdminTarget('admin-moderation-identifier', 'admin-moderation-target', 'admin-moderation-status');
    if (!target) return toast('Selecione uma conta válida.', 'error');
    if (target.user_id === state.user.id) return toast('Não aplique ban ou timeout na própria conta.', 'error');
    const minutes = Number($('admin-timeout-duration')?.value || 0);
    let reason = null;
    if (action === 'timeout' || action === 'ban') {
      reason = await askModerationReason(action, `#${target.public_code || 'esta conta'}`);
      if (!reason) return;
    }
    if (action === 'ban' && !window.confirm(`Bloquear #${target.public_code || 'esta conta'}?\n\nMotivo: ${reason}`)) return;
    if (action === 'timeout' && !window.confirm(`Aplicar timeout de ${minutes} minutos em #${target.public_code || 'esta conta'}?\n\nMotivo: ${reason}`)) return;
    if (action === 'unban' && !window.confirm(`Desbloquear #${target.public_code || 'esta conta'}?`)) return;
    setBusy(button, true, 'Aplicando...');
    try {
      const rpcName = (action === 'timeout' || action === 'ban') ? 'cae_staff_moderate_account_with_reason' : 'cae_staff_moderate_account';
      const rpcPayload = (action === 'timeout' || action === 'ban')
        ? { p_target_user_id: target.user_id, p_action: action, p_minutes: action === 'timeout' ? minutes : null, p_reason: reason }
        : { p_target_user_id: target.user_id, p_action: action, p_minutes: minutes };
      const { error } = await state.supabase.rpc(rpcName, rpcPayload);
      if (error) throw error;
      const messages = {
        timeout: `#${target.public_code || 'Conta'} recebeu timeout por ${minutes} min.`,
        clear_timeout: `Timeout removido de #${target.public_code || 'conta'}.`,
        ban: `#${target.public_code || 'Conta'} foi bloqueada.`,
        unban: `#${target.public_code || 'Conta'} foi desbloqueada.`
      };
      $('admin-moderation-status').textContent = messages[action] || 'Ação aplicada com sucesso.';
      toast(messages[action] || 'Ação aplicada com sucesso.');
      await logAdmin(`account_${action}`, 'profile', target.user_id, action === 'timeout' ? { minutes, reason } : action === 'ban' ? { reason } : {});
      await loadAdmin();
    } catch (error) {
      console.error('ACCOUNT MODERATION', error);
      $('admin-moderation-status').textContent = '';
      toast(errorMessage(error), 'error');
    } finally { setBusy(button, false); }
  }

  async function logAdmin(action,targetType=null,targetId=null,details={}) {
    if(!isStaff()||!state.user)return;
    const {error}=await state.supabase.from(TABLE.logs).insert({admin_id:state.user.id,action,target_type:targetType,target_id:targetId,details});
    if(error)console.warn('ADMIN LOG',error);
  }

  function ensurePollAdminForm() {
    if(!isStaff())return;
    const form=$('poll-form');
    if(form){
      if(form.dataset.bound!=='1'){
        form.addEventListener('submit',createPoll);
        form.dataset.bound='1';
      }
      return;
    }
    const placeholder=$('poll-admin-card-placeholder');
    if(!placeholder)return;
    placeholder.innerHTML=`<div class="eyebrow">Enquetes</div><h3>Nova enquete</h3><form id="poll-form"><div class="field"><label for="poll-question">Pergunta</label><input id="poll-question" required maxlength="300" placeholder="O que a escola deveria melhorar?"></div><div class="field"><label>Opções</label><input class="poll-option-input" required maxlength="120" placeholder="Opção 1"><input class="poll-option-input" required maxlength="120" placeholder="Opção 2"><input class="poll-option-input" maxlength="120" placeholder="Opção 3"><input class="poll-option-input" maxlength="120" placeholder="Opção 4"></div><div class="field"><label for="poll-closes">Encerramento (opcional)</label><input id="poll-closes" type="datetime-local"></div><button class="btn primary" type="submit">Publicar enquete</button></form>`;
    const createdForm=$('poll-form');
    if(createdForm){createdForm.addEventListener('submit',createPoll);createdForm.dataset.bound='1';}
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
      const {error:optionError}=await state.supabase.from(TABLE.pollOptions).insert(options.map(text=>({poll_id:poll.id,text,option_text:text})));
      if(optionError)throw optionError;
      await logAdmin('create_poll','poll',poll.id,{options});
      event.target.reset(); toast('Enquete publicada.'); await loadPolls();
    }catch(error){
      console.error('CREATE POLL',error);
      toast(errorMessage(error),'error');
      if(pollId)console.warn('A enquete foi criada, mas as opções falharam. Verifique o banco:',pollId);
    }finally{setBusy(button,false);}
  }

  async function moderateVent(id,status){
    if(!isStaff())return toast('Você não tem permissão para moderar desabafos.','error');
    if(!['approved','rejected'].includes(status))return;
    try{
      const {data:vent,error:fetchError}=await state.supabase.from(TABLE.vents).select('id,user_id,type,visibility,audio_url').eq('id',id).maybeSingle();
      if(fetchError)throw fetchError;
      if(!vent)return toast('Desabafo não encontrado.','error');
      if(vent.visibility==='private' && !isStaff())return toast('Este desabafo privado não pode ser moderado por esta conta.','error');
      const label = vent.type === 'audio' ? 'este áudio' : 'este desabafo';
      const reason = status === 'rejected' ? await askModerationReason('reject_content', label) : null;
      if(status === 'rejected' && !reason)return;
      if(!window.confirm(status==='approved'?'Aprovar este conteúdo?':`Recusar este conteúdo?\\n\\nMotivo: ${reason}`))return;
      const {error}=await state.supabase.from(TABLE.vents).update({status,moderation_reason:reason,moderated_at:new Date().toISOString(),moderated_by:state.user.id}).eq('id',id);
      if(error)throw error;
      await logAdmin(status==='approved'?'approve_vent':'reject_vent','vent',id);
      toast(status==='approved'?'Conteúdo aprovado.':'Conteúdo recusado. O estudante foi notificado com o motivo.');
      await loadPublicVents(); await loadAdmin(); if(isStaff())await loadAdminPrivateHistory();
    }catch(error){console.error('MODERATE VENT',error);toast(errorMessage(error),'error');}
  }

  async function deleteVent(id,audioPath=''){
    if(!state.user||!state.supabase)return false;
    try{
      const {data:vent,error:fetchError}=await state.supabase.from(TABLE.vents).select('id,user_id,visibility,audio_url').eq('id',id).maybeSingle();
      if(fetchError)throw fetchError;
      if(!vent){toast('Desabafo não encontrado.','error');return false;}
      const owner=vent.user_id===state.user.id;
      if(!owner&&!isStaff()){toast('Você não tem permissão para excluir este desabafo.','error');return false;}
      if(vent.visibility==='private' && !owner && !isStaff()){toast('Desabafos privados só podem ser excluídos pelo autor ou pela equipe de moderação.','error');return false;}
      if(!window.confirm('Excluir este desabafo permanentemente?'))return false;
      if(isStaff()) {
        const {error:rpcError}=await state.supabase.rpc('cae_staff_delete_content',{p_content_id:id,p_content_type:'vent'});
        if(rpcError) throw rpcError;
      } else {
        const {error}=await state.supabase.from(TABLE.vents).delete().eq('id',id);
        if(error)throw error;
      }
      await logAdmin('delete_vent','vent',id,{status:vent.status||'pending',visibility:vent.visibility||'public'});
      const path=audioPath||vent.audio_url||'';
      if(path){const {error:storageError}=await state.supabase.storage.from(AUDIO_BUCKET).remove([path]);if(storageError)console.warn('VENT AUDIO DELETE',storageError);}
      toast('Desabafo excluído permanentemente.');
      await loadHistory(); if(isStaff())await loadAdmin(); if(isStaff())await loadAdminPrivateHistory(); await loadPublicVents();
      return true;
    }catch(error){console.error('DELETE VENT',error);toast(errorMessage(error),'error');return false;}
  }

  async function moderatePost(id,status) {
    if(!isStaff()||!['approved','rejected'].includes(status))return;
    const post = state.adminPostRows.find(row => String(row.id) === String(id));
    const reason = status === 'rejected' ? await askModerationReason('reject_content','esta publicação') : null;
    if(status === 'rejected' && !reason)return;
    if(!window.confirm(status==='approved'?'Aprovar esta publicação?':`Recusar esta publicação?\\n\\nMotivo: ${reason}`))return;
    try{
      const {error}=await state.supabase.from(TABLE.posts).update({status,moderation_reason:reason,moderated_at:new Date().toISOString(),moderated_by:state.user.id}).eq('id',id); if(error)throw error;
      await logAdmin(status==='approved'?'approve_post':'reject_post','post',id); toast(status==='approved'?'Publicação aprovada.':'Publicação recusada. O estudante foi notificado com o motivo.'); await loadAdmin(); await loadPosts();
    }catch(error){console.error('MODERATE POST',error);toast(errorMessage(error),'error');}
  }

  async function resolveReport(id) {
    if(!isStaff())return;
    try{const {error}=await state.supabase.from(TABLE.reports).update({status:'resolved',resolved_at:new Date().toISOString(),resolved_by:state.user.id}).eq('id',id);if(error)throw error;await logAdmin('resolve_report','chat_report',id);toast('Denúncia resolvida.');await loadAdmin();}catch(error){console.error('RESOLVE REPORT',error);toast(errorMessage(error),'error');}
  }

  async function hideReportedMessage(messageId,reportId){
    if(!isStaff())return;
    const hidden=await hideMessage(messageId); if(hidden&&reportId)await resolveReport(reportId);
  }

  async function createAnnouncement(event){
    event.preventDefault();if(!isStaff())return;const title=$('announcement-title').value.trim();const body=$('announcement-body').value.trim();if(!title||!body)return;
    const button=event.submitter;setBusy(button,true,'Publicando...');try{const {error}=await state.supabase.from(TABLE.announcements).insert({title,body,published_by:state.user.id});if(error)throw error;event.target.reset();await logAdmin('create_announcement','announcement');toast('Aviso publicado.');await loadAnnouncements();}catch(error){console.error('ANNOUNCEMENT',error);toast(errorMessage(error),'error');}finally{setBusy(button,false);}
  }

  async function createEvent(event){
    event.preventDefault();if(!isStaff())return;const payload={title:$('event-title').value.trim(),event_date:$('event-date').value,event_time:$('event-time').value,place:$('event-place').value.trim(),description:$('event-description').value.trim(),published_by:state.user.id};if(Object.values(payload).slice(0,5).some(v=>!v))return;
    const button=event.submitter;setBusy(button,true,'Publicando...');try{const {error}=await state.supabase.from(TABLE.events).insert(payload);if(error)throw error;event.target.reset();await logAdmin('create_event','event');toast('Evento publicado.');await loadEvents();}catch(error){console.error('EVENT',error);toast(errorMessage(error),'error');}finally{setBusy(button,false);}
  }

  const labelsForType = type => ({free:'Texto livre',guided:'Perguntas guiadas',feelings:'Como eu me sinto',audio:'Áudio'}[type] || 'Desabafo');

  function postMatchesCharacterFilter(post, filter = state.adminPostFilter) {
    const body = String(getField(post, ['body'], '') || '');
    if (filter === 'all') return true;
    if (filter === 'emoji') return /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/u.test(body);
    if (filter === 'number') return /\p{N}/u.test(body);
    if (filter === 'symbol') {
      const withoutEmoji = body.replace(/(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/gu, '');
      return /[\p{S}#@%&*+<>|~^\\]/u.test(withoutEmoji);
    }
    return true;
  }

  function renderAdminPostModerationList() {
    const target = $('admin-post-list');
    if (!target) return;
    const rows = state.adminPostRows || [];
    const filter = ['all', 'emoji', 'number', 'symbol'].includes(state.adminPostFilter) ? state.adminPostFilter : 'all';
    state.adminPostFilter = filter;
    $$('[data-admin-post-char-filter]').forEach(button => {
      const active = button.dataset.adminPostCharFilter === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const matching = rows.filter(post => postMatchesCharacterFilter(post, filter));
    const pendingPosts = matching.filter(post => String(post.status || 'pending') === 'pending');
    const existingPosts = matching.filter(post => String(post.status || 'approved') !== 'pending');
    const renderCard = (post, canModerate) => `<article class="card"><div class="cae-post-meta">${escapeHTML(getField(post,['category'],'Geral'))} · ${escapeHTML(formatDate(post.created_at))}</div><p>${escapeHTML(getField(post,['body'],''))}</p><div class="cae-muted">Status: ${escapeHTML(String(post.status||'approved'))}</div><div class="actions">${canModerate?`<button class="btn primary" type="button" data-approve-post="${escapeHTML(post.id)}">Aprovar</button><button class="btn secondary" type="button" data-reject-post="${escapeHTML(post.id)}">Recusar</button>`:''}<button class="btn danger" type="button" data-delete-content="1" data-content-type="post" data-content-id="${escapeHTML(post.id)}" data-content-label="esta publicação">Excluir</button></div></article>`;
    const filterNames = { all: 'publicações', emoji: 'publicações com emojis', number: 'publicações com números', symbol: 'publicações com símbolos' };
    if (!matching.length) {
      target.innerHTML = `<div class="admin-private-empty"><p>Nenhuma ${filterNames[filter]} foi encontrada.</p></div>`;
      return;
    }
    target.innerHTML = (pendingPosts.length ? `<div class="eyebrow" style="margin:8px 0 12px">Aguardando moderação · ${pendingPosts.length}</div>${pendingPosts.map(post => renderCard(post, true)).join('')}` : '<div class="admin-private-empty"><p>Nenhuma publicação pendente neste filtro.</p></div>') + (existingPosts.length ? `<div class="eyebrow" style="margin:24px 0 12px">Publicações já decididas · ${existingPosts.length} · também podem ser excluídas</div>${existingPosts.map(post => renderCard(post, false)).join('')}` : '');
  }

  async function loadAdmin(ventFilter = state.adminVentFilter){
    if(!state.supabase||!isStaff())return;
    state.adminVentFilter=['free','guided','feelings','audio'].includes(ventFilter) ? ventFilter : state.adminVentFilter;
    $$('[data-admin-vent-filter]').forEach(button=>{const active=button.dataset.adminVentFilter===state.adminVentFilter;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
    ensurePollAdminForm();
    await Promise.allSettled([loadAdminPrivateVents(),loadAdminSupport(),loadAdminPrivateChats(),loadContentReports(),loadAdminDeletionRequests(),loadAdminSharedPodcasts()]);
    try{
      const [approved,pending,vents,reports,contentReports]=await Promise.all([
        state.supabase.from(TABLE.posts).select('id',{count:'exact',head:true}).eq('status','approved'),
        state.supabase.from(TABLE.posts).select('id',{count:'exact',head:true}).eq('status','pending'),
        state.supabase.from(TABLE.vents).select('id',{count:'exact',head:true}),
        state.supabase.from(TABLE.reports).select('id',{count:'exact',head:true}).eq('status','pending'),
        state.supabase.from(TABLE.contentReports).select('id',{count:'exact',head:true}).eq('status','pending')
      ]);
      [approved,pending,vents,reports].forEach(result=>{if(result.error)throw result.error;});
      if(contentReports.error) console.warn('CONTENT REPORT COUNT',contentReports.error);
      const totalPendingReports=(reports.count||0)+(contentReports.error?0:(contentReports.count||0));
      $('stat-approved').textContent=String(approved.count||0);
      $('stat-pending').textContent=String(pending.count||0);
      $('stat-vents').textContent=String(vents.count||0);
      $('stat-reports').textContent=String(totalPendingReports);
      if($('admin-reports-badge'))$('admin-reports-badge').textContent=String(totalPendingReports);
      if($('admin-post-count-label'))$('admin-post-count-label').textContent=`${pending.count||0} pendente${(pending.count||0)===1?'':'s'}`;

      const {data:postRows,error:postError}=await state.supabase.from(TABLE.posts).select('*').order('created_at',{ascending:false}).limit(150);if(postError)throw postError;
      state.adminPostRows = postRows || [];
      renderAdminPostModerationList();

      const [announcementRows,eventRows,pollRows]=await Promise.all([
        state.supabase.from(TABLE.announcements).select('*').order('created_at',{ascending:false}).limit(100),
        state.supabase.from(TABLE.events).select('*').order('event_date',{ascending:false}).limit(100),
        state.supabase.from(TABLE.polls).select('*').order('created_at',{ascending:false}).limit(100)
      ]);
      [announcementRows,eventRows,pollRows].forEach(result=>{if(result.error)throw result.error;});
      $('admin-announcement-list').innerHTML=announcementRows.data?.length?announcementRows.data.map(row=>`<article class="card"><div class="eyebrow">Aviso · ${escapeHTML(formatDate(row.created_at))}</div><h3>${escapeHTML(getField(row,['title'],'Aviso'))}</h3><p>${escapeHTML(getField(row,['body'],'')).replace(/\n/g,'<br>')}</p><div class="actions"><button class="btn danger" type="button" data-delete-content="1" data-content-type="announcement" data-content-id="${escapeHTML(row.id)}" data-content-label="este aviso">Excluir</button></div></article>`).join(''):'<div class="card"><p>Nenhum aviso publicado.</p></div>';
      $('admin-event-list').innerHTML=eventRows.data?.length?eventRows.data.map(row=>`<article class="card"><div class="eyebrow">${escapeHTML(formatDateOnly(getField(row,['event_date'],null)))}${getField(row,['event_time'],'')?` · ${escapeHTML(String(getField(row,['event_time'],'')).slice(0,5))}`:''}</div><h3>${escapeHTML(getField(row,['title'],'Evento'))}</h3><p>${escapeHTML(getField(row,['description'],'')).replace(/\n/g,'<br>')}</p><p class="cae-muted">${escapeHTML(getField(row,['place'],'')).replace(/\n/g,'<br>')}</p><div class="actions"><button class="btn danger" type="button" data-delete-content="1" data-content-type="event" data-content-id="${escapeHTML(row.id)}" data-content-label="este evento">Excluir</button></div></article>`).join(''):'<div class="card"><p>Nenhum evento publicado.</p></div>';
      const pollList=$('admin-poll-list');
      if(pollList){pollList.innerHTML=pollRows.data?.length?pollRows.data.map(row=>`<article class="card"><div class="eyebrow">Enquete · ${escapeHTML(formatDate(row.created_at))}</div><h3>${escapeHTML(getField(row,['question'],'Enquete'))}</h3><div class="actions"><button class="btn danger" type="button" data-delete-content="1" data-content-type="poll" data-content-id="${escapeHTML(row.id)}" data-content-label="esta enquete">Excluir</button></div></article>`).join(''):'<div class="card"><p>Nenhuma enquete publicada.</p></div>';}

      let pendingVents=(await state.supabase.from(TABLE.vents).select('id,user_id,type,body,feeling,audio_url,status,visibility,created_at').eq('status','pending').order('created_at',{ascending:true}).limit(100)).data||[];
      pendingVents=pendingVents.filter(vent=>String(vent.type||'free')===state.adminVentFilter);
      let publishedVents=(await state.supabase.from(TABLE.vents).select('id,user_id,type,body,feeling,audio_url,status,visibility,created_at').eq('status','approved').eq('visibility','public').order('created_at',{ascending:false}).limit(100)).data||[];
      publishedVents=publishedVents.filter(vent=>String(vent.type||'free')===state.adminVentFilter);
      const labels={free:'Texto livre',guided:'Perguntas guiadas',feelings:'Como eu me sinto',audio:'Áudio'};
      const icons={free:'pen-line',guided:'list-checks',feelings:'heart',audio:'mic'};
      const renderModerationVentCard=(vent,published=false)=>{
        const body=getField(vent,['body'],'');const feeling=getField(vent,['feeling'],'');const audioPath=getField(vent,['audio_url'],'');const isPrivateAudio=vent.visibility==='private'&&vent.type==='audio';const privateTag=vent.visibility==='private'?`<span class="cae-privacy-badge private">${isPrivateAudio?'Áudio privado · equipe autorizada':'Privado · equipe de moderação'}</span>`:'<span class="cae-privacy-badge public">Público</span>';const deleteButton=isStaff()?`<button class="btn danger" type="button" data-delete-vent="${escapeHTML(vent.id)}" data-audio-path="${escapeHTML(audioPath)}">Excluir</button>`:'';const replyButton=isStaff()?`<button class="btn secondary" type="button" data-reply-vent="${escapeHTML(vent.id)}" data-reply-code="${escapeHTML(publicName(vent.user_id))}"><i data-lucide="message-circle"></i>Responder em privado</button>`:'';const moderationButtons=published?'':`<button class="btn primary" type="button" data-approve-vent="${escapeHTML(vent.id)}">Aprovar</button><button class="btn secondary" type="button" data-reject-vent="${escapeHTML(vent.id)}">Recusar</button>`;const statusBadge=published?'<span class="cae-privacy-badge public">Publicado</span>':privateTag;return `<article class="card admin-vent-review-card"><div class="admin-vent-review-head"><div><div class="public-vent-type"><span class="vent-tab-icon"><i data-lucide="${icons[vent.type]||'notebook-pen'}"></i></span><strong>${escapeHTML(labels[vent.type]||'Desabafo')}</strong></div><div class="cae-post-meta">${escapeHTML(publicName(vent.user_id))} · ${escapeHTML(formatDate(vent.created_at))}</div></div>${statusBadge}</div>${feeling?`<div class="public-vent-feeling"><b>${escapeHTML(feeling)}</b></div>`:''}${body?renderVentBody(vent.type,body,'admin-vent-body'):''}${audioPath?`<div class="admin-audio"><button class="btn secondary" type="button" data-play-admin-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>`:''}<div class="actions" style="margin-top:14px">${moderationButtons}${replyButton}${deleteButton}</div></article>`;
      };
      const pendingHtml=pendingVents.length?`<div class="eyebrow" style="margin:8px 0 12px">Aguardando moderação</div>${pendingVents.map(v=>renderModerationVentCard(v,false)).join('')}`:`<div class="admin-private-empty"><p>Nenhum ${escapeHTML(labelsForType(state.adminVentFilter).toLowerCase())} pendente.</p></div>`;
      const publishedHtml=publishedVents.length?`<div class="eyebrow" style="margin:24px 0 12px">Já publicados · também podem receber resposta privada</div>${publishedVents.map(v=>renderModerationVentCard(v,true)).join('')}`:`<div class="admin-private-empty"><p>Nenhum desabafo publicado nesta categoria.</p></div>`;
      $('admin-vent-list').innerHTML=pendingHtml+publishedHtml;refreshIcons();

      const {data:reportRows,error:reportError}=await state.supabase.from(TABLE.reports).select('*').eq('status','pending').order('created_at',{ascending:true}).limit(100);if(reportError)throw reportError;
      $('admin-report-list').innerHTML=reportRows?.length?reportRows.map(report=>`<article class="card report-card"><div class="cae-post-meta">Denúncia · ${escapeHTML(formatDate(report.created_at))}</div><p><b>Motivo:</b> ${escapeHTML(report.reason)}</p><p class="cae-muted">Denunciada por: ${escapeHTML(publicName(report.reporter_id))} · código da mensagem <code>${escapeHTML(String(report.message_id).slice(0,8))}…</code></p><div class="actions"><button class="btn danger" type="button" data-hide-reported="${escapeHTML(report.message_id)}" data-report-id="${escapeHTML(report.id)}">Ocultar mensagem</button><button class="btn secondary" type="button" data-resolve-report="${escapeHTML(report.id)}">Resolver sem ocultar</button></div></article>`).join(''):'<div class="card"><p>Nenhuma denúncia pendente.</p></div>';
    }catch(error){console.error('ADMIN',error);toast(`Painel da equipe: ${errorMessage(error)}`,'error');}
  }

  function openSiteHelp(button) {
    const modal = $('site-help-modal');
    if (!modal) return;
    $('site-help-title').textContent = button.dataset.helpTitle || 'Sobre esta opção';
    $('site-help-text').textContent = button.dataset.helpText || 'Veja as informações desta opção antes de continuar.';
    modal.classList.remove('hidden');
    refreshIcons();
  }

  function closeSiteHelp() {
    $('site-help-modal')?.classList.add('hidden');
  }


  function bookmarkButtonHTML(type, id) {
    const saved = state.bookmarks.has(String(type) + ':' + String(id));
    return '<button class="btn ghost btn-small" type="button" data-toggle-bookmark="1" data-bookmark-type="' + escapeHTML(type) + '" data-bookmark-id="' + escapeHTML(id) + '" aria-pressed="' + String(saved) + '">' +
      (saved ? '<i data-lucide="bookmark-check"></i>Salvo' : '<i data-lucide="bookmark"></i>Salvar') + '</button>';
  }

  async function loadBookmarks() {
    if (!state.user || !state.supabase) return;
    try {
      const { data, error } = await state.supabase.from(TABLE.bookmarks)
        .select('id,content_type,content_id,created_at')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      state.bookmarkRows = data || [];
      state.bookmarks = new Set(state.bookmarkRows.map(row => String(row.content_type) + ':' + String(row.content_id)));
      document.querySelectorAll('[data-toggle-bookmark]').forEach(button => {
        const saved = state.bookmarks.has(button.dataset.bookmarkType + ':' + button.dataset.bookmarkId);
        button.setAttribute('aria-pressed', String(saved));
        button.innerHTML = saved ? '<i data-lucide="bookmark-check"></i>Salvo' : '<i data-lucide="bookmark"></i>Salvar';
      });
      refreshIcons();
    } catch (error) {
      console.warn('BOOKMARKS', error);
      state.bookmarkRows = [];
      state.bookmarks = new Set();
    }
  }

  async function toggleBookmark(type, id) {
    if (!state.user || !state.supabase || !type || !id) return;
    const key = String(type) + ':' + String(id);
    try {
      if (state.bookmarks.has(key)) {
        const { error } = await state.supabase.from(TABLE.bookmarks).delete()
          .eq('user_id', state.user.id).eq('content_type', type).eq('content_id', String(id));
        if (error) throw error;
        state.bookmarks.delete(key);
        toast('Removido dos conteúdos salvos.');
      } else {
        const { error } = await state.supabase.from(TABLE.bookmarks).insert({
          user_id: state.user.id, content_type: type, content_id: String(id)
        });
        if (error) throw error;
        state.bookmarks.add(key);
        toast('Conteúdo salvo.');
      }
      document.querySelectorAll('[data-toggle-bookmark]').forEach(button => {
        if (button.dataset.bookmarkType !== String(type) || button.dataset.bookmarkId !== String(id)) return;
        const saved = state.bookmarks.has(key);
        button.setAttribute('aria-pressed', String(saved));
        button.innerHTML = saved ? '<i data-lucide="bookmark-check"></i>Salvo' : '<i data-lucide="bookmark"></i>Salvar';
      });
      if (state.currentView === 'history-view' && state.historyFilter === 'saved') await loadSavedContent();
      refreshIcons();
    } catch (error) {
      console.error('BOOKMARK TOGGLE', error);
      toast('Não foi possível salvar este conteúdo. Confira se a migração de recursos do CAE já foi aplicada.', 'error');
    }
  }

  async function loadSavedContent() {
    const list = $('saved-content-list');
    if (!list || !state.user || !state.supabase) return;
    list.innerHTML = '<div class="card"><p>Carregando seus conteúdos salvos…</p></div>';
    try {
      await loadBookmarks();
      if (!state.bookmarkRows.length) {
        list.innerHTML = '<div class="card"><p>Você ainda não salvou nenhum conteúdo.</p><p class="cae-muted">Use o botão Salvar nos avisos, eventos, publicações e enquetes.</p></div>';
        return;
      }
      const types = ['post', 'announcement', 'event', 'poll', 'podcast'];
      const labels = { post: 'Publicação', announcement: 'Aviso', event: 'Evento', poll: 'Enquete', podcast: 'Podcast da comunidade' };
      const configs = {
        post: { table: TABLE.posts, fields: 'id,category,body,created_at' },
        announcement: { table: TABLE.announcements, fields: 'id,title,body,created_at' },
        event: { table: TABLE.events, fields: 'id,title,description,place,event_date,event_time,created_at' },
        poll: { table: TABLE.polls, fields: 'id,question,created_at' },
        podcast: { table: TABLE.sharedPodcasts, fields: 'id,title,description,category,url,created_at' }
      };
      const sections = [];
      for (const type of types) {
        const ids = state.bookmarkRows.filter(row => row.content_type === type).map(row => row.content_id);
        if (!ids.length) continue;
        const { data, error } = await state.supabase.from(configs[type].table).select(configs[type].fields).in('id', ids);
        if (error) throw error;
        (data || []).forEach(row => {
          const title = row.title || row.question || row.category || labels[type];
          const body = row.body || row.description || (row.place ? row.place : '');
          const external = type === 'podcast' ? '<p><a href="' + escapeHTML(row.url) + '" target="_blank" rel="noopener noreferrer">Abrir podcast</a></p>' : '';
          sections.push('<article class="card saved-content-card"><div class="eyebrow">' + labels[type] + ' · ' + escapeHTML(formatDate(row.created_at || row.event_date)) + '</div><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(body) + '</p>' + external + '<div class="actions"><button class="btn ghost btn-small" type="button" data-toggle-bookmark="1" data-bookmark-type="' + type + '" data-bookmark-id="' + escapeHTML(row.id) + '"><i data-lucide="bookmark-check"></i>Remover dos salvos</button></div></article>');
        });
      }
      list.innerHTML = sections.length ? sections.join('') : '<div class="card"><p>Os conteúdos salvos não estão mais disponíveis.</p></div>';
      refreshIcons();
    } catch (error) {
      console.error('SAVED CONTENT', error);
      list.innerHTML = '<div class="card"><p class="cae-danger">Não foi possível carregar os conteúdos salvos. Confira se a migração do CAE foi aplicada.</p></div>';
    }
  }

  const MOOD_LABELS = {
    great: 'Muito bem', good: 'Bem', neutral: 'Mais ou menos',
    difficult: 'Difícil', very_difficult: 'Muito difícil'
  };
  const MOOD_EMOJIS = {
    great: '😄', good: '🙂', neutral: '😐', difficult: '😟', very_difficult: '😢'
  };

  async function loadMoodEntries() {
    const list = $('mood-entry-list');
    if (!list || !state.user || !state.supabase) return;
    list.innerHTML = '<div class="card"><p>Carregando registros…</p></div>';
    try {
      const { data, error } = await state.supabase.from(TABLE.moods)
        .select('id,mood,note,created_at').eq('user_id', state.user.id)
        .order('created_at', { ascending: false }).limit(90);
      if (error) throw error;
      state.moodRows = data || [];
      if (!state.moodRows.length) {
        list.innerHTML = '<div class="card"><p>Seu diário ainda está vazio.</p><p class="cae-muted">O primeiro registro fica visível apenas para você.</p></div>';
        return;
      }
      list.innerHTML = state.moodRows.map(row =>
        '<article class="card mood-history-card"><div class="own-vent-meta"><div><strong>' + MOOD_EMOJIS[row.mood] + ' ' + escapeHTML(MOOD_LABELS[row.mood] || 'Registro') + '</strong><div class="eyebrow">' + escapeHTML(formatDate(row.created_at)) + '</div></div><button class="btn ghost btn-small" type="button" data-delete-mood="' + escapeHTML(row.id) + '">Excluir</button></div>' +
        (row.note ? '<p>' + escapeHTML(row.note).replace(/\n/g, '<br>') + '</p>' : '<p class="cae-muted">Sem anotação.</p>') + '</article>'
      ).join('');
    } catch (error) {
      console.error('MOOD LOAD', error);
      list.innerHTML = '<div class="card"><p class="cae-danger">O diário não pôde ser carregado. Confira se a migração do CAE foi aplicada.</p></div>';
    }
  }

  async function saveMoodEntry(event) {
    event.preventDefault();
    if (!state.user || !state.supabase || !ensureAccountCanInteract()) return;
    const form = $('mood-entry-form');
    const mood = form?.querySelector('input[name="mood-entry"]:checked')?.value;
    const note = $('mood-entry-note')?.value.trim() || '';
    if (!mood || !MOOD_LABELS[mood]) {
      setStatus('mood-entry-status', 'Escolha como você está se sentindo.');
      return;
    }
    const button = $('mood-entry-save');
    setBusy(button, true, 'Salvando…');
    try {
      const { error } = await state.supabase.from(TABLE.moods).insert({ user_id: state.user.id, mood, note });
      if (error) throw error;
      form.reset();
      setStatus('mood-entry-status', 'Registro salvo. Só você pode consultar este diário.', 'ok');
      await loadMoodEntries();
    } catch (error) {
      console.error('MOOD SAVE', error);
      setStatus('mood-entry-status', 'Não foi possível salvar. Confira se a migração do CAE foi aplicada.');
    } finally {
      setBusy(button, false);
    }
  }

  async function deleteMoodEntry(id) {
    if (!id || !state.user || !window.confirm('Excluir este registro do diário?')) return;
    try {
      const { error } = await state.supabase.from(TABLE.moods).delete().eq('id', id).eq('user_id', state.user.id);
      if (error) throw error;
      await loadMoodEntries();
      toast('Registro excluído.');
    } catch (error) {
      console.error('MOOD DELETE', error);
      toast('Não foi possível excluir este registro.', 'error');
    }
  }

  function filterHistoryCards() {
    const query = String($('history-search')?.value || '').trim().toLocaleLowerCase('pt-BR');
    $('#history-view .own-vent-card, #history-view .mood-history-card, #history-view .saved-content-card').forEach(card => {
      card.classList.toggle('hidden', Boolean(query) && !card.textContent.toLocaleLowerCase('pt-BR').includes(query));
    });
  }

  function renderMuralSearch() {
    const input = $('mural-search');
    const results = $('mural-search-results');
    const tabs = $('mural-tabs');
    if (!input || !results || !tabs) return;
    const query = input.value.trim().toLocaleLowerCase('pt-BR');
    if (!query) {
      results.classList.add('hidden');
      results.innerHTML = '';
      tabs.classList.remove('hidden');
      $('#mural-view .panel').forEach(panel => panel.classList.remove('hidden'));
      return;
    }
    const cards = $('#mural-view .panel article.card, #mural-view .podcast-grid article.card');
    const matches = cards.filter(card => card.textContent.toLocaleLowerCase('pt-BR').includes(query));
    const sections = ['announcements', 'events', 'posts', 'polls', 'podcasts'];
    const sectionLabels = { announcements: 'Avisos', events: 'Eventos', posts: 'Publicações', polls: 'Enquetes', podcasts: 'Podcasts' };
    results.innerHTML = matches.length ? matches.map(card => {
      const panel = card.closest('.panel');
      const section = panel ? sections.find(key => panel.id === 'panel-' + key) || 'announcements' : 'podcasts';
      return '<article class="card mural-search-result"><div class="eyebrow">' + sectionLabels[section] + '</div>' + card.outerHTML +
        '<button class="btn secondary btn-small" type="button" data-search-open-panel="' + section + '">Abrir seção</button></article>';
    }).join('') : '<div class="card"><p>Nenhum resultado encontrado para “' + escapeHTML(input.value.trim()) + '”.</p></div>';
    results.classList.remove('hidden');
    tabs.classList.add('hidden');
    $('#mural-view .panel').forEach(panel => panel.classList.add('hidden'));
    refreshIcons();
  }

  function downloadEventCalendar(id) {
    const row = state.eventRows.find(event => String(event.id) === String(id));
    if (!row) return toast('Não encontrei este evento. Atualize o mural e tente novamente.', 'error');
    const title = String(row.title || 'Evento CAE');
    const description = String(row.description || '');
    const location = String(row.place || '');
    const escapeIcs = value => String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const pad = value => String(value).padStart(2, '0');
    const date = String(row.event_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('A data deste evento está inválida.', 'error');
    let start, end, allDay = !row.event_time;
    if (allDay) {
      start = date.replace(/-/g, '');
      const next = new Date(date + 'T12:00:00');
      next.setDate(next.getDate() + 1);
      end = next.getFullYear() + pad(next.getMonth() + 1) + pad(next.getDate());
    } else {
      const time = String(row.event_time).slice(0, 5);
      const startDate = new Date(date + 'T' + time + ':00');
      if (Number.isNaN(startDate.getTime())) return toast('O horário deste evento está inválido.', 'error');
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      const utc = value => value.getUTCFullYear() + pad(value.getUTCMonth() + 1) + pad(value.getUTCDate()) + 'T' + pad(value.getUTCHours()) + pad(value.getUTCMinutes()) + '00Z';
      start = utc(startDate);
      end = utc(endDate);
    }
    const dtStart = allDay ? 'DTSTART;VALUE=DATE:' + start : 'DTSTART:' + start;
    const dtEnd = allDay ? 'DTEND;VALUE=DATE:' + end : 'DTEND:' + end;
    const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CAE//Agenda//PT-BR','CALSCALE:GREGORIAN','BEGIN:VEVENT',
      'UID:' + String(row.id) + '@cae','DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
      dtStart,dtEnd,'SUMMARY:' + escapeIcs(title),'DESCRIPTION:' + escapeIcs(description),'LOCATION:' + escapeIcs(location),
      'END:VEVENT','END:VCALENDAR'].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'cae-evento-' + date + '.ics';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function submitContentReport(type, id) {
    if (!state.user || !state.supabase) return;
    const reason = window.prompt('Por que você quer denunciar este conteúdo? Informe um motivo claro (mínimo de 3 caracteres).');
    if (!reason || reason.trim().length < 3) return;
    try {
      const { error } = await state.supabase.rpc('cae_submit_content_report', {
        p_target_type: type,
        p_target_id: id,
        p_reason: reason.trim(),
        p_details: ''
      });
      if (error) throw error;
      toast('Denúncia encaminhada à equipe de moderação.');
      if (isStaff()) await loadContentReports();
    } catch (error) {
      console.error('CONTENT REPORT', error);
      toast('Não foi possível enviar a denúncia. A migração de segurança pode ainda não ter sido aplicada.', 'error');
    }
  }

  async function loadContentReports() {
    const list = $('admin-content-report-list');
    if (!list || !isStaff() || !state.supabase) return;
    try {
      const { data, error } = await state.supabase.from(TABLE.contentReports)
        .select('id,reporter_id,target_type,target_id,reason,details,status,created_at')
        .eq('status', 'pending').order('created_at', { ascending: true }).limit(100);
      if (error) throw error;
      if (!data?.length) {
        list.innerHTML = '<div class="card"><p>Nenhuma denúncia de outras áreas pendente.</p></div>';
        return;
      }
      const cards = [];
      for (const report of data) {
        let preview = 'Conteúdo denunciado';
        if (report.target_type === 'post') {
          const { data: row } = await state.supabase.from(TABLE.posts).select('body,category').eq('id', report.target_id).maybeSingle();
          if (row) preview = (row.category ? row.category + ' · ' : '') + (row.body || '');
        } else if (report.target_type === 'podcast') {
          const { data: row } = await state.supabase.from(TABLE.sharedPodcasts).select('title,description,url').eq('id', report.target_id).maybeSingle();
          if (row) preview = (row.title || 'Podcast') + (row.description ? ' · ' + row.description : '') + (row.url ? ' · ' + row.url : '');
        } else if (report.target_type === 'vent') {
          const { data: row } = await state.supabase.from(TABLE.vents).select('type,body,feeling').eq('id', report.target_id).maybeSingle();
          if (row) preview = row.feeling || row.body || 'Desabafo em áudio';
        } else {
          preview = 'Mensagem de conversa privada. Abra “Conversas privadas · segurança” para verificar.';
        }
        const removeButton = report.target_type === 'private_message' ? '' :
          '<button class="btn danger btn-small" type="button" data-remove-reported-content="1" data-report-id="' + escapeHTML(report.id) + '" data-content-type="' + escapeHTML(report.target_type) + '" data-content-id="' + escapeHTML(report.target_id) + '">Remover conteúdo</button>';
        const privateButton = report.target_type === 'private_message' ?
          '<button class="btn secondary btn-small" type="button" data-admin-tab="private_chats">Abrir conversas privadas</button>' : '';
        cards.push('<article class="card report-card"><div class="cae-post-meta">' + escapeHTML(report.target_type) + ' · ' + escapeHTML(formatDate(report.created_at)) + '</div><p><b>Motivo:</b> ' + escapeHTML(report.reason) + '</p>' +
          (report.details ? '<p>' + escapeHTML(report.details) + '</p>' : '') + '<p>' + escapeHTML(preview).slice(0, 1200) + '</p><p class="cae-muted">Denunciado por ' + escapeHTML(publicName(report.reporter_id)) + '</p><div class="actions">' +
          removeButton + privateButton + '<button class="btn secondary btn-small" type="button" data-resolve-content-report="' + escapeHTML(report.id) + '">Marcar como analisada</button>' +
          '<button class="btn ghost btn-small" type="button" data-dismiss-content-report="' + escapeHTML(report.id) + '">Descartar denúncia</button></div></article>');
      }
      list.innerHTML = cards.join('');
    } catch (error) {
      console.warn('CONTENT REPORTS', error);
      list.innerHTML = '<div class="card"><p class="cae-muted">Fila de denúncias de outras áreas indisponível. Confira se a migração do CAE foi aplicada.</p></div>';
    }
  }

  async function updateContentReportStatus(id, status) {
    if (!isStaff() || !['reviewed', 'dismissed'].includes(status)) return;
    try {
      const { error } = await state.supabase.from(TABLE.contentReports).update({
        status, reviewed_at: new Date().toISOString(), reviewed_by: state.user.id
      }).eq('id', id);
      if (error) throw error;
      await loadContentReports();
      toast(status === 'reviewed' ? 'Denúncia marcada como analisada.' : 'Denúncia descartada.');
    } catch (error) {
      console.error('CONTENT REPORT STATUS', error);
      toast('Não foi possível atualizar a denúncia.', 'error');
    }
  }

  async function removeReportedContent(reportId, type, contentId) {
    let ok = false;
    if (type === 'vent') ok = await deleteVent(contentId);
    else if (type === 'podcast') {
      try {
        const { error } = await state.supabase.from(TABLE.sharedPodcasts).delete().eq('id', contentId);
        if (error) throw error;
        await Promise.all([loadAdminSharedPodcasts(), loadCommunityPodcasts()]);
        ok = true;
      } catch (error) { toast(errorMessage(error), 'error'); }
    } else ok = await deleteStaffContent(type, contentId, 'este conteúdo denunciado');
    if (ok) await updateContentReportStatus(reportId, 'reviewed');
  }

  async function loadUserPreferences() {
    if (!state.user || !state.supabase) return;
    try {
      const { data, error } = await state.supabase.from(TABLE.preferences).select('notifications_enabled,reduced_motion')
        .eq('user_id', state.user.id).maybeSingle();
      if (error) throw error;
      state.notificationsEnabled = data?.notifications_enabled !== false;
      state.reducedMotion = data?.reduced_motion === true;
      if ($('preference-notifications')) $('preference-notifications').checked = state.notificationsEnabled;
      if ($('preference-reduced-motion')) $('preference-reduced-motion').checked = state.reducedMotion;
      document.documentElement.classList.toggle('cae-reduced-motion', state.reducedMotion);
      document.querySelector('.notification-shell')?.classList.toggle('hidden', !state.notificationsEnabled);
    } catch (error) {
      console.warn('USER PREFERENCES', error);
    }
  }

  async function saveUserPreferences() {
    if (!state.user || !state.supabase) return;
    const notificationsEnabled = $('preference-notifications')?.checked !== false;
    const reducedMotion = $('preference-reduced-motion')?.checked === true;
    try {
      const { error } = await state.supabase.from(TABLE.preferences).upsert({
        user_id: state.user.id,
        notifications_enabled: notificationsEnabled,
        reduced_motion: reducedMotion,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (error) throw error;
      state.notificationsEnabled = notificationsEnabled;
      state.reducedMotion = reducedMotion;
      document.documentElement.classList.toggle('cae-reduced-motion', reducedMotion);
      document.querySelector('.notification-shell')?.classList.toggle('hidden', !notificationsEnabled);
      setStatus('preferences-status', 'Preferências salvas.', 'ok');
      await loadNotifications();
    } catch (error) {
      console.error('PREFERENCES SAVE', error);
      setStatus('preferences-status', 'Não foi possível salvar. Confira se a migração do CAE foi aplicada.');
    }
  }

  async function signOutOtherSessions() {
    if (!state.supabase || !window.confirm('Encerrar as outras sessões da sua conta? Esta sessão continuará aberta.')) return;
    const status = $('session-management-status');
    try {
      const { error } = await state.supabase.auth.signOut({ scope: 'others' });
      if (error) throw error;
      if (status) status.textContent = 'As outras sessões foram encerradas.';
      toast('Outras sessões encerradas.');
    } catch (error) {
      console.error('SIGN OUT OTHER SESSIONS', error);
      if (status) status.textContent = 'Não foi possível encerrar as outras sessões. Confira a configuração de sessão do Supabase.';
    }
  }

  async function requestAccountDeletion() {
    if (!state.user || !state.supabase) return;
    if (!window.confirm('Enviar uma solicitação de exclusão da conta? A equipe precisará processá-la; a conta não será apagada imediatamente.')) return;
    const button = $('request-account-deletion');
    setBusy(button, true, 'Enviando solicitação…');
    try {
      const { error } = await state.supabase.rpc('cae_request_account_deletion');
      if (error) throw error;
      setStatus('account-deletion-status', 'Solicitação registrada. A equipe precisa processar a exclusão manualmente.');
      toast('Solicitação de exclusão enviada.');
    } catch (error) {
      console.error('ACCOUNT DELETION REQUEST', error);
      setStatus('account-deletion-status', 'Não foi possível registrar a solicitação. Confira se a migração do CAE foi aplicada.');
    } finally {
      setBusy(button, false);
    }
  }

  async function loadAdminDeletionRequests() {
    const list = $('admin-deletion-request-list');
    if (!list || !isStaff() || !state.supabase) return;
    try {
      const { data, error } = await state.supabase.from(TABLE.deletionRequests)
        .select('id,user_id,status,requested_at').in('status', ['pending', 'processing'])
        .order('requested_at', { ascending: true }).limit(100);
      if (error) throw error;
      list.innerHTML = data?.length ? data.map(row =>
        '<article class="card"><div class="cae-post-meta">' + escapeHTML(publicName(row.user_id)) + ' · ' + escapeHTML(formatDate(row.requested_at)) + '</div><p>Status: ' + escapeHTML(row.status) + '</p><p class="cae-muted">Após revisar e excluir os dados/usuário manualmente no Supabase, marque como concluída.</p><button class="btn secondary btn-small" type="button" data-complete-deletion-request="' + escapeHTML(row.id) + '">Marcar como concluída</button></article>'
      ).join('') : '<div class="card"><p>Nenhuma solicitação pendente.</p></div>';
    } catch (error) {
      console.warn('DELETION REQUESTS', error);
      list.innerHTML = '<div class="card"><p class="cae-muted">Solicitações indisponíveis. Confira se a migração do CAE foi aplicada.</p></div>';
    }
  }

  async function completeDeletionRequest(id) {
    if (!isStaff() || !window.confirm('Confirma que a solicitação já foi processada e que a exclusão foi realizada no Supabase?')) return;
    try {
      const { error } = await state.supabase.from(TABLE.deletionRequests).update({
        status: 'completed', completed_at: new Date().toISOString()
      }).eq('id', id);
      if (error) throw error;
      await loadAdminDeletionRequests();
      toast('Solicitação marcada como concluída.');
    } catch (error) {
      console.error('COMPLETE DELETION REQUEST', error);
      toast('Não foi possível atualizar a solicitação.', 'error');
    }
  }

  function cancelTextVoiceGeneration() {
    if (!state.ttsGenerating || state.ttsVoiceStyle !== 'female') return;
    state.ttsCancelled = true;
    destroyFemaleTtsWorker();
  }

  function bindDelegatedEvents(){
    document.addEventListener('submit',async event=>{
      if(event.target.matches('#mood-entry-form')) return saveMoodEntry(event);
      if(event.target.matches('#podcast-share-form')) return submitCommunityPodcast(event);
      if(event.target.matches('#support-form')) return sendSupportMessage(event);
      if(event.target.matches('#admin-support-form')) return sendAdminSupportMessage(event);
      if(event.target.matches('#private-chat-form')) return sendPrivateMessage(event);
    });
    document.addEventListener('change',event=>{
      if(event.target.matches('#admin-support-conversation')) renderSelectedAdminSupportConversation();
      if(event.target.matches('#preference-notifications,#preference-reduced-motion')) saveUserPreferences();
    });
    document.addEventListener('input',event=>{
      if(event.target.matches('#history-search')) filterHistoryCards();
      if(event.target.matches('#mural-search')) renderMuralSearch();
    });
    document.addEventListener('click',async event=>{
      const helpButton = event.target.closest('[data-site-help]');
      if (helpButton) { openSiteHelp(helpButton); return; }
      if (event.target.closest('#site-help-close,#site-help-ok') || event.target.id === 'site-help-modal') { closeSiteHelp(); return; }
      const button=event.target.closest('button');if(!button)return;
      if(button.matches('#admin-role-button')){await setAccountRole();return;}
      if(button.matches('[data-user-moderation]')){await moderateAccount(button.dataset.userModeration,button);return;}
      if(button.matches('[data-admin-tab]')){showAdminPanel(button.dataset.adminTab);return;}
      if(button.matches('[data-moderate-shared-podcast]')){await moderateSharedPodcast(button.dataset.podcastId,button.dataset.moderateSharedPodcast);return;}
      if(button.matches('[data-delete-shared-podcast]')){await deleteSharedPodcast(button.dataset.deleteSharedPodcast);return;}
      if(button.matches('[data-toggle-bookmark]')){await toggleBookmark(button.dataset.bookmarkType,button.dataset.bookmarkId);return;}
      if(button.matches('[data-report-content]')){await submitContentReport(button.dataset.reportContent,button.dataset.reportId);return;}
      if(button.matches('[data-search-open-panel]')){$('mural-search').value='';renderMuralSearch();switchMuralPanel(button.dataset.searchOpenPanel);return;}
      if(button.matches('[data-download-event]')){downloadEventCalendar(button.dataset.downloadEvent);return;}
      if(button.matches('[data-delete-mood]')){await deleteMoodEntry(button.dataset.deleteMood);return;}
      if(button.matches('[data-resolve-content-report]')){await updateContentReportStatus(button.dataset.resolveContentReport,'reviewed');return;}
      if(button.matches('[data-dismiss-content-report]')){await updateContentReportStatus(button.dataset.dismissContentReport,'dismissed');return;}
      if(button.matches('[data-remove-reported-content]')){await removeReportedContent(button.dataset.reportId,button.dataset.contentType,button.dataset.contentId);return;}
      if(button.matches('[data-complete-deletion-request]')){await completeDeletionRequest(button.dataset.completeDeletionRequest);return;}
      if(button.matches('#signout-other-sessions')){await signOutOtherSessions();return;}
      if(button.matches('#request-account-deletion')){await requestAccountDeletion();return;}
      if(button.matches('#tts-cancel')){cancelTextVoiceGeneration();return;}
      if(button.matches('[data-admin-post-char-filter]')){state.adminPostFilter=button.dataset.adminPostCharFilter;renderAdminPostModerationList();return;}
      if(button.matches('[data-admin-vent-filter]')){showAdminPanel('vents');await loadAdmin(button.dataset.adminVentFilter);return;}
      if(button.matches('[data-direct-timeout]')){await directAccountModeration(button.dataset.directTimeout,'timeout',button);return;}
      if(button.matches('[data-direct-ban]')){await directAccountModeration(button.dataset.directBan,'ban',button);return;}
      if(button.matches('#admin-notifications-button')){openAdminNotificationsPanel();return;}
      if(button.matches('#admin-notifications-mark-read')){await markAllAdminNotificationsRead();return;}
      if(button.matches('[data-open-admin-notification]')){await openAdminNotification(button.dataset.openAdminNotification);return;}
      if(button.matches('#notifications-button')){openNotificationsPanel();return;}
      if(button.matches('#notifications-mark-read')){await markAllNotificationsRead();return;}
      if(button.matches('[data-open-notification]')){await openNotification(button.dataset.openNotification);return;}
      if(button.matches('[data-private-request-action]')){await respondPrivateRequest(button.dataset.privateRequestId,button.dataset.privateRequestAction==='accept');return;}
      if(button.matches('[data-private-conversation-id]')){state.privateSelectedConversationId=button.dataset.privateConversationId;await loadPrivateChatData(state.privateSelectedConversationId);return;}
      if(button.matches('#private-chat-request')){await requestPrivateChat();return;}
      if(button.matches('[data-reply-vent]')){openPrivateReplyModal(button.dataset.replyVent,button.dataset.replyCode);return;}
      if(button.matches('#private-reply-close,#private-reply-cancel')){closePrivateReplyModal();return;}
      if(button.matches('#private-reply-send')){await sendPrivateVentReply();return;}
      if(button.matches('[data-open-view]')){showView(button.dataset.openView);return;}
      if(button.matches('[data-scroll-to]')){setTimeout(()=>$(button.dataset.scrollTo)?.scrollIntoView({behavior:'smooth',block:'start'}),120);return;}
      if(button.matches('[data-play-public-audio]')){await playPublicVentAudio(button.dataset.playPublicAudio,button);return;}
      if(button.matches('[data-play-admin-audio]')){await playAdminPrivateAudio(button.dataset.playAdminAudio,button);return;}
      if(button.matches('[data-delete-content]')){await deleteStaffContent(button.dataset.contentType,button.dataset.contentId,button.dataset.contentLabel||'este conteúdo');return;}
      if(button.matches('[data-delete-vent]')){await deleteVent(button.dataset.deleteVent,button.dataset.audioPath||'');return;}
      if(button.matches('[data-delete-support]')){await deleteSupportMessage(button.dataset.deleteSupport);return;}
      if(button.matches('[data-approve-vent]')){await moderateVent(button.dataset.approveVent,'approved');return;}
      if(button.matches('[data-reject-vent]')){await moderateVent(button.dataset.rejectVent,'rejected');return;}
      if(button.matches('[data-view]')){showView(button.dataset.view);return;}
      if(button.matches('[data-compose]')){openComposer(button.dataset.compose);return;}
      if(button.matches('[data-public-filter]')){await loadPublicVents(button.dataset.publicFilter);return;}
      if(button.matches('[data-history-filter]')){await loadHistory(button.dataset.historyFilter);return;}
      if(button.matches('[data-vent-history-filter]')){await loadVentHistory(button.dataset.ventHistoryFilter);return;}
      if(button.matches('[data-private-filter]')){await loadAdminPrivateHistory(button.dataset.privateFilter);return;}
      if(button.matches('[data-panel]')){switchMuralPanel(button.dataset.panel);return;}
      if(button.matches('[data-report-message]')){await reportMessage(button.dataset.reportMessage);return;}
      if(button.matches('[data-hide-message]')){await hideMessage(button.dataset.hideMessage);return;}
      if(button.matches('[data-delete-message]')){await deleteChatMessage(button.dataset.deleteMessage);return;}
      if(button.matches('[data-feeling]')){selectFeeling(button.dataset.feeling,button);return;}
      if(button.matches('[data-vent-visibility]')){setVentVisibility(button.dataset.ventVisibility);return;}
      if(button.matches('[data-react-post]')){await toggleReaction(button.dataset.reactPost,button.dataset.reaction);return;}
      if(button.matches('[data-vote-option]')){await votePoll(button.dataset.voteOption,button.dataset.votePoll);return;}
      if(button.matches('[data-delete-poll]')){await deletePoll(button.dataset.deletePoll);return;}
      if(button.matches('[data-play-audio]')){await playPrivateAudio(button.dataset.playAudio);return;}
      if(button.matches('[data-approve-post]')){await moderatePost(button.dataset.approvePost,'approved');return;}
      if(button.matches('[data-reject-post]')){await moderatePost(button.dataset.rejectPost,'rejected');return;}
      if(button.matches('[data-resolve-report]')){await resolveReport(button.dataset.resolveReport);return;}
      if(button.matches('[data-hide-reported]')){await hideReportedMessage(button.dataset.hideReported,button.dataset.reportId);return;}
      if(button.matches('[data-action="logout"]')){await logout();return;}
    });
    document.addEventListener('click',event=>{
      const shell=document.querySelector('.notification-shell');
      if(shell && state.notificationsOpen && !shell.contains(event.target)) openNotificationsPanel(false);
    });
  }

  function bindEvents(){
    bindTabArrowNavigation($('mural-tabs'), '#mural-tabs [role="tab"]', button => switchMuralPanel(button.dataset.panel));
    bindTabArrowNavigation(document.querySelector('.history-tabs'), '.history-tabs [role="tab"]', button => loadHistory(button.dataset.historyFilter));
    $('auth-tab-login')?.addEventListener('click',()=>setAuthMode('login'));
    $('auth-tab-signup')?.addEventListener('click',()=>setAuthMode('signup'));
    $('login-form')?.addEventListener('submit',login);
    $('signup-form')?.addEventListener('submit',signup);
    $('magic-button')?.addEventListener('click',magicLogin);
    $('forgot-button')?.addEventListener('click',forgotPassword);
    $('password-form')?.addEventListener('submit',submitPasswordRecovery);
    $('password-modal-close')?.addEventListener('click',closePasswordModal);
    $('password-modal-cancel')?.addEventListener('click',closePasswordModal);
    $('password-modal')?.addEventListener('click',event=>{if(event.target.id==='password-modal')closePasswordModal();});
    $('logout-button')?.addEventListener('click',logout);
    $('brand-home')?.addEventListener('click',()=>showView('home-view'));
    $('chat-form')?.addEventListener('submit',sendChat);
    $('chat-rules-close')?.addEventListener('click',()=>closeChatRules());
    $('email-confirm-close')?.addEventListener('click',closeEmailConfirmationModal);
    $('email-confirm-ok')?.addEventListener('click',closeEmailConfirmationModal);
    $('email-confirm-resend')?.addEventListener('click',resendConfirmation);
    $('email-confirm-modal')?.addEventListener('click',event=>{if(event.target.id==='email-confirm-modal')closeEmailConfirmationModal();});
    $('private-chat-code')?.addEventListener('input',renderPrivateTarget);
    $('chat-rules-cancel')?.addEventListener('click',()=>closeChatRules());
    $('chat-rules-accept')?.addEventListener('click',acceptChatRules);
    $('chat-rules-modal')?.addEventListener('click',event=>{
      if (event.target.id === 'chat-rules-modal') closeChatRules();
    });
    $('support-toggle')?.addEventListener('click',()=>{state.supportOpen=!state.supportOpen;$('support-area')?.classList.toggle('hidden',!state.supportOpen);$('support-toggle').textContent=state.supportOpen?'Fechar conversa':'Abrir conversa';if(state.supportOpen)loadSupportChat();});
    $('send-free')?.addEventListener('click',sendFreeVent);
    $('send-feeling')?.addEventListener('click',sendFeelingVent);
    $('guided-next')?.addEventListener('click',guidedNext);
    $('guided-back')?.addEventListener('click',guidedBack);
    $('record-start')?.addEventListener('click',startRecording);
    $('record-stop')?.addEventListener('click',stopRecording);
    $('record-clear')?.addEventListener('click',clearRecording);
    $('record-send')?.addEventListener('click',sendAudioVent);
    $$('[data-voice-filter]').forEach(button=>button.addEventListener('click',()=>selectPublicVoiceFilter(button.dataset.voiceFilter)));
    $('voice-filter-test')?.addEventListener('click',()=>testSelectedVoiceFilter($('voice-filter-test')));
    $('tts-dictate')?.addEventListener('click',startTtsDictation);
    $('tts-generate')?.addEventListener('click',generateTextVoice);
    $$('[data-tts-voice]').forEach(button=>button.addEventListener('click',()=>chooseTextVoice(button.dataset.ttsVoice)));
    $('post-send')?.addEventListener('click',sendPost);
    $('announcement-form')?.addEventListener('submit',createAnnouncement);
    $('event-form')?.addEventListener('submit',createEvent);
    $('admin-role-identifier')?.addEventListener('input',()=>renderAdminTarget('admin-role-identifier','admin-role-target','admin-role-status'));
    $('admin-moderation-identifier')?.addEventListener('input',()=>renderAdminTarget('admin-moderation-identifier','admin-moderation-target','admin-moderation-status'));

    $('free-text')?.addEventListener('input',()=>{const n=$('free-text').value.length;$('free-counter').textContent=`${n} / 2000`;});
    $$('textarea').forEach(area=>{
      area.addEventListener('input',()=>{area.style.height='auto';area.style.height=`${Math.min(area.scrollHeight,320)}px`;});
      area.addEventListener('keydown',event=>{if(area.id==='chat-input'&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('chat-form')?.requestSubmit();}});
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){openNotificationsPanel(false);closeEmailConfirmationModal();closePrivateReplyModal();closeSiteHelp();}});
    bindDelegatedEvents();
  }

  function initAuthListener(){
    state.supabase.auth.onAuthStateChange((event,session)=>{
      console.debug('CAE AUTH:',event);
      if(event==='PASSWORD_RECOVERY'){
        if (!validSchoolEmail(session?.user?.email)) {
          state.supabase.auth.signOut();
          showAuth();
          setAuthMode('login');
          setStatus('login-status', 'O CAE aceita apenas e-mails terminados em @escola.pr.gov.br.');
          return;
        }
        state.session=session;
        state.user=session?.user||null;
        setTimeout(()=>{
          clearAuthHash();
          if (state.user) showApp();
          openPasswordModal();
        },0);
        return;
      }
      if(event==='SIGNED_OUT'){
        state.user=null;state.profile=null;state.session=null;state.lastHydratedAccessToken=null;
        closePasswordModal();showAuth();return;
      }
      if(session?.user)setTimeout(()=>hydrateSession(session),0);
    });
  }

  async function init(){
    if(state.initialized)return;state.initialized=true;bindEvents();refreshIcons();
    if(!ensureClient())return;
    initAuthListener();
    readAuthRedirectError();
    const {data,error}=await state.supabase.auth.getSession();
    if(error){console.error('SESSION',error);setStatus('login-status',errorMessage(error));return;}
    if(data.session?.user)await hydrateSession(data.session);else{showAuth();setAuthMode('login');}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
