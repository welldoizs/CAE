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
    support: 'cae_support_messages'
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
    ventVisibility: 'public',
    recorder: null,
    recordingChunks: [],
    audioBlob: null,
    audioMime: '',
    audioObjectUrl: null,
    lastHydratedAccessToken: null,
    chatLoading: false,
    muralLoading: false,
    muralQueued: false,
    supportConversationUserId: null,
    supportOpen: false,
    publicDirectory: new Map(),
    publicVentFilter: 'free',
    historyFilter: 'free',
    adminPrivateFilter: 'free'
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const isStaff = () => ['admin', 'moderator'].includes(state.profile?.role);

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

  const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));

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
    const { data, error } = await state.supabase.from(TABLE.profiles).select('id,role,banned_until,timeout_until,public_code,join_number').eq('id', state.user.id).maybeSingle();
    if (error) throw error;

    if (data) {
      state.profile = data;
    } else {
      const { data: created, error: createError } = await state.supabase
        .from(TABLE.profiles)
        .insert({ id: state.user.id, role: 'student' })
        .select('id,role,banned_until,timeout_until,public_code,join_number')
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
    const roleButton = $('admin-role-button');
    if (roleButton) { roleButton.disabled = state.profile.role !== 'admin'; roleButton.title = state.profile.role === 'admin' ? 'Alterar cargo' : 'Somente contas autorizadas podem alterar cargos.'; }

    if (state.profile.banned_until && new Date(state.profile.banned_until) > new Date()) {
      toast(`Sua conta está bloqueada até ${formatDate(state.profile.banned_until)}.`, 'error');
    }
    if (state.profile.timeout_until && new Date(state.profile.timeout_until) > new Date()) {
      toast(`Sua conta está em timeout até ${formatDate(state.profile.timeout_until)}.`, 'error');
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
    if (!validEmail(email)) return setStatus('login-status', 'Digite um e-mail válido.');
    if (!password) return setStatus('login-status', 'Digite sua senha.');

    const button = $('login-button');
    setBusy(button, true, 'Entrando...');
    try {
      const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user || !data.session) throw new Error('O login não retornou uma sessão válida.');
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
    if (!validEmail(email)) return setStatus('signup-status', 'Digite um e-mail válido.');
    if (password.length < 6) return setStatus('signup-status', 'A senha precisa ter pelo menos 6 caracteres.');

    const button = $('signup-button');
    setBusy(button, true, 'Criando...');
    try {
      const { data, error } = await state.supabase.auth.signUp({ email, password, options: { emailRedirectTo: currentRedirect() } });
      if (error) throw error;
      if (data.user && data.session) {
        state.user = data.user;
        state.session = data.session;
        await hydrateSession(data.session);
      } else {
        setStatus('signup-status', 'Conta criada. Confira seu e-mail para confirmar o cadastro.', 'ok');
      }
    } catch (error) {
      console.error('SIGNUP', error);
      setStatus('signup-status', errorMessage(error));
    } finally { setBusy(button, false); }
  }

  async function magicLogin() {
    if (!ensureClient()) return;
    const email = $('login-email')?.value.trim().toLowerCase();
    if (!validEmail(email)) return setStatus('login-status', 'Digite um e-mail válido primeiro.');
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
    if (!validEmail(email)) return setStatus('login-status', 'Digite seu e-mail primeiro.');
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
      await loadProfile();
      await loadPublicDirectory();
      showApp();
      showView(state.currentView || 'home-view');
      prepareFeelings();
    openComposer('free');
      await Promise.allSettled([loadChat(), loadMural(), loadHistory(), loadPublicVents(), loadSupportChat()]);
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

  function showView(id) {
    if (!state.user) return showAuth();
    if (id === 'admin-view' && !isStaff()) id = 'home-view';
    if (id === 'admin-private-history-view' && state.profile?.role !== 'admin') id = 'home-view';
    $$('.view').forEach(view => view.classList.remove('active'));
    $(id)?.classList.add('active');
    state.currentView = id;
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === id));

    if (id === 'chat-view') loadChat();
    if (id === 'desabafo-view') { loadPublicVents(); }
    if (id === 'mural-view') loadMural();
    if (id === 'history-view') loadHistory();
    if (id === 'admin-view' && isStaff()) loadAdmin();
    if (id === 'admin-private-history-view' && state.profile?.role === 'admin') loadAdminPrivateHistory();
    if (id === 'help-view') loadSupportChat();
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
    refreshIcons();
  }

  function ensureAccountCanInteract() {
    if (state.profile?.banned_until && new Date(state.profile.banned_until) > new Date()) {
      toast(`Sua conta está bloqueada até ${formatDate(state.profile.banned_until)}.`, 'error');
      return false;
    }
    if (state.profile?.timeout_until && new Date(state.profile.timeout_until) > new Date()) {
      toast(`Você está em timeout até ${formatDate(state.profile.timeout_until)}.`, 'error');
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
      await finishVent('free', text);
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
      state.recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
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
        .select('id,user_id,body,created_at,deleted_at')
        .order('created_at', { ascending: true }).limit(200);
      if (error) throw error;
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
      const name = publicName(message.user_id);
      const own = message.user_id === state.user.id;
      const deleted = Boolean(message.deleted_at);
      return `<article class="chat-message">
        <div class="chat-avatar">${escapeHTML(initials(name))}</div>
        <div class="chat-bubble">
          <div><span class="chat-name">${escapeHTML(name)}</span><span class="chat-time">${escapeHTML(formatDate(message.created_at))}</span></div>
          <div class="chat-body">${deleted ? '<i>Mensagem removida pela moderação.</i>' : escapeHTML(message.body).replace(/\n/g, '<br>')}</div>
          ${!deleted && !own ? `<div class="chat-actions"><button type="button" data-report-message="${escapeHTML(message.id)}">Denunciar</button></div>` : ''}
          ${!deleted && isStaff() ? `<div class="chat-actions"><button type="button" data-hide-message="${escapeHTML(message.id)}">Ocultar</button></div>` : ''}
          ${deleted && isStaff() ? `<div class="chat-actions"><button type="button" data-delete-message="${escapeHTML(message.id)}">Excluir definitivamente</button></div>` : ''}
        </div>
      </article>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  async function sendChat(event) {
    event.preventDefault();
    const body = $('chat-input')?.value.trim();
    if (!body || !state.user) return;
    if (!ensureAccountCanInteract()) return;
    if (body.length > 1500) return toast('A mensagem é longa demais.', 'error');
    const button = $('chat-send');
    setBusy(button, true, 'Enviando...');
    try {
      const { error } = await state.supabase.from(TABLE.chat).insert({ user_id: state.user.id, body });
      if (error) throw error;
      $('chat-input').value = '';
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

  async function deleteChatMessage(messageId) {
    if (!isStaff()) return false;
    if (!window.confirm('Excluir definitivamente esta mensagem? Esta ação não pode ser desfeita.')) return false;
    try {
      const { error } = await state.supabase.from(TABLE.chat).delete().eq('id', messageId);
      if (error) throw error;
      await logAdmin('delete_chat_message', 'chat_message', messageId);
      toast('Mensagem excluída definitivamente.');
      await loadChat();
      await loadAdmin();
      return true;
    } catch (error) {
      console.error('DELETE CHAT MESSAGE', error);
      toast(errorMessage(error), 'error');
      return false;
    }
  }

  function subscribeRealtime() {
    if (!state.supabase || !state.user) return;
    if (state.realtime) state.supabase.removeChannel(state.realtime);
    state.realtime = state.supabase.channel(`cae-${state.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.chat }, () => loadChat())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.posts }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.announcements }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.events }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.vents }, () => { loadPublicVents(); if (isStaff()) loadAdmin(); if (state.profile?.role === 'admin') loadAdminPrivateHistory(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.support }, () => { loadSupportChat(); if (isStaff()) loadAdminSupport(); })
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
    const postIds = posts.map(post => post.id);

    let reactions = [];
    if (postIds.length) {
      const result = await state.supabase.from(TABLE.reactions).select('id,post_id,user_id,reaction').in('post_id', postIds);
      if (!result.error) reactions = result.data || [];
    }

    if (!posts.length) { list.innerHTML = '<div class="card"><p>Ainda não há publicações aprovadas.</p></div>'; return; }
    list.innerHTML = posts.map(post => {
      const status = String(post.status || 'approved');
      const reactionHTML = REACTIONS.map(([emoji,key]) => {
        const count = reactions.filter(r => r.post_id === post.id && String(r.reaction) === key).length;
        const active = reactions.some(r => r.post_id === post.id && r.user_id === state.user.id && String(r.reaction) === key);
        return `<button type="button" class="cae-reaction ${active?'active':''}" data-react-post="${escapeHTML(post.id)}" data-reaction="${escapeHTML(key)}">${emoji} ${count}</button>`;
      }).join('');
      return `<article class="card"><div class="cae-post-meta"><span>${escapeHTML(getField(post,['category'],'Geral'))}</span><span>·</span><span>${escapeHTML(formatDate(post.created_at))}</span>${post.user_id===state.user.id?'<span>· sua publicação</span>':''}</div><p>${escapeHTML(getField(post,['body'],'')).replace(/\n/g,'<br>')}</p>${status!=='approved'?`<div class="cae-muted">Status: ${escapeHTML(status==='pending'?'aguardando moderação':status)}</div>`:''}${status==='approved'?`<div class="cae-reactions">${reactionHTML}</div>`:''}</article>`;
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
      return `<article class="card"><div class="eyebrow">Enquete${closesAt?` · até ${escapeHTML(formatDate(closesAt))}`:''}</div><h3>${escapeHTML(getField(poll,['question'],'Enquete'))}</h3><p class="cae-muted">${selected?'Seu voto foi registrado.':expired?'Enquete encerrada.':'Escolha uma opção.'}</p><div class="cae-results">${optionHTML}</div>${adminActions}</article>`;
    }).join('');
  }

  async function deletePoll(pollId) {
    if(!isStaff())return;
    if(!window.confirm('Excluir esta enquete? Todos os votos e opções vinculados também serão removidos.'))return;
    try {
      const { error } = await state.supabase.from(TABLE.polls).delete().eq('id',pollId);
      if(error)throw error;
      await logAdmin('delete_poll','poll',pollId);
      toast('Enquete excluída.');
      await loadPolls();
    } catch(error) {
      console.error('DELETE POLL',error);
      toast(errorMessage(error),'error');
    }
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
      setStatus('post-status','Enviado para moderação.','ok');
      toast('Sua publicação foi enviada para moderação.');
      await loadPosts();
      if (isStaff()) await loadAdmin();
    } catch (error) { console.error('POST',error); setStatus('post-status',errorMessage(error)); }
    finally { setBusy(button,false); }
  }

  async function toggleReaction(postId,reaction) {
    try {
      const { data: mine, error: findError } = await state.supabase.from(TABLE.reactions).select('id').eq('post_id',postId).eq('user_id',state.user.id).eq('reaction',reaction).maybeSingle();
      if (findError) throw findError;
      if (mine) {
        const { error } = await state.supabase.from(TABLE.reactions).delete().eq('id',mine.id); if(error) throw error;
      } else {
        const { error } = await state.supabase.from(TABLE.reactions).insert({post_id:postId,user_id:state.user.id,reaction}); if(error) throw error;
      }
      await loadPosts();
    } catch (error) { console.error('REACTION',error); toast(errorMessage(error),'error'); }
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
      return `<div class="guided-public-list">${items}</div>`;
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
        return `<article class="card public-vent-card"><div class="public-vent-type"><span class="vent-tab-icon"><i data-lucide="${state.publicVentFilter==='guided'?'list-question':state.publicVentFilter==='feelings'?'heart':state.publicVentFilter==='audio'?'mic':'pen-line'}"></i></span><strong>${escapeHTML(typeLabel)}</strong></div><div class="cae-post-meta">${escapeHTML(publicName(vent.user_id))} · ${escapeHTML(formatDate(vent.created_at))}</div>${feeling?`<div class="public-vent-feeling">${escapeHTML(feeling)}</div>`:''}${renderVentBody(vent.type,body)}${audioPath?`<div class="public-vent-audio"><button class="btn secondary" type="button" data-play-public-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>`:''}</article>`;
      }).join('');
      refreshIcons();
    } catch(error){console.error('PUBLIC VENTS',error);list.innerHTML=`<div class="public-vent-empty"><p class="cae-danger">${escapeHTML(errorMessage(error))}</p></div>`;}
  }

  async function playPublicVentAudio(path,button) {
    try { const {data,error}=await state.supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path,600); if(error)throw error; const card=button?.closest('.public-vent-card'); if(!card)return; let audio=card.querySelector('audio[data-public-vent-audio]'); if(!audio){audio=document.createElement('audio');audio.controls=true;audio.dataset.publicVentAudio='1';audio.style.width='100%';audio.style.marginTop='10px';card.querySelector('.public-vent-audio')?.appendChild(audio);} audio.src=data.signedUrl; await audio.play().catch(()=>{}); } catch(error){console.error('PUBLIC VENT AUDIO',error);toast(`Não foi possível abrir este áudio: ${errorMessage(error)}`,'error');}
  }

  async function loadHistory(filter = state.historyFilter) {
    const list = $('history-list'); if(!list||!state.user||!state.supabase)return;
    state.historyFilter = ['free','guided','feelings','audio'].includes(filter) ? filter : 'free';
    $$('[data-history-filter]').forEach(button => {
      const active=button.dataset.historyFilter===state.historyFilter;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    });
    try {
      const {data,error}=await state.supabase.from(TABLE.vents).select('*').eq('user_id',state.user.id).eq('type',state.historyFilter).order('created_at',{ascending:false}).limit(100);
      if(error)throw error;
      if(!data?.length){list.innerHTML='<div class="card"><p>Nenhum registro nesta categoria.</p><p class="cae-muted">Quando você enviar um desabafo deste tipo, ele aparecerá aqui.</p></div>';return;}
      const visibilityLabel = (v)=>v==='private'?'Privado':'Público';
      list.innerHTML=data.map(vent=>{
        const body=getField(vent,['body'],''); const feeling=getField(vent,['feeling'],''); const audioPath=getField(vent,['audio_url'],'');
        const status=privateVentStatus(vent.status); const statusClass=vent.status==='approved'?'cae-status-approved':vent.status==='rejected'?'cae-status-rejected':'cae-status-pending';
        return `<article class="card own-vent-card"><div class="own-vent-meta"><div><div class="eyebrow">${escapeHTML(visibilityLabel(vent.visibility))} · ${escapeHTML(formatDate(vent.created_at))}</div></div><span class="cae-status ${statusClass}">${escapeHTML(status)}</span></div>${feeling?`<div class="notice" style="margin-top:10px"><b>${escapeHTML(feeling)}</b></div>`:''}${body?renderVentBody(vent.type,body,'own-vent-body'):''}${audioPath?`<div class="actions" style="margin-top:10px"><button class="btn secondary" type="button" data-play-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>`:''}<div class="actions" style="margin-top:12px"><button class="btn danger" type="button" data-delete-vent="${escapeHTML(vent.id)}" data-audio-path="${escapeHTML(audioPath)}">Excluir</button></div></article>`;
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

  async function playAdminPrivateAudio(path, button) {
    if (!isStaff()) return;
    try {
      const { data, error } = await state.supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path, 600);
      if (error) throw error;
      const wrapper = button?.closest('[data-private-vent-card]');
      if (!wrapper) return;
      let audio = wrapper.querySelector('audio[data-private-admin-audio]');
      if (!audio) {
        audio = document.createElement('audio');
        audio.controls = true;
        audio.dataset.privateAdminAudio = '1';
        audio.style.width = '100%';
        audio.style.marginTop = '10px';
        wrapper.appendChild(audio);
      }
      audio.src = data.signedUrl;
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
    if(state.profile?.role!=='admin'||!state.supabase)return [];
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
        return `<article class="card admin-private-vent-card" data-private-vent-card><div class="admin-private-vent-meta"><div><span class="eyebrow">${escapeHTML(formatDate(vent.created_at))}</span></div><span class="cae-status ${cls}">${escapeHTML(status)}</span></div>${feeling?`<div class="admin-private-feeling"><b>Sentimento</b><span>${escapeHTML(feeling)}</span></div>`:''}${body?`<div class="admin-private-body">${escapeHTML(body).replace(/\n/g,'<br>')}</div>`:''}${audioPath?`<div class="admin-audio"><div class="cae-muted">Áudio privado</div><button class="btn secondary" type="button" data-play-admin-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>`:''}<div class="actions admin-private-actions"><button class="btn danger" type="button" data-delete-vent="${escapeHTML(vent.id)}" data-audio-path="${escapeHTML(audioPath)}">Excluir</button></div></article>`;
      }).join('');
      return `<section class="admin-private-user-group"><div class="admin-private-user-head"><div><div class="eyebrow">Usuário</div><h3>${escapeHTML(code)}</h3><p class="cae-muted">${vents.length} registro${vents.length===1?'':'s'} nesta categoria.</p></div></div><div class="admin-private-user-feed">${cards}</div></section>`;
    }).join('');
    refreshIcons();
  }

  async function loadAdminPrivateVents(){
    const card=$('admin-private-vents-card');if(!card)return;const isAdmin=state.profile?.role==='admin';card.classList.toggle('hidden',!isAdmin);if(!isAdmin)return;
    try{const data=await fetchAdminPrivateVents();$('admin-private-count').textContent=String(data.length);}catch(error){console.error('ADMIN PRIVATE SUMMARY',error);$('admin-private-count').textContent='—';}
  }

  async function loadAdminPrivateHistory(filter=state.adminPrivateFilter){
    if(state.profile?.role!=='admin')return;const list=$('admin-private-history-list');if(!list)return;list.innerHTML='<div class="admin-private-empty"><p>Carregando histórico...</p></div>';
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

  async function sendSupportMessage(event){event.preventDefault();if(!state.user||!state.supabase)return;if(!ensureAccountCanInteract())return;const input=$('support-input');const body=input?.value.trim();if(!body)return;const button=$('support-send');setBusy(button,true,'Enviando...');try{const {error}=await state.supabase.from(TABLE.support).insert({conversation_user_id:state.user.id,sender_id:state.user.id,body});if(error)throw error;input.value='';await loadSupportChat();if(isStaff())await loadAdminSupport();}catch(error){console.error('SUPPORT SEND',error);toast(errorMessage(error),'error');}finally{setBusy(button,false);input?.focus();}}

  async function deleteSupportMessage(id){
    if(!state.user||!state.supabase)return;
    const target=String(id||'').trim();if(!target)return;
    if(!window.confirm('Apagar esta mensagem permanentemente?'))return;
    try{
      let query=state.supabase.from(TABLE.support).delete().eq('id',target);
      if(!isStaff())query=query.eq('sender_id',state.user.id).eq('conversation_user_id',state.user.id);
      const {error}=await query;if(error)throw error;
      toast('Mensagem apagada.');
      await loadSupportChat();
      if(isStaff())await loadAdminSupport();
    }catch(error){console.error('SUPPORT DELETE',error);toast(errorMessage(error),'error');}
  }

  async function loadAdminSupport(){const select=$('admin-support-conversation');const thread=$('admin-support-thread');const count=$('admin-support-count');if(!select||!thread||!state.user||!isStaff())return;try{const {data,error}=await state.supabase.from(TABLE.support).select('id,conversation_user_id,sender_id,body,created_at').order('created_at',{ascending:true}).limit(500);if(error)throw error;const grouped=new Map();(data||[]).forEach(message=>{const id=message.conversation_user_id;if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(message);});if(count)count.textContent=String(grouped.size);const conversations=[...grouped.entries()].sort((a,b)=>new Date(b[1][b[1].length-1].created_at)-new Date(a[1][a[1].length-1].created_at));const current=state.supportConversationUserId||'';select.innerHTML='<option value="">Selecionar conversa</option>'+conversations.map(([id,messages])=>`<option value="${escapeHTML(id)}">${escapeHTML(publicName(id))} · ${messages.length} mensagem${messages.length===1?'':'ns'}</option>`).join('');if(conversations.some(([id])=>id===current))select.value=current;else{state.supportConversationUserId=conversations[0]?.[0]||null;select.value=state.supportConversationUserId||'';}const selected=select.value||'';state.supportConversationUserId=selected||null;renderSupportMessages(selected?grouped.get(selected):[],'admin-support-thread',state.user.id,selected||null);if(selected){thread.insertAdjacentHTML('beforeend','<form id="admin-support-form" class="chat-form support-admin-form"><textarea id="admin-support-input" maxlength="2000" placeholder="Responder ao estudante..."></textarea><button class="btn primary" id="admin-support-send" type="submit">Enviar</button></form>');}}catch(error){console.error('ADMIN SUPPORT LOAD',error);thread.innerHTML=`<div class="support-empty"><p class="cae-danger">${escapeHTML(errorMessage(error))}</p></div>`;}}

  function renderSelectedAdminSupportConversation(){state.supportConversationUserId=$('admin-support-conversation')?.value||null;loadAdminSupport();}

  async function sendAdminSupportMessage(event){event.preventDefault();if(!isStaff()||!state.user||!state.supportConversationUserId)return toast('Selecione uma conversa primeiro.','error');const input=$('admin-support-input');const body=input?.value.trim();if(!body)return;const button=$('admin-support-send');setBusy(button,true,'Enviando...');try{const {error}=await state.supabase.from(TABLE.support).insert({conversation_user_id:state.supportConversationUserId,sender_id:state.user.id,body});if(error)throw error;input.value='';await loadAdminSupport();}catch(error){console.error('ADMIN SUPPORT SEND',error);toast(errorMessage(error),'error');}finally{setBusy(button,false);input?.focus();}}

  async function setAccountRole() {
    if (state.profile?.role !== 'admin') return toast('Esta área é restrita a contas autorizadas a alterar cargos.', 'error');
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
    if (!isStaff()) return toast('Você não tem permissão para moderar contas.', 'error');
    const target = renderAdminTarget('admin-moderation-identifier', 'admin-moderation-target', 'admin-moderation-status');
    if (!target) return toast('Selecione uma conta válida.', 'error');
    if (target.user_id === state.user.id) return toast('Não aplique ban ou timeout na própria conta.', 'error');
    const minutes = Number($('admin-timeout-duration')?.value || 0);
    if (action === 'ban' && !window.confirm(`Bloquear #${target.public_code || 'esta conta'}?`)) return;
    if (action === 'unban' && !window.confirm(`Desbloquear #${target.public_code || 'esta conta'}?`)) return;
    setBusy(button, true, 'Aplicando...');
    try {
      const { error } = await state.supabase.rpc('cae_staff_moderate_account', { p_target_user_id: target.user_id, p_action: action, p_minutes: minutes });
      if (error) throw error;
      const messages = {
        timeout: `#${target.public_code || 'Conta'} recebeu timeout por ${minutes} min.`,
        clear_timeout: `Timeout removido de #${target.public_code || 'conta'}.`,
        ban: `#${target.public_code || 'Conta'} foi bloqueada.`,
        unban: `#${target.public_code || 'Conta'} foi desbloqueada.`
      };
      $('admin-moderation-status').textContent = messages[action] || 'Ação aplicada com sucesso.';
      toast(messages[action] || 'Ação aplicada com sucesso.');
      await logAdmin(`account_${action}`, 'profile', target.user_id, action === 'timeout' ? { minutes } : {});
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
    try{
      const {data:vent,error:fetchError}=await state.supabase.from(TABLE.vents).select('id,user_id,type,visibility,audio_url').eq('id',id).maybeSingle();
      if(fetchError)throw fetchError;
      if(!vent)return toast('Desabafo não encontrado.','error');
      if(vent.visibility==='private' && !(state.profile?.role==='admin' || (state.profile?.role==='moderator' && vent.type==='audio')))return toast('Este desabafo privado não pode ser moderado por esta conta.','error');
      if(!window.confirm(status==='approved'?'Aprovar este desabafo?':'Recusar este desabafo?'))return;
      const {error}=await state.supabase.from(TABLE.vents).update({status,moderated_at:new Date().toISOString(),moderated_by:state.user.id}).eq('id',id);
      if(error)throw error;
      await logAdmin(status==='approved'?'approve_vent':'reject_vent','vent',id);
      toast(status==='approved'?'Desabafo aprovado.':'Desabafo recusado.');
      await loadPublicVents(); await loadAdmin(); if(state.profile?.role==='admin')await loadAdminPrivateHistory();
    }catch(error){console.error('MODERATE VENT',error);toast(errorMessage(error),'error');}
  }

  async function deleteVent(id,audioPath=''){
    if(!state.user||!state.supabase)return;
    try{
      const {data:vent,error:fetchError}=await state.supabase.from(TABLE.vents).select('id,user_id,visibility,audio_url').eq('id',id).maybeSingle();
      if(fetchError)throw fetchError;
      if(!vent)return toast('Desabafo não encontrado.','error');
      const owner=vent.user_id===state.user.id;
      if(!owner&&!isStaff())return toast('Você não tem permissão para excluir este desabafo.','error');
      if(vent.visibility==='private' && !owner && state.profile?.role!=='admin')return toast('Desabafos privados só podem ser excluídos pelo autor ou por um administrador.','error');
      if(!window.confirm('Excluir este desabafo permanentemente?'))return;
      const {error}=await state.supabase.from(TABLE.vents).delete().eq('id',id);if(error)throw error;
      const path=audioPath||vent.audio_url||'';
      if(path){const {error:storageError}=await state.supabase.storage.from(AUDIO_BUCKET).remove([path]);if(storageError)console.warn('VENT AUDIO DELETE',storageError);}
      toast('Desabafo excluído permanentemente.');
      await loadHistory(); if(isStaff())await loadAdmin(); if(state.profile?.role==='admin')await loadAdminPrivateHistory(); await loadPublicVents();
    }catch(error){console.error('DELETE VENT',error);toast(errorMessage(error),'error');}
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

  async function loadAdmin(){
    if(!state.supabase||!isStaff())return;ensurePollAdminForm();await loadAdminPrivateVents();await loadAdminSupport();
    try{
      const [approved,pending,vents,reports]=await Promise.all([
        state.supabase.from(TABLE.posts).select('id',{count:'exact',head:true}).eq('status','approved'),
        state.supabase.from(TABLE.posts).select('id',{count:'exact',head:true}).eq('status','pending'),
        state.supabase.from(TABLE.vents).select('id',{count:'exact',head:true}),
        state.supabase.from(TABLE.reports).select('id',{count:'exact',head:true}).eq('status','pending')
      ]);
      [approved,pending,vents,reports].forEach(result=>{if(result.error)throw result.error;});
      $('stat-approved').textContent=String(approved.count||0);$('stat-pending').textContent=String(pending.count||0);$('stat-vents').textContent=String(vents.count||0);$('stat-reports').textContent=String(reports.count||0);

      const {data:posts,error:postsError}=await state.supabase.from(TABLE.posts).select('*').eq('status','pending').order('created_at',{ascending:true}).limit(100);if(postsError)throw postsError;
      $('admin-post-list').innerHTML=posts?.length?posts.map(post=>`<article class="card"><div class="cae-post-meta">${escapeHTML(getField(post,['category'],'Geral'))} · ${escapeHTML(formatDate(post.created_at))}</div><p>${escapeHTML(getField(post,['body'],''))}</p><div class="actions"><button class="btn primary" type="button" data-approve-post="${escapeHTML(post.id)}">Aprovar</button><button class="btn secondary" type="button" data-reject-post="${escapeHTML(post.id)}">Recusar</button></div></article>`).join(''):'<div class="card"><p>Nenhum post pendente.</p></div>';
      let pendingVents=[];
      if(state.profile?.role==='admin'){
        const {data,error}=await state.supabase.from(TABLE.vents).select('id,user_id,type,body,feeling,audio_url,status,visibility,created_at').eq('status','pending').order('created_at',{ascending:true}).limit(100);
        if(error)throw error; pendingVents=data||[];
      }else{
        const [publicPending,privateAudioPending]=await Promise.all([
          state.supabase.from(TABLE.vents).select('id,user_id,type,body,feeling,audio_url,status,visibility,created_at').eq('status','pending').eq('visibility','public').order('created_at',{ascending:true}).limit(100),
          state.supabase.from(TABLE.vents).select('id,user_id,type,body,feeling,audio_url,status,visibility,created_at').eq('status','pending').eq('visibility','private').eq('type','audio').order('created_at',{ascending:true}).limit(100)
        ]);
        if(publicPending.error)throw publicPending.error; if(privateAudioPending.error)throw privateAudioPending.error;
        pendingVents=[...(publicPending.data||[]),...(privateAudioPending.data||[])].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).slice(0,100);
      }
      $('admin-vent-list').innerHTML=pendingVents?.length?pendingVents.map(vent=>{const labels={free:'Texto livre',guided:'Perguntas guiadas',feelings:'Sentimentos',audio:'Áudio'};const body=getField(vent,['body'],'');const feeling=getField(vent,['feeling'],'');const audioPath=getField(vent,['audio_url'],'');const isPrivateAudio=vent.visibility==='private'&&vent.type==='audio';const privateTag=vent.visibility==='private'?`<span class="cae-privacy-badge private">${isPrivateAudio?'Áudio privado · equipe autorizada':'Privado · somente admin'}</span>`:'<span class="cae-privacy-badge public">Público</span>';const canDelete=isStaff()&&(vent.visibility==='public'||state.profile?.role==='admin');const deleteButton=canDelete?`<button class="btn danger" type="button" data-delete-vent="${escapeHTML(vent.id)}" data-audio-path="${escapeHTML(audioPath)}">Excluir</button>`:'';return `<article class="card"><div class="cae-post-meta">${escapeHTML(labels[vent.type]||'Desabafo')} · ${escapeHTML(publicName(vent.user_id))} · ${escapeHTML(formatDate(vent.created_at))}</div><div style="margin-top:8px">${privateTag}</div>${feeling?`<div class="notice" style="margin-top:10px"><b>${escapeHTML(feeling)}</b></div>`:''}${body?`<p style="white-space:pre-wrap;margin-top:10px">${escapeHTML(body)}</p>`:''}${audioPath?`<div class="actions" style="margin-top:10px"><button class="btn secondary" type="button" data-play-admin-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>`:''}<div class="actions" style="margin-top:10px"><button class="btn primary" type="button" data-approve-vent="${escapeHTML(vent.id)}">Aprovar</button><button class="btn secondary" type="button" data-reject-vent="${escapeHTML(vent.id)}">Recusar</button>${deleteButton}</div></article>`;}).join(''):'<div class="card"><p>Nenhum desabafo pendente.</p></div>';refreshIcons();
      const {data:reportRows,error:reportError}=await state.supabase.from(TABLE.reports).select('*').eq('status','pending').order('created_at',{ascending:true}).limit(100);if(reportError)throw reportError;
      $('admin-report-list').innerHTML=reportRows?.length?reportRows.map(report=>`<article class="card"><div class="cae-post-meta">Denúncia · ${escapeHTML(formatDate(report.created_at))}</div><p><b>Motivo:</b> ${escapeHTML(report.reason)}</p><div class="actions"><button class="btn danger" type="button" data-hide-reported="${escapeHTML(report.message_id)}" data-report-id="${escapeHTML(report.id)}">Ocultar mensagem</button><button class="btn secondary" type="button" data-resolve-report="${escapeHTML(report.id)}">Resolver sem ocultar</button></div></article>`).join(''):'<div class="card"><p>Nenhuma denúncia pendente.</p></div>';
    }catch(error){console.error('ADMIN',error);toast(`Painel admin: ${errorMessage(error)}`,'error');}
  }

  function bindDelegatedEvents(){
    document.addEventListener('submit',async event=>{
      if(event.target.matches('#support-form')) return sendSupportMessage(event);
      if(event.target.matches('#admin-support-form')) return sendAdminSupportMessage(event);
    });
    document.addEventListener('change',event=>{
      if(event.target.matches('#admin-support-conversation')) renderSelectedAdminSupportConversation();
    });
    document.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.matches('#admin-role-button')){await setAccountRole();return;}
      if(button.matches('[data-user-moderation]')){await moderateAccount(button.dataset.userModeration,button);return;}
      if(button.matches('[data-open-view]'))showView(button.dataset.openView);
      if(button.matches('[data-scroll-to]'))setTimeout(()=>$(button.dataset.scrollTo)?.scrollIntoView({behavior:'smooth',block:'start'}),120);
      if(button.matches('[data-play-public-audio]'))await playPublicVentAudio(button.dataset.playPublicAudio,button);
      if(button.matches('[data-play-admin-audio]'))await playAdminPrivateAudio(button.dataset.playAdminAudio,button);
      if(button.matches('[data-delete-vent]'))await deleteVent(button.dataset.deleteVent,button.dataset.audioPath||'');
      if(button.matches('[data-delete-support]'))await deleteSupportMessage(button.dataset.deleteSupport);
      if(button.matches('[data-approve-vent]'))await moderateVent(button.dataset.approveVent,'approved');
      if(button.matches('[data-reject-vent]'))await moderateVent(button.dataset.rejectVent,'rejected');
      if(button.matches('[data-view]'))showView(button.dataset.view);
      if(button.matches('[data-compose]'))openComposer(button.dataset.compose);
      if(button.matches('[data-public-filter]'))await loadPublicVents(button.dataset.publicFilter);
      if(button.matches('[data-history-filter]'))await loadHistory(button.dataset.historyFilter);
      if(button.matches('[data-private-filter]'))await loadAdminPrivateHistory(button.dataset.privateFilter);
      if(button.matches('[data-panel]'))switchMuralPanel(button.dataset.panel);
      if(button.matches('[data-report-message]'))await reportMessage(button.dataset.reportMessage);
      if(button.matches('[data-hide-message]'))await hideMessage(button.dataset.hideMessage);
      if(button.matches('[data-delete-message]'))await deleteChatMessage(button.dataset.deleteMessage);
      if(button.matches('[data-feeling]'))selectFeeling(button.dataset.feeling,button);
      if(button.matches('[data-vent-visibility]'))setVentVisibility(button.dataset.ventVisibility);
      if(button.matches('[data-react-post]'))await toggleReaction(button.dataset.reactPost,button.dataset.reaction);
      if(button.matches('[data-vote-option]'))await votePoll(button.dataset.voteOption,button.dataset.votePoll);
      if(button.matches('[data-delete-poll]'))await deletePoll(button.dataset.deletePoll);
      if(button.matches('[data-play-audio]'))await playPrivateAudio(button.dataset.playAudio);
      if(button.matches('[data-approve-post]'))await moderatePost(button.dataset.approvePost,'approved');
      if(button.matches('[data-reject-post]'))await moderatePost(button.dataset.rejectPost,'rejected');
      if(button.matches('[data-resolve-report]'))await resolveReport(button.dataset.resolveReport);
      if(button.matches('[data-hide-reported]'))await hideReportedMessage(button.dataset.hideReported,button.dataset.reportId);
      if(button.matches('[data-action="logout"]'))await logout();
    });
  }

  function bindEvents(){
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
    $('support-toggle')?.addEventListener('click',()=>{state.supportOpen=!state.supportOpen;$('support-area')?.classList.toggle('hidden',!state.supportOpen);$('support-toggle').textContent=state.supportOpen?'Fechar conversa':'Abrir conversa';if(state.supportOpen)loadSupportChat();});
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
    $('admin-role-identifier')?.addEventListener('input',()=>renderAdminTarget('admin-role-identifier','admin-role-target','admin-role-status'));
    $('admin-moderation-identifier')?.addEventListener('input',()=>renderAdminTarget('admin-moderation-identifier','admin-moderation-target','admin-moderation-status'));

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
      if(event==='PASSWORD_RECOVERY'){
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
