COMPOSE ?= docker compose
INFRA_SERVICES := postgres redis localstack mailpit alloy prometheus loki tempo grafana

.PHONY: up down logs e2e seed-video ps queues

## Sobe infra + observabilidade e espera healthchecks (F1.5)
up:
	$(COMPOSE) up -d --wait $(INFRA_SERVICES)

## Derruba a stack e remove volumes
down:
	$(COMPOSE) down -v --remove-orphans

## Logs contínuos da stack
logs:
	$(COMPOSE) logs -f --tail=200

## Status dos containers
ps:
	$(COMPOSE) ps

## Lista filas no LocalStack (verificação F1.5: 8 filas)
queues:
	$(COMPOSE) exec -T localstack awslocal sqs list-queues

## E2E Cucumber (features preenchidas nas tarefas F2–F5)
e2e: up
	@echo "Rodando verificação de infra (Cucumber completo chega com os AC)."
	@$(COMPOSE) exec -T localstack awslocal sqs list-queues | tee /tmp/fiapx-queues.txt
	@grep -c 'fiapx-local-' /tmp/fiapx-queues.txt | awk '{ if ($$1 < 8) { print "esperava ≥ 8 filas, achou " $$1; exit 1 } }'
	@if [ -f package.json ] && yarn -s cucumber-js --version >/dev/null 2>&1 && [ -n "$$(find features -name '*.feature' 2>/dev/null)" ]; then \
		yarn cucumber-js; \
	else \
		echo "Sem features Cucumber ainda — gate de infra OK."; \
	fi

## Copia fixture para o bucket local (uso futuro em demos)
seed-video: up
	$(COMPOSE) exec -T localstack awslocal s3 cp - s3://fiapx-local-videos/raw/seed/sample-5s.mp4 < test/fixtures/sample-5s.mp4
