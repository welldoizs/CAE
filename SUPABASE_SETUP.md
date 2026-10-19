# Configuração das novas funções do CAE

As alterações do frontend e as migrações do banco já foram aplicadas ao projeto Supabase **CAE**.

## Estado da configuração

As migrações abaixo estão aplicadas no banco conectado ao projeto:

- `20261019_cae_product_features`: tabelas, políticas RLS e funções para os novos recursos.
- `20261019152309_lock_down_new_rpc_anon_access`: impede que clientes anônimos executem as funções privilegiadas de denúncia, solicitação de exclusão e verificação de equipe.
- `20261019154122_cae_shared_podcasts_and_history_integration`: recomendações comunitárias de podcasts, políticas RLS, suporte a favoritos e denúncias de podcasts.

O banco confirmou que as cinco tabelas novas existem com RLS habilitado e políticas configuradas. Também foi verificado que as três funções RPC novas são executáveis por usuários autenticados, mas não por `anon`.

## O que foi criado

- Diário privado de bem-estar (`cae_mood_entries`), com RLS para cada estudante acessar apenas os próprios registros.
- Conteúdos salvos (`cae_bookmarks`), também restritos ao proprietário.
- Preferências do usuário (`cae_user_preferences`).
- Solicitações de exclusão de conta (`cae_account_deletion_requests`).
- Denúncias de publicações, desabafos públicos e mensagens privadas (`cae_content_reports`), recebidas por uma função que verifica se a pessoa pode denunciar aquele conteúdo.
- Recomendações de podcasts da comunidade (`cae_shared_podcasts`), com envio anônimo para outros estudantes, aprovação da equipe, denúncias e possibilidade de salvar.

As migrações são aditivas: criam tabelas, índices, políticas e funções novas. Não apagam tabelas existentes nem eliminam contas automaticamente.

## Antes de disponibilizar aos estudantes

- Revise as políticas RLS já existentes para perfis, chat, desabafos, conversas privadas e demais tabelas.
- Revise as políticas de acesso ao bucket privado `cae-audios` e confirme que URLs assinadas são emitidas somente para pessoas autorizadas.
- Valide com a escola/instituição responsável a política oficial de privacidade, retenção, atendimento aos titulares e tratamento de dados de menores. A página de privacidade do site é apenas uma explicação funcional; não substitui a política oficial.
- Faça testes com contas diferentes: um estudante não deve conseguir ler registros do diário de outro estudante, consultar conteúdo privado de terceiros ou acessar funções de moderação.
- As recomendações de podcasts mantêm o vínculo da conta no banco para moderação e investigação de denúncias; a identidade não é exibida publicamente. A equipe deve aplicar critérios editoriais e verificar os links antes da aprovação.

## Limites que continuam manuais

- Solicitar a exclusão da conta cria uma solicitação para a equipe; a exclusão real de usuário e dados ainda precisa ser processada no Supabase.
- O tutorial da página inicial permanece como espaço reservado, conforme o planejamento.
- A transcrição automática de um áudio já gravado não foi adicionada: isso exige um modelo de reconhecimento de fala ou um serviço próprio e uma decisão explícita sobre processamento de gravações sensíveis. A função atual de ditado continua sendo fala ao vivo para preencher o campo de texto.
