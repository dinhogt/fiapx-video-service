# Enunciado: Hackathon FIAP X (Sistema de Processamento de Vídeos)

Fonte: PDF "POSTECH - SOAT - Fase 5 - Hacka.pdf"

## Contexto
A FIAP X tem um projeto simples que processa um vídeo e devolve as imagens dele num `.zip`. Os investidores querem uma versão em que possam **enviar um vídeo e baixar o zip**. O projeto base (`projeto-fiapx/`) não segue boas práticas de arquitetura.

O desafio é aplicar os conceitos do curso: desenho de arquitetura, microsserviços, qualidade de software, mensageria e outros.

## Requisitos funcionais
- [ ] Processar mais de um vídeo ao mesmo tempo
- [ ] Não perder requisições em picos de carga
- [ ] Sistema protegido por usuário e senha
- [ ] Listagem de status dos vídeos de um usuário
- [ ] Notificação do usuário em caso de erro (e-mail ou outro meio)

## Requisitos técnicos
- [ ] Persistência de dados
- [ ] Arquitetura escalável
- [ ] Versionamento no GitHub
- [ ] Testes que garantam a qualidade
- [ ] CI/CD

## Stack recomendada
| Tema | Recomendação | Escolha do projeto |
|---|---|---|
| Containers | Docker + Kubernetes ou Compose | Docker + EKS, e Compose para o ambiente local |
| Mensageria | RabbitMQ, Kafka ou similar | AWS SQS/SNS (LocalStack no ambiente local) |
| Banco | PostgreSQL + Redis | PostgreSQL + Redis |
| Monitoramento | Prometheus + Grafana, ELK... | Prometheus + Grafana + OpenTelemetry |
| CI/CD | GitHub Actions | GitHub Actions |

## Entregáveis
- [ ] Documentação da arquitetura proposta
- [ ] Script de criação do banco e dos demais recursos
- [ ] Link do GitHub dos projetos
- [ ] Vídeo de **até 10 minutos** com a documentação, a arquitetura escolhida e o projeto funcionando
