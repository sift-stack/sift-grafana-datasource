.PHONY: up log restart down

COMPOSE ?= docker compose

up:
	$(COMPOSE) up --build --watch

log:
	$(COMPOSE) logs --follow

restart:
	$(COMPOSE) down
	$(COMPOSE) up --build --watch

down:
	$(COMPOSE) down
