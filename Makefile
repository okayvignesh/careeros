.PHONY: help install up down logs dev migrate reset test clean

help:
	@echo "Career OS dev commands"
	@echo "  make install    Install all workspace deps"
	@echo "  make up         Start docker services (postgres, redis, api, web)"
	@echo "  make down       Stop docker services"
	@echo "  make logs       Tail docker logs"
	@echo "  make dev        Run api + web + worker in parallel (host)"
	@echo "  make migrate    Apply pending migrations"
	@echo "  make reset      Drop + recreate DB (dev only)"
	@echo "  make test       Run all tests"
	@echo "  make clean      Remove build artifacts + node_modules"

install:
	pnpm install

up:
	pnpm docker:up

down:
	pnpm docker:down

logs:
	pnpm docker:logs

dev:
	pnpm dev

migrate:
	pnpm migrate

reset:
	pnpm db:reset

test:
	pnpm test

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/*/dist apps/*/.next apps/*/.turbo
	rm -rf packages/*/dist packages/*/.turbo
