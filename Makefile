.PHONY: up log restart down

COMPOSE ?= docker compose

up:
	$(COMPOSE) up --build

log:
	$(COMPOSE) logs --follow

restart:
	$(COMPOSE) down
	$(COMPOSE) up --build

down:
	$(COMPOSE) down
