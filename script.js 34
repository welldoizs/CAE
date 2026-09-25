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
    logs: 'cae_admin_logs'
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
    recorder: null,
    recordingChunks: [],
    audioBlob: null,
    audioMime: '',
    audioObjectUrl: null,
    dailyVentBlocked: false,
    lastHydratedAccessToken: null,
    chatLoading: false,
    muralLoading: false,
    muralQueued: false
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
    const compact = String(userId || '').replaceAll('-', '').slice(0, 6).toUpperCase();
    return `Estudante #${compact || '000000'}`;
  };

  const initials = (name) => String(name || 'CA').replace('Estudante #', '').slice(0, 2) || 'CA';

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
    if (/desabafo hoje/i.test(raw)) return 'Você já enviou um desabafo hoje.';
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
    return `${window.location.origin}${window.location.pathname}${window.location.search}`;
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
    const { data, error } = await state.supabase.from(TABLE.profiles).select('id,display_name,role,banned_until').eq('id', state.user.id).maybeSingle();
    if (error) throw error;

    if (data) {
      state.profile = data;
    } else {
      const { data: created, error: createError } = await state.supabase
        .from(TABLE.profiles)
        .insert({ id: state.user.id, display_name: publicName(state.user.id), role: 'student' })
        .select('id,display_name,role,banned_until')
        .single();
      if (createError) throw createError;
      state.profile = created;
    }

    const name = state.profile.display_name || publicName(state.user.id);
    if ($('account-name')) $('account-name').textContent = name;
    if ($('account-email')) $('account-email').textContent = state.user.email || '';
    if ($('account-avatar')) $('account-avatar').textContent = initials(name);
    $('nav-admin')?.classList.toggle('hidden', !isStaff());

    if (state.profile.banned_until && new Date(state.profile.banned_until) > new Date()) {
      toast(`Sua conta está bloqueada até ${formatDate(state.profile.banned_until)}.`, 'error');
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

  async function authRequest(request, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await request();
      } catch (error) {
        lastError = error;
        const raw = String(error?.message || error || '');
        if (!/failed to fetch|networkerror|network request failed/i.test(raw) || attempt === attempts) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        // Recria o cliente para descartar uma conexão fetch presa/stale.
        state.supabase = null;
        if (!ensureClient()) throw lastError;
      }
    }
    throw lastError;
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
      const { data, error } = await authRequest(() =>
        state.supabase.auth.signInWithPassword({ email, password })
      );
      if (error) throw error;
      if (!data.user || !data.session) throw new Error('O login não retornou uma sessão válida.');
      state.user = data.user;
      state.session = data.session;
      $('login-password').value = '';
      await hydrateSession(data.session);
    } catch (error) {
      console.error('LOGIN', error);
      const raw = String(error?.message || error || '');
      setStatus('login-status', /failed to fetch|networkerror|network request failed/i.test(raw)
        ? 'Não foi possível conectar ao servidor de login. Tente novamente em alguns segundos.'
        : errorMessage(error));
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
      const { data, error } = await authRequest(() =>
        state.supabase.auth.signUp({ email, password, options: { emailRedirectTo: currentRedirect() } })
      );
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
    state.dailyVentBlocked = false;
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
      showApp();
      showView(state.currentView || 'home-view');
      prepareFeelings();
      await Promise.allSettled([loadChat(), loadMural(), loadHistory(), checkDailyVent()]);
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
    $$('.view').forEach(view => view.classList.remove('active'));
    $(id)?.classList.add('active');
    state.currentView = id;
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === id));

    if (id === 'chat-view') loadChat();
    if (id === 'desabafo-view') checkDailyVent();
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
    if (state.dailyVentBlocked) return toast('Você já enviou um desabafo hoje.', 'error');
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
    if (!state.user || state.dailyVentBlocked) return false;
    if (!body && !audioPath) return false;
    const { error } = await state.supabase.from(TABLE.vents).insert({
      user_id: state.user.id,
      type,
      body: body || null,
      feeling: feeling || null,
      audio_url: audioPath || null
    });
    if (error) throw error;
    state.dailyVentBlocked = true;
    updateDailyVentUI();
    await loadHistory();
    $$('.compose').forEach(el => el.classList.add('hidden'));
    toast('Desabafo enviado. Obrigado por confiar no CAE.');
    return true;
  }

  async function sendFreeVent() {
    if (state.dailyVentBlocked) return toast('Você já enviou um desabafo hoje.', 'error');
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
    if (state.dailyVentBlocked) return;
    state.selectedFeeling = feeling;
    $$('#feelings-list [data-feeling]').forEach(el => el.classList.remove('active'));
    button?.classList.add('active');
    $('selected-feeling').textContent = feeling;
    $('feeling-area').classList.remove('hidden');
    $('feeling-text').focus();
  }

  async function sendFeelingVent() {
    if (state.dailyVentBlocked) return toast('Você já enviou um desabafo hoje.', 'error');
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
    if (state.dailyVentBlocked) return toast('Você já enviou um desabafo hoje.', 'error');
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

  async function checkDailyVent() {
    if (!state.user || !state.supabase) return;
    try {
      const { count, error } = await state.supabase.from(TABLE.vents)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', state.user.id)
        .gte('created_at', todayStartISO());
      if (error) throw error;
      state.dailyVentBlocked = Number(count || 0) >= 1;
      updateDailyVentUI();
    } catch (error) { console.warn('DAILY VENT', error); }
  }

  function updateDailyVentUI() {
    const message = $('daily-message');
    if (message) {
      message.classList.toggle('hidden', !state.dailyVentBlocked);
      message.textContent = state.dailyVentBlocked ? 'Você já enviou um desabafo hoje. Amanhã você poderá enviar outro.' : '';
    }
    $$('[data-compose]').forEach(button => {
      button.disabled = state.dailyVentBlocked;
      button.title = state.dailyVentBlocked ? 'Limite diário já utilizado' : '';
    });
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
    if (state.dailyVentBlocked) return toast('Você já enviou um desabafo hoje.', 'error');
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
    if (state.dailyVentBlocked) return toast('Você já enviou um desabafo hoje.', 'error');
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

  function subscribeRealtime() {
    if (!state.supabase || !state.user) return;
    if (state.realtime) state.supabase.removeChannel(state.realtime);
    state.realtime = state.supabase.channel(`cae-${state.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.chat }, () => loadChat())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.posts }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.announcements }, () => queueMuralReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE.events }, () => queueMuralReload())
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
      const adminActions = isStaff() ? `<div class="actions" style="margin-top:12px"><button class="btn secondary" type="button" data-delete-poll="${escapeHTML(poll.id)}">Excluir enquete</button></div>` : '';
      return `<article class="card"><div class="eyebrow">Enquete${closesAt?` · até ${escapeHTML(formatDate(closesAt))}`:''}</div><h3>${escapeHTML(getField(poll,['question'],'Enquete'))}</h3><p class="cae-muted">${selected?'Seu voto foi registrado.':expired?'Enquete encerrada.':'Escolha uma opção.'}</p><div class="cae-results">${optionHTML}</div>${adminActions}</article>`;
    }).join('');
  }

  async function deletePoll(pollId) {
    if(!isStaff()) return;
    if(!window.confirm('Excluir esta enquete e todos os votos dela?')) return;
    try {
      const { error } = await state.supabase.from(TABLE.polls).delete().eq('id', pollId);
      if(error) throw error;
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

  async function loadHistory() {
    const list = $('history-list'); if(!list||!state.user||!state.supabase)return;
    try {
      const {data,error}=await state.supabase.from(TABLE.vents).select('*').eq('user_id',state.user.id).order('created_at',{ascending:false}).limit(50);
      if(error)throw error;
      if(!data?.length){list.innerHTML='<div class="card"><p>Você ainda não enviou nada.</p><p class="cae-muted">Quando enviar um desabafo, ele aparecerá aqui.</p></div>';return;}
      const labels={free:'Texto livre',guided:'Perguntas guiadas',feelings:'Sentimentos',audio:'Áudio'};
      list.innerHTML=data.map(vent=>{const type=String(vent.type||'free');const body=getField(vent,['body'],'');const feeling=getField(vent,['feeling'],'');const audioPath=getField(vent,['audio_url'],'');return `<article class="card"><div class="eyebrow">${escapeHTML(labels[type]||'Desabafo')} · ${escapeHTML(formatDate(vent.created_at))}</div>${feeling?`<div class="notice" style="margin-top:10px">${escapeHTML(feeling)}</div>`:''}${body?`<p>${escapeHTML(body).replace(/\n/g,'<br>')}</p>`:''}${audioPath?`<div class="actions"><button class="btn secondary" type="button" data-play-audio="${escapeHTML(audioPath)}"><i data-lucide="play"></i>Ouvir áudio</button></div>`:''}</article>`;}).join('');
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
    if(!state.supabase||!isStaff())return;ensurePollAdminForm();
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

      const {data:reportRows,error:reportError}=await state.supabase.from(TABLE.reports).select('*').eq('status','pending').order('created_at',{ascending:true}).limit(100);if(reportError)throw reportError;
      $('admin-report-list').innerHTML=reportRows?.length?reportRows.map(report=>`<article class="card"><div class="cae-post-meta">Denúncia · ${escapeHTML(formatDate(report.created_at))}</div><p><b>Motivo:</b> ${escapeHTML(report.reason)}</p><div class="actions"><button class="btn danger" type="button" data-hide-reported="${escapeHTML(report.message_id)}" data-report-id="${escapeHTML(report.id)}">Ocultar mensagem</button><button class="btn secondary" type="button" data-resolve-report="${escapeHTML(report.id)}">Resolver sem ocultar</button></div></article>`).join(''):'<div class="card"><p>Nenhuma denúncia pendente.</p></div>';
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
      if(event==='SIGNED_OUT'){state.user=null;state.profile=null;state.session=null;state.lastHydratedAccessToken=null;state.dailyVentBlocked=false;showAuth();return;}
      if(event==='PASSWORD_RECOVERY'){state.session=session;state.user=session?.user||null;setTimeout(openPasswordModal,0);return;}
      if(session?.user)setTimeout(()=>hydrateSession(session),0);
    });
  }

  async function init(){
    if(state.initialized)return;state.initialized=true;bindEvents();refreshIcons();
    if(!ensureClient())return;
    initAuthListener();
    let sessionResult;
    try {
      sessionResult = await authRequest(() => state.supabase.auth.getSession());
    } catch (error) {
      console.error('SESSION', error);
      const raw = String(error?.message || error || '');
      setStatus('login-status', /failed to fetch|networkerror|network request failed/i.test(raw)
        ? 'Não foi possível conectar ao servidor de login. Tente novamente em alguns segundos.'
        : errorMessage(error));
      return;
    }
    const {data,error}=sessionResult;
    if(error){console.error('SESSION',error);setStatus('login-status',errorMessage(error));return;}
    if(data.session?.user)await hydrateSession(data.session);else{showAuth();setAuthMode('login');}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
