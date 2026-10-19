# Configuração das novas funções do CAE

As alterações visuais e de JavaScript já estão na branch `main`. As funções que guardam dados precisam da migração do banco abaixo.

## Aplicar a migração

1. Abra o projeto CAE no painel do Supabase.
2. Entre em **SQL Editor** e crie uma consulta nova.
3. Abra o arquivo `supabase/migrations/20261019_cae_product_features.sql` deste repositório.
4. Copie o arquivo inteiro para o SQL Editor e execute.
5. Depois, recarregue o CAE e teste as novas funções com uma conta de estudante e outra de moderação.

A publicação no GitHub Pages **não executa** SQL no Supabase. A migração ainda precisa ser aplicada manualmente.

## O que ela cria

- Diário privado de bem-estar (`cae_mood_entries`), com RLS para cada estudante acessar apenas os próprios registros.
- Conteúdos salvos (`cae_bookmarks`), também restritos ao proprietário.
- Preferências do usuário (`cae_user_preferences`).
- Solicitações de exclusão de conta (`cae_account_deletion_requests`).
- Denúncias de publicações, desabafos públicos e mensagens privadas (`cae_content_reports`), recebidas por uma função que verifica se a pessoa pode denunciar aquele conteúdo.

A migração é aditiva: cria tabelas, índices, políticas e funções novas. Ela não apaga as tabelas existentes nem elimina contas automaticamente.

## Antes de disponibilizar aos estudantes

- Revise as políticas RLS já existentes para perfis, chat, desabafos, conversas privadas e demais tabelas.
- Revise as políticas de acesso ao bucket privado `cae-audios` e confirme que URLs assinadas são emitidas somente para pessoas autorizadas.
- Valide com a escola/instituição responsável a política oficial de privacidade, retenção, atendimento aos titulares e tratamento de dados de menores. A página de privacidade do site é apenas uma explicação funcional; não substitui a política oficial.
- Faça testes com contas diferentes: um estudante não deve conseguir ler registros do diário de outro estudante, consultar conteúdo privado de terceiros ou acessar funções de moderação.

## Limites que continuam manuais

- Solicitar a exclusão da conta cria uma solicitação para a equipe; a exclusão real de usuário e dados ainda precisa ser processada no Supabase.
- O tutorial da página inicial permanece como espaço reservado, conforme o planejamento.
- A transcrição automática de um áudio já gravado não foi adicionada: isso exige um modelo de reconhecimento de fala ou um serviço próprio e uma decisão explícita sobre processamento de gravações sensíveis. A função atual de ditado continua sendo fala ao vivo para preencher o campo de texto.
